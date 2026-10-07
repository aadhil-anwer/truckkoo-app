-- 0064 · Support desk S2: detectors, review on the board, playbooks.
--
-- The machine looks for the problems nobody reports — an accepted trip never
-- started, a truck gone silent on the road, a suspended driver back on a new
-- account — and hands each to a person as a SUSPECTED strike with an urgent
-- case. It never decides: confirming or voiding is a staff action (0063).
-- Playbooks let a person do the real thing from the case — send the load back
-- to dispatch, give the trip to another driver, cancel — through the existing
-- validated transitions, written into the case thread.

-- ═══ 1. detectors ════════════════════════════════════════════════════════════
create or replace function private.flag_trip(p_trip_id uuid, p_driver uuid, p_kind text, p_case_kind text, p_text text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_incident uuid;
  v_case     uuid;
  v_load     uuid;
begin
  insert into private.incidents (subject_id, kind, weight, state, source, trip_id, reason)
  values (p_driver, p_kind, private.incident_weight(p_kind), 'suspected', 'detector', p_trip_id, p_text)
  on conflict (kind, trip_id, subject_id) where source = 'detector' do nothing
  returning id into v_incident;
  if v_incident is null then
    return false;
  end if;
  select t.load_id into v_load from public.trips t where t.id = p_trip_id;
  insert into public.shipment_cases (load_id, trip_id, reporter_id, subject_id, kind, details, incident_id)
  values (v_load, p_trip_id, null, p_driver, p_case_kind, p_text, v_incident)
  returning id into v_case;
  update private.incidents set case_id = v_case where id = v_incident;
  return true;
end;
$$;
revoke all on function private.flag_trip(uuid, uuid, text, text, text) from public, anon, authenticated;

-- An accepted trip not started by the check hour (Muscat) of its first pickup
-- day. Two hours' grace for a trip accepted just before that hour.
create or replace function private.system_detect_no_shows()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hour integer := private.setting_int('no_show_hour', 14);
  v_n    integer := 0;
  r      record;
begin
  for r in
    select t.id, t.driver_id
      from public.trips t join public.loads l on l.id = t.load_id
     where t.status = 'assigned'::public.trip_status
       and t.created_at < now() - interval '2 hours'
       and now() > ((l.pickup_from::timestamp + make_interval(hours => v_hour)) at time zone 'Asia/Muscat')
  loop
    if private.flag_trip(r.id, r.driver_id, 'no_show', 'no_show',
         format('Detected: the trip was accepted but not started by %s:00 on the pickup day.', v_hour)) then
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    perform private.log_system('system_detect_no_shows', 'system', null, jsonb_build_object('flagged', v_n));
  end if;
  return v_n;
end;
$$;
revoke all on function private.system_detect_no_shows() from public, anon, authenticated;

-- A truck on the road with no event and no GPS fix for abandon_hours.
create or replace function private.system_detect_abandoned()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hours integer := private.setting_int('abandon_hours', 6);
  v_n     integer := 0;
  r       record;
begin
  for r in
    select t.id, t.driver_id
      from public.trips t
     where t.status = 'in_transit'::public.trip_status
       and greatest(t.created_at,
                    (select max(e.occurred_at) from public.trip_events e where e.trip_id = t.id),
                    (select max(p.seen_at) from public.trip_positions p where p.trip_id = t.id))
           < now() - make_interval(hours => v_hours)
  loop
    if private.flag_trip(r.id, r.driver_id, 'abandoned', 'abandoned',
         format('Detected: no event and no GPS from the truck for over %s hours while carrying the load.', v_hours)) then
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n > 0 then
    perform private.log_system('system_detect_abandoned', 'system', null, jsonb_build_object('flagged', v_n));
  end if;
  return v_n;
end;
$$;
revoke all on function private.system_detect_abandoned() from public, anon, authenticated;

create or replace function private.phone_key(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when d is null or d = '' then null
              when length(d) = 8 then '968' || d
              else d end
    from (select regexp_replace(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '^00', '') d) x;
$$;
revoke all on function private.phone_key(text) from public, anon, authenticated;

-- A new account (last two days) that shares a phone or a truck plate with a
-- suspended one. A flag for a person — families share phones and trucks change
-- hands, so this never suspends anyone by itself.
create or replace function private.system_detect_returning()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  r   record;
begin
  for r in
    select n.id, s.full_name as matched_name,
           case when private.phone_key(n.phone) = private.phone_key(s.phone) then 'phone number' else 'truck plate' end as what
      from public.profiles n
      join public.profiles s on s.suspended_at is not null and s.id <> n.id
     where n.created_at > now() - interval '2 days'
       and n.suspended_at is null
       and (private.phone_key(n.phone) = private.phone_key(s.phone)
            or exists (select 1 from public.trucks nt join public.trucks st on st.owner_id = s.id
                        where nt.owner_id = n.id and nt.plate is not null
                          and upper(regexp_replace(nt.plate, '\s', '', 'g')) = upper(regexp_replace(st.plate, '\s', '', 'g'))))
       and not exists (select 1 from public.shipment_cases c where c.kind = 'account_flag' and c.subject_id = n.id)
  loop
    insert into public.shipment_cases (reporter_id, subject_id, kind, details)
    values (null, r.id, 'account_flag',
            format('Detected: this new account has the same %s as a suspended account. Check before they are offered work.', r.what));
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    perform private.log_system('system_detect_returning', 'system', null, jsonb_build_object('flagged', v_n));
  end if;
  return v_n;
end;
$$;
revoke all on function private.system_detect_returning() from public, anon, authenticated;

create or replace function private.system_detect_trouble()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.system_detect_no_shows();
  perform private.system_detect_abandoned();
end;
$$;
revoke all on function private.system_detect_trouble() from public, anon, authenticated;

select cron.schedule('detect-trouble', '*/5 * * * *', $$select private.system_detect_trouble()$$);
select cron.schedule('detect-returning', '23 * * * *', $$select private.system_detect_returning()$$);

-- ═══ 2. the live board ═══════════════════════════════════════════════════════
create or replace function public.ops_board()
returns table (kind text, target_kind text, target_id text, title text, reason text,
               age_minutes integer, urgency integer, action text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Muscat')::date;
begin
  perform private.require_ops();

  return query
  with route as (
    select l.id, l.status, l.pricing_mode, l.pickup_to, l.bid_deadline, l.selected_bid_id,
           l.created_at, l.accepted_at,
           o.name_en || ' → ' || d.name_en as title
      from public.loads l
      join public.cities o on o.id = l.origin_city
      join public.cities d on d.id = l.dest_city
  ),
  rows as (
    -- A load nobody has taken.
    select 'finding_truck'::text as kind, 'load'::text as target_kind, r.id::text as target_id, r.title,
           (extract(epoch from now() - coalesce(r.accepted_at, r.created_at)) / 60)::integer as age_minutes,
           case when r.pickup_to <= v_today + 1 then 4 else 3 end as urgency,
           'Finding a truck for %s'::text as reason_fmt,
           'Send an offer'::text as action
      from route r
     where r.status = 'finding_truck'::public.load_status and r.pickup_to >= v_today

    union all
    -- An auction with nobody bidding.
    select 'bid_no_bids', 'load', r.id::text, r.title,
           (extract(epoch from now() - r.created_at) / 60)::integer,
           case when r.bid_deadline <= now() + interval '15 minutes' then 4 else 2 end,
           'No bids yet, closes in ' || private.ops_ago(greatest(0, (extract(epoch from r.bid_deadline - now()) / 60)::integer)),
           'Extend bidding or call drivers'
      from route r
     where r.pricing_mode = 'bid'
       and r.status in ('posted'::public.load_status, 'matched'::public.load_status)
       and r.selected_bid_id is null
       and r.bid_deadline > now()
       and not exists (select 1 from private.driver_bids b where b.load_id = r.id)

    union all
    -- The machine has had it 15 minutes and found nobody.
    select 'machine_stuck', 'load', r.id::text, r.title,
           (extract(epoch from now() - r.accepted_at) / 60)::integer,
           3,
           'Searching automatically for %s',
           'Take it in hand'
      from route r
     where r.accepted_at < now() - interval '15 minutes'
       and r.status not in ('finding_truck'::public.load_status, 'assigned'::public.load_status,
                            'in_transit'::public.load_status, 'delivered'::public.load_status,
                            'closed'::public.load_status, 'cancelled'::public.load_status)
       and private.machine_owns(r.id)
       and not exists (select 1 from public.trips t where t.load_id = r.id)

    union all
    -- A truck on the road that has gone silent: no event and no position.
    select 'trip_quiet', 'trip', t.id::text, r.title,
           (extract(epoch from now() - s.last_sign) / 60)::integer,
           3,
           'No sign of life for %s',
           'Call the driver'
      from public.trips t
      join route r on r.id = t.load_id
      cross join lateral (
        select greatest(
                 t.created_at,
                 (select max(e.occurred_at) from public.trip_events e where e.trip_id = t.id),
                 (select max(p.seen_at) from public.trip_positions p where p.trip_id = t.id)) as last_sign
      ) s
     where t.status = 'in_transit'::public.trip_status
       and s.last_sign < now() - interval '3 hours'

    union all
    -- Delivered, but nobody photographed it.
    select 'no_pod', 'trip', t.id::text, r.title,
           (extract(epoch from now() - coalesce(
              (select max(e.occurred_at) from public.trip_events e where e.trip_id = t.id), t.created_at)) / 60)::integer,
           1,
           'Delivered %s ago with no photo',
           'Ask for the delivery photo'
      from public.trips t
      join route r on r.id = t.load_id
     where t.status = 'delivered'::public.trip_status
       and not exists (select 1 from public.trip_events e where e.trip_id = t.id and e.photo_path is not null)

    union all
    -- A driver's documents waiting for review (0050), oldest first.
    select 'docs_pending', 'driver', dd.driver_id::text, coalesce(p.full_name, 'Unnamed driver'),
           (extract(epoch from now() - min(dd.created_at)) / 60)::integer,
           2,
           case when count(*) = 1 then '1 document' else count(*) || ' documents' end || ' waiting for %s',
           'Review documents'
      from public.driver_documents dd
      join public.profiles p on p.id = dd.driver_id
     where dd.status = 'pending'
     group by dd.driver_id, p.full_name

    union all
    -- 0062: a support case past its response time.
    select 'case_overdue', 'case', c.id::text,
           initcap(replace(c.kind, '_', ' ')) || coalesce(' · ' || r.title, ''),
           (extract(epoch from now() - c.due_at) / 60)::integer,
           case when c.priority = 'urgent' then 5 else 4 end,
           'Overdue by %s',
           case when c.assignee_id is null then 'Take it' else 'Chase it' end
      from public.shipment_cases c
      left join route r on r.id = c.load_id
     where c.status <> 'resolved' and c.responded_at is null and c.due_at < now()

    union all
    -- 0062: an urgent case nobody has picked up yet (not yet overdue).
    select 'case_urgent_new', 'case', c.id::text,
           initcap(replace(c.kind, '_', ' ')) || coalesce(' · ' || r.title, ''),
           (extract(epoch from now() - c.created_at) / 60)::integer,
           4,
           'Urgent, opened %s ago',
           'Take it'
      from public.shipment_cases c
      left join route r on r.id = c.load_id
     where c.status = 'new' and c.priority = 'urgent' and c.responded_at is null and c.due_at >= now()

    union all
    -- 0064: a strike someone suspects and nobody has decided, with no case
    -- of its own to carry it (a detector's finding comes with a case).
    select 'incident_to_review', 'incident', i.id::text,
           coalesce(p.full_name, 'Someone') || ' — ' || replace(i.kind, '_', ' '),
           (extract(epoch from now() - i.created_at) / 60)::integer,
           3,
           'Flagged %s ago',
           'Confirm or void'
      from private.incidents i
      join public.profiles p on p.id = i.subject_id
     where i.state = 'suspected' and i.case_id is null

    union all
    -- An alert from the last day nobody has acknowledged.
    select 'alert', 'alert', a.id::text, initcap(replace(a.kind, '_', ' ')),
           (extract(epoch from now() - a.created_at) / 60)::integer,
           2,
           'Raised %s ago',
           'Acknowledge'
      from private.ops_alerts a
     where a.created_at > now() - interval '24 hours'
       and a.acknowledged_at is null
  )
  select x.kind, x.target_kind, x.target_id, x.title,
         case when x.reason_fmt like '%\%s%' then replace(x.reason_fmt, '%s', private.ops_ago(x.age_minutes))
              else x.reason_fmt end,
         x.age_minutes, x.urgency, x.action
    from rows x
   order by x.urgency desc, x.age_minutes desc;
end;
$$;

-- ═══ 3. playbooks ════════════════════════════════════════════════════════════
create or replace function public.ops_case_redispatch(p_case_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
  v_reason text;
begin
  perform private.require_ops();
  v := private.case_for_update(p_case_id);
  v_reason := private.clean_text(p_reason, 3, 'sending a load back');
  if v.trip_id is null or not exists (select 1 from public.trips t where t.id = v.trip_id
       and t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)) then
    raise exception 'this case has no trip still on the road' using errcode = 'check_violation';
  end if;
  -- The validated transition: offers expire, the leg reopens, the load looks
  -- for a truck again, and rescue (0037) re-offers it.
  perform public.ops_set_trip_status(v.trip_id, 'cancelled'::public.trip_status, v_reason);
  perform private.case_event(p_case_id, 'action', v_reason, jsonb_build_object('action', 'redispatched', 'trip', v.trip_id));
  perform private.log_ops('ops_case_redispatch', 'shipment_case', p_case_id::text, null,
    jsonb_build_object('trip', v.trip_id), v_reason);
end;
$$;
revoke all on function public.ops_case_redispatch(uuid, text) from public, anon;
grant execute on function public.ops_case_redispatch(uuid, text) to authenticated;

create or replace function public.ops_case_reassign(p_case_id uuid, p_driver_id uuid, p_truck_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
  v_reason text;
  v_from   uuid;
begin
  perform private.require_ops();
  v := private.case_for_update(p_case_id);
  v_reason := private.clean_text(p_reason, 3, 'giving the trip to another driver');
  if v.trip_id is null then
    raise exception 'this case has no trip' using errcode = 'check_violation';
  end if;
  select t.driver_id into v_from from public.trips t where t.id = v.trip_id;
  perform public.ops_reassign_trip(v.trip_id, p_driver_id, p_truck_id, v_reason);
  perform private.case_event(p_case_id, 'action', v_reason,
    jsonb_build_object('action', 'reassigned', 'trip', v.trip_id, 'from', v_from, 'to', p_driver_id));
  perform private.log_ops('ops_case_reassign', 'shipment_case', p_case_id::text,
    jsonb_build_object('driver', v_from), jsonb_build_object('driver', p_driver_id, 'trip', v.trip_id), v_reason);
end;
$$;
revoke all on function public.ops_case_reassign(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.ops_case_reassign(uuid, uuid, uuid, text) to authenticated;

create or replace function public.ops_case_cancel_load(p_case_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
  v_reason text;
begin
  perform private.require_ops();
  v := private.case_for_update(p_case_id);
  v_reason := private.clean_text(p_reason, 3, 'cancelling a load');
  if v.load_id is null then
    raise exception 'this case has no load' using errcode = 'check_violation';
  end if;
  perform public.ops_set_load_status(v.load_id, 'cancelled'::public.load_status, v_reason);
  perform private.case_event(p_case_id, 'action', v_reason, jsonb_build_object('action', 'load_cancelled', 'load', v.load_id));
  perform private.log_ops('ops_case_cancel_load', 'shipment_case', p_case_id::text, null,
    jsonb_build_object('load', v.load_id), v_reason);
end;
$$;
revoke all on function public.ops_case_cancel_load(uuid, text) from public, anon;
grant execute on function public.ops_case_cancel_load(uuid, text) to authenticated;

-- ═══ 4. the case page sees its strike ════════════════════════════════════════
create or replace function public.ops_case(p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
begin
  perform private.require_ops();
  select * into v from public.shipment_cases c where c.id = p_case_id;
  if not found then
    raise exception 'case not found' using errcode = 'no_data_found';
  end if;
  return jsonb_build_object(
    'case', to_jsonb(v) || jsonb_build_object(
       'assignee_name', (select p.full_name from public.profiles p where p.id = v.assignee_id),
       'resolved_by_name', (select p.full_name from public.profiles p where p.id = v.resolved_by),
       'route', (select oc.name_en || ' → ' || dc.name_en from public.loads l
                   join public.cities oc on oc.id = l.origin_city
                   join public.cities dc on dc.id = l.dest_city where l.id = v.load_id),
       -- For messages in Arabic: the arrow points the way Arabic reads.
       'route_ar', (select oc.name_ar || ' ← ' || dc.name_ar from public.loads l
                      join public.cities oc on oc.id = l.origin_city
                      join public.cities dc on dc.id = l.dest_city where l.id = v.load_id),
       'load_status', (select l.status from public.loads l where l.id = v.load_id),
       'trip_status', (select t.status from public.trips t where t.id = v.trip_id),
       'overdue', v.status <> 'resolved' and v.responded_at is null and v.due_at < now()),
    -- 0064: the strike this case carries, and whether anyone has decided it.
    'incident', (select jsonb_build_object('id', i.id, 'kind', i.kind, 'weight', i.weight, 'state', i.state,
                                           'subject_id', i.subject_id, 'decision_reason', i.decision_reason)
                   from private.incidents i where i.id = v.incident_id),
    'parties', (select coalesce(jsonb_agg(jsonb_build_object(
                  'side', x.side, 'id', p.id, 'name', p.full_name, 'phone', p.phone,
                  'language', p.language, 'role', private.party_role(p.id),
                  'suspended', p.suspended_at is not null) order by x.ord), '[]'::jsonb)
                  from (select distinct on (y.pid) y.side, y.pid, y.ord
                          from (values ('reporter', v.reporter_id, 1), ('subject', v.subject_id, 2),
                                       ('shipper', (select l.shipper_id from public.loads l where l.id = v.load_id), 3),
                                       ('driver', (select t.driver_id from public.trips t where t.id = v.trip_id), 4)) y(side, pid, ord)
                         where y.pid is not null
                         order by y.pid, y.ord) x
                  join public.profiles p on p.id = x.pid),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', e.id, 'kind', e.kind, 'body', e.body, 'meta', e.meta,
                 'actor_name', p.full_name, 'created_at', e.created_at) order by e.created_at desc, e.id desc), '[]'::jsonb)
                 from private.case_events e left join public.profiles p on p.id = e.actor_id
                where e.case_id = v.id));
end;
$$;
revoke all on function public.ops_case(uuid) from public, anon;
grant execute on function public.ops_case(uuid) to authenticated;
