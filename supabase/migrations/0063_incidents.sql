-- 0063 · Support desk S2: incidents, strikes and reliability.
--
-- Founder, 2026-10-05: incidents become strikes; drivers with recent strikes
-- are offered work last; suspension stays a staff decision the console only
-- suggests. Fairness is a rule, not a hope:
--   * every strike names its kind, its trip and who decided it;
--   * a detector's finding is SUSPECTED until a person confirms it;
--   * a driver sees their own decided strikes (never the internal reason text)
--     and can appeal each one; staff can void with a reason.
-- No client grant on the table; every staff decision audited.

-- ═══ 1. the table ════════════════════════════════════════════════════════════
create table private.incidents (
  id              uuid primary key default gen_random_uuid(),
  subject_id      uuid not null references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('no_show', 'abandoned', 'release', 'late_cancel', 'damage',
                    'delivery_dispute', 'price_demand', 'misconduct', 'unreachable', 'not_ready',
                    'cargo_mismatch', 'other')),
  weight          smallint not null check (weight between 1 and 3),
  state           text not null check (state in ('suspected', 'confirmed', 'voided')),
  source          text not null check (source in ('detector', 'staff', 'case', 'release')),
  trip_id         uuid references public.trips(id) on delete set null,
  case_id         uuid references public.shipment_cases(id) on delete set null,
  reason          text check (reason is null or char_length(reason) <= 1000),
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 1000),
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  created_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index incidents_subject_idx on private.incidents (subject_id, state, decided_at desc);
create index incidents_review_idx on private.incidents (created_at) where state = 'suspected';
-- A detector flags one trip once per kind.
create unique index incidents_detector_once on private.incidents (kind, trip_id, subject_id) where source = 'detector';
revoke all on private.incidents from public, anon, authenticated;
alter table private.incidents enable row level security;
alter table private.incidents force row level security;
comment on table private.incidents is
  'Strikes (0063). Suspected until a person confirms; confirmed ones in 30 days count. No client grant.';

alter table public.shipment_cases add column incident_id uuid references private.incidents(id) on delete set null;

create or replace function private.incident_weight(p_kind text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select (case
    when p_kind in ('abandoned', 'misconduct') then 3
    when p_kind in ('no_show', 'price_demand', 'damage') then 2
    else 1 end)::smallint;
$$;
revoke all on function private.incident_weight(text) from public, anon, authenticated;

create or replace function private.strikes_30d(p_profile uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(i.weight), 0)::integer from private.incidents i
   where i.subject_id = p_profile and i.state = 'confirmed'
     and coalesce(i.decided_at, i.created_at) > now() - interval '30 days';
$$;
revoke all on function private.strikes_30d(uuid) from public, anon, authenticated;

-- ═══ 2. settings ═════════════════════════════════════════════════════════════
create or replace function private.ops_setting_spec()
returns table (key text, value_type text, label text, description text,
               min_value integer, max_value integer)
language sql
immutable
set search_path = ''
as $$
  values
    ('auto_dispatch_enabled', 'boolean', 'Automatic dispatch',
     'When on, a posted load is offered to nearby drivers with no human involved. When off, every load waits for a dispatcher. Nothing is lost — loads queue normally.',
     null::integer, null::integer),
    -- Since 0036 this is the WAVE size (dispatch_wave: v_size), not a per-load cap.
    ('auto_dispatch_max_offers', 'integer', 'Drivers asked per wave',
     'How many drivers each dispatch wave offers a load to. Every wave asks this many more, so higher fills faster and bothers more drivers.', 1, 20),
    ('auto_dispatch_max_pending_per_driver', 'integer', 'Live offers per driver',
     'How many unanswered offers one driver may hold. Stops one driver being buried.', 1, 20),
    ('auto_dispatch_requires_price', 'boolean', 'Only auto-dispatch priced loads',
     'When on, a load with no price waits for a dispatcher instead of being offered.', null, null),
    ('require_verified_driver', 'boolean', 'Only verified drivers may accept',
     'When on, an unverified driver cannot accept an offer or bid. The website claims "100% verified drivers"; this setting makes that true.', null, null),
    ('dispatch_wave_minutes', 'integer', 'Minutes per dispatch wave',
     'How long each group of drivers has to answer before the next group is asked.', 1, 60),
    -- At most 3: dispatch reads dispatch_radius_km_<wave> and only three exist; a
    -- fourth wave would silently search the 1500 km default.
    ('dispatch_max_waves', 'integer', 'Dispatch waves before a person is alerted',
     'After this many waves with no taker, a dispatcher is alerted. The machine keeps looking, as far as the last wave''s radius.', 1, 3),
    ('dispatch_radius_km_1', 'integer', 'First wave radius (km)',
     'How far from the pickup the first wave looks for drivers.', 10, 2000),
    ('dispatch_radius_km_2', 'integer', 'Second wave radius (km)',
     'How far the second wave looks.', 10, 2000),
    ('dispatch_radius_km_3', 'integer', 'Third wave radius (km)',
     'How far the third wave looks.', 10, 3000),
    ('dispatch_location_fresh_minutes', 'integer', 'GPS counts as fresh for (minutes)',
     'A driver''s last GPS point older than this is ignored and their town is used instead.', 5, 240),
    ('dispatch_rescue_enabled', 'boolean', 'Keep looking after the alert',
     'When on, a load nobody took is offered to any driver who comes online, until its collection date.', null, null),
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
     'Any other case is overdue after this long.', 60, 10080),
    -- 0063: strikes and the detectors.
    ('strike_suspend_threshold', 'integer', 'Strikes before suspension is suggested',
     'When a driver''s strikes in the last 30 days reach this, the console suggests suspending them. Staff decide.', 1, 20),
    ('dispatch_deprioritise_strikes', 'boolean', 'Offer work to drivers with strikes last',
     'When on, drivers with strikes in the last 30 days are asked after drivers with none, at the same distance. They are still asked.', null, null),
    ('no_show_hour', 'integer', 'No-show check, hour of the pickup day (Muscat)',
     'An accepted trip not started by this hour on its first pickup day is flagged as a possible no-show for a person to check.', 8, 23),
    ('abandon_hours', 'integer', 'Possible abandonment after (hours of silence)',
     'A truck on the road with no event or GPS for this long is flagged as possibly abandoned, for a person to check.', 2, 48),
    ('late_release_hours', 'integer', 'Late release, within (hours of pickup)',
     'A driver who releases a job this close to the pickup day gets a heavier strike.', 1, 72)
