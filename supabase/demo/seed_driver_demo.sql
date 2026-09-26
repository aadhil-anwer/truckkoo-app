-- ═══════════════════════════════════════════════════════════════════════════
-- DEMO DATA for recording a driver walkthrough. NOT A MIGRATION.
--
-- Lives outside migrations/ on purpose, like seed_dev_rates.sql: it must never
-- reach a database by `db push`. Run it by hand, as postgres (Supabase dashboard
-- → SQL editor, or psql), and remove it with clear_driver_demo.sql.
--
-- WHAT IT GIVES THE DRIVER (the most recently created driver, or the one whose
-- email you set in v_email below):
--   • one empty leg Muscat → Salalah on their own truck (Routes tab)
--   • two pending offers (Offers tab + badge), sent through public.create_offer,
--     the same function a dispatcher's ops_send_offer calls:
--       A  Nizwa → Salalah, on that leg — shows a detour and room left
--       B  Sohar → Dubai, no leg — cross-border
--   • one trip already IN TRANSIT, Muscat → Sur, with ONE stored position
--     near Ibra — so the tracking map has a truck to draw
--   • one DELIVERED trip last week — so home opens on money, not on nothing
--
-- WHY A STORED POSITION. report_position refuses anything outside the Gulf
-- (lat 12–33, lng 34–60). A phone recording outside Oman cannot put a truck on
-- the map, and a trip accepted during the video will correctly show no truck.
-- This fix is a real row in trip_positions, not a computed one; it is demo data
-- and is labelled as such here. It is the only position that exists.
--
-- Every row uses a fixed id (prefix de30…), so clear_driver_demo.sql removes
-- exactly this and nothing else. Re-running this file first clears, then seeds.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  -- Set this to the driver's sign-up email, or leave NULL for the newest driver.
  v_email   text := null;

  v_driver  uuid;
  v_name    text;
  v_truck   uuid;

  v_shipper uuid := 'de300000-0000-4000-8000-000000000001';
  v_leg     uuid := 'de300000-0000-4000-8000-0000000000a1';
  v_load_a  uuid := 'de300000-0000-4000-8000-0000000000b1';
  v_load_b  uuid := 'de300000-0000-4000-8000-0000000000b2';
  v_load_c  uuid := 'de300000-0000-4000-8000-0000000000b3';
  v_load_d  uuid := 'de300000-0000-4000-8000-0000000000b4';
  v_trip_c  uuid := 'de300000-0000-4000-8000-0000000000c3';
  v_trip_d  uuid := 'de300000-0000-4000-8000-0000000000c4';

  c_muscat  bigint; c_nizwa bigint; c_salalah bigint;
  c_sohar   bigint; c_dubai bigint; c_sur     bigint; c_barka bigint;
