-- Truckkoo — automatic dispatch suite (0036).
--
-- Run against a LOCAL database only, like every suite here: it creates users,
-- loads and a rate card, inside one transaction that rolls back.
--
--   npm run test:db:dispatch
--
-- WHAT IS BEING PROVED
--
-- The founder's brief is "no dispatcher approving loads". So the claims are:
--   * "let us choose" + a weight is priced instantly, and booking at the price
--     the shipper saw dispatches with no human step;
--   * a wave asks only drivers who are online, verified, carry the weight, are
--     not suspended, not already on a job — nearest first;
--   * nobody answering widens the search on a timer, a decline moves on at once,
--     and only when every wave is spent does a person get it — once;
--   * the first accept wins and everyone else's offer dies;
--   * a driver's position is a town, never a coordinate, and only they see it.
--
-- TIME. `now()` is fixed inside a transaction, so "five minutes later" is
-- simulated by moving `accepted_at` and `expires_at` backwards.

begin;

set local client_min_messages to notice;

-- ─── helpers (same shape as pricing.sql) ────────────────────────────────────

create or replace function assert_equals(p_actual bigint, p_expected bigint, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % — expected %, got %', p_what, p_expected, p_actual;
  end if;
  raise notice 'pass: %', p_what;
end $$;

create or replace function assert_text(p_actual text, p_expected text, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % — expected %, got %', p_what, coalesce(p_expected, 'NULL'), coalesce(p_actual, 'NULL');
  end if;
  raise notice 'pass: %', p_what;
end $$;

create or replace function assert_true(p_actual boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is not true then
    raise exception 'FAIL: % — expected true, got %', p_what, coalesce(p_actual::text, 'NULL');
  end if;
  raise notice 'pass: %', p_what;
end $$;

create or replace function assert_raises(p_sql text, p_what text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'pass: % (rejected: %)', p_what, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — statement succeeded but should have been denied', p_what;
end $$;

create or replace function act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function act_as_reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function city(p_name text) returns bigint language sql stable as $$
  select id from public.cities where name_en = p_name
$$;

-- Offers on a load, by driver name — the readable form of "who was asked".
create or replace function asked(p_load uuid, p_status text default null) returns text
language sql stable as $$
  select coalesce(string_agg(p.full_name, ',' order by p.full_name), '')
  from public.offers o join public.profiles p on p.id = o.driver_id
  where o.load_id = p_load and (p_status is null or o.status::text = p_status)
$$;

-- The price the server will quote, read as the superuser so no rate limit is
-- spent — the "price the shipper saw" in every booking below.
create or replace function server_price(p_weight integer, p_truck text default null) returns bigint
language sql stable as $$
  select price_baisa from private.price_for(city('Muscat'), city('Dubai'), p_truck, p_weight)
$$;

-- ─── fixtures ───────────────────────────────────────────────────────────────
--
-- One shipper, one dispatcher, and drivers placed to test one rule each.
-- Road km to Muscat: Seeb 30, Nizwa 138, Sohar 231, Salalah 1029.
-- Radii: wave 1 ≤150, wave 2 ≤400, wave 3 ≤1500 (+ drivers with no town).

do $$
declare
  v_shipper uuid := 'a0000000-0000-4000-8000-000000000001';
  v_ops     uuid := 'a0000000-0000-4000-8000-000000000002';
  r record;
begin
  insert into auth.users (id, email) values
    (v_shipper, 'dispatch-shipper@test.local'),
    (v_ops,     'dispatch-ops@test.local');
  insert into public.profiles (id, role, full_name) values
    (v_shipper, 'shipper', 'Test Shipper'),
    (v_ops,     'shipper', 'Test Dispatcher');
  insert into private.ops_users (profile_id, note) values (v_ops, 'dispatch suite');

  for r in select * from (values
    -- id suffix, name,         town,      verified, available, truck,   suspended
    ('0001', 'A Muscat',       'Muscat',   true,  true,  '10t',    false),
    ('0002', 'B Seeb',         'Seeb',     true,  true,  '10t',    false),
    ('0003', 'C Nizwa',        'Nizwa',    true,  true,  '10t',    false),
    ('0004', 'D Sohar',        'Sohar',    true,  true,  '10t',    false),
    ('0005', 'E Salalah',      'Salalah',  true,  true,  '20t',    false),
    ('0006', 'F Nowhere',      null,       true,  true,  '10t',    false),
    ('0007', 'X Unverified',   'Muscat',   false, true,  '10t',    false),
    ('0008', 'X Offline',      'Muscat',   true,  false, '10t',    false),
    ('0009', 'X Pickup',       'Muscat',   true,  true,  'pickup', false),
    ('0010', 'X Suspended',    'Muscat',   true,  true,  '10t',    true),
    ('0011', 'X Busy',         'Muscat',   true,  true,  '10t',    false)
  ) as t(sfx, name, town, verified, available, truck, suspended)
  loop
    insert into auth.users (id, email)
    values (('d0000000-0000-4000-8000-00000000' || r.sfx)::uuid, 'dispatch-d' || r.sfx || '@test.local');
    insert into public.profiles (id, role, full_name, suspended_at)
    values (('d0000000-0000-4000-8000-00000000' || r.sfx)::uuid, 'driver', r.name,
            case when r.suspended then now() end);
    insert into public.drivers (profile_id, verified_at)
    values (('d0000000-0000-4000-8000-00000000' || r.sfx)::uuid, case when r.verified then now() end)
    on conflict (profile_id) do update set verified_at = excluded.verified_at;
    insert into public.trucks (owner_id, truck_type, plate, capacity_kg)
    values (('d0000000-0000-4000-8000-00000000' || r.sfx)::uuid, r.truck, 'T-' || r.sfx,
            (select capacity_kg from public.truck_types where code = r.truck));
    insert into public.driver_availability (driver_id, available, city_id, source)
    values (('d0000000-0000-4000-8000-00000000' || r.sfx)::uuid, r.available,
            case when r.town is not null then city(r.town) end, 'manual');
  end loop;

  -- X Busy is on a job. Their switch still says available — the stale-switch
  -- case: a job must win over the switch.
  insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                            goods_description, status)
  values ('b0000000-0000-4000-8000-000000000099', v_shipper, city('Muscat'), city('Sohar'),
          current_date, current_date, 'Busy driver cargo', 'assigned');
  insert into public.trips (load_id, driver_id, status)
  values ('b0000000-0000-4000-8000-000000000099', 'd0000000-0000-4000-8000-000000000011', 'assigned');
  update public.driver_availability set available = true
  where driver_id = 'd0000000-0000-4000-8000-000000000011';

  -- One corridor priced for the trucks in play; hand-loaded, as rates always are.
  insert into private.rate_cards
    (origin_corridor, dest_corridor, truck_type_code, base_baisa, per_tonne_baisa, min_fare_baisa)
  select private.corridor_of(city('Muscat')), private.corridor_of(city('Dubai')), tt, 50000, 10000, 80000
  from unnest(array['pickup', '10t', '20t']) tt
  on conflict do nothing;
end $$;

-- The price the shipper "saw", read once as the superuser: inside an act_as()
-- block the caller is a shipper, who rightly cannot call the private pricer.
select server_price(8000) as p8000, server_price(8000) + 1 as p8000_stale \gset

-- 0036 leaves `require_verified_driver` OFF (switched on near launch). This
-- suite proves the behaviour the product promises, so it turns it on for itself;
-- section 9 checks what happens with it off.
select assert_true(not private.setting_bool('require_verified_driver', true),
  'the migration leaves require_verified_driver off until launch');
update private.app_settings set value = 'true'::jsonb where key = 'require_verified_driver';

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Book = accept
-- ════════════════════════════════════════════════════════════════════════════

-- A stale price: the shipper saw one number, the server has another. The load
-- is posted and priced but NOT accepted — they confirm the real price on the
-- load screen. No offer goes out on a price nobody agreed to.
select act_as('a0000000-0000-4000-8000-000000000001');
create temp table booked_stale on commit drop as
select * from public.book_load(city('Muscat'), city('Dubai'), current_date + 1, current_date + 1,
                               'Stale price cargo', 8000, null, :p8000_stale);
select act_as_reset();

select assert_true((select not price_matched from booked_stale),
  'a price the shipper did not see is not booked');
select assert_text((select status::text from booked_stale), 'quoted',
  'the load waits at quoted for the shipper to accept the real price');
select assert_equals((select price_baisa from booked_stale), :p8000,
  'the stored price is the server''s, never the number the client sent');
select assert_text(asked((select load_id from booked_stale)), '',
  'and no driver is asked about a price nobody agreed to');

-- The happy path: let-us-choose, 8 t, the price the shipper saw.
select act_as('a0000000-0000-4000-8000-000000000001');
create temp table booked on commit drop as
select * from public.book_load(city('Muscat'), city('Dubai'), current_date + 1, current_date + 1,
                               'Building materials', 8000, null, :p8000);
select act_as_reset();

select assert_true((select price_matched from booked), 'the price the shipper saw is booked');
select assert_text((select status::text from booked), 'matched',
  'booking dispatches in the same tap — no human, no second screen');
select assert_text(
  (select coalesce(truck_type_code, 'NULL') || '/' || priced_truck_type
     from public.loads where id = (select load_id from booked)),
  'NULL/10t', 'the load still says "let us choose"; the price is recorded as for a 10 t');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Wave 1 — who is asked
-- ════════════════════════════════════════════════════════════════════════════

select assert_text(asked((select load_id from booked)), 'A Muscat,B Seeb,C Nizwa',
  'wave 1 asks the three nearest online, verified, fitting drivers');
select assert_true(
  (select bool_and(o.expires_at <= now() + interval '5 minutes' and o.source = 'auto')
     from public.offers o where o.load_id = (select load_id from booked)),
  'wave offers live five minutes, not the old 48 hours');
select assert_equals(
  (select count(*) from public.offers o join public.profiles p on p.id = o.driver_id
    where o.load_id = (select load_id from booked) and p.full_name like 'X %'), 0,
  'never: unverified, offline, too small a truck, suspended, or already on a job');
select assert_text(
  (select mode || '/' || wave from private.dispatch_log
    where load_id = (select load_id from booked) and offers_sent > 0),
  'nearby/1', 'the dispatch log records the wave and why');

-- A driver cannot see another driver's offer on the same load.
select act_as('d0000000-0000-4000-8000-000000000001');
select assert_equals(
  (select count(*) from public.driver_offers()), 1,
  'a driver sees their own offer, and only theirs');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Declines — Uber moves on at once
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare r record;
begin
  for r in
    select o.id, o.driver_id from public.offers o
    where o.load_id = (select load_id from booked) order by o.driver_id
  loop
    perform act_as(r.driver_id);
    perform public.respond_to_offer(r.id, false);
  end loop;
  perform act_as_reset();
end $$;

select assert_text(
  (select status::text from public.loads where id = (select load_id from booked)), 'accepted',
  'all of wave 1 said no, nobody else is in range yet: the load rests at accepted — still the machine''s, not a person''s');
select assert_true(private.machine_owns((select load_id from booked)),
  'the machine still owns the search after a full decline');
select assert_equals(
  (select count(*) from private.dispatch_log
    where load_id = (select load_id from booked) and skipped = 'no_candidates'), 0,
  'an empty retry after a real wave adds no noise to the log');

-- A declined driver is never re-asked by the machine.
update public.loads set accepted_at = now() - interval '6 minutes' where id = (select load_id from booked);
select private.system_dispatch_waves();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. The radius widens with time — Porter
-- ════════════════════════════════════════════════════════════════════════════

select assert_text(asked((select load_id from booked), 'pending'), 'D Sohar',
  'five minutes on, wave 2 reaches 400 km: Sohar, and nobody who already said no');

-- Nobody answers Sohar either.
update public.offers set expires_at = now() - interval '1 second'
 where load_id = (select load_id from booked) and status = 'pending';
update public.loads set accepted_at = now() - interval '11 minutes' where id = (select load_id from booked);
select private.system_dispatch_waves();

select assert_text(asked((select load_id from booked), 'pending'), 'E Salalah,F Nowhere',
  'wave 3 reaches 1,500 km and drivers whose town is unknown');
select assert_text(
  (select status::text from public.offers o join public.profiles p on p.id = o.driver_id
    where o.load_id = (select load_id from booked) and p.full_name = 'D Sohar'), 'expired',
  'the unanswered wave-2 offer is expired, not left pending');

-- Running the job again while a wave is out changes nothing.
select assert_equals(private.system_dispatch_waves(), 0,
  'the job leaves a load alone while its current wave is still out');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. First accept wins
-- ════════════════════════════════════════════════════════════════════════════

select act_as('d0000000-0000-4000-8000-000000000005');
create temp table won on commit drop as
select public.respond_to_offer(
  (select o.id from public.offers o where o.load_id = (select load_id from booked)
     and o.driver_id = 'd0000000-0000-4000-8000-000000000005'), true) as trip_id;
select act_as_reset();

select assert_true((select trip_id is not null from won), 'Salalah accepts and a trip exists');
select assert_text(
  (select status::text from public.loads where id = (select load_id from booked)), 'assigned',
  'the load is assigned');
select assert_text(
  (select status::text from public.offers where load_id = (select load_id from booked)
     and driver_id = 'd0000000-0000-4000-8000-000000000006'), 'expired',
  'the other driver in the wave loses their offer');

select act_as('d0000000-0000-4000-8000-000000000006');
select assert_raises(
  $$select public.respond_to_offer(
      (select o.id from public.offers o where o.load_id = (select load_id from booked)
         and o.driver_id = 'd0000000-0000-4000-8000-000000000006'), true)$$,
  'a second accept loses');
select act_as_reset();

select assert_true(
  (select not available from public.driver_availability
    where driver_id = 'd0000000-0000-4000-8000-000000000005'),
  'taking a job takes the driver offline');
select assert_true(not private.machine_owns((select load_id from booked)),
  'an assigned load is no longer the machine''s to dispatch');

-- Delivery puts the driver back online where the load ended — the return load.
select act_as('d0000000-0000-4000-8000-000000000005');
select public.advance_trip((select trip_id from won), 'in_transit');
select public.advance_trip((select trip_id from won), 'delivered', null, 'dispatch-suite/pod.jpg');
select act_as_reset();

select assert_text(
  (select available::text || '/' || (select name_en from public.cities where id = city_id) || '/' || source
     from public.driver_availability where driver_id = 'd0000000-0000-4000-8000-000000000005'),
  'true/Dubai/delivery', 'delivering puts the driver back online, in Dubai');

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Nobody at all — a person gets it, once
-- ════════════════════════════════════════════════════════════════════════════

update public.driver_availability set available = false;

select act_as('a0000000-0000-4000-8000-000000000001');
create temp table lonely on commit drop as
select * from public.book_load(city('Muscat'), city('Dubai'), current_date + 2, current_date + 2,
                               'Nobody around', 8000, null, :p8000);
select act_as_reset();

select assert_text((select status::text from lonely), 'accepted',
  'booked with nobody online: accepted and searching, not a dead end');
select assert_equals(
  (select count(*) from private.ops_alerts where kind = 'dispatch_exhausted'), 0,
  'and not handed to a person in the first second — drivers may come online');

-- Several empty minutes pass.
update public.loads set accepted_at = now() - interval '1 minute' where id = (select load_id from lonely);
select private.system_dispatch_waves();
update public.loads set accepted_at = now() - interval '2 minutes' where id = (select load_id from lonely);
select private.system_dispatch_waves();
select assert_equals(
  (select count(*) from private.dispatch_log
    where load_id = (select load_id from lonely) and skipped = 'no_candidates'), 1,
  'a search finding nobody is logged once, not once a minute');

-- A driver switches on at minute 3 and is found.
update public.driver_availability set available = true
 where driver_id = 'd0000000-0000-4000-8000-000000000001';
update public.loads set accepted_at = now() - interval '3 minutes' where id = (select load_id from lonely);
select private.system_dispatch_waves();
select assert_text(asked((select load_id from lonely), 'pending'), 'A Muscat',
  'a driver who comes online mid-search is asked');

-- They let it lapse, and the search runs out of time.
update public.offers set expires_at = now() - interval '1 second'
 where load_id = (select load_id from lonely) and status = 'pending';
update public.driver_availability set available = false
 where driver_id = 'd0000000-0000-4000-8000-000000000001';
update public.loads set accepted_at = now() - interval '16 minutes' where id = (select load_id from lonely);
select private.system_dispatch_waves();

select assert_text(
  (select status::text from public.loads where id = (select load_id from lonely)), 'finding_truck',
  'every wave spent: finding_truck — "we are finding you a truck", and a person owns it');
select assert_equals(
  (select count(*) from private.ops_alerts
    where kind = 'dispatch_exhausted' and detail->>'load_id' = (select load_id::text from lonely)), 1,
  'the dispatcher is alerted');
select private.system_dispatch_waves();
select private.system_dispatch_waves();
select assert_equals(
  (select count(*) from private.ops_alerts
    where kind = 'dispatch_exhausted' and detail->>'load_id' = (select load_id::text from lonely)), 1,
  'once — not every minute');

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Guards — the kill switch, and a person's decision
-- ════════════════════════════════════════════════════════════════════════════

update public.driver_availability set available = true
 where driver_id in ('d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002');

select act_as('a0000000-0000-4000-8000-000000000001');
create temp table switched on commit drop as
select * from public.book_load(city('Muscat'), city('Dubai'), current_date + 3, current_date + 3,
                               'Kill switch cargo', 8000, null, :p8000);
select act_as_reset();

update private.app_settings set value = 'false'::jsonb where key = 'auto_dispatch_enabled';
update public.offers set expires_at = now() - interval '1 second'
 where load_id = (select load_id from switched) and status = 'pending';
update public.loads set accepted_at = now() - interval '6 minutes' where id = (select load_id from switched);

select assert_equals(private.system_dispatch_waves(), 0,
  'with auto-dispatch switched off, the job sends nothing');
select assert_true(not private.machine_owns((select load_id from switched)),
  'and the machine lets go');
select private.system_sweep_expired_offers();
select assert_text(
  (select status::text from public.loads where id = (select load_id from switched)), 'finding_truck',
  'so the sweep hands it to a person, as before 0036');
update private.app_settings set value = 'true'::jsonb where key = 'auto_dispatch_enabled';

-- A dispatcher's own offer is left alone by the machine.
select act_as('a0000000-0000-4000-8000-000000000001');
create temp table manual on commit drop as
select * from public.book_load(city('Muscat'), city('Dubai'), current_date + 4, current_date + 4,
                               'Dispatcher cargo', 8000, null, :p8000);
select act_as_reset();
update public.offers set status = 'expired' where load_id = (select load_id from manual);
insert into public.offers (load_id, driver_id, source)
values ((select load_id from manual), 'd0000000-0000-4000-8000-000000000003', 'ops');
update public.loads set accepted_at = now() - interval '6 minutes' where id = (select load_id from manual);
select private.system_dispatch_waves();
select assert_text(asked((select load_id from manual), 'pending'), 'C Nizwa',
  'while a dispatcher''s offer is out, the machine sends nothing else');

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Availability — a town, never a coordinate, and nobody else's business
-- ════════════════════════════════════════════════════════════════════════════

select act_as('d0000000-0000-4000-8000-000000000002');
select assert_text(
  (select (select name_en from public.cities where id = s.city_id) || '/' || s.source
     from public.set_available(true, 22.9333, 57.5333) s),
  'Nizwa/gps', 'GPS is snapped to the nearest town');
select assert_raises($$select public.set_available(true, 91, 57)$$, 'a latitude off the planet is refused');
select assert_raises($$select public.set_available(true, 23.5, null)$$, 'half a coordinate is refused');
select assert_text(
  (select (select name_en from public.cities where id = s.city_id) || '/' || s.available::text
     from public.set_available(false) s),
  'Nizwa/false', 'going offline remembers where the truck is');
select assert_raises(
  $$update public.driver_availability set available = true, city_id = 1
     where driver_id = 'd0000000-0000-4000-8000-000000000002'$$,
  'a driver cannot write their own row — that would be jumping the queue');
select assert_raises(
  $$insert into public.driver_availability (driver_id, available) values (auth.uid(), true)$$,
  'nor insert one');
select assert_equals((select count(*) from public.driver_availability), 1,
  'a driver reads their own availability and nobody else''s');
select act_as_reset();

select assert_equals(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'driver_availability'
      and column_name in ('lat', 'lng', 'latitude', 'longitude')), 0,
  'no coordinate column exists to leak');

select act_as('a0000000-0000-4000-8000-000000000001');
select assert_raises($$select public.set_available(true)$$, 'a shipper cannot go online as a driver');
select assert_equals((select count(*) from public.driver_availability), 0,
  'a shipper sees no driver''s availability at all');
select assert_raises($$select * from private.nearby_drivers((select load_id from booked), 1500, true, 50)$$,
  'the candidate list is private — it is the load board with the guard removed');
select act_as_reset();

select act_as_anon();
select assert_raises($$select public.set_available(true)$$, 'anon cannot go online');
select assert_raises($$select * from public.book_load(1, 2, current_date, current_date, 'x')$$,
  'anon cannot book');
select act_as_reset();

select act_as('d0000000-0000-4000-8000-000000000001');
select assert_raises(
  $$select * from public.book_load(1, 2, current_date, current_date, 'x')$$, 'a driver cannot book a load');
select act_as_reset();

-- Twelve idle hours turn the switch off.
update public.driver_availability set available = true, updated_at = now() - interval '13 hours'
 where driver_id = 'd0000000-0000-4000-8000-000000000004';
select private.system_expire_availability();
select assert_true(
  (select not available from public.driver_availability
    where driver_id = 'd0000000-0000-4000-8000-000000000004'),
  'a switch left on for twelve idle hours is turned off');

-- ════════════════════════════════════════════════════════════════════════════
-- 9. With verification off (the pre-launch setting)
-- ════════════════════════════════════════════════════════════════════════════

update private.app_settings set value = 'false'::jsonb where key = 'require_verified_driver';
update public.driver_availability set available = false;
update public.driver_availability set available = true
 where driver_id = 'd0000000-0000-4000-8000-000000000007';  -- X Unverified, Muscat

select act_as('a0000000-0000-4000-8000-000000000001');
create temp table unvetted on commit drop as
select * from public.book_load(city('Muscat'), city('Dubai'), current_date + 5, current_date + 5,
                               'Pre-launch cargo', 8000, null, :p8000);
select act_as_reset();
select assert_text(asked((select load_id from unvetted), 'pending'), 'X Unverified',
  'with the flag off, an unverified driver is offered loads — the pre-launch behaviour');

-- ════════════════════════════════════════════════════════════════════════════
-- 11. After the waves — a driver who comes online later is still asked (0037)
-- ════════════════════════════════════════════════════════════════════════════
--
-- `lonely` (section 6) spent every wave with nobody online and went to a person.
-- Before 0037 that was the end: a driver switching on beside it was never asked.

update private.app_settings set value = 'true'::jsonb where key = 'require_verified_driver';
update public.driver_availability set available = false;

-- A load whose collection date has passed is not worth waking anyone for.
update public.loads set pickup_from = current_date - 2, pickup_to = current_date - 1
 where id = (select load_id from switched);

select assert_equals(private.system_rescue_stranded(), 0,
  'nobody online: nothing is sent, and nothing pretends it was');

-- B Seeb switches on, an hour after the search ended.
update public.driver_availability set available = true, updated_at = now() + interval '1 hour'
 where driver_id = 'd0000000-0000-4000-8000-000000000002';
select private.system_rescue_stranded();

select assert_text(asked((select load_id from lonely), 'pending'), 'B Seeb',
  'a driver who comes online after the waves ended is asked');
select assert_true(
  (select bool_and(expires_at <= now() + interval '5 minutes' and source = 'auto')
     from public.offers where load_id = (select load_id from lonely) and status = 'pending'),
  'for as long as a wave offer lives');
select assert_text(
  (select mode from private.dispatch_log
    where load_id = (select load_id from lonely) and mode = 'rescue'),
  'rescue', 'the dispatch log says why');
select assert_text(asked((select load_id from switched), 'pending'), '',
  'a load whose collection date has passed is not offered');
select assert_text(asked((select load_id from manual), 'pending'), 'C Nizwa',
  'a load a dispatcher has an offer out on is left to them');

select private.system_rescue_stranded();
select assert_equals(
  (select count(*) from public.offers where load_id = (select load_id from lonely) and status = 'pending'), 1,
  'while the offer is out, nothing more is sent');

-- B misses it. Still online, never switched again: not asked a second time.
update public.offers set expires_at = now() - interval '1 second'
 where load_id = (select load_id from lonely) and status = 'pending';
update public.driver_availability set updated_at = now() - interval '1 hour'
 where driver_id = 'd0000000-0000-4000-8000-000000000002';
select private.system_rescue_stranded();
select assert_text(asked((select load_id from lonely), 'pending'), '',
  'a driver who let an offer lapse and never switched again is not asked again');

-- B goes off and comes back: they were not there, which is not a no.
update public.driver_availability set updated_at = now() + interval '2 hours'
 where driver_id = 'd0000000-0000-4000-8000-000000000002';
select private.system_rescue_stranded();
select assert_text(asked((select load_id from lonely), 'pending'), 'B Seeb',
  'a driver who missed an offer and switched on again is asked again');

-- B says no. That stands, whatever the switch does next.
select act_as('d0000000-0000-4000-8000-000000000002');
select public.respond_to_offer(
  (select id from public.offers where load_id = (select load_id from lonely)
     and driver_id = 'd0000000-0000-4000-8000-000000000002'), false);
select act_as_reset();
update public.driver_availability set updated_at = now() + interval '3 hours'
 where driver_id = 'd0000000-0000-4000-8000-000000000002';
select private.system_rescue_stranded();
select assert_text(asked((select load_id from lonely), 'pending'), '',
  'a decline is final — the machine never asks again');

-- A dispatcher who has taken the load in hand is never second-guessed.
update public.driver_availability set available = true, updated_at = now() + interval '3 hours'
 where driver_id = 'd0000000-0000-4000-8000-000000000001';  -- A Muscat, asked in section 6
select act_as('a0000000-0000-4000-8000-000000000002');
select public.ops_mark_finding_truck((select load_id from lonely));
select act_as_reset();
select private.system_rescue_stranded();
select assert_text(asked((select load_id from lonely), 'pending'), '',
  'once a dispatcher has marked it theirs, the machine leaves it alone');

-- The switches.
delete from private.ops_audit
 where target_id = (select load_id::text from lonely) and action = 'ops_mark_finding_truck';
update private.app_settings set value = 'false'::jsonb where key = 'dispatch_rescue_enabled';
select assert_equals(private.system_rescue_stranded(), 0, 'dispatch_rescue_enabled off: nothing');
update private.app_settings set value = 'true'::jsonb where key = 'dispatch_rescue_enabled';
update private.app_settings set value = 'false'::jsonb where key = 'auto_dispatch_enabled';
select assert_equals(private.system_rescue_stranded(), 0, 'the auto-dispatch kill switch stops it too');
update private.app_settings set value = 'true'::jsonb where key = 'auto_dispatch_enabled';
select assert_true(private.system_rescue_stranded() > 0,
  'and with both on, it resumes');

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Static checks over everything 0036 added
-- ════════════════════════════════════════════════════════════════════════════

select assert_equals(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and p.proname in ('resolve_truck_type', 'price_for', 'issue_quote', 'quote_route', 'book_load',
                        'nearest_city', 'last_delivery_city', 'set_available', 'trip_availability',
                        'nearby_drivers', 'dispatch_wave', 'machine_owns', 'next_wave', 'auto_dispatch',
                        'offer_declined', 'loads_machine_guard', 'system_dispatch_waves',
                        'system_expire_availability', 'system_rescue_stranded')
      and not coalesce(p.proconfig @> array['search_path=""'], false)), 0,
  'every definer function 0036 touches pins search_path = ''''');

select assert_equals(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = n.oid and n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('resolve_truck_type', 'nearest_city', 'last_delivery_city', 'nearby_drivers',
                        'dispatch_wave', 'machine_owns', 'next_wave', 'system_dispatch_waves',
                        'system_expire_availability', 'system_rescue_stranded')
      and (has_function_privilege('authenticated', p.oid, 'execute')
           or has_function_privilege('anon', p.oid, 'execute'))), 0,
  'no private dispatch function is executable by a client');

select assert_equals(
  (select count(*) from cron.job
    where jobname in ('dispatch-waves', 'expire-availability', 'dispatch-rescue')), 3,
  'every dispatch job is scheduled');

-- The class of bug 0037 fixed, over EVERY function, called or not. PostgREST
-- runs a STABLE or IMMUTABLE function in a READ ONLY transaction, so one that
-- writes — a rate-limit row, an audit row — fails on every call from the app.
-- psql does not set read-only, so no call in these suites could ever see it:
-- `quote_route` passed here while failing for every shipper in production.
select assert_text(
  (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by 1), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.provolatile <> 'v'
      and p.prosrc ~* '(check_rate_limit|log_ops|log_system|raise_alert|\minsert\s+into\M|\mupdate\s+(public|private)\.|\mdelete\s+from\M)'),
  '', 'no STABLE or IMMUTABLE function writes (PostgREST would run it read-only)');

rollback;
