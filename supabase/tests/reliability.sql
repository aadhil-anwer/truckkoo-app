-- Support desk S2 — incidents, strikes and reliability (0063).
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

-- f1 owner, f2 dispatcher, a1 shipper; d1 is the struck driver and d2 a clean
-- one — d1's id sorts first, so only the strike rule can put d2 ahead.
do $$
declare r record;
begin
  for r in select * from (values
    ('69000000-0000-4000-8000-0000000000f1'::uuid, 'shipper', 'Rel Owner'),
    ('69000000-0000-4000-8000-0000000000f2'::uuid, 'shipper', 'Rel Disp'),
    ('69000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'Rel Shipper'),
    ('69000000-0000-4000-8000-0000000000d1'::uuid, 'driver',  'Struck Driver'),
    ('69000000-0000-4000-8000-0000000000d2'::uuid, 'driver',  'Clean Driver')) v(id, role, name)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@rel.test', now());
    insert into public.profiles (id, role, full_name) values (r.id, r.role::public.user_role, r.name);
  end loop;
  insert into private.ops_users (profile_id, note, level) values
    ('69000000-0000-4000-8000-0000000000f1', 'rel', 'owner'),
    ('69000000-0000-4000-8000-0000000000f2', 'rel', 'dispatcher');
  insert into public.drivers (profile_id, verified_at) values
    ('69000000-0000-4000-8000-0000000000d1', now()), ('69000000-0000-4000-8000-0000000000d2', now())
  on conflict (profile_id) do update set verified_at = excluded.verified_at;
  insert into public.trucks (owner_id, truck_type, capacity_kg) values
    ('69000000-0000-4000-8000-0000000000d1', '10t', 10000), ('69000000-0000-4000-8000-0000000000d2', '10t', 10000);
end $$;
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status, price_baisa, weight_kg) values
  ('69000000-0000-4000-8000-000000000101', '69000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'), current_date - 2, current_date - 2, 'boxes', 'delivered', 50000, 5000),
  ('69000000-0000-4000-8000-000000000102', '69000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sur'), current_date + 1, current_date + 1, 'tiles', 'finding_truck', 40000, 5000);
insert into public.trips (id, load_id, driver_id, status) values
  ('69000000-0000-4000-8000-000000000201', '69000000-0000-4000-8000-000000000101', '69000000-0000-4000-8000-0000000000d1', 'delivered');

-- After the trips: a trip's own trigger switches its driver's availability.
-- Only these two drivers are available for this suite's ordering checks.
update public.driver_availability set available = false
 where driver_id not in ('69000000-0000-4000-8000-0000000000d1', '69000000-0000-4000-8000-0000000000d2');
insert into public.driver_availability (driver_id, available, city_id)
select d, true, city('Muscat') from unnest(array['69000000-0000-4000-8000-0000000000d1'::uuid, '69000000-0000-4000-8000-0000000000d2'::uuid]) d
on conflict (driver_id) do update set available = true, city_id = excluded.city_id, lat = null, lng = null, located_at = null;

-- ═══ 1. guards ═════════════════════════════════════════════════════════════
select act_as_staff('69000000-0000-4000-8000-0000000000a1', 'aal2', 1);
select assert_not_found($$select public.ops_incident_add('69000000-0000-4000-8000-0000000000d1', 'no_show', null, null, null, 'he never came')$$, 'a shipper cannot record a strike');
select assert_not_found($$select public.ops_reliability('69000000-0000-4000-8000-0000000000d1')$$, 'nor read a reliability record');
select act_as_staff('69000000-0000-4000-8000-0000000000f2', 'aal1', null);
select assert_not_found($$select * from public.ops_incidents('69000000-0000-4000-8000-0000000000d1')$$, 'a dispatcher without 2FA cannot read incidents');
select act_as_reset();

-- ═══ 2. staff record, confirm and void ════════════════════════════════════
select act_as_staff('69000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table i1 on commit drop as select public.ops_incident_add('69000000-0000-4000-8000-0000000000d1', 'no_show', null,
  '69000000-0000-4000-8000-000000000201', null, 'Shipper waited three hours, driver never came') id;
