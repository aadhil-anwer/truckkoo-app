-- Ops console v2, phase 2 — the live board (0061).
begin;
-- 0060's staff-domain rule is proven in ops_v2.sql; these fixtures use test domains.
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
-- p_role: 'authenticated' for public RPCs; 'postgres' to call private helpers
-- (ungranted to clients on purpose) with the same identity claims.
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


-- ─── fixtures ───────────────────────────────────────────────────────────────
create or replace function city(p_name text) returns bigint language sql stable as $$
  select id from public.cities where name_en = p_name $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('61000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'Board Shipper'),
    ('61000000-0000-4000-8000-0000000000d1'::uuid, 'driver',  'Driver One'),
    ('61000000-0000-4000-8000-0000000000d2'::uuid, 'driver',  'Driver Two'),
    ('61000000-0000-4000-8000-0000000000e1'::uuid, 'shipper', 'Board Ops')) v(id, role, name)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@board.test', now());
    insert into public.profiles (id, role, full_name) values (r.id, r.role::public.user_role, r.name);
  end loop;
  insert into public.trucks (owner_id, truck_type, capacity_kg) values
    ('61000000-0000-4000-8000-0000000000d1', '10t', 10000),
    ('61000000-0000-4000-8000-0000000000d2', '10t', 10000);
  insert into private.ops_users (profile_id, note, level) values ('61000000-0000-4000-8000-0000000000e1', 'board suite', 'dispatcher');
end $$;

-- L1 finding a truck, collected tomorrow.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status)
values ('61000000-0000-4000-8000-000000000101', '61000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sohar'),
        current_date + 1, current_date + 1, 'board L1', 'finding_truck');
-- L2 a bid load closing in 10 minutes with no bids.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status, pricing_mode, bid_deadline)
values ('61000000-0000-4000-8000-000000000102', '61000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Nizwa'),
        current_date + 2, current_date + 2, 'board L2', 'matched', 'bid', now() + interval '10 minutes');
insert into private.bid_loads (load_id, fee_bps) values ('61000000-0000-4000-8000-000000000102', 0);
-- T3 delivered with no photo.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status)
values ('61000000-0000-4000-8000-000000000103', '61000000-0000-4000-8000-0000000000a1', city('Sohar'), city('Muscat'),
        current_date - 1, current_date - 1, 'board L3', 'delivered');
insert into public.trips (id, load_id, driver_id, status)
values ('61000000-0000-4000-8000-000000000203', '61000000-0000-4000-8000-000000000103', '61000000-0000-4000-8000-0000000000d1', 'delivered');
-- T4 in transit, last event 4 h ago, no positions: quiet.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status)
values ('61000000-0000-4000-8000-000000000104', '61000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Sur'),
        current_date, current_date, 'board L4', 'in_transit');
insert into public.trips (id, load_id, driver_id, status, created_at)
values ('61000000-0000-4000-8000-000000000204', '61000000-0000-4000-8000-000000000104', '61000000-0000-4000-8000-0000000000d1', 'in_transit', now() - interval '6 hours');
insert into public.trip_events (trip_id, type) values ('61000000-0000-4000-8000-000000000204', 'picked_up');
-- set_event_actor stamps occurred_at = now() on insert; backdate it for the fixture.
update public.trip_events set occurred_at = now() - interval '4 hours' where trip_id = '61000000-0000-4000-8000-000000000204';
-- T5 in transit, last event 5 h ago, but a position 10 minutes ago: alive.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description, status)
values ('61000000-0000-4000-8000-000000000105', '61000000-0000-4000-8000-0000000000a1', city('Muscat'), city('Ibri'),
        current_date, current_date, 'board L5', 'in_transit');
