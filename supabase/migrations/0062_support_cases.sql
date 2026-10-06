-- 0062 · Support desk S1: cases v2.
--
-- shipment_cases (0052) grows into a support case: who it is about, a
-- priority and a response deadline, an assignee, a status a person can move,
-- an outcome, reopening, and a thread of everything done on it. Extended in
-- place, so the app's report_shipment_problem and request_load_cancellation
-- keep working unchanged. Staff reads and writes are require_ops() definers,
-- each audited. The table and the thread stay unreadable by any client.

-- ═══ 1. the case ═════════════════════════════════════════════════════════════
alter table public.shipment_cases alter column load_id drop not null;
alter table public.shipment_cases alter column reporter_id drop not null;

alter table public.shipment_cases drop constraint shipment_cases_kind_check;
alter table public.shipment_cases add constraint shipment_cases_kind_check check (kind in (
  'delay', 'breakdown', 'damage', 'other', 'cancel_request',
  'no_show', 'abandoned', 'release', 'delivery_dispute', 'no_pod', 'price_demand', 'misconduct',
  'not_ready', 'cargo_mismatch', 'late_cancel', 'unreachable', 'change_request',
  'account_flag', 'appeal', 'app_problem'));

alter table public.shipment_cases drop constraint shipment_cases_status_check;
update public.shipment_cases set status = 'new' where status = 'open';
alter table public.shipment_cases alter column status set default 'new';
alter table public.shipment_cases add constraint shipment_cases_status_check
  check (status in ('new', 'in_progress', 'waiting_customer', 'waiting_driver', 'resolved'));

alter table public.shipment_cases
  add column subject_id      uuid references public.profiles(id),
  add column priority        text check (priority in ('urgent', 'high', 'normal')),
  add column assignee_id     uuid references public.profiles(id),
  add column due_at          timestamptz,
  add column opened_by_staff boolean not null default false,
  add column outcome         text check (outcome in ('redispatched', 'reassigned', 'driver_warned',
                               'shipper_informed', 'no_fault', 'resolved_by_parties', 'duplicate',
                               'not_actionable', 'other')),
  add column reopened_at     timestamptz;

drop index if exists public.shipment_cases_queue_idx;
create index shipment_cases_queue_idx on public.shipment_cases (due_at) where status <> 'resolved';
create index shipment_cases_assignee_idx on public.shipment_cases (assignee_id) where status <> 'resolved';
create index shipment_cases_subject_idx on public.shipment_cases (subject_id);

