-- 0039 · Driver background GPS — the latest point, used to find the nearest driver.
--
-- Spec: docs/superpowers/specs/2026-09-28-driver-background-gps-design.md.
-- REVERSES 0036's "a town, never a coordinate", on the founder's call
-- (2026-09-28). What is kept: one point per driver, overwritten — never a trail —
-- and only while they are online. No client role can read it, not even the
-- driver's own; `located_at` alone is readable, so the app can say "last sent".

alter table public.driver_availability
  add column if not exists lat        double precision,
  add column if not exists lng        double precision,
  add column if not exists accuracy_m numeric,
  add column if not exists located_at timestamptz;

alter table public.driver_availability drop constraint if exists driver_availability_point_whole;
alter table public.driver_availability add constraint driver_availability_point_whole
  check ((lat is null) = (lng is null) and (lat is null) = (located_at is null));

-- 0036 granted select by column list, so the three coordinate columns start
-- with no grant. Only the timestamp is granted back.
grant select (located_at) on public.driver_availability to authenticated;

insert into private.app_settings (key, value) values
  ('dispatch_location_fresh_minutes', '45'::jsonb)
on conflict (key) do nothing;

create or replace function public.report_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric default null,
  p_recorded_at timestamptz default null
)
returns table(stored boolean, on_trip boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_at      timestamptz;
  v_trip    uuid;
  v_stored  boolean := false;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if (select private.actor_role()) <> 'driver' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_active();
  -- 120/hour: the phone asks every 2 min at most (on a trip). This bounds a
  -- broken client, not the real one.
  perform private.check_rate_limit('report_location', 120, interval '1 hour');

  if p_lat is null or p_lng is null
     or p_lat not between 12 and 33 or p_lng not between 34 and 60 then
    raise exception 'position out of range' using errcode = 'check_violation';
  end if;
  if p_accuracy_m is not null and (p_accuracy_m < 0 or p_accuracy_m > 100000) then
    raise exception 'accuracy out of range' using errcode = 'check_violation';
  end if;

  -- A fast phone clock is clamped, not refused: refusing would lock that phone
  -- out for as long as its clock is wrong, silently. A day-old point is a
  -- replay from a phone that was off; it is dropped, not raised, so the
  -- rate-limit row stays spent.
  v_at := least(coalesce(p_recorded_at, now()), now());
  if v_at < now() - interval '24 hours' then
    return query select false, false;
    return;
  end if;

  -- The load being carried is tracked whatever the switch says: the trip
  -- trigger (0036) takes a driver on a job offline.
  select t.id into v_trip
  from public.trips t
  where t.driver_id = v_actor and t.status = 'in_transit'::public.trip_status
  order by t.created_at desc
  limit 1;

  if v_trip is not null then
    insert into public.trip_positions (trip_id, driver_id, lat, lng, accuracy_m, seen_at)
    values (v_trip, v_actor, p_lat, p_lng, p_accuracy_m, v_at);
  end if;

  -- Offline stores nothing. Older than what we have is ignored. `updated_at`
  -- is NOT touched: it records the switch, and 0037's re-ask rule reads it.
  update public.driver_availability da
     set lat = p_lat, lng = p_lng, accuracy_m = p_accuracy_m, located_at = v_at,
         city_id = private.nearest_city(p_lat, p_lng), source = 'gps'
   where da.driver_id = v_actor
     and da.available
     and (da.located_at is null or da.located_at < v_at);
  v_stored := found;

  return query select v_stored, v_trip is not null;
end;
$$;

revoke all on function public.report_location(double precision, double precision, numeric, timestamptz)
  from public, anon;
grant execute on function public.report_location(double precision, double precision, numeric, timestamptz)
  to authenticated;

-- 0036's set_available, plus: off erases the point; on with GPS stores it.
create or replace function public.set_available(
  p_available boolean,
  p_lat double precision default null,
  p_lng double precision default null
)
returns table(available boolean, city_id bigint, source text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_city   bigint;
  v_source text;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if (select private.actor_role()) <> 'driver' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_active();
  perform private.check_rate_limit('set_available', 60, interval '1 hour');

  if p_available is null then
    raise exception 'available required' using errcode = 'check_violation';
  end if;
  if (p_lat is null) <> (p_lng is null)
     or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception 'bad position' using errcode = 'check_violation';
  end if;

  if p_lat is not null then
    v_city := private.nearest_city(p_lat, p_lng);
    v_source := 'gps';
  else
    v_city := private.last_delivery_city(v_actor);
    v_source := case when v_city is not null then 'delivery' else 'manual' end;
  end if;

  insert into public.driver_availability as da (driver_id, available, city_id, source, updated_at)
  values (v_actor, p_available, v_city, v_source, now())
  on conflict (driver_id) do update
    set available  = excluded.available,
        city_id    = coalesce(excluded.city_id, da.city_id),
        source     = case when excluded.city_id is null then da.source else excluded.source end,
        updated_at = now();

  -- Off means we stop knowing, not just stop updating. The town stays: the next
  -- switch-on needs somewhere to rank from before its first fix.
  if not p_available then
    update public.driver_availability da
       set lat = null, lng = null, accuracy_m = null, located_at = null
     where da.driver_id = v_actor;
  elsif p_lat is not null
        and p_lat between 12 and 33 and p_lng between 34 and 60 then
    update public.driver_availability da
       set lat = p_lat, lng = p_lng, accuracy_m = null, located_at = now()
     where da.driver_id = v_actor;
  end if;

  return query
  select da.available, da.city_id, da.source
  from public.driver_availability da where da.driver_id = v_actor;
end;
$$;

revoke all on function public.set_available(boolean, double precision, double precision) from public, anon;
grant execute on function public.set_available(boolean, double precision, double precision) to authenticated;

-- 0036's trip trigger, plus: a job ending clears the point. A short trip's
-- pickup-area fix is under 45 minutes old at delivery and would otherwise
-- outrank the destination town it is no longer anywhere near.
create or replace function private.trip_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status) then
    insert into public.driver_availability (driver_id, available, source, updated_at)
    values (new.driver_id, false, 'manual', now())
    on conflict (driver_id) do update set available = false, updated_at = now();
  elsif new.status = 'delivered'::public.trip_status
        and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.driver_availability (driver_id, available, city_id, source, updated_at)
    select new.driver_id, true, l.dest_city, 'delivery', now()
    from public.loads l where l.id = new.load_id
    on conflict (driver_id) do update
      set available = true, city_id = excluded.city_id, source = 'delivery',
          updated_at = now(), lat = null, lng = null, accuracy_m = null, located_at = null;
  end if;
  return new;
end;
$$;

revoke all on function private.trip_availability() from public, anon, authenticated;
