-- 0075 · Rolling dispatch: the nearest drivers, a few at a time, refilled the
-- moment a place frees up — including drivers who come online mid-search.
--
-- Founder, 2026-10-08: "some drivers aren't getting the ride if they go online
-- after the first wave is gone". Why, before this:
--   * next_wave did nothing while ANY offer of the wave was open, so a driver
--     switching on next to the pickup waited for the whole wave to lapse;
--   * nothing ran when a driver came online — only the every-minute tick;
--   * after the alert the separate rescue job asked again only when nothing
--     at all was open.
-- Now (founder's choices):
--   * Nearest `auto_dispatch_max_offers` (3) hold an open offer at once. When
--     one declines or lets it lapse (offer_answer_seconds, 60), the slot is
--     refilled at once with the next nearest — on the decline, on the 20 s tick,
--     and when a driver switches on or first reports a fresh position.
--   * A driver who let an offer lapse (never one who declined) sits out
--     `dispatch_reask_skip_rounds` (1) answer windows and is then asked again,
--     up to `dispatch_max_reasks` (1) times.
--   * Stages (`dispatch_wave_minutes` × `dispatch_max_waves`) still widen the
--     range and alert a person; with `dispatch_rescue_enabled` the same loop
--     keeps going after the alert, at the widest range. The separate rescue job
--     is unscheduled — one loop, not two that could both ask.
--   * Every one of these is editable from the console (System), and the labels
--     now describe this rather than waves.

insert into private.app_settings (key, value) values
  ('dispatch_max_reasks', '1'::jsonb),
  ('dispatch_reask_skip_rounds', '1'::jsonb)
on conflict (key) do nothing;

-- How often each offer has been asked again. No client grant.
create table if not exists private.offer_reasks (
  offer_id   uuid primary key references public.offers (id) on delete cascade,
  reasks     smallint not null default 0,
  last_at    timestamptz not null default now()
);
revoke all on private.offer_reasks from public, anon, authenticated;
alter table private.offer_reasks enable row level security;
alter table private.offer_reasks force row level security;

-- ═══ 1. who may be asked: also a driver due their second ask ═══════════════
-- 0063's body; only the re-ask rule changed.
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
    select lo.id, lo.origin_city, lo.weight_kg, lo.truck_type_code
    from public.loads lo where lo.id = p_load_id
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
    select case
      when fr.fresh then private.point_km(da.lat::numeric, da.lng::numeric, l.origin_city)
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
      or (km.v is null and p_include_unlocated)
    )
  -- 0063: drivers with strikes in the last 30 days are asked after the rest,
  -- when the owner's switch is on. Still asked — never excluded.
  order by (private.setting_bool('dispatch_deprioritise_strikes', true)
            and private.strikes_30d(p.id) > 0) asc,
           fr.fresh desc, km.v asc nulls last, coalesce(pc.n, 0) asc,
           tk.capacity_kg asc nulls last, p.id
  limit p_limit;
$$;