-- The first triage, the same for every way a case is opened.
create or replace function private.case_priority_for(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('breakdown', 'abandoned', 'no_show', 'misconduct') then 'urgent'
    when p_kind in ('damage', 'delivery_dispute', 'price_demand', 'release', 'late_cancel', 'cancel_request',
                    'not_ready', 'unreachable', 'delay', 'change_request', 'cargo_mismatch') then 'high'
    else 'normal'
  end;
$$;
revoke all on function private.case_priority_for(text) from public, anon, authenticated;

create or replace function private.case_sla(p_priority text)
returns interval
language sql
stable
security definer
set search_path = ''
as $$
  select make_interval(mins => case p_priority
    when 'urgent' then private.setting_int('case_sla_urgent_minutes', 15)
    when 'high'   then private.setting_int('case_sla_high_minutes', 120)
    else               private.setting_int('case_sla_normal_minutes', 1440) end);
$$;
revoke all on function private.case_sla(text) from public, anon, authenticated;

-- Defaults for every insert path: priority from the kind, a deadline from the
-- priority, and — for a report on a trip — the other side as the subject.
create or replace function private.shipment_cases_triage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver  uuid;
  v_shipper uuid;
begin
  if new.status = 'open' then new.status := 'new'; end if;
  new.priority := coalesce(new.priority, private.case_priority_for(new.kind));
  new.due_at := coalesce(new.due_at, coalesce(new.created_at, now()) + private.case_sla(new.priority));
  if new.subject_id is null and new.trip_id is not null and new.reporter_id is not null then
    select t.driver_id, l.shipper_id into v_driver, v_shipper
      from public.trips t join public.loads l on l.id = t.load_id where t.id = new.trip_id;
    if new.reporter_id = v_shipper then new.subject_id := v_driver;
    elsif new.reporter_id = v_driver then new.subject_id := v_shipper;
    end if;
  end if;
  return new;
end;
$$;
create trigger shipment_cases_triage before insert on public.shipment_cases
  for each row execute function private.shipment_cases_triage();

-- ═══ 2. the thread ═══════════════════════════════════════════════════════════
create table private.case_events (
  id         bigint generated always as identity primary key,
  case_id    uuid not null references public.shipment_cases(id) on delete cascade,
  kind       text not null check (kind in ('opened', 'note', 'assign', 'contact', 'message', 'status',
                                           'resolved', 'reopened', 'evidence', 'action')),
  body       text check (body is null or char_length(body) <= 1000),
  meta       jsonb,
  actor_id   uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index case_events_case_idx on private.case_events (case_id, id desc);
revoke all on private.case_events from public, anon, authenticated;
alter table private.case_events enable row level security;
alter table private.case_events force row level security;
comment on table private.case_events is
  'Everything done on a support case (0062). Append-only, no client grant; read through ops_case().';

create or replace function private.shipment_cases_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.case_events (case_id, kind, meta, actor_id)
  values (new.id, 'opened', jsonb_build_object('kind', new.kind, 'priority', new.priority,
                                               'by_staff', new.opened_by_staff), new.reporter_id);
  return null;
end;
$$;
create trigger shipment_cases_opened after insert on public.shipment_cases
  for each row execute function private.shipment_cases_opened();

create or replace function private.case_event(p_case_id uuid, p_kind text, p_body text, p_meta jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.case_events (case_id, kind, body, meta, actor_id)
  values (p_case_id, p_kind, p_body, p_meta, auth.uid());
$$;
revoke all on function private.case_event(uuid, text, text, jsonb) from public, anon, authenticated;

-- A case row for a staff write, locked. Not found if it does not exist.
create or replace function private.case_for_update(p_case_id uuid)
returns public.shipment_cases
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
begin
  select * into v from public.shipment_cases c where c.id = p_case_id for update;
  if not found then
    raise exception 'case not found' using errcode = 'no_data_found';
  end if;
  return v;
end;
$$;
revoke all on function private.case_for_update(uuid) from public, anon, authenticated;

create or replace function private.clean_text(p_text text, p_min integer, p_what text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_text, ''));
begin
  if char_length(v) < p_min or char_length(v) > 1000 or private.contains_unsafe_text(v) then
    raise exception '% needs % to 1000 characters of plain text', p_what, p_min using errcode = 'check_violation';
  end if;
  return v;
end;
$$;
revoke all on function private.clean_text(text, integer, text) from public, anon, authenticated;

-- ═══ 3. settings ═════════════════════════════════════════════════════════════
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
     'Any other case is overdue after this long.', 60, 10080)
$$;

-- ═══ 4. staff reads ══════════════════════════════════════════════════════════
create or replace function private.party_role(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from private.ops_users o where o.profile_id = p_id) then 'staff'
              else (select p.role::text from public.profiles p where p.id = p_id) end;
$$;
revoke all on function private.party_role(uuid) from public, anon, authenticated;

create or replace function public.ops_support_queue(
  p_include_resolved boolean default false,
  p_status           text    default null,
  p_kind             text    default null,
  p_priority         text    default null,
  p_assignee         text    default null,
  p_party            uuid    default null,
  p_limit            integer default 50,
  p_offset           integer default 0
)
returns table (queue_position bigint, id uuid, kind text, priority text, status text,
               created_at timestamptz, due_at timestamptz, overdue boolean, minutes_to_due integer,
               assignee_id uuid, assignee_name text,
               reporter_id uuid, reporter_name text, reporter_role text,
               subject_id uuid, subject_name text, subject_role text,
               load_id uuid, trip_id uuid, route text, summary text, last_event_at timestamptz,
               total_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_me     uuid := auth.uid();
begin
  perform private.require_ops();
  return query
  with base as (
    select c.*,
           (c.status <> 'resolved' and c.due_at < now()) as is_overdue,
           case c.priority when 'urgent' then 0 when 'high' then 1 else 2 end as prank
      from public.shipment_cases c
     where (coalesce(p_include_resolved, false) or c.status <> 'resolved')
       and (p_status is null or c.status = p_status)
       and (p_kind is null or c.kind = p_kind)
       and (p_priority is null or c.priority = p_priority)
       and (p_assignee is null
            or (p_assignee = 'me' and c.assignee_id = v_me)
            or (p_assignee = 'none' and c.assignee_id is null)
            or (p_assignee not in ('me', 'none') and c.assignee_id::text = p_assignee))
       and (p_party is null or p_party in (c.reporter_id, c.subject_id))
  ),
  ordered as (
    select b.*, row_number() over (order by b.is_overdue desc, b.prank, b.due_at, b.created_at, b.id) as pos,
           count(*) over () as total
      from base b
  )
  select o.pos, o.id, o.kind, o.priority, o.status, o.created_at, o.due_at, o.is_overdue,
         (extract(epoch from o.due_at - now()) / 60)::integer,
         o.assignee_id, ap.full_name,
         o.reporter_id, rp.full_name, private.party_role(o.reporter_id),
         o.subject_id, sp.full_name, private.party_role(o.subject_id),
         o.load_id, o.trip_id,
         oc.name_en || ' → ' || dc.name_en,
         left(o.details, 140),
         (select max(e.created_at) from private.case_events e where e.case_id = o.id),
         o.total
    from ordered o
    left join public.profiles ap on ap.id = o.assignee_id
    left join public.profiles rp on rp.id = o.reporter_id
    left join public.profiles sp on sp.id = o.subject_id
    left join public.loads l on l.id = o.load_id
    left join public.cities oc on oc.id = l.origin_city
    left join public.cities dc on dc.id = l.dest_city
   order by o.pos
   limit v_limit offset v_offset;
end;
$$;
revoke all on function public.ops_support_queue(boolean, text, text, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.ops_support_queue(boolean, text, text, text, text, uuid, integer, integer) to authenticated;

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
       'overdue', v.status <> 'resolved' and v.due_at < now()),
    'parties', (select coalesce(jsonb_agg(jsonb_build_object(
                  'side', x.side, 'id', p.id, 'name', p.full_name, 'phone', p.phone,
                  'language', p.language, 'role', private.party_role(p.id),
                  'suspended', p.suspended_at is not null) order by x.ord), '[]'::jsonb)
                  from (values ('reporter', v.reporter_id, 1), ('subject', v.subject_id, 2)) x(side, pid, ord)
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

-- ═══ 5. staff writes — every one in the thread and in ops_audit ══════════════
create or replace function public.ops_open_case(
  p_kind text, p_details text, p_load_id uuid, p_trip_id uuid, p_subject_id uuid, p_priority text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_load    uuid := p_load_id;
  v_details text;
  v_id      uuid;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_open_case', 200, interval '1 hour');
  if p_kind is null or private.case_priority_for(p_kind) is null
     or p_kind not in ('delay', 'breakdown', 'damage', 'other', 'cancel_request', 'no_show', 'abandoned', 'release',
                       'delivery_dispute', 'no_pod', 'price_demand', 'misconduct', 'not_ready', 'cargo_mismatch',
                       'late_cancel', 'unreachable', 'change_request', 'account_flag', 'appeal', 'app_problem') then
    raise exception 'unknown case kind' using errcode = 'check_violation';
  end if;
  if p_priority is not null and p_priority not in ('urgent', 'high', 'normal') then
    raise exception 'priority is urgent, high or normal' using errcode = 'check_violation';
  end if;
  v_details := private.clean_text(p_details, 10, 'a case');
  if p_trip_id is not null then
    select t.load_id into v_load from public.trips t where t.id = p_trip_id;
    if v_load is null then raise exception 'trip not found' using errcode = 'no_data_found'; end if;
  elsif v_load is not null and not exists (select 1 from public.loads l where l.id = v_load) then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;
  if p_subject_id is not null and not exists (select 1 from public.profiles p where p.id = p_subject_id) then
    raise exception 'person not found' using errcode = 'no_data_found';
  end if;

  insert into public.shipment_cases (load_id, trip_id, reporter_id, subject_id, kind, details, priority, opened_by_staff)
  values (v_load, p_trip_id, auth.uid(), p_subject_id, p_kind, v_details, p_priority, true)
  returning id into v_id;
  perform private.log_ops('ops_open_case', 'shipment_case', v_id::text, null,
    jsonb_build_object('kind', p_kind, 'load_id', v_load, 'trip_id', p_trip_id, 'subject_id', p_subject_id), v_details);
  return v_id;
end;
$$;
revoke all on function public.ops_open_case(text, text, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.ops_open_case(text, text, uuid, uuid, uuid, text) to authenticated;

create or replace function public.ops_case_assign(p_case_id uuid, p_assignee uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
begin
  perform private.require_ops();
  v := private.case_for_update(p_case_id);
  if p_assignee is not null and not exists (select 1 from private.ops_users o where o.profile_id = p_assignee) then
    raise exception 'a case can only be assigned to staff' using errcode = 'check_violation';
  end if;
  update public.shipment_cases set assignee_id = p_assignee,
         status = case when status = 'new' and p_assignee is not null then 'in_progress' else status end
   where id = p_case_id;
  perform private.case_event(p_case_id, 'assign', null, jsonb_build_object('assignee', p_assignee, 'before', v.assignee_id));
  perform private.log_ops('ops_case_assign', 'shipment_case', p_case_id::text,
    jsonb_build_object('assignee', v.assignee_id), jsonb_build_object('assignee', p_assignee), null);
end;
$$;
revoke all on function public.ops_case_assign(uuid, uuid) from public, anon;
grant execute on function public.ops_case_assign(uuid, uuid) to authenticated;

create or replace function public.ops_case_note(p_case_id uuid, p_body text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
  v_body text;
begin
  perform private.require_ops();
  v := private.case_for_update(p_case_id);
  v_body := private.clean_text(p_body, 1, 'a note');
  perform private.case_event(p_case_id, 'note', v_body, null);
  perform private.log_ops('ops_case_note', 'shipment_case', p_case_id::text, null, null, v_body);
end;
$$;
revoke all on function public.ops_case_note(uuid, text) from public, anon;
grant execute on function public.ops_case_note(uuid, text) to authenticated;

create or replace function public.ops_case_log_contact(
  p_case_id uuid, p_channel text, p_party uuid, p_outcome text, p_note text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
  v_note text;
begin
  perform private.require_ops();
  v := private.case_for_update(p_case_id);
  if p_channel is null or p_channel not in ('whatsapp', 'call') then
    raise exception 'contact channel is whatsapp or call' using errcode = 'check_violation';
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'reached', 'no_answer', 'wrong_number', 'left_message') then
    raise exception 'contact outcome is sent, reached, no_answer, wrong_number or left_message' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_party) then
    raise exception 'person not found' using errcode = 'no_data_found';
  end if;
  v_note := case when nullif(btrim(coalesce(p_note, '')), '') is null then null
                 else private.clean_text(p_note, 1, 'a contact note') end;
  perform private.case_event(p_case_id, 'contact', v_note,
    jsonb_build_object('channel', p_channel, 'party', p_party, 'outcome', p_outcome));
  perform private.log_ops('ops_case_log_contact', 'shipment_case', p_case_id::text, null,
    jsonb_build_object('channel', p_channel, 'party', p_party, 'outcome', p_outcome), v_note);
end;
$$;
revoke all on function public.ops_case_log_contact(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.ops_case_log_contact(uuid, text, uuid, text, text) to authenticated;

create or replace function public.ops_case_status(p_case_id uuid, p_status text, p_reason text)
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
  if p_status = 'resolved' then
    raise exception 'use resolve to close a case, with an outcome' using errcode = 'check_violation';
  end if;
  if p_status is null or p_status not in ('new', 'in_progress', 'waiting_customer', 'waiting_driver') then
    raise exception 'unknown case status' using errcode = 'check_violation';
  end if;
  if v.status = 'resolved' then
    raise exception 'a resolved case is reopened, not moved' using errcode = 'check_violation';
  end if;
  v_reason := private.clean_text(p_reason, 3, 'a status change');
  update public.shipment_cases set status = p_status where id = p_case_id;
  perform private.case_event(p_case_id, 'status', v_reason, jsonb_build_object('from', v.status, 'to', p_status));
  perform private.log_ops('ops_case_status', 'shipment_case', p_case_id::text,
    jsonb_build_object('status', v.status), jsonb_build_object('status', p_status), v_reason);
end;
$$;
revoke all on function public.ops_case_status(uuid, text, text) from public, anon;
grant execute on function public.ops_case_status(uuid, text, text) to authenticated;

create or replace function public.ops_case_resolve(p_case_id uuid, p_outcome text, p_resolution text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.shipment_cases;
  v_text text;
begin
  perform private.require_ops();
  v := private.case_for_update(p_case_id);
  if p_outcome is null or p_outcome not in ('redispatched', 'reassigned', 'driver_warned', 'shipper_informed',
                                            'no_fault', 'resolved_by_parties', 'duplicate', 'not_actionable', 'other') then
    raise exception 'unknown outcome' using errcode = 'check_violation';
  end if;
  if v.status = 'resolved' then
    raise exception 'case already resolved' using errcode = 'check_violation';
  end if;
  v_text := private.clean_text(p_resolution, 10, 'a resolution');
  update public.shipment_cases set status = 'resolved', outcome = p_outcome, resolution = v_text,
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_case_id;
  perform private.case_event(p_case_id, 'resolved', v_text, jsonb_build_object('outcome', p_outcome));
  perform private.log_ops('ops_case_resolve', 'shipment_case', p_case_id::text,
    jsonb_build_object('status', v.status), jsonb_build_object('status', 'resolved', 'outcome', p_outcome), v_text);
end;
$$;
revoke all on function public.ops_case_resolve(uuid, text, text) from public, anon;
grant execute on function public.ops_case_resolve(uuid, text, text) to authenticated;

create or replace function public.ops_case_reopen(p_case_id uuid, p_reason text)
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
  if v.status <> 'resolved' then
    raise exception 'only a resolved case can be reopened' using errcode = 'check_violation';
  end if;
  v_reason := private.clean_text(p_reason, 3, 'reopening');
  update public.shipment_cases set status = 'in_progress', reopened_at = now(), outcome = null,
         resolved_by = null, resolved_at = null,
         due_at = now() + private.case_sla(priority)
   where id = p_case_id;
  perform private.case_event(p_case_id, 'reopened', v_reason, jsonb_build_object('previous_outcome', v.outcome));
  perform private.log_ops('ops_case_reopen', 'shipment_case', p_case_id::text,
    jsonb_build_object('status', 'resolved', 'outcome', v.outcome), jsonb_build_object('status', 'in_progress'), v_reason);
end;
$$;
revoke all on function public.ops_case_reopen(uuid, text) from public, anon;
grant execute on function public.ops_case_reopen(uuid, text) to authenticated;

-- ═══ 6. the 0052 functions, on the new statuses ══════════════════════════════
create or replace function public.ops_shipment_cases(p_open_only boolean default true)
returns table(id uuid, load_id uuid, trip_id uuid, reporter_id uuid,
              reporter_name text, kind text, details text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_ops();
  return query select c.id, c.load_id, c.trip_id, c.reporter_id,
    p.full_name, c.kind, c.details, c.status, c.created_at
  from public.shipment_cases c left join public.profiles p on p.id = c.reporter_id
  where not p_open_only or c.status <> 'resolved'
  order by c.created_at asc limit 200;
end $$;
revoke all on function public.ops_shipment_cases(boolean) from public, anon;
grant execute on function public.ops_shipment_cases(boolean) to authenticated;

create or replace function public.ops_resolve_shipment_case(p_case_id uuid, p_resolution text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.check_rate_limit('ops_resolve_shipment_case', 200, interval '1 hour');
  perform public.ops_case_resolve(p_case_id, 'other', p_resolution);
end $$;
revoke all on function public.ops_resolve_shipment_case(uuid, text) from public, anon;
grant execute on function public.ops_resolve_shipment_case(uuid, text) to authenticated;

-- ═══ 7. the live board gains overdue and urgent cases ════════════════════════
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
     where c.status <> 'resolved' and c.due_at < now()

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
     where c.status = 'new' and c.priority = 'urgent' and c.due_at >= now()

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
