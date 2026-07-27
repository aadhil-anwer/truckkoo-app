-- Truckkoo — initial schema.
--
-- Security posture per SECURITY.md. Read before changing a type or a grant:
--   * DENY BY DEFAULT: every table is revoked from anon/authenticated, then
--     granted back per column, per operation, with a reason.
--   * loads.truck_type_code is NULLABLE — that is "Not sure, advise me"
--   * money is integer baisa, never float — OMR has THREE decimals
--   * no status or price column carries a client write grant (SENSITIVE_FIELDS.md)
--   * drivers never browse loads; they see offers addressed to them

create extension if not exists "pgcrypto";

-- ─── the private schema ─────────────────────────────────────────────────────
-- Helper functions, feature flags, and rate-limit state live here rather than in
-- `public`. The point is API surface: **PostgREST only exposes `public`**, so
-- nothing in `private` can be called as an RPC from a client, however the grants
-- end up. That is the real containment.
--
-- Note on grants: an RLS policy expression is evaluated with the privileges of
-- the *querying* role, so a helper used inside a policy (actor_role) must still
-- be granted EXECUTE to `authenticated` or every policy referencing it fails with
-- "permission denied for function". Helpers called only from inside other
-- `security definer` functions (check_rate_limit, setting_bool,
-- is_verified_driver) need no grant at all, because those run as the owner.

create schema if not exists private;

revoke all on schema private from anon, authenticated;
-- USAGE only, so the two policy helpers below can be resolved. No table access.
grant usage on schema private to authenticated;

-- ─── enums (allowlists, per SECURITY.md §6) ─────────────────────────────────

create type user_role as enum ('shipper', 'driver');

-- 'finding_truck' is the no-match concierge path. A shipper must never see a
-- dead end, so this is a real state, not an error.
create type load_status as enum (
  'posted', 'finding_truck', 'matched', 'assigned',
  'in_transit', 'delivered', 'closed', 'cancelled'
);

create type leg_status   as enum ('open', 'matched', 'closed', 'cancelled');
create type offer_status as enum ('pending', 'accepted', 'declined', 'expired');
create type trip_status  as enum ('assigned', 'in_transit', 'delivered', 'closed', 'cancelled');

-- ─── reference data ─────────────────────────────────────────────────────────
-- Sequential ids here are the documented exception in SECURITY.md §3: public
-- reference data, no owner, no PII, and the app ships the whole list to every
-- client by design. No other table may take this exception.

create table public.cities (
  id       bigint generated always as identity primary key,
  name_en  text not null unique,
  name_ar  text not null,
  country  char(2) not null,
  corridor text,
  sort     integer not null default 0
);

create table public.truck_types (
  code           text primary key,
  name_en        text not null,
  name_ar        text not null,
  description_en text,
  description_ar text,
  capacity_kg    integer not null,
  sort           integer not null default 0
);

-- ─── people ─────────────────────────────────────────────────────────────────

create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  -- INSERT-grantable (self-selected at signup), never UPDATE-grantable.
  -- See SENSITIVE_FIELDS.md — changing role crosses a tenant boundary.
  role       user_role not null,
  full_name  text,
  phone      text,
  language   char(2) not null default 'en',
  created_at timestamptz not null default now(),

  constraint profiles_language_valid check (language in ('en', 'ar')),
  constraint profiles_name_len  check (full_name is null or char_length(full_name) <= 120),
  constraint profiles_phone_len check (phone is null or char_length(phone) <= 24)
);

-- Split from profiles so verification carries its own audit trail, and so no
-- client grant on profiles can ever touch it.
create table public.drivers (
  profile_id  uuid primary key references public.profiles on delete cascade,
  verified_at timestamptz,
  verified_by uuid references auth.users,
  notes       text
);

create table public.trucks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles on delete cascade,
  truck_type  text not null references public.truck_types,
  plate       text,
  capacity_kg integer,
  verified_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint trucks_plate_len check (plate is null or char_length(plate) <= 24),
  constraint trucks_capacity_sane check (capacity_kg is null or (capacity_kg > 0 and capacity_kg <= 60000))
);

