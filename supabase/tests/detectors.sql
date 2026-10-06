-- Support desk S2 — detectors, board review, playbooks (0064).
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

-- f2 dispatcher, a1 shipper, d1–d4 drivers, s9 a suspended driver.
do $$
declare r record;
begin
  for r in select * from (values
    ('6a000000-0000-4000-8000-0000000000f2'::uuid, 'shipper', 'Det Disp', null),
    ('6a000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'Det Shipper', null),
    ('6a000000-0000-4000-8000-0000000000d1'::uuid, 'driver', 'No Show Driver', null),
    ('6a000000-0000-4000-8000-0000000000d2'::uuid, 'driver', 'Fresh Driver', null),
    ('6a000000-0000-4000-8000-0000000000d3'::uuid, 'driver', 'Dark Driver', null),
    ('6a000000-0000-4000-8000-0000000000d4'::uuid, 'driver', 'Spare Driver', null),
    ('6a000000-0000-4000-8000-0000000000e1'::uuid, 'driver', 'Banned Driver', '+968 9000 1111'),
    ('6a000000-0000-4000-8000-0000000000e2'::uuid, 'driver', 'New Name', '90001111')) v(id, role, name, phone)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@det.test', now());
    insert into public.profiles (id, role, full_name, phone) values (r.id, r.role::public.user_role, r.name, r.phone);
  end loop;
  insert into private.ops_users (profile_id, note, level) values ('6a000000-0000-4000-8000-0000000000f2', 'det', 'dispatcher');
  insert into public.drivers (profile_id, verified_at) values ('6a000000-0000-4000-8000-0000000000d4', now())
  on conflict (profile_id) do update set verified_at = excluded.verified_at;
  insert into public.trucks (id, owner_id, truck_type, capacity_kg, plate) values
    ('6a000000-0000-4000-8000-0000000000c4', '6a000000-0000-4000-8000-0000000000d4', '10t', 10000, 'SPARE 4');
end $$;
update public.profiles set suspended_at = now() - interval '5 days', suspended_reason = 'abandoned two loads'
 where id = '6a000000-0000-4000-8000-0000000000e1';
update public.profiles set created_at = now() - interval '1 hour' where id = '6a000000-0000-4000-8000-0000000000e2';
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status, price_baisa, weight_kg) values
  ('6a000000-0000-4000-8000-000000000101', '6a000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'), current_date - 1, current_date, 'boxes', 'assigned', 50000, 5000),
  ('6a000000-0000-4000-8000-000000000102', '6a000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sur'), current_date + 1, current_date + 1, 'tiles', 'assigned', 40000, 5000),
  ('6a000000-0000-4000-8000-000000000103', '6a000000-0000-4000-8000-0000000000a1', city('Nizwa'), city('Muscat'), current_date - 1, current_date, 'dates', 'in_transit', 30000, 5000),
  ('6a000000-0000-4000-8000-000000000104', '6a000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'), current_date - 1, current_date, 'cement', 'assigned', 30000, 5000);
insert into public.trips (id, load_id, driver_id, status, created_at) values
  ('6a000000-0000-4000-8000-000000000201', '6a000000-0000-4000-8000-000000000101', '6a000000-0000-4000-8000-0000000000d1', 'assigned', now() - interval '2 days'),
  ('6a000000-0000-4000-8000-000000000202', '6a000000-0000-4000-8000-000000000102', '6a000000-0000-4000-8000-0000000000d2', 'assigned', now() - interval '2 days'),
  ('6a000000-0000-4000-8000-000000000203', '6a000000-0000-4000-8000-000000000103', '6a000000-0000-4000-8000-0000000000d3', 'in_transit', now() - interval '1 day'),
  ('6a000000-0000-4000-8000-000000000204', '6a000000-0000-4000-8000-000000000104', '6a000000-0000-4000-8000-0000000000d2', 'assigned', now() - interval '30 minutes');
-- The actor trigger stamps events with now() (no backdating by clients); a
-- fixture needs the past, so it steps around it.
alter table public.trip_events disable trigger trip_events_set_actor;
insert into public.trip_events (trip_id, type, occurred_at) values
  ('6a000000-0000-4000-8000-000000000203', 'en_route', now() - interval '8 hours');
alter table public.trip_events enable trigger trip_events_set_actor;

-- ═══ 1. detectors ══════════════════════════════════════════════════════════
select private.system_detect_no_shows();
select private.system_detect_no_shows();
select private.system_detect_abandoned();
select private.system_detect_abandoned();
select private.system_detect_returning();
select private.system_detect_returning();

select assert_true((select count(*) = 1 from private.incidents i where i.trip_id = '6a000000-0000-4000-8000-000000000201'
                      and i.kind = 'no_show' and i.state = 'suspected' and i.source = 'detector' and i.case_id is not null),
  'an accepted trip not started by the pickup day''s check hour is a suspected no-show, once');
select assert_true((select count(*) = 1 from public.shipment_cases c where c.trip_id = '6a000000-0000-4000-8000-000000000201'
                      and c.kind = 'no_show' and c.priority = 'urgent' and c.incident_id is not null
                      and c.subject_id = '6a000000-0000-4000-8000-0000000000d1'),
  'with one urgent case about the driver, linked to it');
select assert_true(not exists (select 1 from private.incidents where trip_id = '6a000000-0000-4000-8000-000000000202'),
  'a trip whose pickup is tomorrow is not a no-show');
select assert_true(not exists (select 1 from private.incidents where trip_id = '6a000000-0000-4000-8000-000000000204'),
  'nor one accepted half an hour ago');
