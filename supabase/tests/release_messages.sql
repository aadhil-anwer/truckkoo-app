-- Support desk S3 — driver release, staff messages, reports with photos (0065).
begin;
delete from private.app_settings where key = 'staff_email_domains';
create or replace function assert_true(p_actual boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from true then
    raise exception 'FAIL: % — expected true, got %', p_what, p_actual;
  end if;
  raise notice 'pass: %', p_what;
end $$;

create or replace function assert_raises(p_sql text, p_what text, p_like text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_like is not null and sqlerrm not like p_like then
      raise exception 'FAIL: % — raised "%" but expected like "%"', p_what, sqlerrm, p_like;
    end if;
    raise notice 'pass: % (rejected: %)', p_what, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement succeeded but should have been denied', p_what;
end $$;

create or replace function assert_not_found(p_sql text, p_what text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when no_data_found then
    raise notice 'pass: % (not found)', p_what;
    return;
  when others then
    raise exception 'FAIL: % — raised % (%) instead of no_data_found', p_what, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % — succeeded but should have been not found', p_what;
end $$;

-- Impersonate with explicit 2FA state. p_totp_age_min null = no totp in amr.
create or replace function act_as_staff(p_uid uuid, p_aal text, p_totp_age_min integer,
                                        p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated', 'aal', p_aal,
    'amr', case when p_totp_age_min is null
                then json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint))
                else json_build_array(
                  json_build_object('method', 'password', 'timestamp', extract(epoch from now() - interval '1 hour')::bigint),
                  json_build_object('method', 'totp', 'timestamp', extract(epoch from now() - make_interval(mins => p_totp_age_min))::bigint))
           end)::text, true);
end $$;

create or replace function act_as_reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;


create or replace function city(p_name text) returns bigint language sql stable as $$
  select id from public.cities where name_en = p_name $$;

-- f2 dispatcher, a1 shipper, b1 another shipper, d1–d3 drivers.
do $$
declare r record;
begin
  for r in select * from (values
    ('6b000000-0000-4000-8000-0000000000f2'::uuid, 'shipper', 'Msg Disp'),
    ('6b000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'Msg Shipper'),
    ('6b000000-0000-4000-8000-0000000000b1'::uuid, 'shipper', 'Other Shipper'),
    ('6b000000-0000-4000-8000-0000000000d1'::uuid, 'driver',  'Early Driver'),
    ('6b000000-0000-4000-8000-0000000000d2'::uuid, 'driver',  'Late Driver'),
    ('6b000000-0000-4000-8000-0000000000d3'::uuid, 'driver',  'Road Driver')) v(id, role, name)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@msg.test', now());
    insert into public.profiles (id, role, full_name, language) values (r.id, r.role::public.user_role, r.name, 'ar');
  end loop;
  insert into private.ops_users (profile_id, note, level) values ('6b000000-0000-4000-8000-0000000000f2', 'msg', 'dispatcher');
end $$;
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status, price_baisa) values
  ('6b000000-0000-4000-8000-000000000101', '6b000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'), current_date + 5, current_date + 6, 'boxes', 'assigned', 50000),
  ('6b000000-0000-4000-8000-000000000102', '6b000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sur'), current_date, current_date + 1, 'tiles', 'assigned', 40000),
  ('6b000000-0000-4000-8000-000000000103', '6b000000-0000-4000-8000-0000000000a1', city('Nizwa'), city('Muscat'), current_date, current_date, 'dates', 'in_transit', 30000),
  ('6b000000-0000-4000-8000-000000000104', '6b000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'), current_date + 5, current_date + 6, 'chairs', 'assigned', 50000);
insert into public.legs (id, driver_id, origin_city, dest_city, depart_from, depart_to, status) values
  ('6b000000-0000-4000-8000-000000000601', '6b000000-0000-4000-8000-0000000000d1', city('Muscat'), city('Sohar'), current_date + 5, current_date + 6, 'matched');
insert into public.trips (id, load_id, driver_id, leg_id, status) values
  ('6b000000-0000-4000-8000-000000000201', '6b000000-0000-4000-8000-000000000101', '6b000000-0000-4000-8000-0000000000d1', '6b000000-0000-4000-8000-000000000601', 'assigned'),
  ('6b000000-0000-4000-8000-000000000202', '6b000000-0000-4000-8000-000000000102', '6b000000-0000-4000-8000-0000000000d2', null, 'assigned'),
  ('6b000000-0000-4000-8000-000000000203', '6b000000-0000-4000-8000-000000000103', '6b000000-0000-4000-8000-0000000000d3', null, 'in_transit'),
  ('6b000000-0000-4000-8000-000000000204', '6b000000-0000-4000-8000-000000000104', '6b000000-0000-4000-8000-0000000000d3', null, 'assigned');
