-- 0040 · A trip reports every 30 s, so the rate limit makes room for it.
--
-- T4 is the one screen a shipper watches while it changes. At 0039's trip
-- cadence (2 min / 500 m) the truck jumped a few kilometres at a time; the
-- phone now sends a fix every 30 s or 150 m while carrying a load
-- (`CADENCE.trip` in src/lib/background-location.ts). That is 120 an hour —
-- exactly 0039's ceiling, which exists to bound a broken client, not the real
-- one. The ceiling doubles to 240. Nothing else in the function changes: the
-- body below is 0039's, word for word, apart from the limit and its comment.

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
  -- 240/hour: the phone asks every 30 s at most (on a trip, 0040). This bounds a
  -- broken client, not the real one.
  perform private.check_rate_limit('report_location', 240, interval '1 hour');

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
