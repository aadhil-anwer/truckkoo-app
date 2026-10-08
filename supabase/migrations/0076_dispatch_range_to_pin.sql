-- 0076 · "Max distance should be 10 km" (founder, 2026-10-08).
--
-- The ranges are settings (dispatch_radius_km_1..3, set to 10 in production
-- through the settings table, as a console change would be — not here, so test
-- databases keep their own). This migration makes a range mean what it says:
--   * distance is measured to the pickup PIN when the shipper set one — before
--     it was to the pickup town's centre, so "10 km" in Muscat meant anywhere
--     within 10 km of a point in a governorate 50 km across;
--   * a driver with no fresh GPS and no town was asked in the last stage and
--     after the alert whatever the distance; now only with the new console
--     switch `dispatch_ask_unlocated` on (off by default).
-- The same pin-first distance is what the driver's offer card shows (0074).

insert into private.app_settings (key, value) values ('dispatch_ask_unlocated', 'false'::jsonb)
on conflict (key) do nothing;

-- 0075's body; distance and the unlocated rule changed.
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
    select lo.id, lo.origin_city, lo.weight_kg, lo.truck_type_code,
           pp.lat as pick_lat, pp.lng as pick_lng
    from public.loads lo
    -- 0076: the pickup pin, when the shipper set one.
    left join public.load_places pp on pp.load_id = lo.id and pp.kind = 'pickup'
    where lo.id = p_load_id
  )
  select p.id, tk.id, km.v, coalesce(pc.n, 0)
  from public.profiles p
  cross join l
  join public.driver_availability da on da.driver_id = p.id and da.available
  join lateral (
    select t.id, t.capacity_kg
    from public.trucks t
    where t.owner_id = p.id
      and (l.truck_type_code is null or t.truck_type = l.truck_type_code)
      and (l.weight_kg is null or coalesce(t.capacity_kg, 2147483647) >= l.weight_kg)
    order by t.capacity_kg asc nulls last
    limit 1
  ) tk on true
  cross join lateral (
    select (da.lat is not null
            and da.located_at > now() - make_interval(
                  mins => private.setting_int('dispatch_location_fresh_minutes', 45))
            and coalesce(da.accuracy_m, 0) <= 1000) as fresh
  ) fr
  left join lateral (
    -- 0076: to the pickup PIN when there is one — "within 10 km" has to mean
    -- of the job, not of a town centre in a governorate 50 km across.
    select case
      when fr.fresh and l.pick_lat is not null
        then private.straight_road_km(da.lat, da.lng, l.pick_lat, l.pick_lng)
      when fr.fresh then private.point_km(da.lat::numeric, da.lng::numeric, l.origin_city)
      when da.city_id is not null and l.pick_lat is not null
        then (select private.straight_road_km(c.lat, c.lng, l.pick_lat, l.pick_lng)
                from public.cities c where c.id = da.city_id)
      when da.city_id is not null then private.route_km(da.city_id, l.origin_city)
    end as v
  ) km on true
  left join lateral (
    select count(*) as n from public.offers o
    where o.driver_id = p.id and o.status = 'pending' and o.expires_at > now()
  ) pc on true
  where p.role = 'driver'
    and p.suspended_at is null
    and (not private.setting_bool('require_verified_driver', true)
         or private.is_verified_driver(p.id))
    and not exists (
      select 1 from public.offers o
      where o.load_id = p_load_id and o.driver_id = p.id
        and not (
          (o.status = 'expired' or (o.status = 'pending' and o.expires_at <= now()))
          and (
            -- 0037: they switched on again since they were asked.
            da.updated_at > o.created_at
            -- 0075: or they sat out the rounds the owner set, and have asks left.
            or (coalesce((select r.reasks from private.offer_reasks r where r.offer_id = o.id), 0)
                  < private.setting_int('dispatch_max_reasks', 1)
                and o.expires_at <= now() - make_interval(secs =>
                      private.setting_int('dispatch_reask_skip_rounds', 1)
                      * private.setting_int('offer_answer_seconds', 60)))
          )
        )
    )
    and not exists (
      select 1 from public.trips t
      where t.driver_id = p.id
        and t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
    )
    and (
      (km.v is not null and km.v <= p_radius_km)
      -- 0076: a driver with no known place cannot be shown to be within range,
      -- so they are asked only when the owner allows it.
      or (km.v is null and p_include_unlocated and private.setting_bool('dispatch_ask_unlocated', false))
    )
  -- 0063: drivers with strikes in the last 30 days are asked after the rest,
  -- when the owner's switch is on. Still asked — never excluded.
  order by (private.setting_bool('dispatch_deprioritise_strikes', true)
            and private.strikes_30d(p.id) > 0) asc,
           fr.fresh desc, km.v asc nulls last, coalesce(pc.n, 0) asc,
           tk.capacity_kg asc nulls last, p.id
  limit p_limit;