$$;
insert into private.app_settings (key, value) values
  ('strike_suspend_threshold', '3'::jsonb),
  ('dispatch_deprioritise_strikes', 'true'::jsonb),
  ('no_show_hour', '14'::jsonb),
  ('abandon_hours', '6'::jsonb),
  ('late_release_hours', '12'::jsonb)
on conflict (key) do nothing;

-- ═══ 3. dispatch: strikes last ═══════════════════════════════════════════════
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
          and da.updated_at > o.created_at
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
revoke all on function private.nearby_drivers(uuid, numeric, boolean, integer) from public, anon, authenticated;

-- Staff pick a replacement driver from the same ranking dispatch uses.
create or replace function public.ops_nearby_drivers(p_load_id uuid)
returns table (rank bigint, driver_id uuid, driver_name text, phone text, truck_id uuid,
               deadhead_km numeric, strikes_30d integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  if not exists (select 1 from public.loads l where l.id = p_load_id) then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;
  return query
  select row_number() over (), n.driver_id, p.full_name, p.phone, n.truck_id, n.deadhead_km,
         private.strikes_30d(n.driver_id)
    from private.nearby_drivers(p_load_id, private.setting_int('dispatch_radius_km_3', 1500), true, 50) n
    join public.profiles p on p.id = n.driver_id;
end;
$$;
revoke all on function public.ops_nearby_drivers(uuid) from public, anon;
grant execute on function public.ops_nearby_drivers(uuid) to authenticated;

-- ═══ 4. staff decisions ══════════════════════════════════════════════════════
create or replace function public.ops_incident_add(
  p_subject uuid, p_kind text, p_weight integer, p_trip_id uuid, p_case_id uuid, p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_reason text;
  v_weight smallint;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_incident_add', 100, interval '1 hour');
  if p_kind is null or p_kind not in ('no_show', 'abandoned', 'release', 'late_cancel', 'damage', 'delivery_dispute',
                                      'price_demand', 'misconduct', 'unreachable', 'not_ready', 'cargo_mismatch', 'other') then
    raise exception 'unknown incident kind' using errcode = 'check_violation';
  end if;
  if p_weight is not null and p_weight not between 1 and 3 then
    raise exception 'a strike weighs 1, 2 or 3' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_subject) then
    raise exception 'person not found' using errcode = 'no_data_found';
  end if;
  if p_trip_id is not null and not exists (select 1 from public.trips t where t.id = p_trip_id) then
    raise exception 'trip not found' using errcode = 'no_data_found';
  end if;
  if p_case_id is not null and not exists (select 1 from public.shipment_cases c where c.id = p_case_id) then
    raise exception 'case not found' using errcode = 'no_data_found';
  end if;
  v_reason := private.clean_text(p_reason, 3, 'a strike');
  v_weight := coalesce(p_weight, private.incident_weight(p_kind));

  insert into private.incidents (subject_id, kind, weight, state, source, trip_id, case_id, reason,
                                 decided_by, decided_at, created_by)
  values (p_subject, p_kind, v_weight, 'confirmed', case when p_case_id is null then 'staff' else 'case' end,
          p_trip_id, p_case_id, v_reason, auth.uid(), now(), auth.uid())
  returning id into v_id;

  if p_case_id is not null then
    perform private.case_event(p_case_id, 'action', v_reason,
      jsonb_build_object('action', 'strike', 'incident', v_id, 'kind', p_kind, 'weight', v_weight));
  end if;
  perform private.log_ops('ops_incident_add', 'account', p_subject::text, null,
    jsonb_build_object('incident', v_id, 'kind', p_kind, 'weight', v_weight, 'trip_id', p_trip_id, 'case_id', p_case_id), v_reason);
  return v_id;
end;
$$;
revoke all on function public.ops_incident_add(uuid, text, integer, uuid, uuid, text) from public, anon;
grant execute on function public.ops_incident_add(uuid, text, integer, uuid, uuid, text) to authenticated;

create or replace function private.incident_for_update(p_id uuid)
returns private.incidents
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v private.incidents;
begin
  select * into v from private.incidents i where i.id = p_id for update;
  if not found then
    raise exception 'incident not found' using errcode = 'no_data_found';
  end if;
  return v;
end;
$$;
revoke all on function private.incident_for_update(uuid) from public, anon, authenticated;

create or replace function public.ops_incident_confirm(p_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v private.incidents;
  v_reason text;
begin
  perform private.require_ops();
  v := private.incident_for_update(p_id);
  if v.state = 'voided' then
    raise exception 'a voided incident cannot be confirmed' using errcode = 'check_violation';
  elsif v.state = 'confirmed' then
    raise exception 'already confirmed' using errcode = 'check_violation';
  end if;
  v_reason := private.clean_text(p_reason, 3, 'confirming a strike');
  update private.incidents set state = 'confirmed', decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason
   where id = p_id;
  if v.case_id is not null then
    perform private.case_event(v.case_id, 'action', v_reason, jsonb_build_object('action', 'strike_confirmed', 'incident', p_id));
  end if;
  perform private.log_ops('ops_incident_confirm', 'account', v.subject_id::text,
    jsonb_build_object('incident', p_id, 'state', v.state), jsonb_build_object('incident', p_id, 'state', 'confirmed'), v_reason);
end;
$$;
revoke all on function public.ops_incident_confirm(uuid, text) from public, anon;
grant execute on function public.ops_incident_confirm(uuid, text) to authenticated;

create or replace function public.ops_incident_void(p_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v private.incidents;
  v_reason text;
  v_appeal uuid;
begin
  perform private.require_ops();
  v := private.incident_for_update(p_id);
  if v.state = 'voided' then
    raise exception 'already voided' using errcode = 'check_violation';
  end if;
  v_reason := private.clean_text(p_reason, 3, 'voiding a strike needs a reason;');
  update private.incidents set state = 'voided', decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason
   where id = p_id;
  if v.case_id is not null then
    perform private.case_event(v.case_id, 'action', v_reason, jsonb_build_object('action', 'strike_voided', 'incident', p_id));
  end if;
  select c.id into v_appeal from public.shipment_cases c
   where c.incident_id = p_id and c.kind = 'appeal' and c.status <> 'resolved' limit 1;
  if v_appeal is not null then
    perform private.case_event(v_appeal, 'action', v_reason, jsonb_build_object('action', 'strike_voided', 'incident', p_id));
  end if;
  perform private.log_ops('ops_incident_void', 'account', v.subject_id::text,
    jsonb_build_object('incident', p_id, 'state', v.state), jsonb_build_object('incident', p_id, 'state', 'voided'), v_reason);
end;
$$;
revoke all on function public.ops_incident_void(uuid, text) from public, anon;
grant execute on function public.ops_incident_void(uuid, text) to authenticated;

-- ═══ 5. staff reads ══════════════════════════════════════════════════════════
create or replace function public.ops_incidents(p_subject uuid, p_state text default null)
returns table (id uuid, kind text, weight smallint, state text, source text, trip_id uuid, case_id uuid,
               route text, reason text, decision_reason text, created_at timestamptz, decided_at timestamptz,
               decided_by_name text, appeal_case_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return query
  select i.id, i.kind, i.weight, i.state, i.source, i.trip_id, i.case_id,
         oc.name_en || ' → ' || dc.name_en, i.reason, i.decision_reason, i.created_at, i.decided_at, dp.full_name,
         (select c.id from public.shipment_cases c where c.incident_id = i.id and c.kind = 'appeal'
           order by c.created_at desc limit 1)
    from private.incidents i
    left join public.trips t on t.id = i.trip_id
    left join public.loads l on l.id = t.load_id
    left join public.cities oc on oc.id = l.origin_city
    left join public.cities dc on dc.id = l.dest_city
    left join public.profiles dp on dp.id = i.decided_by
   where i.subject_id = p_subject and (p_state is null or i.state = p_state)
   order by i.created_at desc, i.id;
end;
$$;
revoke all on function public.ops_incidents(uuid, text) from public, anon;
grant execute on function public.ops_incidents(uuid, text) to authenticated;

create or replace function public.ops_reliability(p_profile uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_strikes   integer;
  v_threshold integer := private.setting_int('strike_suspend_threshold', 3);
  v_done      integer;
  v_failed    integer;
begin
  perform private.require_ops();
  if not exists (select 1 from public.profiles p where p.id = p_profile) then
    raise exception 'person not found' using errcode = 'no_data_found';
  end if;
  v_strikes := private.strikes_30d(p_profile);
  select count(*) filter (where t.status in ('delivered'::public.trip_status, 'closed'::public.trip_status)),
         count(*) filter (where t.status = 'cancelled'::public.trip_status)
    into v_done, v_failed
    from public.trips t where t.driver_id = p_profile;
  return jsonb_build_object(
    'strikes_30d', v_strikes,
    'threshold', v_threshold,
    'suggest_suspension', v_strikes >= v_threshold
                          and not exists (select 1 from public.profiles p where p.id = p_profile and p.suspended_at is not null),
    'to_review', (select count(*) from private.incidents i where i.subject_id = p_profile and i.state = 'suspected'),
    'by_kind_90d', (select coalesce(jsonb_object_agg(x.kind, x.n), '{}'::jsonb) from (
                      select i.kind, count(*) n from private.incidents i
                       where i.subject_id = p_profile and i.state = 'confirmed'
                         and coalesce(i.decided_at, i.created_at) > now() - interval '90 days'
                       group by i.kind) x),
    'trips_completed', v_done,
    'trips_cancelled', v_failed,
    'completion_pct', case when v_done + v_failed = 0 then null
                           else round(100.0 * v_done / (v_done + v_failed)) end);
end;
$$;
revoke all on function public.ops_reliability(uuid) from public, anon;
grant execute on function public.ops_reliability(uuid) to authenticated;

-- ═══ 6. the driver's own record, and appeals ════════════════════════════════
-- Decided incidents only (a suspicion is not yet anything), and never the
-- internal reason text: a shipper's words are not handed to the driver.
create or replace function public.my_record()
returns table (id uuid, kind text, weight smallint, state text, trip_id uuid, trip_route text,
               created_at timestamptz, decided_at timestamptz, appeal_open boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.kind, i.weight, i.state, i.trip_id,
         oc.name_en || ' → ' || dc.name_en, i.created_at, i.decided_at,
         exists (select 1 from public.shipment_cases c where c.incident_id = i.id and c.kind = 'appeal'
                  and c.status <> 'resolved')
    from private.incidents i
    left join public.trips t on t.id = i.trip_id
    left join public.loads l on l.id = t.load_id
    left join public.cities oc on oc.id = l.origin_city
    left join public.cities dc on dc.id = l.dest_city
   where auth.uid() is not null and i.subject_id = auth.uid()
     and i.state in ('confirmed', 'voided')
   order by i.created_at desc;
$$;
revoke all on function public.my_record() from public, anon;
grant execute on function public.my_record() to authenticated;

create or replace function public.appeal_incident(p_incident_id uuid, p_text text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v       private.incidents;
  v_text  text;
  v_load  uuid;
  v_case  uuid;
begin
  perform private.check_rate_limit('appeal_incident', 5, interval '1 hour');
  select * into v from private.incidents i where i.id = p_incident_id and i.subject_id = auth.uid() for update;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  if v.state <> 'confirmed' then
    raise exception 'only a confirmed strike can be appealed' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.shipment_cases c where c.incident_id = v.id and c.kind = 'appeal' and c.status <> 'resolved') then
    raise exception 'an appeal is already open for this strike' using errcode = 'check_violation';
  end if;
  v_text := private.clean_text(p_text, 10, 'an appeal');
  select t.load_id into v_load from public.trips t where t.id = v.trip_id;
  insert into public.shipment_cases (load_id, trip_id, reporter_id, kind, details, incident_id)
  values (v_load, v.trip_id, auth.uid(), 'appeal', v_text, v.id)
  returning id into v_case;
  return v_case;
end;
$$;
revoke all on function public.appeal_incident(uuid, text) from public, anon;
grant execute on function public.appeal_incident(uuid, text) to authenticated;

-- ═══ 7. person history shows strikes and cases ═══════════════════════════════
create or replace function private.person_history(p_id uuid)
returns table (at timestamptz, key text, kind text, title text, detail text,
               target_kind text, target_id text, actor text)
language sql
stable
security definer
set search_path = ''
as $$
  -- Only this person's loads: theirs as shipper, or ones they were offered,
  -- bid on or carried. (0059 joined every load in the system.)
  with routes as (
    select l.id, l.shipper_id, l.created_at, l.accepted_at, l.status,
           o.name_en || ' → ' || d.name_en as route
      from public.loads l
      join public.cities o on o.id = l.origin_city
      join public.cities d on d.id = l.dest_city
     where l.shipper_id = p_id
        or l.id in (select o2.load_id from public.offers o2 where o2.driver_id = p_id)
        or l.id in (select b2.load_id from private.driver_bids b2 where b2.driver_id = p_id)
        or l.id in (select t2.load_id from public.trips t2 where t2.driver_id = p_id)
  ),
  my_trips as (
    select t.id, t.created_at, r.route
      from public.trips t join routes r on r.id = t.load_id
     where t.driver_id = p_id or r.shipper_id = p_id
  )
  -- shipper: loads posted and prices accepted
  select r.created_at, 'load_posted:' || r.id, 'load_posted', 'Posted a load: ' || r.route,
         r.status::text, 'load', r.id::text, null::text
    from routes r where r.shipper_id = p_id
  union all
  select r.accepted_at, 'quote_accepted:' || r.id, 'quote_accepted', 'Accepted the price: ' || r.route,
         null, 'load', r.id::text, null
    from routes r where r.shipper_id = p_id and r.accepted_at is not null
  -- driver: offers (no response timestamp exists, so the offer's own time and its outcome)
  union all
  select o.created_at, 'offer:' || o.id,
         case o.status when 'pending'::public.offer_status then 'offer_sent' else 'offer_' || o.status::text end,
         case o.status
           when 'pending'::public.offer_status then 'Offered a load: '
           when 'accepted'::public.offer_status then 'Accepted a load: '
           when 'declined'::public.offer_status then 'Declined a load: '
           else 'Offer closed: ' end || r.route,
         case o.source when 'bid' then 'invited to bid' when 'auto' then 'automatic dispatch' else 'sent by a dispatcher' end,
         'load', o.load_id::text, null
    from public.offers o join routes r on r.id = o.load_id
   where o.driver_id = p_id
  union all
  select b.created_at, 'bid_placed:' || b.id, 'bid_placed', 'Bid on a load: ' || r.route,
         null, 'load', b.load_id::text, null
    from private.driver_bids b join routes r on r.id = b.load_id
   where b.driver_id = p_id
  -- both: trips and what happened on them
  union all
  select t.created_at, 'trip_started:' || t.id, 'trip_started', 'Took the job: ' || t.route,
         null, 'trip', t.id::text, null
    from my_trips t
  union all
  select e.occurred_at, 'trip_event:' || e.id, 'trip_event', initcap(replace(e.type, '_', ' ')) || ': ' || t.route,
         e.note, 'trip', t.id::text, null
    from public.trip_events e join my_trips t on t.id = e.trip_id
   -- A note staff added is already a staff action (ops_add_trip_note).
   where not (e.type = 'note' and exists (select 1 from private.ops_users ou where ou.profile_id = e.created_by))
  union all
  select ra.created_at, 'rating:' || ra.trip_id, 'rating',
         case when ra.driver_id = p_id then 'Was rated ' else 'Gave ' end || ra.stars || ' stars',
         null, 'trip', ra.trip_id::text, null
    from public.ratings ra where ra.driver_id = p_id or ra.shipper_id = p_id
  -- account
  union all
  select dd.created_at, 'document_submitted:' || dd.id, 'document_submitted',
         'Sent a document: ' || replace(dd.kind, '_', ' '), null, 'document', p_id::text, null
    from public.driver_documents dd where dd.driver_id = p_id
  union all
  select dd.reviewed_at, 'document_reviewed:' || dd.id, 'document_reviewed',
         'Document ' || dd.status || ': ' || replace(dd.kind, '_', ' '), dd.review_note,
         'document', p_id::text, null
    from public.driver_documents dd
   where dd.driver_id = p_id and dd.reviewed_at is not null and dd.status <> 'pending'
  union all
  select d.verified_at, 'verified:' || d.profile_id, 'verified', 'Verified as a driver',
         null, 'account', p_id::text, null
    from public.drivers d where d.profile_id = p_id and d.verified_at is not null
     -- Verified from the console: the staff action row says it, with who and why.
     and not exists (select 1 from private.ops_audit a where a.action = 'ops_verify_driver'
                      and a.target_kind = 'account' and a.target_id = p_id::text)
  union all
  select p.suspended_at, 'suspended:' || p.id, 'suspended', 'Suspended', p.suspended_reason,
         'account', p_id::text, null
    from public.profiles p where p.id = p_id and p.suspended_at is not null
     and not exists (select 1 from private.ops_audit a where a.action = 'ops_suspend_account'
                      and a.target_kind = 'account' and a.target_id = p_id::text)
  -- 0063: strikes, in every state staff can see, and support cases.
  union all
  select i.created_at, 'incident:' || i.id, 'incident',
         'Strike: ' || replace(i.kind, '_', ' ')
           || case i.state when 'suspected' then ' (to review)' when 'voided' then ' (voided)' else '' end,
         coalesce(i.decision_reason, i.reason), 'account', p_id::text, null
    from private.incidents i where i.subject_id = p_id
  union all
  select c.created_at, 'case:' || c.id, 'case',
         'Case: ' || replace(c.kind, '_', ' ') || case when c.status = 'resolved' then ' (resolved)' else '' end,
         left(c.details, 140), 'case', c.id::text, null
    from public.shipment_cases c where c.reporter_id = p_id or c.subject_id = p_id
  -- every staff action on them, their loads, trips, documents or trucks
  union all
  select a.created_at, 'staff_action:' || a.id, 'staff_action',
         initcap(replace(regexp_replace(a.action, '^ops_', ''), '_', ' ')), a.reason,
         a.target_kind, a.target_id, ap.full_name
    from private.ops_audit a
    left join public.profiles ap on ap.id = a.actor_id
   where (a.target_kind in ('account', 'profile') and a.target_id = p_id::text)
      or (a.target_kind = 'load' and a.target_id in (select r.id::text from routes r where r.shipper_id = p_id))
      or (a.target_kind = 'trip' and a.target_id in (select t.id::text from my_trips t))
      or (a.target_kind = 'driver_document'
          and a.target_id in (select dd.id::text from public.driver_documents dd where dd.driver_id = p_id))
      or (a.target_kind = 'truck'
          and a.target_id in (select tr.id::text from public.trucks tr where tr.owner_id = p_id))
      or (a.target_kind = 'offer'
          and a.target_id in (select o.id::text from public.offers o where o.driver_id = p_id))
      or (a.target_kind = 'leg'
          and a.target_id in (select lg.id::text from public.legs lg where lg.driver_id = p_id))
      -- A trip reassigned away from them no longer names them; its audit row's
      -- before-state still does, and that is the trace of why.
      or (a.target_kind in ('trip', 'load')
          and p_id::text in (a.before ->> 'driver_id', a.after ->> 'driver_id'));
$$;
revoke all on function private.person_history(uuid) from public, anon, authenticated;