-- ─── supply: driver-declared legs ───────────────────────────────────────────
-- Supply intelligence. A competitor reading this table knows where every
-- Truckkoo truck will be and when. Never readable across tenants, never by
-- shippers. Matching crosses this boundary only via a definer function.

create table public.legs (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references public.profiles on delete cascade,
  truck_id    uuid references public.trucks on delete set null,
  origin_city bigint not null references public.cities,
  dest_city   bigint not null references public.cities,
  depart_from date not null,
  depart_to   date not null,
  is_empty    boolean not null default true,
  status      leg_status not null default 'open',
  created_at  timestamptz not null default now(),

  constraint legs_window_ordered check (depart_to >= depart_from),
  constraint legs_not_circular   check (origin_city <> dest_city),
  -- No legs in 2074 (SECURITY.md §6: bound everything)
  constraint legs_window_sane    check (depart_from >= date '2024-01-01'
                                    and depart_to   <= date '2035-01-01'
                                    and depart_to - depart_from <= 60)
);

-- ─── demand: shipper loads ──────────────────────────────────────────────────

create table public.loads (
  id          uuid primary key default gen_random_uuid(),
  shipper_id  uuid not null references public.profiles on delete cascade,
  origin_city bigint not null references public.cities,
  dest_city   bigint not null references public.cities,
  pickup_from date not null,
  pickup_to   date not null,
  weight_kg   integer,

  -- NULLABLE ON PURPOSE. The website's default truck choice is
  -- "Not sure — advise me", and for an audience with near-zero tech skills that
  -- is the single most important affordance in the product. Making this NOT NULL
  -- silently deletes it. Don't.
  truck_type_code text references public.truck_types,

  goods_description text not null,
  status            load_status not null default 'posted',

  -- Money: integer baisa. OMR is a THREE-decimal currency (1000 baisa = 1 rial)
  -- and almost every formatter assumes two. Never float, never numeric.
  -- No client write grant on either column — the server owns price. (§5)
  price_baisa bigint,
  currency    char(3) not null default 'OMR',

  created_at timestamptz not null default now(),

  constraint loads_window_ordered check (pickup_to >= pickup_from),
  constraint loads_not_circular   check (origin_city <> dest_city),
  constraint loads_price_positive check (price_baisa is null or price_baisa > 0),
  constraint loads_weight_sane    check (weight_kg is null or (weight_kg > 0 and weight_kg <= 60000)),
  constraint loads_goods_len      check (char_length(goods_description) between 1 and 500),
  constraint loads_window_sane    check (pickup_from >= date '2024-01-01'
                                    and pickup_to   <= date '2035-01-01'
                                    and pickup_to - pickup_from <= 60)
);

-- ─── offers: the only bridge from a load to a driver ────────────────────────
-- Replaces a browsable load board. A load board would let any signed-up
-- "driver" read every shipper's cargo details — crown jewel #2. Drivers see
-- only offers addressed to them.

create table public.offers (
  id         uuid primary key default gen_random_uuid(),
  load_id    uuid not null references public.loads on delete cascade,
  driver_id  uuid not null references public.profiles on delete cascade,
  leg_id     uuid references public.legs on delete set null,
  status     offer_status not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '48 hours',

  unique (load_id, driver_id)
);

-- ─── the trip ───────────────────────────────────────────────────────────────

create table public.trips (
  id         uuid primary key default gen_random_uuid(),
  load_id    uuid not null unique references public.loads on delete cascade,
  driver_id  uuid not null references public.profiles,
  truck_id   uuid references public.trucks on delete set null,
  leg_id     uuid references public.legs on delete set null,
  status     trip_status not null default 'assigned',
  created_at timestamptz not null default now()
);

create table public.trip_events (
  id      uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips on delete cascade,
  type    text not null,
  -- Server-set. Backdating a delivery is fraud, so this is not client-writable.
  occurred_at timestamptz not null default now(),
  note        text,
  -- Storage object path, never a public URL. Bucket is private (0004).
  photo_path  text,
  -- Trigger-set from the session, never client-supplied.
  created_by  uuid references auth.users,

  constraint trip_events_type_valid check (type in ('picked_up', 'en_route', 'delivered', 'note')),
  constraint trip_events_note_len   check (note is null or char_length(note) <= 500),
  constraint trip_events_path_len   check (photo_path is null or char_length(photo_path) <= 300)
);

