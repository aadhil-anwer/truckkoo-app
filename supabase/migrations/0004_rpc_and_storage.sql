-- Truckkoo — state-machine RPCs, rate limiting, private storage.
--
-- Every state transition lives here. No client holds an UPDATE grant on a
-- status column (SENSITIVE_FIELDS.md), so this file is the only way state moves.
--
-- Every function below: `security definer`, `search_path = ''`, fully qualified
-- identifiers, ownership re-checked per object, fail closed and loud (§0.5).

-- ─── feature flags ──────────────────────────────────────────────────────────
-- Ops-only. No client grant.

create table private.app_settings (
  key   text primary key,
  value jsonb not null
);

alter table private.app_settings enable row level security;
alter table private.app_settings force row level security;
revoke all on private.app_settings from anon, authenticated;

insert into private.app_settings (key, value) values
  -- Flip to true before open driver signup ships. See SECURITY.md / 0003.
  ('require_verified_driver', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function private.setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value)::boolean from private.app_settings s where s.key = p_key), p_default);
$$;

revoke all on function private.setting_bool(text, boolean) from public, anon, authenticated;

-- ─── rate limiting ──────────────────────────────────────────────────────────
-- Per-user throttle. Postgres cannot see client IPs, so per-IP limits need an
-- Edge Function or gateway and are NOT implemented — see SECURITY.md §11. Do not
-- ship an anonymous endpoint until they are.

create table private.rate_events (
  id         bigint generated always as identity primary key,
  actor_id   uuid not null references auth.users on delete cascade,
  action     text not null,
  created_at timestamptz not null default now()
);

create index rate_events_lookup on private.rate_events (actor_id, action, created_at desc);

alter table private.rate_events enable row level security;
alter table private.rate_events force row level security;
revoke all on private.rate_events from anon, authenticated;

