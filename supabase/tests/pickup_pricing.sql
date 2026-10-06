-- Pickups: per-km between the pins, jobs inside one town, paid waiting (0069).
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
do $$
declare r record;
begin
  for r in select * from (values
    ('6e000000-0000-4000-8000-0000000000f1'::uuid, 'shipper', 'Pk Owner'),
    ('6e000000-0000-4000-8000-0000000000f2'::uuid, 'shipper', 'Pk Disp'),
    ('6e000000-0000-4000-8000-0000000000a1'::uuid, 'shipper', 'Pk Shipper'),
    ('6e000000-0000-4000-8000-0000000000a2'::uuid, 'shipper', 'Pk Other Shipper'),
    ('6e000000-0000-4000-8000-0000000000d1'::uuid, 'driver',  'Pk Driver')) v(id, role, name)
  loop
    insert into auth.users (id, email, email_confirmed_at) values (r.id, r.id || '@pk.test', now());
    insert into public.profiles (id, role, full_name) values (r.id, r.role::public.user_role, r.name);
  end loop;
  insert into private.ops_users (profile_id, note, level) values
    ('6e000000-0000-4000-8000-0000000000f1', 'pk', 'owner'), ('6e000000-0000-4000-8000-0000000000f2', 'pk', 'dispatcher');
end $$;
insert into private.app_settings (key, value) values ('commission_pct', '10') on conflict (key) do update set value = '10';
delete from private.app_settings where key in ('same_city_min_m', 'arrive_radius_m', 'wait_cap_minutes');
-- road_factor_pct stays: point_km (0041) reads it with no fallback when the row is missing.

-- Two pins in Seeb about 5½ km apart, and one in Muscat.
create temp table pin (name text primary key, lat double precision, lng double precision);
insert into pin values ('a', 23.68, 58.15), ('b', 23.66, 58.20), ('near_a', 23.6805, 58.1502), ('muscat', 23.59, 58.40);
grant select on pin to authenticated;
select assert_true(private.place_city('{"lat":23.68,"lng":58.15}') = city('Seeb')
               and private.place_city('{"lat":23.66,"lng":58.20}') = city('Seeb'),
  'fixture: both pins are in Seeb');

-- ── the rate card: the owner sets per-km and waiting on the pickup band ──────
select act_as_staff('6e000000-0000-4000-8000-0000000000f1', 'aal2', 1);
select assert_raises($$select public.ops_upsert_rate_card('Muscat governorate', 'Muscat governorate', 'pickup',
  2000, 0, 3000, 'launch pickups', 300, 20, null)$$, 'free minutes without a rate is refused', '%both%');
select public.ops_upsert_rate_card('Muscat governorate', 'Muscat governorate', 'pickup',
  2000, 0, 3000, 'launch pickups', 300, 20, 1000) is not null;
select assert_true((select wait_free_minutes = 20 and wait_per_15min_baisa = 1000 and per_km_baisa = 300
                      from public.ops_rate_cards() where truck_type_code = 'pickup'),
  'the band carries per-km and waiting, and the console reads them back');
select act_as_reset();
select assert_true((select count(*) = 1 from private.ops_audit where action = 'ops_upsert_rate_card'),
  'the change is audited');

-- ── quoting a job inside one town ────────────────────────────────────────────
select act_as_staff('6e000000-0000-4000-8000-0000000000a1', 'aal1', null);
select assert_raises($$select * from public.quote_trip(city('Seeb'), city('Seeb'), 'pickup', 300)$$,
  'inside one town without pins is refused, with what to do', '%both the pickup and the drop-off%');
select assert_raises($$select * from public.quote_trip(city('Seeb'), city('Seeb'), 'pickup', 300,
  23.68, 58.15, 23.6805, 58.1502)$$, 'pins a few metres apart are not a job', '%too close%');
select assert_raises($$select * from public.quote_trip(city('Seeb'), city('Seeb'), 'pickup', 300,
  23.68, 58.15, 23.59, 58.40)$$, 'a pin must be in the town it is booked in', '%city does not match%');
create temp table q on commit drop as
  select * from public.quote_trip(city('Seeb'), city('Seeb'), 'pickup', 300, 23.68, 58.15, 23.66, 58.20);
select act_as_reset();
select assert_true((select km between 6 and 9 and km = private.road_km_between(23.68, 58.15, 23.66, 58.20) from q),
  'distance is measured between the pins, with the road factor');
select assert_true((select price_baisa = 2000 + 300 * ceil(km)::bigint and outcome = 'quoted' from q),
  'price is base + per-km × km');
select assert_true((select wait_free_minutes = 20 and wait_per_15min_baisa = 1000 from q),
  'the quote shows the waiting terms that come with the price');