begin
  -- ── who ──────────────────────────────────────────────────────────────────
  select p.id, p.full_name into v_driver, v_name
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'driver'
    and (v_email is null or lower(u.email) = lower(v_email))
  order by p.created_at desc
  limit 1;

  if v_driver is null then
    raise exception 'no driver account found%',
      coalesce(' for ' || v_email, '') || ' — sign up as a driver in the app first';
  end if;

  select t.id into v_truck from public.trucks t
  where t.owner_id = v_driver order by t.created_at limit 1;

  -- A driver who skipped the truck at sign-up still gets one, so matching and
  -- "room left" have something to read.
  if v_truck is null then
    insert into public.trucks (id, owner_id, truck_type, plate, capacity_kg)
    values ('de300000-0000-4000-8000-0000000000e1', v_driver, '20t', 'DEMO 1234', 20000)
    returning id into v_truck;
  end if;

  update public.trucks set capacity_kg = coalesce(capacity_kg, 20000) where id = v_truck;

  -- ── start clean ──────────────────────────────────────────────────────────
  delete from public.legs  where id = v_leg;
  delete from auth.users   where id = v_shipper;   -- cascades: profile → loads → offers, trips

  select id into c_muscat  from public.cities where name_en = 'Muscat';
  select id into c_nizwa   from public.cities where name_en = 'Nizwa';
  select id into c_salalah from public.cities where name_en = 'Salalah';
  select id into c_sohar   from public.cities where name_en = 'Sohar';
  select id into c_dubai   from public.cities where name_en = 'Dubai';
  select id into c_sur     from public.cities where name_en = 'Sur';
  select id into c_barka   from public.cities where name_en = 'Barka';

  -- ── the shipper whose loads these are ────────────────────────────────────
  -- No password: this account cannot sign in. It exists to own the loads.
  insert into auth.users (id, email, aud, role)
  values (v_shipper, 'demo-shipper@truckkoo.invalid', 'authenticated', 'authenticated');

  insert into public.profiles (id, role, full_name, phone)
  values (v_shipper, 'shipper', 'Al Noor Trading (demo)', '+968 9000 0000');

  -- ── the driver's declared leg ────────────────────────────────────────────
  insert into public.legs (id, driver_id, truck_id, origin_city, dest_city,
                           depart_from, depart_to, is_empty, free_kg)
  values (v_leg, v_driver, v_truck, c_muscat, c_salalah,
          current_date + 1, current_date + 3, true, 20000);

  -- ── loads, priced. Prices in integer baisa (1000 = 1 OMR). ───────────────
  insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                            weight_kg, truck_type_code, goods_description, status, price_baisa)
  values
    (v_load_a, v_shipper, c_nizwa, c_salalah, current_date + 1, current_date + 2,
     8000, '20t', 'Cement bags on pallets', 'finding_truck', 185000),
    (v_load_b, v_shipper, c_sohar, c_dubai, current_date + 2, current_date + 3,
     3000, null, 'Household furniture', 'finding_truck', 95500),
    (v_load_c, v_shipper, c_muscat, c_sur, current_date, current_date,
     12000, '20t', 'Steel rebar', 'finding_truck', 120000),
    (v_load_d, v_shipper, c_barka, c_muscat, current_date - 7, current_date - 7,
     5000, '10t', 'Fresh produce crates', 'finding_truck', 45000);

  -- ── offers, through the dispatcher's own function ────────────────────────
  perform public.create_offer(v_load_a, v_driver, v_leg, 'ops', true);
  perform public.create_offer(v_load_b, v_driver, null,  'ops', true);

  -- ── a trip under way, and one delivered ──────────────────────────────────
  -- Built as rows rather than by accepting as the driver: it is history the
  -- video starts from, not something the video demonstrates.
  update public.loads set status = 'in_transit' where id = v_load_c;
  update public.loads set status = 'delivered'  where id = v_load_d;

  insert into public.offers (load_id, driver_id, status, source)
  values (v_load_c, v_driver, 'accepted', 'ops'),
         (v_load_d, v_driver, 'accepted', 'ops');

  insert into public.trips (id, load_id, driver_id, truck_id, status, created_at)
  values (v_trip_c, v_load_c, v_driver, v_truck, 'in_transit', now() - interval '2 hours'),
         (v_trip_d, v_load_d, v_driver, v_truck, 'delivered',  now() - interval '7 days');

  insert into public.trip_events (trip_id, type, occurred_at, created_by)
  values (v_trip_c, 'en_route', now() - interval '90 minutes', v_driver),
         (v_trip_d, 'en_route', now() - interval '7 days',     v_driver);
  insert into public.trip_events (trip_id, type, occurred_at, photo_path, created_by)
  values (v_trip_d, 'delivered', now() - interval '7 days' + interval '3 hours',
          'demo/no-photo.jpg', v_driver);

  -- One stored fix, on the Muscat → Sur road near Ibra. See the header.
  insert into public.trip_positions (trip_id, driver_id, lat, lng, accuracy_m, seen_at)
  values (v_trip_c, v_driver, 22.69, 58.53, 15, now() - interval '2 minutes');

  raise notice 'Demo data seeded for driver "%" (%).', v_name, v_driver;
end $$;
