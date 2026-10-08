-- Truckkoo — shipper places suite (0041).
--
-- Run against a LOCAL database only: one transaction, rolled back.
--   npm run test:db:places
--
-- WHAT IS BEING PROVED
--   * a place is readable by the shipper who owns the load, and nobody else;
--   * no client can write one directly — only book_load, which derives the city;
--   * a driver sees a place only through the driver functions: while the offer
--     is pending, and on their own trip (contact hidden after delivery);
--   * the search quota is a shipper's, and it runs out.

begin;
-- 0054's staff-domain rule is proven in ops_v2.sql; these fixtures use test domains.
delete from private.app_settings where key = 'staff_email_domains';
set local client_min_messages to notice;

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
  if p_actual is distinct from true then
    raise exception 'FAIL: % — expected true, got %', p_what, p_actual;
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
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_uid, 'role', 'authenticated', 'aal', 'aal2',
    'amr', json_build_array(json_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint))
  )::text, true);
end $$;

create or replace function act_as_reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function city(p_name text) returns bigint language sql stable as $$
  select id from public.cities where name_en = p_name
$$;

-- Shipper A, Shipper B, Driver D, a dispatcher, and A's load Muscat → Salalah.
do $$
begin
  insert into auth.users (id, email) values
    ('c0000000-0000-4000-8000-00000000000a', 'places-a@test.local'),
    ('c0000000-0000-4000-8000-00000000000b', 'places-b@test.local'),
    ('c0000000-0000-4000-8000-00000000000d', 'places-d@test.local'),
    ('c0000000-0000-4000-8000-00000000000e', 'places-ops@test.local');
  insert into public.profiles (id, role, full_name) values
    ('c0000000-0000-4000-8000-00000000000a', 'shipper', 'Places A'),
    ('c0000000-0000-4000-8000-00000000000b', 'shipper', 'Places B'),
    ('c0000000-0000-4000-8000-00000000000d', 'driver',  'Places D'),
    ('c0000000-0000-4000-8000-00000000000e', 'shipper', 'Places Ops');
  insert into private.ops_users (profile_id, note)
    values ('c0000000-0000-4000-8000-00000000000e', 'places suite');
  insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description)
    values ('c1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000a',
            city('Muscat'), city('Salalah'), current_date + 1, current_date + 1, 'Places cargo');
  insert into public.load_places (load_id, kind, lat, lng, place_name, note, contact_name, contact_phone)
    values ('c1000000-0000-4000-8000-000000000001', 'pickup', 23.59, 58.41, 'Ruwi warehouse',
            'Gate 3', 'Rashid', '+968 9000 0000');
end $$;

-- ═══ 1. who reads a place ═══════════════════════════════════════════════════
select act_as('c0000000-0000-4000-8000-00000000000a');
select assert_equals((select count(*) from public.load_places), 1, 'the shipper reads the place on their own load');
select act_as('c0000000-0000-4000-8000-00000000000b');
select assert_equals((select count(*) from public.load_places), 0, 'another shipper reads none of it');
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_equals((select count(*) from public.load_places), 0, 'a driver reads nothing from the table itself');
select act_as_reset();
select set_config('role', 'anon', true), set_config('request.jwt.claims', '', true);
select assert_raises($$select count(*) from public.load_places$$, 'anon cannot read places at all');
select act_as_reset();

-- ═══ 2. nobody writes a place directly ══════════════════════════════════════
select act_as('c0000000-0000-4000-8000-00000000000a');
select assert_raises(
  $$insert into public.load_places (load_id, kind, lat, lng)
    values ('c1000000-0000-4000-8000-000000000001', 'drop', 17.0, 54.1)$$,
  'a shipper cannot insert a place around book_load');
select assert_raises(
  $$update public.load_places set note = 'x' where kind = 'pickup'$$,
  'a shipper cannot edit a place');
select act_as_reset();

-- ═══ 3. the table's own checks ══════════════════════════════════════════════
select assert_raises(
  $$insert into public.load_places (load_id, kind, lat, lng)
    values ('c1000000-0000-4000-8000-000000000001', 'drop', 51.5, -0.1)$$,
  'a point outside the region is refused');
select assert_raises(
  $$insert into public.load_places (load_id, kind, lat, lng, contact_phone)
    values ('c1000000-0000-4000-8000-000000000001', 'drop', 17.0, 54.1, 'call me')$$,
  'a phone that is not a phone is refused');