-- ── booking it ───────────────────────────────────────────────────────────────
select act_as_staff('6e000000-0000-4000-8000-0000000000a1', 'aal1', null);
select assert_raises($$select public.post_load(city('Seeb'), city('Seeb'), current_date, current_date, 'sofa', 300, 'pickup')$$,
  'posting inside one town with no places is refused', '%both the pickup and the drop-off%');
create temp table booked on commit drop as
  select * from public.book_load(
    p_origin_city => city('Seeb'), p_dest_city => city('Seeb'), p_pickup_from => current_date, p_pickup_to => current_date,
    p_goods => 'sofa and two chairs', p_weight_kg => 300, p_truck_type_code => 'pickup',
    p_seen_price_baisa => (select price_baisa from q),
    p_origin_place => '{"lat":23.68,"lng":58.15,"place_name":"Shop"}'::jsonb,
    p_dest_place => '{"lat":23.66,"lng":58.20,"place_name":"Home"}'::jsonb,
    p_request_id => gen_random_uuid());
select act_as_reset();
select assert_true((select b.price_matched and b.price_baisa = q.price_baisa from booked b, q),
  'the load is priced exactly as quoted, so booking accepts it');
select assert_true((select free_minutes = 20 and per_15min_baisa = 1000 and cap_minutes = 120
                      from private.load_wait_terms where load_id = (select load_id from booked)),
  'the waiting terms are kept with the load');
update private.rate_cards set wait_free_minutes = 5, wait_per_15min_baisa = 9000 where truck_type_code = 'pickup';
select assert_true((select free_minutes = 20 and per_15min_baisa = 1000 from private.load_wait_terms
                     where load_id = (select load_id from booked)),
  'changing the card later does not change a booked load''s terms');

-- Between towns, pins still beat town centres.
select act_as_staff('6e000000-0000-4000-8000-0000000000a1', 'aal1', null);
create temp table q2 on commit drop as
  select * from public.quote_trip(city('Seeb'), city('Muscat'), 'pickup', 300, 23.68, 58.15, 23.59, 58.40);
select act_as_reset();
select assert_true((select km = private.road_km_between(23.68, 58.15, 23.59, 58.40)
                       and km <> private.route_km(city('Seeb'), city('Muscat')) from q2),
  'between towns, a quote with pins measures the pins, not the town centres');

-- ── arriving and waiting ─────────────────────────────────────────────────────
insert into public.drivers (profile_id, verified_at) values ('6e000000-0000-4000-8000-0000000000d1', now())
on conflict (profile_id) do update set verified_at = excluded.verified_at;
insert into public.trips (id, load_id, driver_id, status)
select '6e000000-0000-4000-8000-000000000201', load_id, '6e000000-0000-4000-8000-0000000000d1', 'assigned' from booked;

select act_as_staff('6e000000-0000-4000-8000-0000000000d1', 'aal1', null);
select assert_raises($$select public.mark_arrived('6e000000-0000-4000-8000-000000000201', 'pickup', 23.66, 58.20, 10)$$,
  'arriving far from the pin is refused, saying how far', '%m from the pin%');
select assert_raises($$select public.mark_arrived('6e000000-0000-4000-8000-000000000201', 'drop', 23.66, 58.20, 10)$$,
  'the drop-off cannot be reached before pickup', '%not at this stage%');
select public.mark_arrived('6e000000-0000-4000-8000-000000000201', 'pickup', 23.6803, 58.1503, 15) is not null;
select act_as_reset();
select assert_true((select count(*) = 1 from public.trip_events where trip_id = '6e000000-0000-4000-8000-000000000201' and type = 'arrived_pickup'),
  'arriving at the pin records it');
