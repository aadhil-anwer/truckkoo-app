-- 0037 · Three gaps in 0036's dispatch, found on production, 2026-09-28.
--
-- 1. Nobody could see a price. `quote_route` (and `estimate_route`, 0010) were
--    declared STABLE but call `private.check_rate_limit`, which writes a row.
--    PostgREST runs a STABLE function inside a READ ONLY transaction, so every
--    call on the real project failed with "cannot execute INSERT in a read-only
--    transaction" — the review screen showed no price, the shipper booked
--    without one, and every load went to a person instead of dispatching.
--    `psql` does not set read-only, so no suite could see it: the guard is the
--    static check in dispatch.sql §10, over every function, not a call.
--
-- 2. A driver who comes online after the search ended was never asked. 0036
--    searches for 15 minutes and then hands the load to a person — and stops
--    looking. A load could sit "finding you a truck" while a fitting driver sat
--    online next to it. `system_rescue_stranded` keeps looking, every minute,
--    for loads the shipper accepted and nobody has taken: a driver who switches
--    on is asked within a minute. A person is still alerted at minute 15; this
--    only means the machine keeps trying while they do.
--
-- 3. A driver who missed an offer was never asked again. `nearby_drivers`
--    excluded anyone who had EVER been offered the load — so a driver who was
--    online, missed a five-minute offer (no push notifications yet), went
--    offline and came back, was locked out of that load for good. They are now
--    asked again if the offer lapsed unanswered and they switched on since it
--    was made. A "no" is still final: declined is never re-asked by a machine.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Functions that write are VOLATILE
-- ════════════════════════════════════════════════════════════════════════════

alter function public.quote_route(bigint, bigint, text, integer) volatile;
alter function public.estimate_route(bigint, bigint, text, integer) volatile;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. A lapsed offer is not a "no"
-- ════════════════════════════════════════════════════════════════════════════