select assert_true((select count(*) = 1 from private.incidents i where i.trip_id = '6a000000-0000-4000-8000-000000000203'
                      and i.kind = 'abandoned' and i.state = 'suspected')
               and (select count(*) = 1 from public.shipment_cases c where c.trip_id = '6a000000-0000-4000-8000-000000000203' and c.kind = 'abandoned'),
  'a truck silent for 8 hours on the road is a suspected abandonment, once, with an urgent case');
select assert_true((select count(*) = 1 from public.shipment_cases c where c.kind = 'account_flag'
                      and c.subject_id = '6a000000-0000-4000-8000-0000000000e2'),
  'a new account with a suspended driver''s phone number is flagged once for a person to look at');
select assert_true((select count(*) >= 3 from private.ops_audit where action like 'system_detect%'), 'the detectors are audited');

-- A fresh GPS fix means the truck is moving: not abandoned.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status, price_baisa) values
  ('6a000000-0000-4000-8000-000000000105', '6a000000-0000-4000-8000-0000000000a1', city('Sur'), city('Muscat'), current_date - 1, current_date, 'fish', 'in_transit', 30000);
insert into public.trips (id, load_id, driver_id, status, created_at) values
  ('6a000000-0000-4000-8000-000000000205', '6a000000-0000-4000-8000-000000000105', '6a000000-0000-4000-8000-0000000000d4', 'in_transit', now() - interval '1 day');
alter table public.trip_events disable trigger trip_events_set_actor;
insert into public.trip_events (trip_id, type, occurred_at) values ('6a000000-0000-4000-8000-000000000205', 'en_route', now() - interval '9 hours');
alter table public.trip_events enable trigger trip_events_set_actor;
insert into public.trip_positions (trip_id, driver_id, lat, lng, seen_at) values
  ('6a000000-0000-4000-8000-000000000205', '6a000000-0000-4000-8000-0000000000d4', 23.6, 58.4, now() - interval '30 minutes');
select private.system_detect_abandoned();
select assert_true(not exists (select 1 from private.incidents where trip_id = '6a000000-0000-4000-8000-000000000205'),
  'a truck still reporting its position is not abandoned');
delete from public.trips where id = '6a000000-0000-4000-8000-000000000205';

select assert_true((select count(*) = 2 from cron.job where jobname in ('detect-trouble', 'detect-returning')),
  'both detector jobs are scheduled');

-- ═══ 2. the board shows strikes waiting for a person ═════════════════════
insert into private.incidents (id, subject_id, kind, weight, state, source, reason) values
  ('6a000000-0000-4000-8000-000000000301', '6a000000-0000-4000-8000-0000000000d2', 'unreachable', 1, 'suspected', 'staff', 'No answer three times');
select act_as_staff('6a000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table b on commit drop as select * from public.ops_board();
select act_as_reset();
select assert_true(exists (select 1 from b where kind = 'incident_to_review' and target_id = '6a000000-0000-4000-8000-000000000301'
                           and title like 'Fresh Driver%'),
  'a suspected strike with no case reaches the live board for a person to confirm or void');

-- ═══ 3. playbook actions do the real work and record it on the case ═══════
create temp table nscase on commit drop as
  select id from public.shipment_cases where trip_id = '6a000000-0000-4000-8000-000000000201' and kind = 'no_show';
create temp table abcase on commit drop as
  select id from public.shipment_cases where trip_id = '6a000000-0000-4000-8000-000000000203' and kind = 'abandoned';
grant select on nscase, abcase to authenticated;
select act_as_staff('6a000000-0000-4000-8000-0000000000a1', 'aal2', 1);
select assert_not_found(format($$select public.ops_case_redispatch(%L, 'send it back')$$, (select id from nscase)),
  'a shipper cannot run a playbook');
select act_as_staff('6a000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table nsview on commit drop as select public.ops_case((select id from nscase)) j;
select public.ops_case_redispatch((select id from nscase), 'Driver did not come, sending it back to dispatch');
select public.ops_case_reassign((select id from abcase), '6a000000-0000-4000-8000-0000000000d4',
  '6a000000-0000-4000-8000-0000000000c4', 'Driver unreachable, spare driver takes it from Nizwa');
select act_as_reset();
select assert_true((select status = 'cancelled' from public.trips where id = '6a000000-0000-4000-8000-000000000201')
               and (select status = 'finding_truck' from public.loads where id = '6a000000-0000-4000-8000-000000000101'),
  'send back to dispatch cancels the trip and the load looks for a truck again');
select assert_true((select driver_id = '6a000000-0000-4000-8000-0000000000d4' from public.trips where id = '6a000000-0000-4000-8000-000000000203'),
  'give to another driver moves the trip');
select assert_true((select count(*) = 1 from private.case_events where case_id = (select id from nscase) and kind = 'action' and meta->>'action' = 'redispatched')
               and (select count(*) = 1 from private.case_events where case_id = (select id from abcase) and kind = 'action' and meta->>'action' = 'reassigned'),
  'each playbook step is written in the case thread');

select assert_true((select j->'incident'->>'state' = 'suspected' and j->'incident'->>'kind' = 'no_show'
                       and (j->'incident'->>'weight')::int = 2 from nsview),
  'the case page knows the strike it carries and whether anyone has decided it');

-- ═══ 4. static ═════════════════════════════════════════════════════════════
select assert_true((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'] and p.provolatile = 'v')
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where (n.nspname = 'public' and p.proname in ('ops_case_redispatch', 'ops_case_reassign', 'ops_case_cancel_load'))
                        or (n.nspname = 'private' and p.proname in ('system_detect_no_shows', 'system_detect_abandoned', 'system_detect_returning'))),
  'playbooks and detectors are pinned, volatile definers');
select assert_true(not has_function_privilege('authenticated', 'private.system_detect_no_shows()', 'execute'),
  'no client can run a detector');

rollback;