select assert_raises(
  format($$insert into public.load_places (load_id, kind, lat, lng, note)
    values ('c1000000-0000-4000-8000-000000000001', 'drop', 17.0, 54.1, %L)$$, 'Gate ' || chr(8238) || '3'),
  'a bidi override in a note is refused');

-- ═══ 4. city_near ═══════════════════════════════════════════════════════════
select act_as('c0000000-0000-4000-8000-00000000000a');
select assert_equals(public.city_near(23.588, 58.408), city('Muscat'), 'a point in Muscat is near Muscat');
select assert_equals(public.city_near(17.02, 54.09), city('Salalah'), 'a point in Salalah is near Salalah');
select assert_raises($$select public.city_near(51.5, -0.1)$$, 'city_near refuses a point outside the region');
-- 0042: inside the box is not inside the network. Doha has no city of ours,
-- and Bandar Abbas is across the strait — neither may snap to a town and be
-- priced as one.
select assert_equals(public.city_near(25.29, 51.53), null, 'a point in Doha is near no city of ours');
select assert_equals(public.city_near(27.18, 56.27), null, 'a point in Bandar Abbas is near no city of ours');
select assert_equals(public.city_near(23.70, 57.88), city('Barka'), 'a point just outside Barka is still Barka');
select act_as_reset();

-- ═══ 5. the search quota ════════════════════════════════════════════════════
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_raises($$select public.use_places_quota('autocomplete')$$, 'a driver has no search quota');
-- 0043: a signed-in user with no profile row has no role, and NULL <> 'shipper'
-- is NULL, which an IF treats as false — so it passed. It must not.
select act_as('c0000000-0000-4000-8000-0000000000ff');
do $$
begin
  perform public.use_places_quota('autocomplete');
  raise exception 'FAIL: a user with no profile has no search quota — it was granted';
exception when insufficient_privilege then
  raise notice 'pass: a user with no profile has no search quota (%)', sqlerrm;
end $$;
select act_as_reset();
select act_as('c0000000-0000-4000-8000-00000000000a');
select assert_raises($$select public.use_places_quota('geocode')$$, 'an unknown kind is refused');
select assert_equals(
  -- Correlated with g: an uncorrelated subquery would run once, not sixty times.
  (select count(*) from generate_series(1, 60) g, lateral public.use_places_quota('details' || left('', g)) q), 60,
  'sixty place lookups an hour are allowed');
select assert_raises($$select public.use_places_quota('details')$$, 'the sixty-first is refused');
select act_as_reset();

-- ═══ 6. ops ═════════════════════════════════════════════════════════════════
select act_as('c0000000-0000-4000-8000-00000000000e');
select assert_text(
  (select contact_phone from public.ops_load_places('c1000000-0000-4000-8000-000000000001') where kind = 'pickup'),
  '+968 9000 0000', 'a dispatcher reads the contact at the gate');
select act_as('c0000000-0000-4000-8000-00000000000a');
select assert_raises($$select * from public.ops_load_places('c1000000-0000-4000-8000-000000000001')$$,
  'a shipper cannot call the ops read');
select act_as_reset();

-- ═══ 7. book_load writes places, and derives the city ═══════════════════════
select act_as('c0000000-0000-4000-8000-00000000000a');
select assert_equals(
  (select count(*) from public.book_load(
     city('Muscat'), city('Salalah'), current_date + 2, current_date + 2, 'Booked with places',
     null, null, null,
     jsonb_build_object('lat', 23.588, 'lng', 58.408, 'place_name', 'Ruwi', 'note', '  ',
                        'contact_name', 'Rashid', 'contact_phone', '+968 9000 0001'),
     jsonb_build_object('lat', 17.02, 'lng', 54.09, 'place_name', 'Salalah port'))),
  1, 'book_load accepts a pickup and a drop place');
select assert_equals(
  (select count(*) from public.load_places p join public.loads l on l.id = p.load_id
    where l.goods_description = 'Booked with places'), 2,
  'both places are written with the load');
select assert_text(
  (select coalesce(p.note, 'NULL') from public.load_places p join public.loads l on l.id = p.load_id
    where l.goods_description = 'Booked with places' and p.kind = 'pickup'),
  'NULL', 'a blank note is stored as nothing, not as spaces');
