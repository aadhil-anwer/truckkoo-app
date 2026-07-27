-- ─────────────────────────────────────────────────────────────────────────────
-- 0015 — the ops console read layer, and an audit trail for what comes next
--
-- WHY THIS EXISTS
--
-- Dispatch is what closes the loop in this product: `create_offer` is revoked
-- from every client role, so nothing moves without a dispatcher. That job
-- currently runs on two phone screens with six RPCs behind them, and it is
-- structurally half blind:
--
--   * There is no per-load RPC at all. `ops/[id].tsx` finds a load by scanning
--     `ops_queue()`, so any load outside posted|finding_truck|matched simply
--     cannot be opened. A delivered trip, a cancelled load, a load that got
--     stuck — all invisible.
--   * `ops_queue()` takes no arguments. No filter, no search, no date range, no
--     pagination. It returns every open load, ordered by age, forever.
--   * Nothing can read trips, offer history, drivers, trucks, legs, quotes, or
--     `private.dispatch_log`. That last one is written on every single
--     `post_load` and has never been read by anybody — the same failure shape
--     as `trips.truck_id` in OPEN_ISSUES: a column nobody selected, so nobody
--     noticed.
--
-- This migration adds the read layer a real dispatch console needs, plus the
-- audit table that migrations 0016–0018 will write to when they add the powers
-- that make the console dangerous.
--
-- WHAT IS DELIBERATELY NOT DONE HERE
--
-- No RLS policy on any public table is loosened, no column grant is added for
-- `authenticated`, and `private.candidates_for` stays ungranted. Everything
-- below is a `security definer` function that calls `private.require_ops()`
-- first, pins `search_path = ''`, and fully qualifies every identifier. A bug in
-- an ops screen therefore cannot widen what a shipper or a driver can see —
-- which is the property that makes it safe to give this console more power in
-- the migrations that follow.
--
-- THE ONE DELIBERATE WIDENING: shipper and driver identity
--
-- `ops_queue()` returns no shipper at all, which is correct for a list. A load
-- detail view exists so a dispatcher can ring the shipper, so `ops_load` and
-- friends return `full_name` and `phone`. That is a real increase in what a
-- dispatcher session can read, and it is the point of the screen. It is scoped
-- to these functions; no policy changed.
--
-- THE SECOND, SMALLER ONE: proof-of-delivery photos — see the bottom of the file.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. THE AUDIT TRAIL ══════════════════════════════════════════════════════
--
-- Written now, before any of the write powers exist, because an audit table is
-- the one thing that cannot be backfilled. From 0016 onward a dispatcher can
-- force a load's status, cancel a trip, suspend an account and edit the rate
-- card. Every one of those is a legitimate action that is indistinguishable
-- from a mistake or a compromise after the fact unless it was recorded as it
-- happened.
--
-- `private`, RLS forced, no grant to any client role. Ops reads it back through
-- `public.ops_audit_log()` below — deliberately read-only: there is no RPC that
-- deletes from this table, and adding one would defeat its purpose.

create table if not exists private.ops_audit (
  id          bigint generated always as identity primary key,
  -- The dispatcher, from auth.uid() inside the definer function. Never a
  -- client-supplied value — that would make the log a fiction.
  actor_id    uuid not null,
  -- The RPC name, e.g. 'ops_set_load_status'.
  action      text not null,
  target_kind text not null,
  -- text, not uuid: settings are keyed by name and rate cards by bigint.
  target_id   text,
  before      jsonb,
  after       jsonb,
  reason      text,
  created_at  timestamptz not null default now(),

  constraint ops_audit_reason_len check (reason is null or char_length(reason) <= 500)
);

alter table private.ops_audit enable row level security;
alter table private.ops_audit force row level security;
revoke all on table private.ops_audit from anon, authenticated;

create index if not exists ops_audit_target_idx
  on private.ops_audit (target_kind, target_id, created_at desc);
create index if not exists ops_audit_recent_idx
  on private.ops_audit (created_at desc);
create index if not exists ops_audit_actor_idx
  on private.ops_audit (actor_id, created_at desc);

comment on table private.ops_audit is
  'Every privileged dispatcher write. Written inside the definer function that '
  'performs the write, so it cannot be bypassed by a caller. No delete path '
  'exists on purpose.';