insert into public.trips (id, load_id, driver_id, status, created_at)
values ('61000000-0000-4000-8000-000000000205', '61000000-0000-4000-8000-000000000105', '61000000-0000-4000-8000-0000000000d2', 'in_transit', now() - interval '6 hours');
insert into public.trip_events (trip_id, type) values ('61000000-0000-4000-8000-000000000205', 'picked_up');
-- set_event_actor stamps occurred_at = now() on insert; backdate it for the fixture.
update public.trip_events set occurred_at = now() - interval '5 hours' where trip_id = '61000000-0000-4000-8000-000000000205';
insert into public.trip_positions (trip_id, driver_id, lat, lng, accuracy_m, seen_at)
values ('61000000-0000-4000-8000-000000000205', '61000000-0000-4000-8000-0000000000d2', 23.2, 57.5, 15, now() - interval '10 minutes');
-- A1 an alert from the last day.
delete from private.ops_alerts;
select private.system_raise_alert('test_kind', 'Test alert', '{}'::jsonb);

-- ═══ 1. the queue ═══════════════════════════════════════════════════════════
select act_as_staff('61000000-0000-4000-8000-0000000000e1', 'aal1', null);
select assert_not_found($$select * from public.ops_board()$$, 'a dispatcher without 2FA cannot read the board');
select act_as_staff('61000000-0000-4000-8000-0000000000a1', 'aal2', 1);
select assert_not_found($$select * from public.ops_board()$$, 'a shipper cannot read the board');

select act_as_staff('61000000-0000-4000-8000-0000000000e1', 'aal2', 1);
create temp table b on commit drop as select * from public.ops_board();
select act_as_reset();
select assert_true(exists (select 1 from b where kind = 'finding_truck' and target_id = '61000000-0000-4000-8000-000000000101' and urgency = 4),
  'a load finding a truck for tomorrow is on the board, urgent');
select assert_true(exists (select 1 from b where kind = 'bid_no_bids' and target_id = '61000000-0000-4000-8000-000000000102' and urgency = 4),
  'a bid load closing in 10 minutes with no bids is on the board, urgent');
select assert_true(exists (select 1 from b where kind = 'no_pod' and target_id = '61000000-0000-4000-8000-000000000203'),
  'a delivery without a photo is on the board');
select assert_true(exists (select 1 from b where kind = 'trip_quiet' and target_id = '61000000-0000-4000-8000-000000000204'),
  'a trip with no sign of life for 4 hours is on the board');
select assert_true(not exists (select 1 from b where kind = 'trip_quiet' and target_id = '61000000-0000-4000-8000-000000000205'),
  'a trip with a fresh position is not quiet, even with no event for 5 hours');
select assert_true(exists (select 1 from b where kind = 'alert'), 'an unacknowledged alert is on the board');
select assert_true((select bool_and(title is not null and reason is not null and action is not null) from b),
  'every row says what, why and what to do');
select assert_true((select title from b where target_id = '61000000-0000-4000-8000-000000000101') = 'Muscat → Sohar',
  'a load row is titled by its route');

-- acknowledging
select id as a1 from private.ops_alerts where kind = 'test_kind' \gset
select act_as_staff('61000000-0000-4000-8000-0000000000e1', 'aal2', 1);
select public.ops_ack_alert(:a1);
select public.ops_ack_alert(:a1);
select assert_true(not exists (select 1 from public.ops_board() where kind = 'alert'),
  'an acknowledged alert leaves the board');
select assert_not_found($$select public.ops_ack_alert(-1)$$, 'acknowledging an alert that does not exist is not found');
select act_as_reset();
select assert_true((select count(*) = 1 from private.ops_audit where action = 'ops_ack_alert'),
  'acknowledging twice is one audit row, not two');
select assert_true((select acknowledged_by = '61000000-0000-4000-8000-0000000000e1' from private.ops_alerts where kind = 'test_kind'),
  'and it records who acknowledged it');


-- ═══ 2. the live map ═══════════════════════════════════════════════════════
insert into public.driver_availability (driver_id, available, city_id, source, lat, lng, accuracy_m, located_at, updated_at)
values ('61000000-0000-4000-8000-0000000000d1', true, city('Muscat'), 'gps', 23.588, 58.408, 20, now() - interval '5 minutes', now())
on conflict (driver_id) do update set available = true, lat = 23.588, lng = 58.408, accuracy_m = 20,
  located_at = now() - interval '5 minutes';
