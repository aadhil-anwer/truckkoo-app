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