insert into public.offers (load_id, driver_id, status, source, expires_at) values
  ('6b000000-0000-4000-8000-000000000101', '6b000000-0000-4000-8000-0000000000d1', 'accepted', 'auto', now()),
  ('6b000000-0000-4000-8000-000000000104', '6b000000-0000-4000-8000-0000000000d3', 'accepted', 'auto', now());

-- ═══ 1. a driver releases a job ═══════════════════════════════════════════
select act_as_staff('6b000000-0000-4000-8000-0000000000d1', 'aal1', null);
select public.release_trip('6b000000-0000-4000-8000-000000000201', 'breakdown', 'Gearbox failed this morning');
select assert_raises($$select public.release_trip('6b000000-0000-4000-8000-000000000202', 'sick', null)$$,
  'a driver cannot release someone else''s job', '%not found%');
select act_as_staff('6b000000-0000-4000-8000-0000000000d2', 'aal1', null);
select assert_raises($$select public.release_trip('6b000000-0000-4000-8000-000000000202', 'bored', null)$$,
  'an unknown reason is refused', '%reason%');
select public.release_trip('6b000000-0000-4000-8000-000000000202', 'family', null);
select act_as_staff('6b000000-0000-4000-8000-0000000000d3', 'aal1', null);
select assert_raises($$select public.release_trip('6b000000-0000-4000-8000-000000000203', 'breakdown', null)$$,
  'with the cargo on the truck, a release is refused — report a problem instead', '%Report a problem%');
select act_as_reset();

select assert_true((select status = 'cancelled' from public.trips where id = '6b000000-0000-4000-8000-000000000201')
               and (select status = 'finding_truck' from public.loads where id = '6b000000-0000-4000-8000-000000000101')
               and (select status = 'open' from public.legs where id = '6b000000-0000-4000-8000-000000000601')
               and not exists (select 1 from public.offers where load_id = '6b000000-0000-4000-8000-000000000101' and status in ('pending', 'accepted')),
  'a release cancels the trip, sends the load back to finding a truck, expires its offers and reopens the leg');
select assert_true((select i.kind = 'release' and i.state = 'confirmed' and i.weight = 1 and i.source = 'release'
                      from private.incidents i where i.trip_id = '6b000000-0000-4000-8000-000000000201'),
  'an early release is a light confirmed strike — the driver said so themselves');
select assert_true((select weight = 2 from private.incidents where trip_id = '6b000000-0000-4000-8000-000000000202'),
  'a release on the pickup day weighs more');
select assert_true((select c.kind = 'release' and c.incident_id is not null and c.reporter_id = '6b000000-0000-4000-8000-0000000000d1'
                       and c.details like '%Gearbox failed%'
                      from public.shipment_cases c where c.trip_id = '6b000000-0000-4000-8000-000000000201'),
  'staff see the release as a case with the driver''s reason');
select assert_true((select count(*) = 1 from private.push_log where profile_id = '6b000000-0000-4000-8000-0000000000a1'
                     and kind = 'shipper_driver_released' and load_id = '6b000000-0000-4000-8000-000000000101'),
  'the shipper is told by push that a new truck is being found');
select assert_true((select count(*) = 1 from public.trip_events where trip_id = '6b000000-0000-4000-8000-000000000201' and type = 'note'),
  'the trip records why it ended');