select assert_true((select count(*) = 1 from private.push_log where kind = 'shipper_driver_arrived'
                     and profile_id = '6e000000-0000-4000-8000-0000000000a1')
               or not coalesce((select (value #>> '{}')::boolean from private.app_settings where key = 'push_enabled'), true),
  'the shipper is told the truck is there');

-- The driver has waited 50 minutes: 20 free, then 30 = two blocks of 15.
update public.trip_events set occurred_at = now() - interval '50 minutes'
 where trip_id = '6e000000-0000-4000-8000-000000000201' and type = 'arrived_pickup';
select act_as_staff('6e000000-0000-4000-8000-0000000000d1', 'aal1', null);
select assert_true((select public.mark_arrived('6e000000-0000-4000-8000-000000000201', 'pickup', 23.6803, 58.1503, 15)
                     < now() - interval '49 minutes'),
  'arriving twice keeps the first time');
select assert_true((select (public.trip_waiting('6e000000-0000-4000-8000-000000000201') #>> '{stops,0,charge_baisa}')::bigint = 2000
                       and (public.trip_waiting('6e000000-0000-4000-8000-000000000201') #>> '{stops,0,running}')::boolean),
  'fifty minutes with twenty free is two blocks: 2.000, still running');
select assert_true((select (w->>'total_baisa')::bigint = (w->>'price_baisa')::bigint + 2000
                       and (w->>'payout_baisa')::bigint = floor((w->>'price_baisa')::bigint * 0.9)::bigint + 2000
                      from (select public.trip_waiting('6e000000-0000-4000-8000-000000000201') w) x),
  'the driver collects price + waiting, and keeps all of the waiting');
select public.advance_trip('6e000000-0000-4000-8000-000000000201', 'in_transit');
select act_as_reset();
update public.trip_events set occurred_at = now() - interval '50 minutes'
 where trip_id = '6e000000-0000-4000-8000-000000000201' and type = 'arrived_pickup';
select assert_true((select not (w #>> '{stops,0,running}')::boolean and (w #>> '{stops,0,charge_baisa}')::bigint = 2000
                      from (select private.trip_wait_json('6e000000-0000-4000-8000-000000000201', true) w) x),
  'picking up stops the clock');

select act_as_staff('6e000000-0000-4000-8000-0000000000a1', 'aal1', null);
select assert_true((select w->'payout_baisa' = 'null'::jsonb and (w->>'waiting_baisa')::bigint = 2000
                      from (select public.trip_waiting('6e000000-0000-4000-8000-000000000201') w) x),
  'the shipper sees the waiting charge and never the driver''s payout');
select act_as_reset();
select act_as_staff('6e000000-0000-4000-8000-0000000000a2', 'aal1', null);
select assert_not_found($$select public.trip_waiting('6e000000-0000-4000-8000-000000000201')$$,
  'another shipper is told the trip does not exist');
select act_as_reset();

-- At the drop-off the shipper's customer keeps the truck 200 minutes: counted to the 120-minute cap.
select act_as_staff('6e000000-0000-4000-8000-0000000000d1', 'aal1', null);
select public.mark_arrived('6e000000-0000-4000-8000-000000000201', 'drop', 23.6601, 58.2001, 15) is not null;
select act_as_reset();
update public.trip_events set occurred_at = now() - interval '200 minutes'
 where trip_id = '6e000000-0000-4000-8000-000000000201' and type = 'arrived_drop';
select assert_true((select w.capped and w.charge_baisa = 7000 from private.trip_wait('6e000000-0000-4000-8000-000000000201') w where w.stop = 'drop'),
  'waiting counts up to the cap: (120 - 20) minutes is seven blocks');
select assert_true(private.system_detect_long_waits() = 1, 'a stop at the cap opens a case');
select assert_true(private.system_detect_long_waits() = 0, 'once');
select assert_true((select priority = 'high' from public.shipment_cases where kind = 'long_wait'),
  'and it is high priority');

-- Staff waive the drop-off wait, with a reason.
select act_as_staff('6e000000-0000-4000-8000-0000000000f2', 'aal2', 1);
select assert_raises($$select public.ops_waive_waiting('6e000000-0000-4000-8000-000000000201', 'drop', '')$$,
  'waiving needs a reason');
select public.ops_waive_waiting('6e000000-0000-4000-8000-000000000201', 'drop', 'Receiver was told the wrong time by us');
select assert_true((select (w->>'waiting_baisa')::bigint = 2000 and jsonb_array_length(w->'waivers') = 1
                      from (select public.ops_trip_waiting('6e000000-0000-4000-8000-000000000201') w) x),
  'the waived stop charges nothing, and the console shows who waived it and why');
select act_as_reset();
select assert_true((select count(*) = 1 from private.ops_audit where action = 'ops_waive_waiting'), 'waiving is audited');

-- Delivered: the driver's earnings include the waiting.
update public.trips set status = 'delivered' where id = '6e000000-0000-4000-8000-000000000201';
insert into public.trip_events (trip_id, type, photo_path) values ('6e000000-0000-4000-8000-000000000201', 'delivered', 'x/pod.jpg');
select act_as_staff('6e000000-0000-4000-8000-0000000000d1', 'aal1', null);
select assert_true((select t.payout_baisa = floor(l.price_baisa * 0.9)::bigint + 2000
                      from public.driver_trips() t, booked b, public.loads l where l.id = b.load_id),
  'the driver''s history pays price after commission plus the waiting');
select act_as_reset();

-- ── nobody reads the terms or waivers directly ──────────────────────────────
select assert_true(not has_table_privilege('authenticated', 'private.load_wait_terms', 'select')
               and not has_table_privilege('authenticated', 'private.trip_wait_waivers', 'select')
               and not has_table_privilege('anon', 'private.load_wait_terms', 'select'),
  'no client reads the waiting tables');
select assert_true((select provolatile = 'v' from pg_proc where proname = 'quote_trip')
               and (select provolatile = 'v' from pg_proc where proname = 'mark_arrived'),
  'the writers are volatile');

rollback;