-- ═══ 2. asking one driver ════════════════════════════════════════════════════
-- create_offer reopens a lapsed row (and never a declined one); this sets the
-- answer window, stamps the ask, and counts a repeat ask after silence.
create or replace function private.offer_auto(p_load_id uuid, p_driver_id uuid, p_leg_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prior_at timestamptz;
  v_switched timestamptz;
  v_offer    uuid;
begin
  select o.created_at into v_prior_at from public.offers o
   where o.load_id = p_load_id and o.driver_id = p_driver_id;
  select da.updated_at into v_switched from public.driver_availability da where da.driver_id = p_driver_id;
  v_offer := public.create_offer(p_load_id, p_driver_id, p_leg_id, 'auto', false);
  -- A reopened offer is a new ask: `created_at` moves to now. Before this a
  -- reopened row kept its first time, so 0037's "switched on since they were
  -- asked" stayed true for ever after one switch, and a driver who let offers
  -- lapse was asked again after every lapse.
  update public.offers
     set expires_at = now() + make_interval(secs => private.setting_int('offer_answer_seconds', 60)),
         created_at = case when v_prior_at is null then created_at else now() end
   where id = v_offer and status = 'pending';
  -- Only an ask after silence spends the re-ask allowance. Switching on again
  -- is a fresh start, as it has been since 0037.
  if found and v_prior_at is not null and not coalesce(v_switched > v_prior_at, false) then
    insert into private.offer_reasks (offer_id, reasks, last_at) values (v_offer, 1, now())
    on conflict (offer_id) do update set reasks = private.offer_reasks.reasks + 1, last_at = now();
  end if;
  return v_offer;
end;
$$;
revoke all on function private.offer_auto(uuid, uuid, uuid) from public, anon, authenticated;

-- ═══ 3. filling free places ══════════════════════════════════════════════════
-- 0074's dispatch_wave, asked to fill only the free places, and doubling as the
-- old rescue job after the alert (widest range, no leg tier, mode 'rescue').
drop function if exists private.dispatch_wave(uuid, integer);
create or replace function private.dispatch_wave(p_load_id uuid, p_wave integer, p_free integer, p_after_alert boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_size       integer := private.setting_int('auto_dispatch_max_offers', 3);
  v_per_driver integer := private.setting_int('auto_dispatch_max_pending_per_driver', 3);
  v_max        integer := private.setting_int('dispatch_max_waves', 3);
  v_radius     numeric := private.setting_int('dispatch_radius_km_' || p_wave, 1500);
  v_verified   boolean := private.setting_bool('require_verified_driver', true);
  v_sent       integer := 0;
  v_legs       integer := 0;
  v_seen       integer := 0;
  v_pending    integer;
  c            record;
begin
  if p_free <= 0 then
    return 0;
  end if;

  if not p_after_alert then
    for c in select * from private.candidates_for(p_load_id, 1::smallint, 0, v_size * 4) loop
      v_seen := v_seen + 1;
      exit when v_sent >= p_free;
      continue when c.offer_status is not null;
      continue when v_verified and not private.is_verified_driver(c.driver_id);
      select count(*) into v_pending from public.offers o
      where o.driver_id = c.driver_id and o.status = 'pending' and o.expires_at > now();
      continue when v_pending >= v_per_driver;
      perform private.offer_auto(p_load_id, c.driver_id, c.leg_id);
      v_sent := v_sent + 1;
      v_legs := v_legs + 1;
    end loop;
  end if;

  if v_sent < p_free then
    for c in
      select * from private.nearby_drivers(p_load_id, v_radius, p_after_alert or p_wave >= v_max, v_size * 4)
    loop
      v_seen := v_seen + 1;
      exit when v_sent >= p_free;
      continue when c.pending >= v_per_driver;
      perform private.offer_auto(p_load_id, c.driver_id, null);
      v_sent := v_sent + 1;
    end loop;
  end if;

  -- Logged when someone was asked, and once for the first empty attempt, so a
  -- dispatcher can see the search began without a row every 20 seconds.
  if v_sent > 0 or (not p_after_alert and not exists (
    select 1 from private.dispatch_log d where d.load_id = p_load_id and d.wave is not null
  )) then
    insert into private.dispatch_log (load_id, candidates, offers_sent, mode, skipped, wave)
    values (p_load_id, v_seen, v_sent,
            case when p_after_alert then 'rescue'
                 when v_sent > 0 and v_legs = v_sent then 'leg'
                 when v_legs > 0 then 'mixed'
                 else 'nearby' end,
            case when v_sent = 0 then 'no_candidates' end, p_wave);
  end if;

  return v_sent;
end;
$$;
revoke all on function private.dispatch_wave(uuid, integer, integer, boolean) from public, anon, authenticated;

-- ═══ 4. one step of the search ══════════════════════════════════════════════
create or replace function private.next_wave(p_load_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max       integer := private.setting_int('dispatch_max_waves', 3);
  v_minutes   integer := private.setting_int('dispatch_wave_minutes', 5);
  v_size      integer := private.setting_int('auto_dispatch_max_offers', 3);
  v_today     date    := (now() at time zone 'Asia/Muscat')::date;
  v_load      public.loads;
  v_after     boolean;
  v_elapsed   numeric := 0;
  v_open      integer;
begin
  -- Serialise per load, but never wait (0036): a decline and an accept arrive
  -- holding different rows, and the 20 s tick re-checks anything skipped.
  select * into v_load from public.loads l where l.id = p_load_id for update skip locked;
  if not found or v_load.accepted_at is null
     or not private.setting_bool('auto_dispatch_enabled', true)
     or v_load.status not in ('accepted'::public.load_status, 'matched'::public.load_status,
                              'finding_truck'::public.load_status) then
    return 0;
  end if;
  -- Not while a dispatcher's own offer is out: a person chose that driver.
  if exists (select 1 from public.offers o where o.load_id = p_load_id and o.source <> 'auto'
               and o.status = 'pending' and o.expires_at > now()) then
    return 0;
  end if;

  v_after := exists (select 1 from private.dispatch_log d where d.load_id = p_load_id and d.skipped = 'exhausted');

  if not v_after then
    if not private.machine_owns(p_load_id) then
      return 0;
    end if;
    v_elapsed := extract(epoch from now() - v_load.accepted_at) / 60;
    if v_elapsed >= v_max * v_minutes then
      -- Every stage spent. A person is told — once; the `exhausted` row is what
      -- ends machine ownership, so this cannot fire twice.
      insert into private.dispatch_log (load_id, offers_sent, skipped, wave)
      values (p_load_id, 0, 'exhausted', v_max);
      update public.loads l set status = 'finding_truck'::public.load_status
      where l.id = p_load_id and l.status = 'matched'::public.load_status;
      perform private.system_raise_alert(
        'dispatch_exhausted',
        'No driver took load ' || upper(left(p_load_id::text, 8)) || ' — it needs a person.',
        jsonb_build_object('load_id', p_load_id, 'waves', v_max));
      v_after := true;
    end if;
  end if;

  if v_after then
    -- After the alert: the old rescue job's rules (0037).
    if not private.setting_bool('dispatch_rescue_enabled', true)
       or v_load.price_baisa is null
       or v_load.pickup_to < v_today
       or exists (
         select 1 from private.ops_audit a
         where a.target_kind = 'load' and a.target_id = p_load_id::text
           and a.action in ('ops_send_offer', 'ops_mark_finding_truck', 'ops_set_load_status')
           and a.created_at >= v_load.accepted_at) then
      return 0;
    end if;
  end if;

  update public.offers set status = 'expired'
  where load_id = p_load_id and status = 'pending' and expires_at <= now();

  select count(*) into v_open from public.offers o
  where o.load_id = p_load_id and o.status = 'pending' and o.expires_at > now();

  return private.dispatch_wave(
    p_load_id,
    case when v_after then v_max else least(v_max, floor(v_elapsed / v_minutes)::integer + 1) end,
    v_size - v_open,
    v_after);
end;
$$;
revoke all on function private.next_wave(uuid) from public, anon, authenticated;

-- ═══ 5. the tick: every searching load with a free place ════════════════════
create or replace function private.system_dispatch_waves()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_moved integer := 0;
  v_size  integer := private.setting_int('auto_dispatch_max_offers', 3);
begin
  if not private.setting_bool('auto_dispatch_enabled', true) then
    return 0;
  end if;
  for r in
    select l.id from public.loads l
    where l.status in ('accepted'::public.load_status, 'matched'::public.load_status,
                       'finding_truck'::public.load_status)
      and l.accepted_at is not null
      and l.pickup_to >= (now() at time zone 'Asia/Muscat')::date
      and (select count(*) from public.offers o
            where o.load_id = l.id and o.status = 'pending' and o.expires_at > now()) < v_size
    order by l.accepted_at
  loop
    if private.next_wave(r.id) > 0 then
      v_moved := v_moved + 1;
    end if;
  end loop;
  if v_moved > 0 then
    perform private.log_system('system_dispatch_waves', 'system', 'loads',
                               jsonb_build_object('loads_offered', v_moved));
  end if;
  return v_moved;
end;
$$;
revoke all on function private.system_dispatch_waves() from public, anon, authenticated;

-- The rescue job is now part of the loop above.
select cron.unschedule('dispatch-rescue')
 where exists (select 1 from cron.job where jobname = 'dispatch-rescue');
drop function if exists private.system_rescue_stranded();

-- ═══ 6. a driver comes online: ask them now, not at the next tick ═══════════
create or replace function private.driver_online_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_size integer := private.setting_int('auto_dispatch_max_offers', 3);
begin
  if not new.available then
    return null;
  end if;
  -- Switched on, moved town, or a first fresh fix — not every GPS report.
  if tg_op = 'UPDATE'
     and old.available
     and old.city_id is not distinct from new.city_id
     and old.located_at is not null
     and old.located_at > now() - make_interval(mins => private.setting_int('dispatch_location_fresh_minutes', 45)) then
    return null;
  end if;
  begin
    for r in
      select l.id from public.loads l
      where l.status in ('accepted'::public.load_status, 'matched'::public.load_status,
                         'finding_truck'::public.load_status)
        and l.accepted_at is not null
        and l.pickup_to >= (now() at time zone 'Asia/Muscat')::date
        and (select count(*) from public.offers o
              where o.load_id = l.id and o.status = 'pending' and o.expires_at > now()) < v_size
      order by l.accepted_at
      limit 10
    loop
      perform private.next_wave(r.id);
    end loop;
  exception when others then
    -- Never fail the driver's own switch or location report over a search.
    raise warning 'driver_online_match: %', sqlstate;
  end;
  return null;
end;
$$;
revoke all on function private.driver_online_match() from public, anon, authenticated;

drop trigger if exists driver_online_match on public.driver_availability;
create trigger driver_online_match
  after insert or update of available, city_id, located_at on public.driver_availability
  for each row execute function private.driver_online_match();

-- ═══ 7. the console can edit all of it ═══════════════════════════════════════
-- 0069's registry; the dispatch rows relabelled for this design, three added.
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
