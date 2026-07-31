-- 0032 — where the truck actually is.
--
-- T4 has drawn a truck since P4 whose position is `elapsed time ÷ corridor
-- hours`, clamped away from both ends so it never quite arrives and never quite
-- fails to leave. It moves whether or not the driver does. This is the table
-- that lets it stop.
--
-- FOREGROUND ONLY (spec F1). Positions arrive while the driver has D7 open. That
-- is a client fact, not a schema fact: everything here — the shape, the RLS
-- posture, the read function, the retention — is what background tracking would
-- need too, so adopting it later is a client change and not a migration.

create table public.trip_positions (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips on delete cascade,
  -- Denormalised so the sweep and the retention delete never join. A position
  -- outlives nothing: the row dies with its trip.
  driver_id   uuid not null references public.profiles on delete cascade,
  lat         numeric(9,6) not null,
  lng         numeric(9,6) not null,
  accuracy_m  numeric,
  -- WHEN THE PHONE SAW IT, not when the row landed. A queued fix uploaded ten
  -- minutes later is ten minutes old, and the shipper is told so.
  seen_at     timestamptz not null,
  created_at  timestamptz not null default now(),

  -- Bounded, like every client-supplied number (SECURITY.md §6). A generous GCC
  -- box: Oman plus the five countries the fleet crosses into, with room to
  -- spare. Anything outside is a broken device or a forged call, not a truck.
  constraint trip_positions_in_region check (
    lat between 12 and 33 and lng between 34 and 60
  ),
  constraint trip_positions_accuracy_sane check (
    accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)
  ),
  -- No fixes from the future. Clock skew of a minute is tolerated; an hour is a
  -- device lying about when it saw something.
  constraint trip_positions_not_future check (seen_at <= now() + interval '1 minute')
);

create index trip_positions_trip_idx   on public.trip_positions (trip_id, seen_at desc);
create index trip_positions_sweep_idx  on public.trip_positions (seen_at);
create index trip_positions_driver_idx on public.trip_positions (driver_id);

comment on table public.trip_positions is
  'Driver-reported positions during a live trip. No client grant: written by '
  'report_position(), read one row at a time by trip_position(), swept by ops.';

-- ═══ deny by default ════════════════════════════════════════════════════════
-- No grant of any kind, and therefore no policies: nothing reaches this table
-- except through the definer functions below. RLS is still enabled and forced,
-- so a grant added by accident later fails closed rather than open.

revoke all on public.trip_positions from anon, authenticated;
alter table public.trip_positions enable row level security;
alter table public.trip_positions force row level security;

-- ═══ how fast a truck goes ══════════════════════════════════════════════════
-- A SETTING, not a constant, for the same reason road_factor_pct is one: it is
-- wrong until there is real trip data to tune it against, and retuning it must
-- not need a migration.
insert into private.app_settings (key, value)
values ('avg_speed_kph', '65'::jsonb)
on conflict (key) do nothing;

-- ═══ the driver reports ═════════════════════════════════════════════════════
-- Returns FALSE rather than raising when the trip is no longer live (spec F9).
-- The delivery transition and the last queued ping race by seconds, and a driver
-- should not be shown an error at the gate because their own delivery landed
-- first. Authentication and out-of-range coordinates still raise.