create or replace function private.log_ops(
  p_action      text,
  p_target_kind text,
  p_target_id   text,
  p_before      jsonb default null,
  p_after       jsonb default null,
  p_reason      text  default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.ops_audit (
    actor_id, action, target_kind, target_id, before, after, reason
  )
  values (
    (select auth.uid()), p_action, p_target_kind, p_target_id,
    p_before, p_after, left(p_reason, 500)
  );
$$;

-- Ungranted. Only other definer functions in this schema call it.
revoke all on function private.log_ops(text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;

-- ═══ 2. LOADS ════════════════════════════════════════════════════════════════
--
-- The list `ops_queue()` should always have been. Every status, not three;
-- filterable; paginated; and carrying the shipper so a dispatcher can act.
--
-- `ops_queue()` is left exactly as it is. The mobile ops screens still call it,
-- and a console that breaks the phone it is replacing is not an improvement.
--
-- Every filter argument is null-means-all, so PostgREST callers can omit them.
-- `total_count` rides along as a window function rather than forcing a second
-- round trip for pagination.

create or replace function public.ops_loads(
  p_status  public.load_status[] default null,
  p_origin  bigint  default null,
  p_dest    bigint  default null,
  p_search  text    default null,
  p_from    date    default null,
  p_to      date    default null,
  p_limit   integer default 50,
  p_offset  integer default 0
)
returns table (
  load_id          uuid,
  reference        text,
  shipper_id       uuid,
  shipper_name     text,
  shipper_phone    text,
  origin_city      bigint,
  origin_name      text,
  dest_city        bigint,
  dest_name        text,
  pickup_from      date,
  pickup_to        date,
  goods            text,
  weight_kg        integer,
  truck_type_code  text,
  status           text,
  price_baisa      bigint,
  currency         char(3),
  posted_at        timestamptz,
  age_hours        numeric,
  pending_offers   bigint,
  accepted_offers  bigint,
  declined_offers  bigint,
  auto_offers      bigint,
  trip_id          uuid,
  total_count      bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Bound the page size. An unbounded limit from a client is a denial-of-service
  -- primitive against our own database, and no screen shows 5000 rows usefully.
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text    := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_ops();

  return query
  select
    l.id,
    'NO. ' || upper(left(l.id::text, 8)),
    l.shipper_id,
    sp.full_name,
    sp.phone,
    l.origin_city,
    oc.name_en,
    l.dest_city,
    dc.name_en,
    l.pickup_from,
    l.pickup_to,
    l.goods_description,
    l.weight_kg,
    l.truck_type_code,
    l.status::text,
    l.price_baisa,
    l.currency,
    l.created_at,
    round(extract(epoch from (now() - l.created_at)) / 3600.0, 1),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'pending'),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'accepted'),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'declined'),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.source = 'auto'),
    (select t.id from public.trips t where t.load_id = l.id),
    count(*) over ()
  from public.loads l
  join public.profiles sp on sp.id = l.shipper_id
  join public.cities   oc on oc.id = l.origin_city
  join public.cities   dc on dc.id = l.dest_city
  where (p_status is null or l.status = any (p_status))
    and (p_origin is null or l.origin_city = p_origin)
    and (p_dest   is null or l.dest_city   = p_dest)
    and (p_from   is null or l.pickup_to   >= p_from)
    and (p_to     is null or l.pickup_from <= p_to)
    and (
      v_search is null
      -- The dispatcher's two search habits: reading a reference off a phone
      -- call, and remembering what the cargo was. `left(id::text, 8)` is exactly
      -- what `reference()` shows, so a pasted "NO. A3F21C0B" finds its load.
      or l.id::text ilike left(regexp_replace(v_search, '^NO\.?\s*', '', 'i'), 8) || '%'
      or l.goods_description ilike '%' || v_search || '%'
      or sp.full_name ilike '%' || v_search || '%'
    )
  order by l.created_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.ops_loads(public.load_status[], bigint, bigint, text, date, date, integer, integer)
  from public, anon;
grant execute on function public.ops_loads(public.load_status[], bigint, bigint, text, date, date, integer, integer)
  to authenticated;