-- 0036's `nearby_drivers`, with one clause changed (marked). Everything else —
-- online, verified, fitting, not suspended, not on a job, nearest first — is as
-- it was.
create or replace function private.nearby_drivers(
  p_load_id uuid, p_radius_km numeric, p_include_unlocated boolean, p_limit integer
)
returns table(driver_id uuid, truck_id uuid, deadhead_km numeric, pending bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with l as (
    select lo.id, lo.origin_city, lo.weight_kg,
           private.resolve_truck_type(lo.truck_type_code, lo.weight_kg) as want_type,
           lo.truck_type_code
    from public.loads lo where lo.id = p_load_id
  )
  select p.id, tk.id, km.v, coalesce(pc.n, 0)
  from public.profiles p
  cross join l
  join public.driver_availability da on da.driver_id = p.id and da.available
  -- One row per driver: their smallest truck that fits.
  join lateral (
    select t.id, t.capacity_kg
    from public.trucks t
    where t.owner_id = p.id
      and (l.truck_type_code is null or t.truck_type = l.truck_type_code)
      and (l.weight_kg is null or coalesce(t.capacity_kg, 2147483647) >= l.weight_kg)
    order by t.capacity_kg asc nulls last
    limit 1
  ) tk on true
  left join lateral (
    select private.route_km(da.city_id, l.origin_city) as v
    where da.city_id is not null
  ) km on true
  left join lateral (
    select count(*) as n from public.offers o
    where o.driver_id = p.id and o.status = 'pending' and o.expires_at > now()
  ) pc on true
  where p.role = 'driver'
    and p.suspended_at is null
    and (not private.setting_bool('require_verified_driver', true)
         or private.is_verified_driver(p.id))
    -- CHANGED in 0037. Asked before, and the answer stands — unless the offer
    -- lapsed unanswered AND the driver has switched on since it was made: they
    -- were not there, which is not the same as saying no.
    and not exists (
      select 1 from public.offers o
      where o.load_id = p_load_id and o.driver_id = p.id
        and not (
          (o.status = 'expired' or (o.status = 'pending' and o.expires_at <= now()))
          and da.updated_at > o.created_at
        )
    )
    -- A driver on a job is not free, whatever their switch says.
    and not exists (
      select 1 from public.trips t
      where t.driver_id = p.id
        and t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
    )
    and (
      (km.v is not null and km.v <= p_radius_km)
      or (km.v is null and p_include_unlocated)
    )
  order by km.v asc nulls last, coalesce(pc.n, 0) asc, tk.capacity_kg asc nulls last, p.id
  limit p_limit;
$$;

revoke all on function private.nearby_drivers(uuid, numeric, boolean, integer)
  from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Keep looking after the waves end
-- ════════════════════════════════════════════════════════════════════════════

insert into private.app_settings (key, value) values
  ('dispatch_rescue_enabled', 'true'::jsonb)
on conflict (key) do nothing;

alter table private.dispatch_log drop constraint if exists dispatch_log_mode_known;
alter table private.dispatch_log add constraint dispatch_log_mode_known
  check (mode is null or mode in ('leg', 'fresh', 'backfill', 'nearby', 'mixed', 'rescue'));

-- Every minute: a load the shipper accepted at a price, that nobody has taken,
-- that the waves have let go of, and whose collection date has not passed, is
-- offered to online drivers who fit — widest radius, drivers with no known town
-- included, never anyone who said no. Offers live as long as a wave's.
--
-- Left alone:
--   * anything while an offer is out, from anyone — a dispatcher's included;
--   * anything a dispatcher has taken in hand since it was accepted (sent an
--     offer, marked it finding-a-truck, set its status). A person deciding is
--     the point, and the machine never second-guesses one;
--   * everything, when `auto_dispatch_enabled` or `dispatch_rescue_enabled` is off.
create or replace function private.system_rescue_stranded()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_size       integer := private.setting_int('auto_dispatch_max_offers', 3);
  v_per_driver integer := private.setting_int('auto_dispatch_max_pending_per_driver', 3);
  v_minutes    integer := private.setting_int('dispatch_wave_minutes', 5);
  v_max        integer := private.setting_int('dispatch_max_waves', 3);
  v_radius     numeric := private.setting_int('dispatch_radius_km_' || v_max, 1500);
  v_today      date    := (now() at time zone 'Asia/Muscat')::date;
  v_loads      integer := 0;
  v_sent       integer;
  v_seen       integer;
  v_offer      uuid;
  r            record;
  c            record;
begin
  if not private.setting_bool('auto_dispatch_enabled', true)
     or not private.setting_bool('dispatch_rescue_enabled', true) then
    return 0;
  end if;

  for r in
    select l.id from public.loads l
    where l.status in ('finding_truck'::public.load_status, 'matched'::public.load_status)
      and l.accepted_at is not null
      and l.price_baisa is not null
      and l.pickup_to >= v_today
      and not private.machine_owns(l.id)
      and not exists (
        select 1 from public.offers o
        where o.load_id = l.id and o.status = 'pending' and o.expires_at > now())
      and not exists (
        select 1 from private.ops_audit a
        where a.target_kind = 'load' and a.target_id = l.id::text
          and a.action in ('ops_send_offer', 'ops_mark_finding_truck', 'ops_set_load_status')
          and a.created_at >= l.accepted_at)
    order by l.pickup_from, l.accepted_at
    for update of l skip locked
  loop
    update public.offers set status = 'expired'
    where load_id = r.id and status = 'pending' and expires_at <= now();

    v_sent := 0;
    v_seen := 0;
    for c in select * from private.nearby_drivers(r.id, v_radius, true, v_size * 4) loop
      v_seen := v_seen + 1;
      exit when v_sent >= v_size;
      continue when c.pending >= v_per_driver;
      v_offer := public.create_offer(r.id, c.driver_id, null, 'auto', false);
      update public.offers set expires_at = now() + make_interval(mins => v_minutes)
      where id = v_offer;
      v_sent := v_sent + 1;
    end loop;

    -- Only when someone was asked: a load nobody fits would otherwise write a
    -- row every minute until its collection date.
    if v_sent > 0 then
      insert into private.dispatch_log (load_id, candidates, offers_sent, mode)
      values (r.id, v_seen, v_sent, 'rescue');
      v_loads := v_loads + 1;
    end if;
  end loop;

  if v_loads > 0 then
    perform private.log_system('system_rescue_stranded', 'system', 'loads',
                               jsonb_build_object('loads_offered', v_loads));
  end if;
  return v_loads;
end;
$$;

revoke all on function private.system_rescue_stranded() from public, anon, authenticated;

select cron.schedule('dispatch-rescue', '* * * * *',
  $$select private.system_rescue_stranded()$$);
