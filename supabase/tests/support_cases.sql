-- Support desk S1 — cases v2 (0062).
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

-- f1 owner, f2 dispatcher, f3 dispatcher, a1 shipper, d1 driver, x1 other shipper.
do $$
declare r record;
begin
  for r in select * from (values
    ('68000000-0000-4000-8000-0000000000f1'::uuid, 'shipper', 'Desk Owner', null),
    ('68000000-0000-4000-8000-0000000000f2'::uuid, 'shipper', 'Desk Disp', null),
    ('68000000-0000-4000-8000-0000000000f3'::uuid, 'shipper', 'Desk Disp Two', null),
    ('68000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'Desk Shipper', '+96890000001'),
    ('68000000-0000-4000-8000-0000000000d1'::uuid, 'driver',  'Desk Driver', '+96890000002'),
    ('68000000-0000-4000-8000-0000000000b1'::uuid, 'shipper', 'Other Shipper', null)) v(id, role, name, phone)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@desk.test', now());
    insert into public.profiles (id, role, full_name, phone, language) values (r.id, r.role::public.user_role, r.name, r.phone, 'ar');
  end loop;
  insert into private.ops_users (profile_id, note, level) values
    ('68000000-0000-4000-8000-0000000000f1', 'desk', 'owner'),
    ('68000000-0000-4000-8000-0000000000f2', 'desk', 'dispatcher'),
    ('68000000-0000-4000-8000-0000000000f3', 'desk', 'dispatcher');
end $$;
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status, price_baisa) values
  ('68000000-0000-4000-8000-000000000101', '68000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'), current_date, current_date, 'boxes', 'assigned', 50000),
  ('68000000-0000-4000-8000-000000000102', '68000000-0000-4000-8000-0000000000a1', city('Nizwa'), city('Sur'), current_date + 1, current_date + 1, 'tiles', 'posted', 40000);
insert into public.trips (id, load_id, driver_id, status) values
  ('68000000-0000-4000-8000-000000000201', '68000000-0000-4000-8000-000000000101', '68000000-0000-4000-8000-0000000000d1', 'assigned');

-- ═══ 1. the app's existing paths still open cases, now with triage ═══════
select act_as_staff('68000000-0000-4000-8000-0000000000a1', 'aal1', null);
create temp table c_ship on commit drop as
  select public.report_shipment_problem(null, '68000000-0000-4000-8000-000000000201', 'breakdown',
    'The truck has not arrived and the driver says it broke down') id;
select act_as_staff('68000000-0000-4000-8000-0000000000d1', 'aal1', null);
create temp table c_drv on commit drop as
  select public.report_shipment_problem(null, '68000000-0000-4000-8000-000000000201', 'delay',
    'Cargo was not ready at the warehouse, waited two hours') id;
select act_as_reset();
grant select on c_ship, c_drv to authenticated;
select assert_true((select c.status = 'new' and c.priority = 'urgent' and c.due_at = c.created_at + interval '15 minutes'
                       and c.subject_id = '68000000-0000-4000-8000-0000000000d1' and not c.opened_by_staff
                      from public.shipment_cases c where c.id = (select id from c_ship)),
  'a shipper''s breakdown report is new, urgent, due in 15 minutes, and about the driver');
select assert_true((select c.priority = 'high' and c.subject_id = '68000000-0000-4000-8000-0000000000a1'
                      from public.shipment_cases c where c.id = (select id from c_drv)),
  'a driver''s report is about the shipper');
select assert_true((select count(*) = 1 from private.case_events e where e.case_id = (select id from c_ship) and e.kind = 'opened'),
  'opening a case writes its first event');