-- The per-load RPC that has been missing since 0005. Note it applies no status
-- filter: the whole point is reaching a load the queue cannot show.
create or replace function public.ops_load(p_load_id uuid)
returns table (
  load_id          uuid,
  reference        text,
  shipper_id       uuid,
  shipper_name     text,
  shipper_phone    text,
  shipper_language char(2),
  origin_city      bigint,
  origin_name      text,
  origin_name_ar   text,
  dest_city        bigint,
  dest_name        text,
  dest_name_ar     text,
  pickup_from      date,
  pickup_to        date,
  goods            text,
  weight_kg        integer,
  truck_type_code  text,
  truck_type_name  text,
  status           text,
  price_baisa      bigint,
  currency         char(3),
  posted_at        timestamptz,
  age_hours        numeric,
  pending_offers   bigint,
  auto_offers      bigint,
  trip_id          uuid,
  trip_status      text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    l.id,
    'NO. ' || upper(left(l.id::text, 8)),
    l.shipper_id,
    sp.full_name,
    sp.phone,
    sp.language,
    l.origin_city,
    oc.name_en,
    oc.name_ar,
    l.dest_city,
    dc.name_en,
    dc.name_ar,
    l.pickup_from,
    l.pickup_to,
    l.goods_description,
    l.weight_kg,
    l.truck_type_code,
    tt.name_en,
    l.status::text,
    l.price_baisa,
    l.currency,
    l.created_at,
    round(extract(epoch from (now() - l.created_at)) / 3600.0, 1),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'pending'),
    (select count(*) from public.offers o
      where o.load_id = l.id and o.source = 'auto'),
    t.id,
    t.status::text
  from public.loads l
  join public.profiles sp on sp.id = l.shipper_id
  join public.cities   oc on oc.id = l.origin_city
  join public.cities   dc on dc.id = l.dest_city
  left join public.truck_types tt on tt.code = l.truck_type_code
  left join public.trips       t  on t.load_id = l.id
  where l.id = p_load_id;
end;
$$;

revoke all on function public.ops_load(uuid) from public, anon;
grant execute on function public.ops_load(uuid) to authenticated;