-- ─── indexes ────────────────────────────────────────────────────────────────
-- Two jobs here, and both matter:
--   1. matching (the leading composite indexes)
--   2. RLS. Every policy above filters on an ownership column, so those columns
--      are on the hot path of literally every query. An unindexed ownership
--      column means a sequential scan per policy check.
-- Postgres does NOT index foreign keys automatically, and unindexed FKs also make
-- ON DELETE CASCADE lock and scan the child table.

-- matching
create index legs_match_idx  on public.legs  (origin_city, dest_city, depart_from, status);
create index loads_match_idx on public.loads (origin_city, dest_city, pickup_from, status);

-- ownership / RLS hot paths
create index loads_shipper_idx on public.loads  (shipper_id, created_at desc);
create index legs_driver_idx   on public.legs   (driver_id, created_at desc);
create index offers_driver_idx on public.offers (driver_id, status, created_at desc);
create index offers_load_idx   on public.offers (load_id, status);
create index trips_driver_idx  on public.trips  (driver_id, created_at desc);
create index trips_load_idx    on public.trips  (load_id);
create index trip_events_idx   on public.trip_events (trip_id, occurred_at desc);
create index trucks_owner_idx  on public.trucks (owner_id);

-- remaining foreign keys
create index legs_truck_idx        on public.legs        (truck_id);
create index legs_dest_idx         on public.legs        (dest_city);
create index loads_dest_idx        on public.loads       (dest_city);
create index loads_truck_type_idx  on public.loads       (truck_type_code);
create index trucks_type_idx       on public.trucks      (truck_type);
create index offers_leg_idx        on public.offers      (leg_id);
create index trips_truck_idx       on public.trips       (truck_id);
create index trips_leg_idx         on public.trips       (leg_id);
create index trip_events_actor_idx on public.trip_events (created_by);
create index drivers_verified_by_idx on public.drivers   (verified_by);

-- ─── actor role helper ──────────────────────────────────────────────────────
-- Definer + pinned search_path so reading profiles inside a profiles policy
-- cannot recurse, and so the function is not a search-path escalation
-- primitive (SECURITY.md §7).

create or replace function private.actor_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

revoke all on function private.actor_role() from public, anon;
-- Required: this one IS used inside RLS policies, which evaluate as the querying role.
grant execute on function private.actor_role() to authenticated;

-- ─── cross-table relationship helpers ───────────────────────────────────────
-- These exist to BREAK RLS POLICY RECURSION, and the reason is worth spelling out
-- because it is easy to reintroduce:
--
--   a policy on `loads` that queries `offers`, while a policy on `offers` queries
--   `loads`, is mutual recursion. Postgres detects it and every query against
--   either table then fails outright with
--   "infinite recursion detected in policy for relation".
--
-- Each helper is `security definer`, so it bypasses RLS on the table it reads and
-- the cycle never forms. Each still checks `auth.uid()` internally, so bypassing
-- RLS does not mean bypassing authorization — the check moves from the policy
-- into the function. They are also faster: one indexed lookup instead of a
-- nested policy evaluation.

/** Does the calling user own this load, as the shipper? */
create or replace function private.owns_load(p_load_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.loads l
    where l.id = p_load_id and l.shipper_id = (select auth.uid())
  );
$$;

/** Does the calling driver hold a live offer on this load? */
create or replace function private.driver_has_offer(p_load_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.offers o
    where o.load_id = p_load_id
      and o.driver_id = (select auth.uid())
      and o.status in ('pending', 'accepted')
  );
$$;

/** Is the calling driver assigned to a trip for this load? */
create or replace function private.driver_on_load(p_load_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.trips t
    where t.load_id = p_load_id and t.driver_id = (select auth.uid())
  );
$$;

/** Is the calling user either side of this trip? */
create or replace function private.is_trip_participant(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.trips t
    left join public.loads l on l.id = t.load_id
    where t.id = p_trip_id
      and (select auth.uid()) in (t.driver_id, l.shipper_id)
  );
$$;

/** May the calling driver append an event to this trip? Live trips only. */
create or replace function private.can_append_trip_event(p_trip_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip_id
      and t.driver_id = (select auth.uid())
      and t.status in ('assigned', 'in_transit')
  );