create or replace function public.report_position(
  p_trip_id    uuid,
  p_lat        numeric,
  p_lng        numeric,
  p_accuracy_m numeric default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_ok    boolean;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if p_lat is null or p_lng is null
     or p_lat not between 12 and 33 or p_lng not between 34 and 60 then
    raise exception 'position out of range' using errcode = 'check_violation';
  end if;

  -- 240/hour is one fix every fifteen seconds sustained. The client asks for one
  -- per minute or per 500m, so this bounds a broken client rather than the real
  -- one.
  perform private.check_rate_limit('report_position', 240, interval '1 hour');

  -- THE WHOLE GUARD, and it is internal. The trip id comes from the client and
  -- is worth nothing without this: own trip, and live. Tracking that stops when
  -- a trip ends is a promise if the client does it and a fact if this does.
  select exists (
    select 1 from public.trips t
    where t.id = p_trip_id
      and t.driver_id = v_actor
      and t.status = 'in_transit'::public.trip_status
  ) into v_ok;

  if not v_ok then
    return false;
  end if;

  insert into public.trip_positions (trip_id, driver_id, lat, lng, accuracy_m, seen_at)
  values (p_trip_id, v_actor, p_lat, p_lng, p_accuracy_m, now());

  return true;
end;
$$;

revoke all on function public.report_position(uuid, numeric, numeric, numeric)
  from public, anon;
grant execute on function public.report_position(uuid, numeric, numeric, numeric)
  to authenticated;

-- ═══ how far is left ════════════════════════════════════════════════════════
-- The point-to-city twin of private.route_km (0024), sharing its haversine and
-- its road factor rather than restating either. One distance implementation,
-- server-side, is the same rule the price follows.

create or replace function private.point_km(
  p_lat     numeric,
  p_lng     numeric,
  p_city_id bigint
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.cities;
  v_factor numeric;
  v_km     numeric;
begin
  select * into c from public.cities x where x.id = p_city_id;
  if c.id is null or p_lat is null or p_lng is null then
    return null;
  end if;

  v_km := 2 * 6371 * asin(
    sqrt(
      power(sin(radians(c.lat - p_lat) / 2), 2)
      + cos(radians(p_lat)) * cos(radians(c.lat))
        * power(sin(radians(c.lng - p_lng) / 2), 2)
    )
  );

  select coalesce((value #>> '{}')::numeric, 120) into v_factor
  from private.app_settings where key = 'road_factor_pct';

  return round(v_km * v_factor / 100, 1);
end;
$$;

revoke all on function private.point_km(numeric, numeric, bigint)
  from public, anon, authenticated;

-- ═══ what a screen may know about where the truck is ════════════════════════
-- ONE ROW, ALWAYS — for any trip the caller may see, whether or not a fix
-- exists. With no fix, lat/lng/seen_at are null and eta_source is 'corridor':
-- the arrival time from the pickup event plus the full corridor duration, which
-- is the estimate T4 shows today. With a fix, eta_source is 'fix'.
--
-- BOTH ETAs LIVE HERE. A client-side fallback would be a second arrival-time
-- implementation, and two of those disagree eventually — the same reason there
-- is no src/lib/pricing.ts.
--
-- THE LATEST FIX ONLY. The trail is never returned to a client: "where is my
-- truck" is the product; "where has this driver been for a month" is a movement
-- record, and the difference is this `limit 1`.

create or replace function public.trip_position(p_trip_id uuid)
returns table (
  lat          numeric,
  lng          numeric,
  seen_at      timestamptz,
  accuracy_m   numeric,
  remaining_km numeric,
  eta_at       timestamptz,
  eta_source   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_trip     public.trips;
  v_load     public.loads;
  v_fix      public.trip_positions;
  v_speed    numeric;
  v_from     timestamptz;
  v_km       numeric;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_trip from public.trips t where t.id = p_trip_id;
  if v_trip.id is null then
    return;
  end if;

  select * into v_load from public.loads l where l.id = v_trip.load_id;

  -- Scoped INSIDE the definer, like match_load and driver_offers: the driver on
  -- the trip, the shipper who owns the load, or ops. Anyone else gets no row —
  -- "not found", never "forbidden", because a distinct refusal confirms the
  -- trip exists.
  if not (
    v_trip.driver_id = v_actor
    or private.owns_load(v_trip.load_id)
    or private.is_ops()
  ) then
    return;
  end if;

  select * into v_fix
  from public.trip_positions p
  where p.trip_id = p_trip_id
  order by p.seen_at desc
  limit 1;

  select coalesce((value #>> '{}')::numeric, 65) into v_speed
  from private.app_settings where key = 'avg_speed_kph';
  if v_speed is null or v_speed <= 0 then
    v_speed := 65;
  end if;

  if v_fix.id is not null then
    v_km := private.point_km(v_fix.lat, v_fix.lng, v_load.dest_city);
    return query select
      v_fix.lat,
      v_fix.lng,
      v_fix.seen_at,
      v_fix.accuracy_m,
      v_km,
      -- From NOW, not from the fix: the remaining distance is what was left when
      -- the phone last looked, and the truck has been driving since.
      (now() + make_interval(secs => (v_km / v_speed * 3600)::int)),
      'fix'::text;
    return;
  end if;

  -- No fix. The corridor estimate, said to be one.
  v_from := coalesce(
    (select max(e.occurred_at) from public.trip_events e
      where e.trip_id = p_trip_id and e.type = 'picked_up'),
    v_trip.created_at);

  v_km := private.route_km(v_load.origin_city, v_load.dest_city);

  return query select
    null::numeric,
    null::numeric,
    null::timestamptz,
    null::numeric,
    v_km,
    case when v_km is null then null
         else v_from + make_interval(secs => (v_km / v_speed * 3600)::int) end,
    'corridor'::text;
end;
$$;

revoke all on function public.trip_position(uuid) from public, anon;
grant execute on function public.trip_position(uuid) to authenticated;

-- ═══ retention ══════════════════════════════════════════════════════════════
-- 30 days, swept by a dispatcher. pg_cron is not enabled on this project, and
-- the alternative — deleting on every write — was considered and not chosen.
--
-- THE KNOWN WEAKNESS, WRITTEN DOWN: this is the same shape as
-- ops_sweep_expired_offers, which OPEN_ISSUES 27 records going stale because
-- nothing runs it. ops_position_health() exists to make that visible rather
-- than silent — the console shows the age of the oldest stored point, so a
-- forgotten sweep is a number on a screen instead of an invisible pile.

create or replace function public.ops_sweep_positions(
  p_days   integer default 30,
  p_reason text    default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer;
begin
  perform private.require_ops();

  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'retention must be between 1 and 365 days'
      using errcode = 'check_violation';
  end if;

  with gone as (
    delete from public.trip_positions
     where seen_at < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*) into v_deleted from gone;

  perform private.log_ops(
    'ops_sweep_positions', 'table', 'trip_positions',
    null,
    jsonb_build_object('deleted', v_deleted, 'days', p_days),
    p_reason);

  return v_deleted;
end;
$$;

revoke all on function public.ops_sweep_positions(integer, text) from public, anon;
grant execute on function public.ops_sweep_positions(integer, text) to authenticated;

create or replace function public.ops_position_health()
returns table (rows bigint, oldest_seen_at timestamptz, oldest_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    count(*)::bigint,
    min(p.seen_at),
    coalesce(extract(day from (now() - min(p.seen_at)))::int, 0)
  from public.trip_positions p;
end;
$$;

revoke all on function public.ops_position_health() from public, anon;
grant execute on function public.ops_position_health() to authenticated;