-- ═══ 2. guards ═════════════════════════════════════════════════════════════
select act_as_reset();
select set_config('role', 'anon', true);
select assert_raises($$select * from public.ops_support_queue()$$, 'anon cannot call the queue', '%permission denied%');
select act_as_reset();
select act_as_staff('68000000-0000-4000-8000-0000000000a1', 'aal2', 1);
select assert_not_found($$select * from public.ops_support_queue()$$, 'a shipper cannot read the queue');
select assert_not_found(format($$select public.ops_case(%L)$$, (select id from c_ship)), 'nor a case');
select act_as_staff('68000000-0000-4000-8000-0000000000d1', 'aal2', 1);
select assert_not_found(format($$select public.ops_case_note(%L, 'trying this')$$, (select id from c_ship)), 'a driver cannot write case notes');
select act_as_staff('68000000-0000-4000-8000-0000000000f2', 'aal1', null);
select assert_not_found($$select * from public.ops_support_queue()$$, 'a dispatcher without 2FA cannot read the queue');
select act_as_reset();

-- ═══ 3. staff open, assign, note, contact, status, resolve, reopen ═══════
select act_as_staff('68000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table c_staff on commit drop as
  select public.ops_open_case('no_show', 'Shipper called: driver never came to the gate',
    null, '68000000-0000-4000-8000-000000000201', '68000000-0000-4000-8000-0000000000d1', null) id;
select assert_raises($$select public.ops_open_case('teleport', 'Nothing like this exists here', null, null, null, null)$$,
  'an unknown kind is refused', '%kind%');
select assert_not_found($$select public.ops_open_case('other', 'A trip that does not exist at all', null, '68000000-0000-4000-8000-00000000ffff', null, null)$$,
  'a case on a trip that does not exist is not found');
select public.ops_case_assign((select id from c_staff), '68000000-0000-4000-8000-0000000000f2');
select assert_raises(format($$select public.ops_case_assign(%L, '68000000-0000-4000-8000-0000000000a1')$$, (select id from c_staff)),
  'a case can only be assigned to staff', '%staff%');
select public.ops_case_note((select id from c_staff), 'Called the driver twice, no answer');
select assert_raises(format($$select public.ops_case_note(%L, '  ')$$, (select id from c_staff)), 'an empty note is refused', '%note%');
select public.ops_case_log_contact((select id from c_staff), 'whatsapp', '68000000-0000-4000-8000-0000000000d1', 'no_answer', null);
select assert_raises(format($$select public.ops_case_log_contact(%L, 'pigeon', '68000000-0000-4000-8000-0000000000d1', 'reached', null)$$, (select id from c_staff)),
  'an unknown contact channel is refused', '%channel%');
select public.ops_case_status((select id from c_staff), 'waiting_driver', 'Waiting for the driver to call back');
select assert_raises(format($$select public.ops_case_status(%L, 'resolved', 'skip the outcome')$$, (select id from c_staff)),
  'resolving needs an outcome, not a status change', '%resolve%');
select assert_raises(format($$select public.ops_case_resolve(%L, 'magic', 'Sorted it out somehow')$$, (select id from c_staff)),
  'an unknown outcome is refused', '%outcome%');
select public.ops_case_resolve((select id from c_staff), 'redispatched', 'Driver unreachable; load sent back to dispatch');
create temp table q_open on commit drop as select * from public.ops_support_queue();
create temp table q_all on commit drop as select * from public.ops_support_queue(p_include_resolved => true);
select public.ops_case_reopen((select id from c_staff), 'Shipper says the new truck also did not come');
create temp table cs on commit drop as select public.ops_case((select id from c_staff)) j;
select act_as_reset();

select assert_true((select c.reporter_id = '68000000-0000-4000-8000-0000000000f2' and c.opened_by_staff
                       and c.load_id = '68000000-0000-4000-8000-000000000101' and c.priority = 'urgent'
                      from public.shipment_cases c where c.id = (select id from c_staff)),
  'a staff-opened case takes its load from the trip and the staff member as reporter');
select assert_true(not exists (select 1 from q_open where id = (select id from c_staff))
               and exists (select 1 from q_all where id = (select id from c_staff)),
  'a resolved case leaves the default queue');
select assert_true((select j->'case'->>'status' = 'in_progress' and j->'case'->>'reopened_at' is not null
                       and j->'case'->>'assignee_name' = 'Desk Disp' from cs),
  'a reopened case is in progress again, still assigned');
select assert_true((select array_agg(e->>'kind' order by ord) = array['reopened', 'resolved', 'status', 'contact', 'note', 'assign', 'opened']
                      from cs, jsonb_array_elements(cs.j->'events') with ordinality x(e, ord)),
  'the thread holds every step, newest first');
select assert_true((select j->'case'->>'route_ar' = (select o.name_ar || ' ← ' || d.name_ar from public.cities o, public.cities d
                                                       where o.name_en = 'Muscat' and d.name_en = 'Sohar') from cs),
  'the case carries its route in Arabic too, for messages in Arabic');
select assert_true((select bool_or(p->>'phone' = '+96890000002' and p->>'language' = 'ar' and p->>'side' = 'subject')
                      from cs, jsonb_array_elements(cs.j->'parties') p),
  'the case names its parties with phone and language, for contacting them');
select assert_true((select count(*) >= 7 from private.ops_audit a where a.target_kind = 'shipment_case'
                     and a.target_id = (select id from c_staff)::text),
  'every staff step on the case is audited');

-- ═══ 4. queue order and filters ═══════════════════════════════════════════
update public.shipment_cases set created_at = now() - interval '2 hours', due_at = now() - interval '105 minutes'
 where id = (select id from c_ship);
select act_as_staff('68000000-0000-4000-8000-0000000000f3', 'aal2', 1);
create temp table q on commit drop as select * from public.ops_support_queue();
create temp table q_mine on commit drop as select * from public.ops_support_queue(p_assignee => 'me');
create temp table q_none on commit drop as select * from public.ops_support_queue(p_assignee => 'none');
create temp table q_kind on commit drop as select * from public.ops_support_queue(p_kind => 'delay');
create temp table board on commit drop as select * from public.ops_board();
select act_as_reset();
select assert_true((select id from q order by queue_position limit 1) = (select id from c_ship),
  'an overdue case is at the top of the queue');
select assert_true((select overdue from q where id = (select id from c_ship)), 'and is marked overdue');
select assert_true(not exists (select 1 from q_mine), 'mine: nothing assigned to this dispatcher');
select assert_true(exists (select 1 from q_none where id = (select id from c_ship))
               and not exists (select 1 from q_none where id = (select id from c_staff)),
  'unassigned excludes the assigned case');
select assert_true((select count(*) = 1 and bool_and(kind = 'delay') from q_kind), 'filter by kind');
select assert_true(exists (select 1 from board where kind = 'case_overdue' and target_id = (select id from c_ship)::text),
  'an overdue case reaches the live board');

-- ═══ 5. the old resolve still works ═══════════════════════════════════════
select act_as_staff('68000000-0000-4000-8000-0000000000f3', 'aal2', 1);
select public.ops_resolve_shipment_case((select id from c_drv), 'Spoke to the shipper, cargo ready now');
select act_as_reset();
select assert_true((select status = 'resolved' and outcome = 'other' from public.shipment_cases where id = (select id from c_drv)),
  'the original resolve still closes a new-style case');

-- ═══ 6. static ═════════════════════════════════════════════════════════════
select assert_true((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('ops_support_queue', 'ops_case', 'ops_open_case',
                       'ops_case_assign', 'ops_case_note', 'ops_case_log_contact', 'ops_case_status',
                       'ops_case_resolve', 'ops_case_reopen')),
  'every desk function is a pinned definer');
select assert_true((select bool_and(p.provolatile = 'v') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('ops_open_case', 'ops_case_assign', 'ops_case_note',
                       'ops_case_log_contact', 'ops_case_status', 'ops_case_resolve', 'ops_case_reopen')),
  'writers are volatile');
select assert_true(not has_table_privilege('authenticated', 'private.case_events', 'select'),
  'the case thread has no client grant');

rollback;