select assert_raises(
  $$select * from public.book_load(city('Muscat'), city('Salalah'), current_date + 2, current_date + 2,
      'Mismatch', null, null, null,
      jsonb_build_object('lat', 17.02, 'lng', 54.09), null)$$,
  'a pickup place that is not in the pickup city is refused');
select assert_raises(
  $$select * from public.book_load(city('Muscat'), city('Salalah'), current_date + 2, current_date + 2,
      'Doha', null, null, null,
      jsonb_build_object('lat', 25.29, 'lng', 51.53), null)$$,
  'a place far from every city is refused, whatever city is passed');
select assert_equals(
  (select count(*) from public.book_load(
     city('Muscat'), city('Salalah'), current_date + 2, current_date + 2, 'Booked without places')),
  1, 'book_load without places still books, as before');
select act_as_reset();

-- ═══ 8. drivers read places only through their functions ════════════════════
insert into public.offers (id, load_id, driver_id, status)
values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-00000000000d', 'pending');

-- 0074 (founder, 2026-10-08): an open offer shows towns, km and fare — not the
-- exact place or who is there. Those come with the job, in driver_trip (§9).
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_true(
  (select pickup_contact_phone is null and pickup_contact_name is null and pickup_lat is null
          and pickup_name is null and pickup_note is null
          and drop_contact_phone is null and drop_lat is null and drop_name is null
     from public.driver_offer('c2000000-0000-4000-8000-000000000001')),
  'a pending offer carries no pin, place name, note or contact — a driver who says no learns none of it');
select assert_true(
  (select trip_km > 0 from public.driver_offers() where offer_id = 'c2000000-0000-4000-8000-000000000001'),
  'and it says how far the trip is');
select act_as_reset();
insert into public.driver_availability (driver_id, available, lat, lng, accuracy_m, located_at)
values ('c0000000-0000-4000-8000-00000000000d', true, 23.60, 58.45, 20, now())
on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng,
  accuracy_m = excluded.accuracy_m, located_at = excluded.located_at;
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_true(
  (select to_pickup_km between 0 and 50 from public.driver_offer('c2000000-0000-4000-8000-000000000001')),
  'and how far the pickup is from the driver''s own latest fix');
select act_as_reset();

-- An offer that lapsed unanswered is not a live offer: the contact goes with it.
update public.offers set expires_at = now() - interval '1 minute'
  where id = 'c2000000-0000-4000-8000-000000000001';
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_equals(
  (select count(*) from public.driver_offer('c2000000-0000-4000-8000-000000000001')), 0,
  'an expired offer — and its contact — is gone');
select assert_equals(
  (select count(*) from public.driver_offers() where offer_id = 'c2000000-0000-4000-8000-000000000001'), 0,
  'and it is gone from the list');
select act_as_reset();
update public.offers set expires_at = now() + interval '5 minutes'
  where id = 'c2000000-0000-4000-8000-000000000001';

update public.offers set status = 'declined' where id = 'c2000000-0000-4000-8000-000000000001';
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_equals(
  (select count(*) from public.driver_offer('c2000000-0000-4000-8000-000000000001')), 0,
  'after a pass the offer — and its contact — is gone');
select act_as_reset();

insert into public.trips (id, load_id, driver_id, status)
values ('c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-00000000000d', 'assigned');
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_text((select pickup_note from public.driver_trip('c3000000-0000-4000-8000-000000000001')),
  'Gate 3', 'the driver on the job reads the note');
select assert_text((select pickup_contact_phone from public.driver_trip('c3000000-0000-4000-8000-000000000001')),
  '+968 9000 0000', 'and the contact, while the job is open');
select act_as_reset();

update public.trips set status = 'delivered' where id = 'c3000000-0000-4000-8000-000000000001';
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_text(
  (select coalesce(pickup_contact_phone, 'NULL') from public.driver_trip('c3000000-0000-4000-8000-000000000001')),
  'NULL', 'after delivery the contact is hidden');
select assert_text((select pickup_name from public.driver_trip('c3000000-0000-4000-8000-000000000001')),
  'Ruwi warehouse', 'and the place stays, as a record');
select act_as_reset();

do $$ begin raise notice 'ALL PLACES ASSERTIONS HELD'; end $$;
rollback;
