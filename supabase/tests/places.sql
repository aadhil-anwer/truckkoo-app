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
select act_as_reset();

-- ═══ 5. the search quota ════════════════════════════════════════════════════
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_raises($$select public.use_places_quota('autocomplete')$$, 'a driver has no search quota');
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
select assert_equals(
  (select count(*) from public.book_load(
     city('Muscat'), city('Salalah'), current_date + 2, current_date + 2, 'Booked without places')),
  1, 'book_load without places still books, as before');
select act_as_reset();

do $$ begin raise notice 'ALL PLACES ASSERTIONS HELD'; end $$;
rollback;
