-- 0065 · Support desk S3: a driver can release a job, staff can message
-- people in the app, and reports can carry photos.
--
-- Releasing is the honest exit (founder, 2026-10-05): better a driver says
-- "I can't" a day ahead than goes silent on the morning. It cancels the trip
-- through the same steps a staff cancel takes, sends the load back to finding
-- a truck (rescue, 0037, re-offers it), tells the shipper by push, records a
-- light strike — heavier on the pickup day — and opens a case so staff see it.
-- With the cargo already on the truck there is no release: that is a problem
-- to report, not a job to hand back.

-- ═══ 1. release ══════════════════════════════════════════════════════════════
-- The cancel cascade of ops_set_trip_status (0016), as one internal step.
-- ops_set_trip_status itself is unchanged; release_messages.sql proves both
-- land the load in the same state.
create or replace function private.cancel_trip_cascade(p_trip_id uuid, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_trip public.trips;
begin
  select * into v_trip from public.trips t where t.id = p_trip_id for update;
  update public.trips set status = 'cancelled'::public.trip_status where id = p_trip_id;
  update public.loads set status = 'finding_truck'::public.load_status where id = v_trip.load_id;
  update public.offers set status = 'expired'
   where load_id = v_trip.load_id and status in ('pending', 'accepted');
  update public.legs set status = 'open' where id = v_trip.leg_id and status = 'matched';
  insert into public.trip_events (trip_id, type, note) values (p_trip_id, 'note', left(p_note, 500));
end;
$$;
revoke all on function private.cancel_trip_cascade(uuid, text) from public, anon, authenticated;

create or replace function private.release_reason_label(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when 'breakdown'  then 'truck broke down'
    when 'sick'       then 'driver is ill'
    when 'family'     then 'family emergency'
    when 'wrong_load' then 'the load is not what was agreed'
    when 'too_far'    then 'cannot reach the pickup in time'
    else 'other reason' end;
$$;
revoke all on function private.release_reason_label(text) from public, anon, authenticated;

create or replace function public.release_trip(p_trip_id uuid, p_reason_code text, p_note text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_trip     public.trips;
  v_load     public.loads;
  v_note     text;
  v_weight   smallint := 1;
  v_incident uuid;
  v_case     uuid;
  v_label    text;
begin
  perform private.check_rate_limit('release_trip', 5, interval '1 day');
  select * into v_trip from public.trips t where t.id = p_trip_id and t.driver_id = v_uid for update;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  if p_reason_code is null or p_reason_code not in ('breakdown', 'sick', 'family', 'wrong_load', 'too_far', 'other') then
    raise exception 'choose a reason' using errcode = 'check_violation';
  end if;
  if v_trip.status = 'in_transit'::public.trip_status then
    raise exception 'The cargo is on your truck. Report a problem instead, and we will help.' using errcode = 'check_violation';
  end if;
  if v_trip.status <> 'assigned'::public.trip_status then
    raise exception 'this job can no longer be released' using errcode = 'check_violation';
  end if;
  v_note := case when nullif(btrim(coalesce(p_note, '')), '') is null then null
                 else private.clean_text(p_note, 1, 'a note') end;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'a note is at most 500 characters' using errcode = 'check_violation';
  end if;
  select * into v_load from public.loads l where l.id = v_trip.load_id;
  v_label := private.release_reason_label(p_reason_code);

  perform private.cancel_trip_cascade(p_trip_id,
    'Released by the driver: ' || v_label || coalesce(' — ' || v_note, ''));

  -- Late = within late_release_hours of the start of the pickup day (Muscat).
  if now() >= (v_load.pickup_from::timestamp at time zone 'Asia/Muscat')
               - make_interval(hours => private.setting_int('late_release_hours', 12)) then
    v_weight := 2;
  end if;
  insert into private.incidents (subject_id, kind, weight, state, source, trip_id, reason,
                                 decided_at, created_by)
  values (v_uid, 'release', v_weight, 'confirmed', 'release', p_trip_id, 'Released: ' || v_label,
          now(), v_uid)
  returning id into v_incident;
  insert into public.shipment_cases (load_id, trip_id, reporter_id, subject_id, kind, details, incident_id)
  values (v_trip.load_id, p_trip_id, v_uid, v_uid, 'release',
          'Driver released the job: ' || v_label || coalesce(' — ' || v_note, ''), v_incident)
  returning id into v_case;
  update private.incidents set case_id = v_case where id = v_incident;

  -- Cities only on the lock screen (0046): no cargo, no names.
  perform private.push_send(v_load.shipper_id, 'shipper_driver_released', v_load.id,
    'Finding you another truck',
    'The driver for ' || private.push_route(v_load.id, 'en') || ' can''t make it. We are finding another truck now.',
    'نبحث لك عن شاحنة أخرى',
    'السائق المكلف بـ ' || private.push_route(v_load.id, 'ar') || ' لن يتمكن من الحضور. نبحث الآن عن شاحنة أخرى.',
    jsonb_build_object('kind', 'shipper_driver_released', 'load_id', v_load.id));
end;
$$;
revoke all on function public.release_trip(uuid, text, text) from public, anon;
grant execute on function public.release_trip(uuid, text, text) to authenticated;

-- ═══ 2. messages from staff ══════════════════════════════════════════════════
create table private.user_messages (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  case_id      uuid references public.shipment_cases(id) on delete set null,
  body         text not null check (char_length(body) between 1 and 500),
  sent_by      uuid references public.profiles(id),
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index user_messages_recipient_idx on private.user_messages (recipient_id, created_at desc);
revoke all on private.user_messages from public, anon, authenticated;
alter table private.user_messages enable row level security;
alter table private.user_messages force row level security;
comment on table private.user_messages is
  'Messages from staff (0065). No client grant: read through my_messages(), sent through ops_message_user().';

create or replace function public.ops_message_user(p_profile uuid, p_case_id uuid, p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_body text;
  v_case public.shipment_cases;
  v_id   uuid;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_message_user', 200, interval '1 hour');
  v_body := private.clean_text(p_body, 1, 'a message');
  if char_length(v_body) > 500 then
    raise exception 'a message is at most 500 characters' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile) then
    raise exception 'person not found' using errcode = 'no_data_found';
  end if;
  if p_case_id is not null then
    v_case := private.case_for_update(p_case_id);
    if p_profile not in (select x from unnest(array[v_case.reporter_id, v_case.subject_id,
          (select l.shipper_id from public.loads l where l.id = v_case.load_id),
          (select t.driver_id from public.trips t where t.id = v_case.trip_id)]) x where x is not null) then
      raise exception 'that person is not on this case' using errcode = 'check_violation';
    end if;
  end if;

  insert into private.user_messages (recipient_id, case_id, body, sent_by)
  values (p_profile, p_case_id, v_body, auth.uid()) returning id into v_id;
  if p_case_id is not null then
    perform private.case_event(p_case_id, 'message', v_body, jsonb_build_object('to', p_profile, 'message', v_id));
  end if;
  -- The lock screen says only that there is a message; the words are in the app.
  perform private.push_send(p_profile, 'staff_message', v_case.load_id,
    'Message from Truckkoo', 'Open the app to read it.',
    'رسالة من تركو', 'افتح التطبيق لقراءتها.',
    jsonb_build_object('kind', 'staff_message', 'message_id', v_id));
  perform private.log_ops('ops_message_user', 'account', p_profile::text, null,
    jsonb_build_object('message', v_id, 'case_id', p_case_id), v_body);
  return v_id;
end;
$$;
revoke all on function public.ops_message_user(uuid, uuid, text) from public, anon;
grant execute on function public.ops_message_user(uuid, uuid, text) to authenticated;

create or replace function public.my_messages(p_limit integer default 50)
returns table (id uuid, body text, case_id uuid, created_at timestamptz, read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.body, m.case_id, m.created_at, m.read_at
    from private.user_messages m
   where auth.uid() is not null and m.recipient_id = auth.uid()
   order by m.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;
revoke all on function public.my_messages(integer) from public, anon;
grant execute on function public.my_messages(integer) to authenticated;

create or replace function public.mark_message_read(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update private.user_messages set read_at = coalesce(read_at, now())
   where id = p_id and recipient_id = auth.uid();
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function public.mark_message_read(uuid) from public, anon;
grant execute on function public.mark_message_read(uuid) to authenticated;

-- ═══ 3. reports with photos, and the reporter's own cases ════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('case-evidence', 'case-evidence', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "user uploads own case evidence" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'case-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and storage.extension(name) in ('jpg', 'jpeg', 'png', 'webp')
  );

create policy "user reads own case evidence" on storage.objects
  for select to authenticated
  using (bucket_id = 'case-evidence' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Approved with the support-desk plan (2026-10-05): staff mint short-lived
-- signed URLs to look at report photos, as "ops reads pod" (0015). Read only;
-- no update or delete policy for anyone — evidence is append-only.
create policy "ops reads case evidence" on storage.objects
  for select to authenticated
  using (bucket_id = 'case-evidence' and (select private.is_ops()));

create or replace function public.report_problem(
  p_load_id uuid, p_trip_id uuid, p_kind text, p_details text, p_evidence text[] default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_load    uuid;
  v_shipper uuid;
  v_driver  uuid;
  v_side    text;
  v_details text;
  v_case    uuid;
  v_path    text;
begin
  perform private.check_rate_limit('report_problem', 10, interval '1 hour');
  if v_uid is null then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  v_details := private.clean_text(p_details, 10, 'a report');

  if p_trip_id is not null then
    select t.load_id, t.driver_id, l.shipper_id into v_load, v_driver, v_shipper
      from public.trips t join public.loads l on l.id = t.load_id
     where t.id = p_trip_id and (p_load_id is null or p_load_id = l.id);
  else
    select l.id, l.shipper_id into v_load, v_shipper from public.loads l where l.id = p_load_id;
  end if;
  v_side := case when v_uid = v_shipper then 'shipper' when v_uid = v_driver then 'driver' end;
  if v_load is null or v_side is null then
    raise exception 'shipment not found' using errcode = 'no_data_found';
  end if;

  if (v_side = 'shipper' and p_kind not in ('delay', 'breakdown', 'damage', 'delivery_dispute', 'price_demand',
                                           'misconduct', 'no_show', 'change_request', 'app_problem', 'other'))
     or (v_side = 'driver' and p_kind not in ('delay', 'breakdown', 'not_ready', 'cargo_mismatch', 'misconduct',
                                             'unreachable', 'change_request', 'app_problem', 'other'))
     or p_kind is null then
    raise exception 'that kind of report is not available here' using errcode = 'check_violation';
  end if;

  if coalesce(cardinality(p_evidence), 0) > 4 then
    raise exception 'at most four photos' using errcode = 'check_violation';
  end if;
  foreach v_path in array coalesce(p_evidence, array[]::text[]) loop
    if v_path !~ ('^' || v_uid::text || '/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$')
       or not exists (select 1 from storage.objects o where o.bucket_id = 'case-evidence' and o.name = v_path) then
      raise exception 'a photo must be one you uploaded' using errcode = 'check_violation';
    end if;
  end loop;

  insert into public.shipment_cases (load_id, trip_id, reporter_id, kind, details)
  values (v_load, p_trip_id, v_uid, p_kind, v_details)
  returning id into v_case;
  -- Straight into the thread: evidence from the reporter is not a staff response.
  insert into private.case_events (case_id, kind, meta, actor_id)
  select v_case, 'evidence', jsonb_build_object('path', e), v_uid from unnest(coalesce(p_evidence, array[]::text[])) e;
  return v_case;
end;
$$;
revoke all on function public.report_problem(uuid, uuid, text, text, text[]) from public, anon;
grant execute on function public.report_problem(uuid, uuid, text, text, text[]) to authenticated;

-- What the reporter sees of their own reports: the kind and where it stands.
-- Never the staff resolution text (staff tell people things by message).
create or replace function public.my_cases()
returns table (id uuid, kind text, status text, created_at timestamptz, load_id uuid, trip_id uuid,
               route text, resolved_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.kind, c.status, c.created_at, c.load_id, c.trip_id,
         oc.name_en || ' → ' || dc.name_en, c.resolved_at
    from public.shipment_cases c
    left join public.loads l on l.id = c.load_id
    left join public.cities oc on oc.id = l.origin_city
    left join public.cities dc on dc.id = l.dest_city
   where auth.uid() is not null and c.reporter_id = auth.uid()
   order by c.created_at desc
   limit 100;
$$;
revoke all on function public.my_cases() from public, anon;
grant execute on function public.my_cases() to authenticated;