-- Raises on breach. Returns nothing about the limit's shape (§11).
create or replace function private.check_rate_limit(
  p_action   text,
  p_max      integer,
  p_window   interval
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_count
  from private.rate_events r
  where r.actor_id = v_actor
    and r.action = p_action
    and r.created_at > now() - p_window;

  if v_count >= p_max then
    raise exception 'rate limit exceeded' using errcode = 'too_many_connections';
  end if;

  insert into private.rate_events (actor_id, action) values (v_actor, p_action);
end;
$$;

revoke all on function private.check_rate_limit(text, integer, interval) from public, anon, authenticated;

-- ─── shipper: post a load ───────────────────────────────────────────────────
-- Wraps the insert so it can be rate-limited and so status/price stay
-- server-owned. Inputs are bounded here as well as by table constraints.

create or replace function public.post_load(
  p_origin_city     bigint,
  p_dest_city       bigint,
  p_pickup_from     date,
  p_pickup_to       date,
  p_goods           text,
  p_weight_kg       integer default null,
  p_truck_type_code text    default null   -- NULL = "Not sure, advise me"
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if (select private.actor_role()) <> 'shipper' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  perform private.check_rate_limit('post_load', 20, interval '1 hour');

  -- Fail closed on anything unexpected rather than coercing it (§0.5).
  if p_goods is null or char_length(btrim(p_goods)) = 0 then
    raise exception 'goods description required' using errcode = 'check_violation';
  end if;

  if p_truck_type_code is not null
     and not exists (select 1 from public.truck_types t where t.code = p_truck_type_code) then
    raise exception 'unknown truck type' using errcode = 'foreign_key_violation';
  end if;

  insert into public.loads (
    shipper_id, origin_city, dest_city, pickup_from, pickup_to,
    weight_kg, truck_type_code, goods_description, status
  ) values (
    -- shipper_id from the session, never from a parameter (§2)
    v_actor, p_origin_city, p_dest_city, p_pickup_from, p_pickup_to,
    p_weight_kg, p_truck_type_code, btrim(p_goods), 'posted'
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.post_load(bigint, bigint, date, date, text, integer, text) from public, anon;
grant execute on function public.post_load(bigint, bigint, date, date, text, integer, text) to authenticated;

-- ─── ops/matching: create an offer ──────────────────────────────────────────
-- Not client-callable. Offers are minted by the matching path (Edge Function or
-- ops console) because an offer grants a driver read access to cargo details.

create or replace function public.create_offer(
  p_load_id   uuid,
  p_driver_id uuid,
  p_leg_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.loads l
                 where l.id = p_load_id
                   and l.status in ('posted', 'finding_truck', 'matched')) then
    raise exception 'load not open for offers' using errcode = 'check_violation';
  end if;

  insert into public.offers (load_id, driver_id, leg_id)
  values (p_load_id, p_driver_id, p_leg_id)
  on conflict (load_id, driver_id) do update set status = 'pending', expires_at = now() + interval '48 hours'
  returning id into v_id;

  update public.loads set status = 'matched'
  where id = p_load_id and status in ('posted', 'finding_truck');

  return v_id;
end;
$$;

-- Deliberately NOT granted to authenticated. Ops/server only.
revoke all on function public.create_offer(uuid, uuid, uuid) from public, anon, authenticated;

-- ─── driver: respond to an offer ────────────────────────────────────────────
-- The only path that creates a trip. Enforces the offer state machine, the
-- driver's ownership of the offer, and expiry.

create or replace function public.respond_to_offer(
  p_offer_id uuid,
  p_accept   boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_offer   public.offers;
  v_truck   uuid;
  v_trip_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Fetch SCOPED TO THE ACTOR, never fetch-then-check (§3).
  select * into v_offer
  from public.offers o
  where o.id = p_offer_id and o.driver_id = v_actor
  for update;

  -- Not found and not-yours are indistinguishable to the caller (§3).
  if v_offer.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'offer already resolved' using errcode = 'check_violation';
  end if;

  if v_offer.expires_at <= now() then
    update public.offers set status = 'expired' where id = v_offer.id;
    raise exception 'offer expired' using errcode = 'check_violation';
  end if;

  if not p_accept then
    update public.offers set status = 'declined' where id = v_offer.id;
    return null;
  end if;

  -- The verification gate. Off for MVP hand-onboarding; flip the setting before
  -- open driver signup so "100% verified drivers" stays true.
  if private.setting_bool('require_verified_driver', false)
     and not private.is_verified_driver(v_actor) then
    raise exception 'driver not verified' using errcode = 'insufficient_privilege';
  end if;

  select l.truck_id into v_truck from public.legs l where l.id = v_offer.leg_id;

  insert into public.trips (load_id, driver_id, truck_id, leg_id, status)
  values (v_offer.load_id, v_actor, v_truck, v_offer.leg_id, 'assigned')
  returning id into v_trip_id;

  update public.offers set status = 'accepted' where id = v_offer.id;
  -- Every other pending offer on this load is dead.
  update public.offers set status = 'expired'
  where load_id = v_offer.load_id and id <> v_offer.id and status = 'pending';

  update public.loads set status = 'assigned' where id = v_offer.load_id;
  update public.legs  set status = 'matched'  where id = v_offer.leg_id;

  return v_trip_id;
end;
$$;

revoke all on function public.respond_to_offer(uuid, boolean) from public, anon;
grant execute on function public.respond_to_offer(uuid, boolean) to authenticated;

-- ─── driver: advance a trip ─────────────────────────────────────────────────
-- Explicit transition table (§8). An invalid transition raises; it is never a
-- silent no-op.

create or replace function public.advance_trip(
  p_trip_id    uuid,
  p_to         trip_status,
  p_note       text default null,
  p_photo_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_trip  public.trips;
  v_event text;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_trip
  from public.trips t
  where t.id = p_trip_id and t.driver_id = v_actor
  for update;

  if v_trip.id is null then
    raise exception 'trip not found' using errcode = 'no_data_found';
  end if;

  -- assigned -> in_transit -> delivered. Nothing goes backwards.
  if not (
       (v_trip.status = 'assigned'   and p_to = 'in_transit')
    or (v_trip.status = 'in_transit' and p_to = 'delivered')
  ) then
    raise exception 'invalid transition % -> %', v_trip.status, p_to
      using errcode = 'check_violation';
  end if;

  -- Proof of delivery is mandatory on the delivering transition.
  if p_to = 'delivered' and (p_photo_path is null or char_length(btrim(p_photo_path)) = 0) then
    raise exception 'delivery requires proof photo' using errcode = 'check_violation';
  end if;

  update public.trips set status = p_to where id = v_trip.id;
  update public.loads set status = (case when p_to = 'in_transit' then 'in_transit'::load_status
                                        else 'delivered'::load_status end)
  where id = v_trip.load_id;

  v_event := case when p_to = 'in_transit' then 'en_route' else 'delivered' end;

  insert into public.trip_events (trip_id, type, note, photo_path)
  values (v_trip.id, v_event, p_note, p_photo_path);
end;
$$;

revoke all on function public.advance_trip(uuid, trip_status, text, text) from public, anon;
grant execute on function public.advance_trip(uuid, trip_status, text, text) to authenticated;

-- ─── driver: declare a leg ──────────────────────────────────────────────────

create or replace function public.post_leg(
  p_origin_city bigint,
  p_dest_city   bigint,
  p_depart_from date,
  p_depart_to   date,
  p_truck_id    uuid default null,
  p_is_empty    boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if (select private.actor_role()) <> 'driver' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  perform private.check_rate_limit('post_leg', 40, interval '1 hour');

  -- A driver may only attach a truck they own (§3: re-check every traversal).
  if p_truck_id is not null
     and not exists (select 1 from public.trucks t where t.id = p_truck_id and t.owner_id = v_actor) then
    raise exception 'truck not found' using errcode = 'no_data_found';
  end if;

  insert into public.legs (driver_id, truck_id, origin_city, dest_city, depart_from, depart_to, is_empty)
  values (v_actor, p_truck_id, p_origin_city, p_dest_city, p_depart_from, p_depart_to, p_is_empty)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.post_leg(bigint, bigint, date, date, uuid, boolean) from public, anon;
grant execute on function public.post_leg(bigint, bigint, date, date, uuid, boolean) to authenticated;

-- ─── counterpart identity ───────────────────────────────────────────────────
-- profiles RLS is own-row-only, so participants cannot read each other directly.
-- This exposes exactly the fields each side needs and nothing else. Phone is
-- released only once a trip exists — before that, a match must not leak contact
-- details (§10).

create or replace function public.trip_counterpart(p_trip_id uuid)
returns table (full_name text, phone text, role public.user_role)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.full_name,
    p.phone,
    p.role
  from public.trips t
  join public.loads l on l.id = t.load_id
  join public.profiles p
    on p.id = case when t.driver_id = (select auth.uid()) then l.shipper_id else t.driver_id end
  where t.id = p_trip_id
    -- caller must be a participant
    and (t.driver_id = (select auth.uid()) or l.shipper_id = (select auth.uid()))
    and t.status in ('assigned', 'in_transit', 'delivered');
$$;

revoke all on function public.trip_counterpart(uuid) from public, anon;
grant execute on function public.trip_counterpart(uuid) to authenticated;

-- ═══ STORAGE ════════════════════════════════════════════════════════════════
-- Proof-of-delivery photos. PRIVATE bucket, signed short-lived URLs only (§10).
-- Path convention: <trip_id>/<uuid>.jpg — the first path segment is the trip,
-- which is what the policies below authorize against.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pod', 'pod', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Driver of the trip may upload, while the trip is still live.
create policy "driver uploads pod" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pod'
    -- definer helper, so storage policies never re-enter public.trips RLS
    and (select private.can_append_trip_event(((storage.foldername(name))[1])::uuid))
  );

-- Both participants may read. No update or delete policy: proof is append-only.
create policy "trip participants read pod" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pod'
    and (select private.is_trip_participant(((storage.foldername(name))[1])::uuid))
  );