insert into public.driver_availability (driver_id, available, city_id, source, lat, lng, accuracy_m, located_at, updated_at)
values ('61000000-0000-4000-8000-0000000000d2', true, city('Sohar'), 'gps', 24.34, 56.73, 20, now() - interval '2 hours', now())
on conflict (driver_id) do update set available = true, lat = 24.34, lng = 56.73, accuracy_m = 20,
  located_at = now() - interval '2 hours';

select act_as_staff('61000000-0000-4000-8000-0000000000e1', 'aal1', null);
select assert_not_found($$select public.ops_live_map()$$, 'a dispatcher without 2FA cannot see the map');
select act_as_staff('61000000-0000-4000-8000-0000000000e1', 'aal2', 1);
select public.ops_live_map() as m \gset
select act_as_reset();
select assert_true(jsonb_typeof(:'m'::jsonb -> 'drivers') = 'array' and jsonb_typeof(:'m'::jsonb -> 'trips') = 'array'
  and jsonb_typeof(:'m'::jsonb -> 'loads') = 'array', 'drivers, trips and loads are always arrays');
select assert_true(exists (select 1 from jsonb_array_elements(:'m'::jsonb -> 'drivers') d
  where d ->> 'id' = '61000000-0000-4000-8000-0000000000d1' and (d ->> 'lat')::numeric = 23.588),
  'an online driver with a fresh, accurate point is on the map');
select assert_true(not exists (select 1 from jsonb_array_elements(:'m'::jsonb -> 'drivers') d
  where d ->> 'id' = '61000000-0000-4000-8000-0000000000d2'),
  'stale: a driver whose point is 2 hours old is not on the map');
select assert_true(exists (select 1 from jsonb_array_elements(:'m'::jsonb -> 'trips') t
  where t ->> 'id' = '61000000-0000-4000-8000-000000000204' and t -> 'lat' = 'null'::jsonb and t -> 'origin' ->> 'name' = 'Muscat'),
  'a trip with no reported fix has its route but no position — nothing computes one');
select assert_true(exists (select 1 from jsonb_array_elements(:'m'::jsonb -> 'trips') t
  where t ->> 'id' = '61000000-0000-4000-8000-000000000205' and (t ->> 'lat')::numeric = 23.2),
  'a trip with a fix is drawn at its latest fix');
select assert_true(exists (select 1 from jsonb_array_elements(:'m'::jsonb -> 'loads') l
  where l ->> 'id' = '61000000-0000-4000-8000-000000000101'),
  'a waiting load is on the map');

update public.driver_availability set located_at = now(), accuracy_m = 5000
 where driver_id = '61000000-0000-4000-8000-0000000000d2';
select act_as_staff('61000000-0000-4000-8000-0000000000e1', 'aal2', 1);
select assert_true(not exists (select 1 from jsonb_array_elements(public.ops_live_map() -> 'drivers') d
  where d ->> 'id' = '61000000-0000-4000-8000-0000000000d2'),
  'a point 5 km uncertain is not drawn as a position');
select act_as_reset();

-- ═══ static ════════════════════════════════════════════════════════════════
select assert_true(
  (select bool_and(coalesce(p.proconfig, '{}') @> array['search_path=""'])
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('ops_board', 'ops_ack_alert', 'ops_live_map')),
  'every 0061 function pins search_path');
select assert_true(
  (select provolatile = 'v' from pg_proc where proname = 'ops_ack_alert')
  and (select provolatile = 's' from pg_proc where proname = 'ops_board'),
  'the writer is volatile and the reader stable');
select assert_true(
  not has_function_privilege('anon', 'public.ops_board()', 'execute')
  and not has_function_privilege('anon', 'public.ops_ack_alert(bigint)', 'execute'),
  'nothing in 0061 is callable anonymously');

do $$ begin raise notice 'ALL OPS BOARD ASSERTIONS HELD'; end $$;
rollback;