$$;

-- 0075's registry, with the new switch.
create or replace function private.ops_setting_spec()
 RETURNS TABLE(key text, value_type text, label text, description text, min_value integer, max_value integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  values
    ('auto_dispatch_enabled', 'boolean', 'Automatic dispatch',
     'When on, a posted load is offered to nearby drivers with no human involved. When off, every load waits for a dispatcher. Nothing is lost — loads queue normally.',
     null::integer, null::integer),
    -- Since 0036 this is the WAVE size (dispatch_wave: v_size), not a per-load cap.
    ('auto_dispatch_max_offers', 'integer', 'Drivers asked at once',
     'How many drivers hold an open offer for one job at the same time. The moment one declines or runs out of time, the next nearest driver — including one who just came online — is asked.', 1, 20),
    ('offer_answer_seconds', 'integer', 'Seconds a driver has to answer',
     'How long a driver has to Accept or Decline a job before it goes to the next nearest driver.', 15, 600),
    ('dispatch_max_reasks', 'integer', 'Times a driver who did not answer is asked again',
     'A driver who let an offer run out (not one who declined) is asked again this many times while the job is still open. 0 = never.', 0, 5),
    ('dispatch_reask_skip_rounds', 'integer', 'Rounds a driver who did not answer sits out',
     'How many answer windows pass before a driver who did not answer can be asked again. 1 = skip the next round, asked in the one after.', 0, 10),
    ('auto_dispatch_max_pending_per_driver', 'integer', 'Live offers per driver',
     'How many unanswered offers one driver may hold. Stops one driver being buried.', 1, 20),
    ('auto_dispatch_requires_price', 'boolean', 'Only auto-dispatch priced loads',
     'When on, a load with no price waits for a dispatcher instead of being offered.', null, null),
    ('require_verified_driver', 'boolean', 'Only verified drivers may accept',
     'When on, an unverified driver cannot accept an offer or bid. The website claims "100% verified drivers"; this setting makes that true.', null, null),
    ('dispatch_wave_minutes', 'integer', 'Minutes per search stage',
     'The search widens its range at the end of each stage. It does not limit how long a driver has to answer — that is "Seconds a driver has to answer".', 1, 60),
    -- At most 3: dispatch reads dispatch_radius_km_<wave> and only three exist; a
    -- fourth wave would silently search the 1500 km default.
    ('dispatch_max_waves', 'integer', 'Search stages before a person is alerted',
     'After this many stages with no taker, a dispatcher is alerted. With "Keep looking after the alert" on, the search carries on at the widest range.', 1, 3),
    ('dispatch_radius_km_1', 'integer', 'Range in stage 1 (km)',
     'How far from the pickup drivers are asked during the first stage.', 1, 2000),
    ('dispatch_radius_km_2', 'integer', 'Range in stage 2 (km)',
     'How far drivers are asked during the second stage.', 1, 2000),
    ('dispatch_radius_km_3', 'integer', 'Range in stage 3 and after (km)',
     'How far drivers are asked during the third stage, and after the alert.', 1, 3000),
    ('dispatch_ask_unlocated', 'boolean', 'Ask drivers with no known location',
     'When on, drivers with no recent GPS and no town are asked in the last stage and after the alert, however far away they may be. Off keeps every ask within the ranges above.', null, null),
    ('dispatch_location_fresh_minutes', 'integer', 'GPS counts as fresh for (minutes)',
     'A driver''s last GPS point older than this is ignored and their town is used instead.', 5, 240),
    ('dispatch_rescue_enabled', 'boolean', 'Keep looking after the alert',
     'When on, a job nobody took keeps being offered — to drivers who come online, and to anyone due a second ask — until its collection date, unless a dispatcher takes it in hand.', null, null),
    ('drivers_online_by_default', 'boolean', 'Drivers online unless they switch off',
     'When on, every driver is offered work unless they turn themselves off.', null, null),
    ('bid_window_minutes', 'integer', 'Bidding window (minutes)',
     'How long a bid load takes bids before the shipper chooses.', 10, 1440),
    ('bid_wave_minutes', 'integer', 'Minutes between bid invitations',
     'How often more drivers are invited to bid.', 1, 60),
    ('bid_invites_per_wave', 'integer', 'Drivers invited per wave',
     'How many drivers each bid invitation wave reaches.', 1, 20),
    ('bid_enough_bids', 'integer', 'Bids that are enough',
     'Once a load has this many bids, no more drivers are invited.', 1, 20),
    ('push_enabled', 'boolean', 'Push notifications',
     'When off, the database sends no push notifications at all. The kill switch for a bad push.', null, null),
    ('stuck_alert_minutes', 'integer', 'Stuck-load alert (minutes)',
     'A load waiting this long with nobody on it alerts a person.', 5, 240),
    -- 0062: support desk response times.
    ('case_sla_urgent_minutes', 'integer', 'Urgent case: answer within (minutes)',
     'An urgent case (breakdown, abandoned trip, no-show, misconduct) is overdue after this long.', 5, 240),
    ('case_sla_high_minutes', 'integer', 'High-priority case: answer within (minutes)',
     'A high-priority case (damage, dispute, delay, cancellation) is overdue after this long.', 15, 1440),
    ('case_sla_normal_minutes', 'integer', 'Normal case: answer within (minutes)',
     'Any other case is overdue after this long. Changing these does not move deadlines already set.', 60, 10080),
    -- 0063: strikes and the detectors.
    ('strike_suspend_threshold', 'integer', 'Strike points before suspension is suggested',
     'Strikes weigh 1 to 3 points (an abandoned load is 3). When a driver''s points in the last 30 days reach this, the console suggests suspending them. Staff decide.', 1, 20),
    ('dispatch_deprioritise_strikes', 'boolean', 'Offer work to drivers with strikes last',
     'When on, drivers with strikes in the last 30 days are asked after every driver without strikes in the same search — even ones further away. They are still asked. Declared empty legs are matched first either way.', null, null),
    ('no_show_hour', 'integer', 'No-show check, hour of the last pickup day (Muscat)',
     'An accepted trip not started by this hour on the last day of its pickup window is flagged as a possible no-show for a person to check.', 8, 23),
    ('abandon_hours', 'integer', 'Possible abandonment after (hours of silence)',
     'A truck on the road with no event or GPS for this long is flagged as possibly abandoned, for a person to check. Leave room for a night''s sleep and a border queue.', 2, 48),
    ('late_release_hours', 'integer', 'Late release, within (hours of pickup)',
     'A driver who releases a job this close to the pickup day gets a heavier strike.', 1, 72),
    -- 0069: pickups.
    ('wait_cap_minutes', 'integer', 'Waiting stops counting after (minutes, per stop)',
     'Waiting at a pickup or drop-off is charged up to this long; past it the charge stops and a support case opens for a person to sort out. Applies to loads priced after the change.', 30, 480),
    ('arrive_radius_m', 'integer', 'Driver counts as arrived within (metres of the pin)',
     'How close the driver''s phone must be to the pin to count as arrived and start the waiting clock. 300 by default.', 100, 2000),
    ('same_city_min_m', 'integer', 'Shortest job inside one town (metres between pins)',
     'A job whose pickup and drop-off are in the same town needs both pins at least this far apart.', 100, 5000)
$function$;