-- The same end state as a staff cancel of an equivalent trip.
select act_as_staff('6b000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select public.ops_set_trip_status('6b000000-0000-4000-8000-000000000204', 'cancelled', 'equivalence check');
select act_as_reset();
select assert_true((select l1.status = l2.status from public.loads l1, public.loads l2
                     where l1.id = '6b000000-0000-4000-8000-000000000101' and l2.id = '6b000000-0000-4000-8000-000000000104')
               and (select array_agg(distinct status) from public.offers where load_id = '6b000000-0000-4000-8000-000000000101')
                 = (select array_agg(distinct status) from public.offers where load_id = '6b000000-0000-4000-8000-000000000104'),
  'a release lands the load exactly where a staff cancel does');

-- ═══ 2. staff messages ════════════════════════════════════════════════════
create temp table rc on commit drop as select id from public.shipment_cases where trip_id = '6b000000-0000-4000-8000-000000000201';
grant select on rc to authenticated;
select act_as_staff('6b000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select public.ops_message_user('6b000000-0000-4000-8000-0000000000a1', (select id from rc),
  'Your driver could not come. We are finding you another truck now.');
select assert_raises(format($$select public.ops_message_user('6b000000-0000-4000-8000-0000000000b1', %L, 'hello there')$$, (select id from rc)),
  'a message on a case goes only to someone on that case', '%case%');
select assert_raises($$select public.ops_message_user('6b000000-0000-4000-8000-0000000000a1', null, ' ')$$, 'an empty message is refused', '%message%');
select act_as_staff('6b000000-0000-4000-8000-0000000000a1', 'aal2', 1);
select assert_not_found($$select public.ops_message_user('6b000000-0000-4000-8000-0000000000b1', null, 'hi from a shipper')$$,
  'a shipper cannot message anyone through staff tools');
create temp table mine on commit drop as select * from public.my_messages();
select public.mark_message_read((select id from mine limit 1));
create temp table mine2 on commit drop as select * from public.my_messages();
select act_as_staff('6b000000-0000-4000-8000-0000000000b1', 'aal2', 1);
create temp table theirs on commit drop as select * from public.my_messages();
select assert_raises(format($$select public.mark_message_read(%L)$$, (select id from mine limit 1)),
  'nobody can mark another person''s message read', '%not found%');
select act_as_reset();
select assert_true((select count(*) = 1 and bool_and(body like 'Your driver could not come%') from mine), 'the shipper reads the message in the app');
select assert_true((select read_at is not null from mine2), 'and can mark it read');
select assert_true(not exists (select 1 from theirs), 'nobody else sees it');
select assert_true((select count(*) = 1 from private.push_log where profile_id = '6b000000-0000-4000-8000-0000000000a1' and kind = 'staff_message'),
  'a push tells them there is a message — the text stays in the app');
select assert_true((select count(*) = 1 from private.case_events where case_id = (select id from rc) and kind = 'message'),
  'the message is in the case thread');

-- ═══ 3. reports with photos, and my cases ═════════════════════════════════
insert into storage.objects (bucket_id, name) values
  ('case-evidence', '6b000000-0000-4000-8000-0000000000a1/6b000000-1111-4111-8111-000000000001.jpg'),
  ('case-evidence', '6b000000-0000-4000-8000-0000000000b1/6b000000-1111-4111-8111-000000000002.jpg');
select act_as_staff('6b000000-0000-4000-8000-0000000000a1', 'aal1', null);
create temp table rp on commit drop as select public.report_problem(null, '6b000000-0000-4000-8000-000000000203', 'damage',
  'Two crates arrived crushed at the corner',
  array['6b000000-0000-4000-8000-0000000000a1/6b000000-1111-4111-8111-000000000001.jpg']) id;
select assert_raises($$select public.report_problem(null, '6b000000-0000-4000-8000-000000000203', 'damage', 'Someone else''s photo here',
  array['6b000000-0000-4000-8000-0000000000b1/6b000000-1111-4111-8111-000000000002.jpg'])$$,
  'a report can only carry the reporter''s own uploads', '%photo%');
select assert_raises($$select public.report_problem(null, '6b000000-0000-4000-8000-000000000203', 'not_ready', 'The shipper is me, odd report')$$,
  'a shipper cannot file a driver-side kind', '%kind%');
create temp table mc on commit drop as select * from public.my_cases();
select act_as_staff('6b000000-0000-4000-8000-0000000000d3', 'aal1', null);
select public.report_problem(null, '6b000000-0000-4000-8000-000000000203', 'not_ready', 'Waited three hours at the gate, cargo not packed', null);
create temp table mc_d on commit drop as select * from public.my_cases();
select act_as_reset();
select assert_true((select c.subject_id = '6b000000-0000-4000-8000-0000000000d3' from public.shipment_cases c where c.id = (select id from rp))
               and (select count(*) = 1 from private.case_events where case_id = (select id from rp) and kind = 'evidence'),
  'a shipper''s damage report is about the driver and carries its photo');
select assert_true((select count(*) = 1 and bool_and(kind = 'damage') from mc), 'the shipper sees their own report');
select assert_true((select count(*) = 1 and bool_and(kind = 'not_ready') from mc_d)
               and not exists (select 1 from mc_d where kind in ('damage', 'release')),
  'the driver sees only what they reported — never the shipper''s report about them');
select assert_true(not exists (select 1 from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name
                                where r.routine_name = 'my_cases' and p.parameter_mode = 'OUT' and p.parameter_name in ('resolution', 'details')),
  'my_cases never carries staff resolution text');

-- ═══ 4. storage and static ════════════════════════════════════════════════
select assert_true((select not public from storage.buckets where id = 'case-evidence'), 'the evidence bucket is private');
select act_as_staff('6b000000-0000-4000-8000-0000000000b1', 'aal1', null);
select assert_raises($$insert into storage.objects (bucket_id, name) values ('case-evidence', '6b000000-0000-4000-8000-0000000000a1/x.jpg')$$,
  'nobody uploads into someone else''s folder');
select act_as_reset();
select assert_true((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('release_trip', 'ops_message_user', 'my_messages',
                       'mark_message_read', 'my_cases', 'report_problem')),
  'every new function is a pinned definer');
select assert_true(not has_table_privilege('authenticated', 'private.user_messages', 'select'), 'messages have no client grant');

rollback;