select act_as_reset();
insert into private.incidents (id, subject_id, kind, weight, state, source, trip_id, reason) values
  ('69000000-0000-4000-8000-000000000301', '69000000-0000-4000-8000-0000000000d1', 'abandoned', 3, 'suspected', 'detector', '69000000-0000-4000-8000-000000000201', 'No sign for 6 hours'),
  ('69000000-0000-4000-8000-000000000302', '69000000-0000-4000-8000-0000000000d1', 'unreachable', 1, 'suspected', 'detector', null, 'Three calls unanswered'),
  ('69000000-0000-4000-8000-000000000303', '69000000-0000-4000-8000-0000000000d1', 'misconduct', 3, 'confirmed', 'staff', null, 'Old incident');
update private.incidents set created_at = now() - interval '40 days', decided_at = now() - interval '40 days'
 where id = '69000000-0000-4000-8000-000000000303';
select act_as_staff('69000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select public.ops_incident_confirm('69000000-0000-4000-8000-000000000301', 'Driver admitted he left the truck');
select assert_raises($$select public.ops_incident_void('69000000-0000-4000-8000-000000000302', ' ')$$, 'voiding needs a reason', '%reason%');
select public.ops_incident_void('69000000-0000-4000-8000-000000000302', 'Phone was broken, he called back');
select assert_raises($$select public.ops_incident_confirm('69000000-0000-4000-8000-000000000302', 'changed my mind')$$,
  'a voided incident cannot be confirmed again', '%voided%');
create temp table rel on commit drop as select public.ops_reliability('69000000-0000-4000-8000-0000000000d1') j;
create temp table rel2 on commit drop as select public.ops_reliability('69000000-0000-4000-8000-0000000000d2') j;
create temp table inc on commit drop as select * from public.ops_incidents('69000000-0000-4000-8000-0000000000d1');
select act_as_reset();
select assert_true((select state = 'confirmed' and weight = 2 and source = 'staff' and decided_by = '69000000-0000-4000-8000-0000000000f2'
                      from private.incidents where id = (select id from i1)),
  'a staff-recorded no-show is a confirmed strike of weight 2, by that staff member');
select assert_true((select (j->>'strikes_30d')::int = 5 from rel),
  'strikes in 30 days: the no-show (2) and the confirmed abandonment (3); not the voided or the 40-day-old one');
select assert_true((select (j->>'suggest_suspension')::boolean from rel) and not (select (j->>'suggest_suspension')::boolean from rel2),
  'five strikes reach the suspension threshold (3); a clean driver does not');
select assert_true((select count(*) = 4 from inc), 'the incident list shows all four, in every state');
select assert_true((select count(*) >= 3 from private.ops_audit where action in ('ops_incident_add', 'ops_incident_confirm', 'ops_incident_void')),
  'each decision is audited');

-- ═══ 3. dispatch offers a struck driver last ══════════════════════════════
create temp table near_on on commit drop as
  select row_number() over () pos, n.driver_id from private.nearby_drivers('69000000-0000-4000-8000-000000000102', 150, true, 10) n;
update private.app_settings set value = 'false'::jsonb where key = 'dispatch_deprioritise_strikes';
create temp table near_off on commit drop as
  select row_number() over () pos, n.driver_id from private.nearby_drivers('69000000-0000-4000-8000-000000000102', 150, true, 10) n;
update private.app_settings set value = 'true'::jsonb where key = 'dispatch_deprioritise_strikes';
select assert_true((select driver_id from near_on where pos = 1) = '69000000-0000-4000-8000-0000000000d2',
  'with the setting on, the clean driver is offered the load first');
select assert_true((select driver_id from near_off where pos = 1) = '69000000-0000-4000-8000-0000000000d1',
  'with it off, distance and id decide as before');
select assert_true((select count(*) = 2 from near_on), 'the struck driver is still offered work, just later');
select act_as_staff('69000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table nd on commit drop as select * from public.ops_nearby_drivers('69000000-0000-4000-8000-000000000102');
select act_as_reset();
select assert_true((select driver_name = 'Clean Driver' and strikes_30d = 0 from nd order by rank limit 1)
               and (select strikes_30d = 5 from nd where driver_id = '69000000-0000-4000-8000-0000000000d1'),
  'staff see the same order, with names and strikes, to pick a replacement driver');

-- ═══ 4. the driver sees their record and can appeal ═══════════════════════
select act_as_staff('69000000-0000-4000-8000-0000000000d1', 'aal1', null);
create temp table rec on commit drop as select * from public.my_record();
create temp table ap on commit drop as select public.appeal_incident((select id from i1), 'I was at the gate at 8, the guard sent me away') id;
select assert_raises(format($$select public.appeal_incident(%L, 'again please, it was not me')$$, (select id from i1)),
  'one open appeal per strike', '%appeal%');
select assert_raises($$select public.appeal_incident('69000000-0000-4000-8000-000000000302', 'this one was voided anyway')$$,
  'a voided strike has nothing to appeal', '%appeal%');
select act_as_staff('69000000-0000-4000-8000-0000000000d2', 'aal1', null);
create temp table rec2 on commit drop as select * from public.my_record();
select assert_not_found(format($$select public.appeal_incident(%L, 'not mine but let me try')$$, (select id from i1)),
  'nobody can appeal someone else''s strike');
select act_as_reset();
select assert_true((select count(*) = 3 from rec) and not exists (select 1 from rec where state = 'suspected'),
  'a driver sees their decided incidents (confirmed and voided), never suspicions');
select assert_true((select bool_and(r.trip_route is not null or r.trip_id is null) from rec r), 'each with its trip');
select assert_true(not exists (select 1 from information_schema.columns c where c.table_name = 'my_record' and c.column_name = 'reason')
               and not exists (select 1 from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name
                                where r.routine_name = 'my_record' and p.parameter_mode = 'OUT' and p.parameter_name = 'reason'),
  'the record never carries the internal reason text');
select assert_true(not exists (select 1 from rec2), 'and nobody else''s');
select assert_true((select c.kind = 'appeal' and c.incident_id = (select id from i1) and c.reporter_id = '69000000-0000-4000-8000-0000000000d1'
                      from public.shipment_cases c where c.id = (select id from ap)),
  'an appeal is a support case linked to the strike');
select assert_true((select appeal_open from rec where id = (select id from i1)) is not null, 'the record says whether an appeal is open');
select assert_true((select subject_id = '69000000-0000-4000-8000-0000000000d1' from public.shipment_cases where id = (select id from ap)),
  'an appeal is about the driver who made it, not the shipper on the trip');
select assert_true(not exists (select 1 from rec where id = '69000000-0000-4000-8000-000000000302'),
  'a suspicion voided before anyone confirmed it never shows on the driver''s record');

-- ═══ 5. the person page shows incidents ════════════════════════════════════
select act_as_staff('69000000-0000-4000-8000-0000000000f2', 'aal2', 1);
create temp table ph on commit drop as select h from jsonb_array_elements(public.ops_person('69000000-0000-4000-8000-0000000000d1')->'history') h;
select act_as_reset();
select assert_true(exists (select 1 from ph where h->>'kind' = 'incident' and h->>'title' like 'Strike: no show%'),
  'a strike appears in the person''s history');

-- ═══ 6. static ═════════════════════════════════════════════════════════════
select assert_true((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('ops_incident_add', 'ops_incident_confirm', 'ops_incident_void',
                       'ops_incidents', 'ops_reliability', 'ops_nearby_drivers', 'my_record', 'appeal_incident')),
  'every incident function is a pinned definer');
select assert_true(not has_table_privilege('authenticated', 'private.incidents', 'select'), 'incidents have no client grant');

rollback;