-- Every offer ever made on a load, not just the live ones. A dispatcher about to
-- ring a driver needs to know they already declined this load on Tuesday.
create or replace function public.ops_load_offers(p_load_id uuid)
returns table (
  offer_id     uuid,
  driver_id    uuid,
  driver_name  text,
  driver_phone text,
  verified_at  timestamptz,
  leg_id       uuid,
  status       text,
  source       text,
  created_at   timestamptz,
  expires_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    o.id, o.driver_id, dp.full_name, dp.phone, d.verified_at,
    o.leg_id, o.status::text, o.source, o.created_at, o.expires_at
  from public.offers o
  join public.profiles dp on dp.id = o.driver_id
  left join public.drivers d on d.profile_id = o.driver_id
  where o.load_id = p_load_id
  order by o.created_at desc;
end;
$$;

revoke all on function public.ops_load_offers(uuid) from public, anon;
grant execute on function public.ops_load_offers(uuid) to authenticated;

-- Why auto-dispatch fired, or why it did not. Written by 0014 on every single
-- post_load and never surfaced anywhere until now.
--
-- `detail` holds a SQLSTATE only, never SQLERRM — 0014 is explicit that an error
-- message can carry goods text. That restraint is why this is safe to show.
create or replace function public.ops_dispatch_log(
  p_load_id uuid    default null,
  p_limit   integer default 50
)
returns table (
  id          bigint,
  load_id     uuid,
  reference   text,
  candidates  integer,
  offers_sent integer,
  skipped     text,
  detail      text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform private.require_ops();

  return query
  select
    dl.id, dl.load_id, 'NO. ' || upper(left(dl.load_id::text, 8)),
    dl.candidates, dl.offers_sent, dl.skipped, dl.detail, dl.created_at
  from private.dispatch_log dl
  where p_load_id is null or dl.load_id = p_load_id
  order by dl.created_at desc
  limit v_limit;
end;
$$;

revoke all on function public.ops_dispatch_log(uuid, integer) from public, anon;
grant execute on function public.ops_dispatch_log(uuid, integer) to authenticated;

-- Quote history. `outcome` matters as much as the number: advise_me, no_rate and
-- over_capacity are the three ways a load legitimately has no price, and a
-- dispatcher staring at an empty price field needs to know which one happened.
create or replace function public.ops_quotes(p_load_id uuid)
returns table (
  quote_id    uuid,
  price_baisa bigint,
  currency    char(3),
  outcome     text,
  had_rate    boolean,
  created_at  timestamptz,
  expires_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    q.id, q.price_baisa, q.currency, q.outcome,
    -- Whether a rate card matched, without exposing which card. The card's
    -- contents stay in `private` until 0018 grants them deliberately.
    (q.rate_card_id is not null),
    q.created_at, q.expires_at
  from public.quotes q
  where q.load_id = p_load_id
  order by q.created_at desc;
end;
$$;

revoke all on function public.ops_quotes(uuid) from public, anon;
grant execute on function public.ops_quotes(uuid) to authenticated;

-- ═══ 3. TRIPS ════════════════════════════════════════════════════════════════
--
-- Nothing in the ops surface has ever been able to see a trip. Once a driver
-- accepts, the load leaves `ops_queue()` and vanishes from the dispatcher's
-- world entirely — including the "who is carrying what, right now" question that
-- is most of an operator's actual day.

create or replace function public.ops_trips(
  p_status public.trip_status[] default null,
  p_search text    default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  trip_id        uuid,
  load_id        uuid,
  reference      text,
  status         text,
  driver_id      uuid,
  driver_name    text,
  driver_phone   text,
  truck_id       uuid,
  truck_plate    text,
  truck_type     text,
  shipper_id     uuid,
  shipper_name   text,
  shipper_phone  text,
  origin_name    text,
  dest_name      text,
  pickup_from    date,
  pickup_to      date,
  goods          text,
  price_baisa    bigint,
  currency       char(3),
  created_at     timestamptz,
  last_event_at  timestamptz,
  last_event     text,
  stale_hours    numeric,
  total_count    bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text    := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_ops();

  return query
  select
    t.id, t.load_id, 'NO. ' || upper(left(t.load_id::text, 8)), t.status::text,
    t.driver_id, dp.full_name, dp.phone,
    t.truck_id, tk.plate, tk.truck_type,
    l.shipper_id, sp.full_name, sp.phone,
    oc.name_en, dc.name_en,
    l.pickup_from, l.pickup_to, l.goods_description,
    l.price_baisa, l.currency,
    t.created_at,
    ev.occurred_at,
    ev.type,
    -- How long since anything happened. A trip nobody has touched in two days
    -- is the single most useful thing this screen can point at.
    round(extract(epoch from (now() - coalesce(ev.occurred_at, t.created_at))) / 3600.0, 1),
    count(*) over ()
  from public.trips t
  join public.loads    l  on l.id = t.load_id
  join public.profiles dp on dp.id = t.driver_id
  join public.profiles sp on sp.id = l.shipper_id
  join public.cities   oc on oc.id = l.origin_city
  join public.cities   dc on dc.id = l.dest_city
  left join public.trucks tk on tk.id = t.truck_id
  left join lateral (
    select e.occurred_at, e.type
    from public.trip_events e
    where e.trip_id = t.id
    order by e.occurred_at desc
    limit 1
  ) ev on true
  where (p_status is null or t.status = any (p_status))
    and (
      v_search is null
      or t.load_id::text ilike left(regexp_replace(v_search, '^NO\.?\s*', '', 'i'), 8) || '%'
      or dp.full_name ilike '%' || v_search || '%'
      or sp.full_name ilike '%' || v_search || '%'
      or tk.plate     ilike '%' || v_search || '%'
    )
  order by t.created_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.ops_trips(public.trip_status[], text, integer, integer)
  from public, anon;
grant execute on function public.ops_trips(public.trip_status[], text, integer, integer)
  to authenticated;

create or replace function public.ops_trip(p_trip_id uuid)
returns table (
  trip_id       uuid,
  load_id       uuid,
  reference     text,
  status        text,
  driver_id     uuid,
  driver_name   text,
  driver_phone  text,
  driver_verified_at timestamptz,
  truck_id      uuid,
  truck_plate   text,
  truck_type    text,
  truck_capacity_kg integer,
  leg_id        uuid,
  shipper_id    uuid,
  shipper_name  text,
  shipper_phone text,
  origin_name   text,
  dest_name     text,
  pickup_from   date,
  pickup_to     date,
  goods         text,
  weight_kg     integer,
  price_baisa   bigint,
  currency      char(3),
  load_status   text,
  created_at    timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    t.id, t.load_id, 'NO. ' || upper(left(t.load_id::text, 8)), t.status::text,
    t.driver_id, dp.full_name, dp.phone, d.verified_at,
    t.truck_id, tk.plate, tk.truck_type, tk.capacity_kg,
    t.leg_id,
    l.shipper_id, sp.full_name, sp.phone,
    oc.name_en, dc.name_en,
    l.pickup_from, l.pickup_to, l.goods_description, l.weight_kg,
    l.price_baisa, l.currency, l.status::text,
    t.created_at
  from public.trips t
  join public.loads    l  on l.id = t.load_id
  join public.profiles dp on dp.id = t.driver_id
  join public.profiles sp on sp.id = l.shipper_id
  join public.cities   oc on oc.id = l.origin_city
  join public.cities   dc on dc.id = l.dest_city
  left join public.drivers d  on d.profile_id = t.driver_id
  left join public.trucks  tk on tk.id = t.truck_id
  where t.id = p_trip_id;
end;
$$;

revoke all on function public.ops_trip(uuid) from public, anon;
grant execute on function public.ops_trip(uuid) to authenticated;

-- The event timeline, including `photo_path` for proof of delivery. The path is
-- an object key in the private `pod` bucket, never a URL — see the storage note
-- at the bottom of this file for how the console turns one into a signed URL.
create or replace function public.ops_trip_events(p_trip_id uuid)
returns table (
  event_id    uuid,
  type        text,
  occurred_at timestamptz,
  note        text,
  photo_path  text,
  created_by  uuid,
  author_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    e.id, e.type, e.occurred_at, e.note, e.photo_path, e.created_by, p.full_name
  from public.trip_events e
  left join public.profiles p on p.id = e.created_by
  where e.trip_id = p_trip_id
  order by e.occurred_at asc;
end;
$$;

revoke all on function public.ops_trip_events(uuid) from public, anon;
grant execute on function public.ops_trip_events(uuid) to authenticated;

-- ═══ 4. ACCOUNTS ═════════════════════════════════════════════════════════════
--
-- Shippers and drivers in one list, because the dispatcher's question is "who is
-- this person and what have they got on" rather than "show me a role".
--
-- `drivers.notes` is internal vetting text and has never been client-readable
-- (SENSITIVE_FIELDS.md). It is returned by `ops_account` — the detail view — and
-- not by the list, so it cannot leak through a screenshot of a table.

create or replace function public.ops_accounts(
  p_role     public.user_role default null,
  p_search   text    default null,
  p_verified boolean default null,
  p_limit    integer default 50,
  p_offset   integer default 0
)
returns table (
  profile_id  uuid,
  role        text,
  full_name   text,
  phone       text,
  language    char(2),
  created_at  timestamptz,
  verified_at timestamptz,
  truck_count bigint,
  load_count  bigint,
  leg_count   bigint,
  trip_count  bigint,
  open_count  bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text    := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_ops();

  return query
  select
    p.id, p.role::text, p.full_name, p.phone, p.language, p.created_at,
    d.verified_at,
    (select count(*) from public.trucks tk where tk.owner_id = p.id),
    (select count(*) from public.loads  l  where l.shipper_id = p.id),
    (select count(*) from public.legs   lg where lg.driver_id = p.id),
    (select count(*) from public.trips  t  where t.driver_id  = p.id),
    -- "Has anything on right now" — the column that decides whether this person
    -- is worth a call today.
    case p.role
      when 'shipper' then (select count(*) from public.loads l
                            where l.shipper_id = p.id
                              and l.status in ('posted','finding_truck','matched','assigned','in_transit'))
      else                (select count(*) from public.trips t
                            where t.driver_id = p.id
                              and t.status in ('assigned','in_transit'))
    end,
    count(*) over ()
  from public.profiles p
  left join public.drivers d on d.profile_id = p.id
  where (p_role is null or p.role = p_role)
    and (
      p_verified is null
      -- Only meaningful for drivers; a shipper is never "verified".
      or (p_verified and d.verified_at is not null)
      or (not p_verified and d.verified_at is null and p.role = 'driver')
    )
    and (
      v_search is null
      or p.full_name ilike '%' || v_search || '%'
      or p.phone     ilike '%' || v_search || '%'
    )
  order by p.created_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.ops_accounts(public.user_role, text, boolean, integer, integer)
  from public, anon;
grant execute on function public.ops_accounts(public.user_role, text, boolean, integer, integer)
  to authenticated;

create or replace function public.ops_account(p_profile_id uuid)
returns table (
  profile_id   uuid,
  role         text,
  full_name    text,
  phone        text,
  language     char(2),
  created_at   timestamptz,
  verified_at  timestamptz,
  verified_by  uuid,
  notes        text,
  truck_count  bigint,
  load_count   bigint,
  leg_count    bigint,
  trip_count   bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    p.id, p.role::text, p.full_name, p.phone, p.language, p.created_at,
    d.verified_at, d.verified_by, d.notes,
    (select count(*) from public.trucks tk where tk.owner_id = p.id),
    (select count(*) from public.loads  l  where l.shipper_id = p.id),
    (select count(*) from public.legs   lg where lg.driver_id = p.id),
    (select count(*) from public.trips  t  where t.driver_id  = p.id)
  from public.profiles p
  left join public.drivers d on d.profile_id = p.id
  where p.id = p_profile_id;
end;
$$;

revoke all on function public.ops_account(uuid) from public, anon;
grant execute on function public.ops_account(uuid) to authenticated;

create or replace function public.ops_account_trucks(p_profile_id uuid)
returns table (
  truck_id    uuid,
  truck_type  text,
  type_name   text,
  plate       text,
  capacity_kg integer,
  verified_at timestamptz,
  created_at  timestamptz,
  trip_count  bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    tk.id, tk.truck_type, tt.name_en, tk.plate, tk.capacity_kg,
    tk.verified_at, tk.created_at,
    (select count(*) from public.trips t where t.truck_id = tk.id)
  from public.trucks tk
  left join public.truck_types tt on tt.code = tk.truck_type
  where tk.owner_id = p_profile_id
  order by tk.created_at desc;
end;
$$;

revoke all on function public.ops_account_trucks(uuid) from public, anon;
grant execute on function public.ops_account_trucks(uuid) to authenticated;

-- ═══ 5. LEGS — supply intelligence ═══════════════════════════════════════════
--
-- SECURITY.md is emphatic that driver legs are never readable by shippers or by
-- other drivers, and that drivers do not browse a load board. This function is
-- the mirror image of that rule: it is the supply board, and it is ops-only
-- forever. It exists because "which corridors are covered this week" is a
-- question only the operator may ask, and today nobody can.

create or replace function public.ops_legs(
  p_status public.leg_status[] default null,
  p_origin bigint  default null,
  p_dest   bigint  default null,
  p_from   date    default null,
  p_to     date    default null,
  p_empty  boolean default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  leg_id      uuid,
  driver_id   uuid,
  driver_name text,
  driver_phone text,
  verified_at timestamptz,
  truck_id    uuid,
  truck_plate text,
  truck_type  text,
  capacity_kg integer,
  origin_city bigint,
  origin_name text,
  dest_city   bigint,
  dest_name   text,
  depart_from date,
  depart_to   date,
  is_empty    boolean,
  status      text,
  created_at  timestamptz,
  offer_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.require_ops();

  return query
  select
    lg.id, lg.driver_id, dp.full_name, dp.phone, d.verified_at,
    lg.truck_id, tk.plate, tk.truck_type, tk.capacity_kg,
    lg.origin_city, oc.name_en, lg.dest_city, dc.name_en,
    lg.depart_from, lg.depart_to, lg.is_empty, lg.status::text, lg.created_at,
    (select count(*) from public.offers o where o.leg_id = lg.id),
    count(*) over ()
  from public.legs lg
  join public.profiles dp on dp.id = lg.driver_id
  join public.cities   oc on oc.id = lg.origin_city
  join public.cities   dc on dc.id = lg.dest_city
  left join public.drivers d  on d.profile_id = lg.driver_id
  left join public.trucks  tk on tk.id = lg.truck_id
  where (p_status is null or lg.status = any (p_status))
    and (p_origin is null or lg.origin_city = p_origin)
    and (p_dest   is null or lg.dest_city   = p_dest)
    and (p_from   is null or lg.depart_to   >= p_from)
    and (p_to     is null or lg.depart_from <= p_to)
    and (p_empty  is null or lg.is_empty    = p_empty)
  order by lg.depart_from asc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.ops_legs(public.leg_status[], bigint, bigint, date, date, boolean, integer, integer)
  from public, anon;
grant execute on function public.ops_legs(public.leg_status[], bigint, bigint, date, date, boolean, integer, integer)
  to authenticated;

-- Every leg a given driver has declared. Reached from the account detail view.
create or replace function public.ops_account_legs(p_profile_id uuid)
returns table (
  leg_id      uuid,
  origin_name text,
  dest_name   text,
  depart_from date,
  depart_to   date,
  is_empty    boolean,
  status      text,
  truck_plate text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    lg.id, oc.name_en, dc.name_en, lg.depart_from, lg.depart_to,
    lg.is_empty, lg.status::text, tk.plate, lg.created_at
  from public.legs lg
  join public.cities oc on oc.id = lg.origin_city
  join public.cities dc on dc.id = lg.dest_city
  left join public.trucks tk on tk.id = lg.truck_id
  where lg.driver_id = p_profile_id
  order by lg.depart_from desc
  limit 100;
end;
$$;

revoke all on function public.ops_account_legs(uuid) from public, anon;
grant execute on function public.ops_account_legs(uuid) to authenticated;

-- Every load a given shipper has posted. The demand-side counterpart.
create or replace function public.ops_account_loads(p_profile_id uuid)
returns table (
  load_id     uuid,
  reference   text,
  origin_name text,
  dest_name   text,
  pickup_from date,
  pickup_to   date,
  goods       text,
  status      text,
  price_baisa bigint,
  currency    char(3),
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    l.id, 'NO. ' || upper(left(l.id::text, 8)), oc.name_en, dc.name_en,
    l.pickup_from, l.pickup_to, l.goods_description, l.status::text,
    l.price_baisa, l.currency, l.created_at
  from public.loads l
  join public.cities oc on oc.id = l.origin_city
  join public.cities dc on dc.id = l.dest_city
  where l.shipper_id = p_profile_id
  order by l.created_at desc
  limit 100;
end;
$$;

revoke all on function public.ops_account_loads(uuid) from public, anon;
grant execute on function public.ops_account_loads(uuid) to authenticated;

-- ═══ 6. THE OVERVIEW ═════════════════════════════════════════════════════════
--
-- One round trip, on purpose. A dashboard that fires fourteen count queries on
-- load is the standard way this screen becomes the slowest thing in the product,
-- and it is the screen most likely to be left open all day.
--
-- Every figure here is a live count from our own tables. Nothing on this screen
-- is ever a fabricated or illustrative number — CLAUDE.md §5 is about public
-- claims, but a dispatcher acting on a made-up figure is a worse outcome than a
-- customer reading one.

create or replace function public.ops_stats()
returns table (
  loads_posted          bigint,
  loads_finding_truck   bigint,
  loads_matched         bigint,
  loads_assigned        bigint,
  loads_in_transit      bigint,
  loads_delivered       bigint,
  loads_cancelled       bigint,
  -- Aging: open loads with no live offer, bucketed. This is the console's
  -- reason to exist — a shipper never hits a dead end, so something sitting
  -- here for a day is a promise being broken quietly.
  unmatched_under_4h    bigint,
  unmatched_4_to_24h    bigint,
  unmatched_over_24h    bigint,
  unpriced_open         bigint,
  offers_pending        bigint,
  offers_expiring_6h    bigint,
  offers_already_expired bigint,
  trips_assigned        bigint,
  trips_in_transit      bigint,
  trips_stale_48h       bigint,
  drivers_total         bigint,
  drivers_verified      bigint,
  legs_open_next_7d     bigint,
  auto_dispatch_enabled boolean,
  dispatch_7d_sent      bigint,
  dispatch_7d_no_candidates bigint,
  dispatch_7d_no_price  bigint,
  dispatch_7d_disabled  bigint,
  dispatch_7d_error     bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  with open_loads as (
    select l.id, l.created_at, l.price_baisa
    from public.loads l
    where l.status in ('posted', 'finding_truck', 'matched')
  ),
  unmatched as (
    select ol.*
    from open_loads ol
    where not exists (
      select 1 from public.offers o
      where o.load_id = ol.id and o.status in ('pending', 'accepted')
    )
  ),
  trip_last as (
    select t.id, t.status,
           coalesce(
             (select max(e.occurred_at) from public.trip_events e where e.trip_id = t.id),
             t.created_at
           ) as touched_at
    from public.trips t
  )
  select
    (select count(*) from public.loads where status = 'posted'),
    (select count(*) from public.loads where status = 'finding_truck'),
    (select count(*) from public.loads where status = 'matched'),
    (select count(*) from public.loads where status = 'assigned'),
    (select count(*) from public.loads where status = 'in_transit'),
    (select count(*) from public.loads where status = 'delivered'),
    (select count(*) from public.loads where status = 'cancelled'),

    (select count(*) from unmatched where now() - created_at <  interval '4 hours'),
    (select count(*) from unmatched where now() - created_at >= interval '4 hours'
                                     and now() - created_at <  interval '24 hours'),
    (select count(*) from unmatched where now() - created_at >= interval '24 hours'),
    (select count(*) from open_loads where price_baisa is null),

    (select count(*) from public.offers where status = 'pending'),
    (select count(*) from public.offers
      where status = 'pending' and expires_at > now() and expires_at <= now() + interval '6 hours'),
    -- Pending but already past expiry: the sweep has not been run. 0013 made
    -- this a manual button because pg_cron is not enabled, which means it is
    -- exactly the kind of thing that silently stops happening.
    (select count(*) from public.offers where status = 'pending' and expires_at <= now()),

    (select count(*) from public.trips where status = 'assigned'),
    (select count(*) from public.trips where status = 'in_transit'),
    (select count(*) from trip_last
      where status in ('assigned', 'in_transit') and now() - touched_at > interval '48 hours'),

    (select count(*) from public.profiles where role = 'driver'),
    (select count(*) from public.drivers where verified_at is not null),
    (select count(*) from public.legs
      where status = 'open' and depart_from <= (now() + interval '7 days')::date
        and depart_to >= now()::date),

    private.setting_bool('auto_dispatch_enabled', true),

    (select coalesce(sum(dl.offers_sent), 0) from private.dispatch_log dl
      where dl.created_at > now() - interval '7 days'),
    (select count(*) from private.dispatch_log dl
      where dl.created_at > now() - interval '7 days' and dl.skipped = 'no_candidates'),
    (select count(*) from private.dispatch_log dl
      where dl.created_at > now() - interval '7 days' and dl.skipped = 'no_price'),
    (select count(*) from private.dispatch_log dl
      where dl.created_at > now() - interval '7 days' and dl.skipped = 'disabled'),
    (select count(*) from private.dispatch_log dl
      where dl.created_at > now() - interval '7 days' and dl.skipped = 'error');
end;
$$;

revoke all on function public.ops_stats() from public, anon;
grant execute on function public.ops_stats() to authenticated;

-- ═══ 7. THE AUDIT LOG, READ BACK ═════════════════════════════════════════════

create or replace function public.ops_audit_log(
  p_target_kind text    default null,
  p_target_id   text    default null,
  p_actor_id    uuid    default null,
  p_limit       integer default 100,
  p_offset      integer default 0
)
returns table (
  id          bigint,
  actor_id    uuid,
  actor_name  text,
  action      text,
  target_kind text,
  target_id   text,
  before      jsonb,
  after       jsonb,
  reason      text,
  created_at  timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.require_ops();

  return query
  select
    a.id, a.actor_id, p.full_name, a.action, a.target_kind, a.target_id,
    a.before, a.after, a.reason, a.created_at,
    count(*) over ()
  from private.ops_audit a
  left join public.profiles p on p.id = a.actor_id
  where (p_target_kind is null or a.target_kind = p_target_kind)
    and (p_target_id   is null or a.target_id   = p_target_id)
    and (p_actor_id    is null or a.actor_id    = p_actor_id)
  order by a.created_at desc, a.id desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.ops_audit_log(text, text, uuid, integer, integer)
  from public, anon;
grant execute on function public.ops_audit_log(text, text, uuid, integer, integer)
  to authenticated;

-- ═══ 8. PROOF-OF-DELIVERY PHOTOS ═════════════════════════════════════════════
--
-- READ THIS BEFORE CHANGING IT.
--
-- Everything else in this migration reaches across tenants through a definer
-- function, so no table policy needed touching. Storage cannot work that way: a
-- signed URL is minted by the storage service against `storage.objects` RLS, not
-- by SQL. A definer function cannot produce one, and the alternative — a
-- service-role key somewhere — is exactly what the console is built to avoid.
--
-- So this is the one new *policy* in the ops surface. It is additive and scoped
-- to `private.is_ops()`: it grants dispatchers read on the `pod` bucket and
-- changes nothing for anyone else. The two existing policies from 0004 (driver
-- uploads, trip participants read) are untouched, so a bug here still cannot
-- widen what a shipper or another driver can reach.
--
-- The bucket stays private, and proof of delivery stays append-only: there is
-- still no update or delete policy for anybody, ops included. A dispatcher can
-- look at the evidence; nobody can quietly replace it.

drop policy if exists "ops reads pod" on storage.objects;

create policy "ops reads pod" on storage.objects
  for select to authenticated
  using (bucket_id = 'pod' and (select private.is_ops()));

comment on table private.ops_audit is
  'Every privileged dispatcher write. Written inside the definer function that '
  'performs the write, so it cannot be bypassed by a caller. No delete path '
  'exists on purpose — see supabase/migrations/0015.';