$$;

revoke all on function private.owns_load(uuid)             from public, anon;
revoke all on function private.driver_has_offer(uuid)      from public, anon;
revoke all on function private.driver_on_load(uuid)        from public, anon;
revoke all on function private.is_trip_participant(uuid)   from public, anon;
revoke all on function private.can_append_trip_event(uuid) from public, anon;

-- Used inside policies, so `authenticated` needs EXECUTE (see the note above).
grant execute on function private.owns_load(uuid)             to authenticated;
grant execute on function private.driver_has_offer(uuid)      to authenticated;
grant execute on function private.driver_on_load(uuid)        to authenticated;
grant execute on function private.is_trip_participant(uuid)   to authenticated;
grant execute on function private.can_append_trip_event(uuid) to authenticated;

-- ─── hostile-text guard ─────────────────────────────────────────────────────
-- The client is hostile (§0.2) and text from it reaches WhatsApp deep links and
-- a bilingual RTL UI. Bidi overrides inside a name are a display-spoofing
-- vector. Sanitised on the client in src/lib/safe-text.ts AND rejected here,
-- because a client-side control is not a control.

create or replace function private.contains_unsafe_text(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and (
    -- U+202A..U+202E, U+2066..U+2069 bidi overrides and isolates
    p ~ ('[' || chr(8234) || '-' || chr(8238) || chr(8294) || '-' || chr(8297) || ']')
    -- C0 controls except tab/newline/CR
    or p ~ '[\x00-\x08\x0B\x0C\x0E-\x1F]'
  );
$$;

create or replace function private.reject_unsafe_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.contains_unsafe_text(new.goods_description) then
    raise exception 'unsafe control characters in text' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger loads_reject_unsafe_text
  before insert or update on public.loads
  for each row execute function private.reject_unsafe_text();

create or replace function private.reject_unsafe_profile_text()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.contains_unsafe_text(new.full_name) then
    raise exception 'unsafe control characters in text' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger profiles_reject_unsafe_text
  before insert or update on public.profiles
  for each row execute function private.reject_unsafe_profile_text();

-- Attribution is server-derived, never client-supplied (§2).
create or replace function private.set_event_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by  := auth.uid();
  new.occurred_at := now();
  return new;
end;
$$;

create trigger trip_events_set_actor
  before insert on public.trip_events
  for each row execute function private.set_event_actor();

-- ═══ DENY BY DEFAULT ════════════════════════════════════════════════════════
-- Supabase grants broadly to anon/authenticated on new public tables. Take it
-- all back, then hand back the minimum. anon gets nothing anywhere: this app
-- has no unauthenticated surface.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;

alter table public.cities      enable row level security;
alter table public.truck_types enable row level security;
alter table public.profiles    enable row level security;
alter table public.drivers     enable row level security;
alter table public.trucks      enable row level security;
alter table public.legs        enable row level security;
alter table public.loads       enable row level security;
alter table public.offers      enable row level security;
alter table public.trips       enable row level security;
alter table public.trip_events enable row level security;

-- Belt and braces: RLS also applies to the table owner.
alter table public.cities      force row level security;
alter table public.truck_types force row level security;
alter table public.profiles    force row level security;
alter table public.drivers     force row level security;
alter table public.trucks      force row level security;
alter table public.legs        force row level security;
alter table public.loads       force row level security;
alter table public.offers      force row level security;
alter table public.trips       force row level security;
alter table public.trip_events force row level security;

-- ─── reference: read-only to signed-in users ────────────────────────────────
-- A driver who could edit truck_types.capacity_kg would defeat capacity
-- filtering in matching. SELECT only.

grant select on public.cities      to authenticated;
grant select on public.truck_types to authenticated;

create policy "reference readable" on public.cities
  for select to authenticated using (true);
create policy "reference readable" on public.truck_types
  for select to authenticated using (true);

-- ─── profiles ───────────────────────────────────────────────────────────────
-- role is INSERT-grantable (self-selected at signup) and NOT update-grantable.
-- No delete grant, so the row cannot be recreated with a different role.

grant select on public.profiles to authenticated;
grant insert (id, role, full_name, phone, language) on public.profiles to authenticated;
grant update (full_name, phone, language)           on public.profiles to authenticated;

create policy "own profile readable" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "own profile insertable" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "own profile updatable" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ─── drivers: read own, write never ─────────────────────────────────────────
-- verified_at is the public trust claim. Ops writes it via a privileged path.

grant select (profile_id, verified_at) on public.drivers to authenticated;

create policy "own driver record readable" on public.drivers
  for select to authenticated using (profile_id = (select auth.uid()));

-- ─── trucks ─────────────────────────────────────────────────────────────────
-- owner_id fixed at insert; verified_at never client-writable.

grant select on public.trucks to authenticated;
grant insert (owner_id, truck_type, plate, capacity_kg) on public.trucks to authenticated;
grant update (truck_type, plate, capacity_kg)           on public.trucks to authenticated;
grant delete on public.trucks to authenticated;

create policy "own trucks readable" on public.trucks
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "own trucks insertable" on public.trucks
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "own trucks updatable" on public.trucks
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "own trucks deletable" on public.trucks
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ─── legs: own only, always ─────────────────────────────────────────────────
-- status has no client grant: transitions go through RPCs (§8).

grant select on public.legs to authenticated;
grant insert (driver_id, truck_id, origin_city, dest_city, depart_from, depart_to, is_empty)
  on public.legs to authenticated;
grant update (truck_id, origin_city, dest_city, depart_from, depart_to, is_empty)
  on public.legs to authenticated;

create policy "own legs readable" on public.legs
  for select to authenticated using (driver_id = (select auth.uid()));
create policy "own legs insertable" on public.legs
  for insert to authenticated with check (driver_id = (select auth.uid()) and (select private.actor_role()) = 'driver');
create policy "own legs updatable" on public.legs
  for update to authenticated
  using (driver_id = (select auth.uid()) and status = 'open')
  with check (driver_id = (select auth.uid()));

-- ─── loads ──────────────────────────────────────────────────────────────────
-- No UPDATE grant at all: status and price are server-owned, and edits go
-- through RPCs. A driver reads a load ONLY through an offer addressed to them
-- or a trip they are driving — never a browsable board.

grant select on public.loads to authenticated;
grant insert (shipper_id, origin_city, dest_city, pickup_from, pickup_to,
              weight_kg, truck_type_code, goods_description)
  on public.loads to authenticated;

create policy "own loads readable" on public.loads
  for select to authenticated using (shipper_id = (select auth.uid()));
create policy "own loads insertable" on public.loads
  for insert to authenticated with check (shipper_id = (select auth.uid()) and (select private.actor_role()) = 'shipper');

create policy "driver reads offered load" on public.loads
  for select to authenticated using (
    (select private.actor_role()) = 'driver'
    and (
      (select private.driver_has_offer(loads.id))
      or (select private.driver_on_load(loads.id))
    )
  );

-- ─── offers: read own, resolve via RPC ──────────────────────────────────────
-- No write grant. Forging an offer to yourself would grant read access to
-- another shipper's cargo details.

grant select on public.offers to authenticated;

create policy "driver reads own offers" on public.offers
  for select to authenticated using (driver_id = (select auth.uid()));
create policy "shipper reads offers on own loads" on public.offers
  for select to authenticated using (
    (select private.owns_load(offers.load_id))
  );

-- ─── trips: read as participant, mutate via RPC ─────────────────────────────

grant select on public.trips to authenticated;

create policy "trip participants read" on public.trips
  for select to authenticated using (
    driver_id = (select auth.uid())
    or (select private.owns_load(trips.load_id))
  );

-- ─── trip events: append-only ───────────────────────────────────────────────
-- Insert only. No update, no delete: a proof-of-delivery trail that can be
-- edited is not a trail.

grant select on public.trip_events to authenticated;
grant insert (trip_id, type, note, photo_path) on public.trip_events to authenticated;

create policy "trip participants read events" on public.trip_events
  for select to authenticated using (
    (select private.is_trip_participant(trip_events.trip_id))
  );

create policy "driver appends own trip events" on public.trip_events
  for insert to authenticated with check (
    (select private.can_append_trip_event(trip_events.trip_id))
  );
