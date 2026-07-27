-- Truckkoo — tenant isolation suite. Required by SECURITY.md §14.
--
-- Run against a LOCAL database only (`supabase db reset` then psql -f this).
-- Never against production: it creates users and rows.
--
-- Every assertion is "actor A cannot touch actor B's row". This file must grow
-- with every new owned table — a new owned table without a case here is an
-- incomplete change.
--
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/tenant_isolation.sql
--
-- Exit code 0 = all assertions held.

begin;

-- 'notice' so each `pass:` line is visible. Setting this to 'warning' hides the
-- assertions and makes a green run indistinguishable from a run that did nothing.
set local client_min_messages to notice;

-- ─── fixtures ───────────────────────────────────────────────────────────────
-- Insert auth users directly; we are simulating post-signup state.

create or replace function tests_seed() returns void
language plpgsql as $$
declare
  v_shipper_a uuid := '11111111-1111-4111-8111-111111111111';
  v_shipper_b uuid := '22222222-2222-4222-8222-222222222222';
  v_driver_a  uuid := '33333333-3333-4333-8333-333333333333';
  v_driver_b  uuid := '44444444-4444-4444-8444-444444444444';
  v_muscat    bigint;
  v_salalah   bigint;
begin
  insert into auth.users (id, email) values
    (v_shipper_a, 'shipper-a@test.local'),
    (v_shipper_b, 'shipper-b@test.local'),
    (v_driver_a,  'driver-a@test.local'),
    (v_driver_b,  'driver-b@test.local')
  on conflict (id) do nothing;

  insert into public.profiles (id, role, full_name) values
    (v_shipper_a, 'shipper', 'Shipper A'),
    (v_shipper_b, 'shipper', 'Shipper B'),
    (v_driver_a,  'driver',  'Driver A'),
    (v_driver_b,  'driver',  'Driver B')
  on conflict (id) do nothing;

  select id into v_muscat  from public.cities where name_en = 'Muscat';
  select id into v_salalah from public.cities where name_en = 'Salalah';

  insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description)
  values ('aaaaaaaa-0000-4000-8000-000000000001', v_shipper_a, v_muscat, v_salalah,
          current_date + 1, current_date + 3, 'A cargo — confidential')
  on conflict (id) do nothing;

  insert into public.legs (id, driver_id, origin_city, dest_city, depart_from, depart_to)
  values ('bbbbbbbb-0000-4000-8000-000000000001', v_driver_a, v_muscat, v_salalah,
          current_date + 1, current_date + 3)
  on conflict (id) do nothing;

  insert into public.trucks (id, owner_id, truck_type, plate)
  values ('cccccccc-0000-4000-8000-000000000001', v_driver_a, '10t', 'A-1234')
  on conflict (id) do nothing;

  -- A quote on shipper A's load. Inserted directly as owner because there is no
  -- client INSERT grant at all — quotes come from quote_load() only (0010).
  insert into public.quotes (id, shipper_id, load_id, origin_city, dest_city,
                             pickup_from, pickup_to, price_baisa, outcome)
  values ('eeeeeeee-0000-4000-8000-000000000001', v_shipper_a,
          'aaaaaaaa-0000-4000-8000-000000000001', v_muscat, v_salalah,
          current_date + 1, current_date + 3, 150000, 'quoted')
  on conflict (id) do nothing;
end $$;

select tests_seed();

-- ─── helpers ────────────────────────────────────────────────────────────────

create or replace function assert_equals(p_actual bigint, p_expected bigint, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % — expected %, got %', p_what, p_expected, p_actual;
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

-- Impersonate a user the way PostgREST does.
create or replace function act_as(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function act_as_reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. loads — cross-tenant read
-- ════════════════════════════════════════════════════════════════════════════

select act_as('22222222-2222-4222-8222-222222222222');  -- Shipper B
select assert_equals(
  (select count(*) from public.loads where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0, 'shipper B cannot read shipper A''s load');
select act_as_reset();

-- A driver with NO offer must not see the load either. This is the regression
-- test for the load-board leak: a browsable board would return 1 here.
select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A
select assert_equals(
  (select count(*) from public.loads where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0, 'driver without an offer cannot read a posted load');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. legs — supply intelligence is never cross-readable
-- ════════════════════════════════════════════════════════════════════════════

select act_as('44444444-4444-4444-8444-444444444444');  -- Driver B
select assert_equals(
  (select count(*) from public.legs where id = 'bbbbbbbb-0000-4000-8000-000000000001'),
  0, 'driver B cannot read driver A''s leg');
select act_as_reset();

select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A
select assert_equals(
  (select count(*) from public.legs),
  0, 'a shipper can never read any leg');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. trucks — cross-tenant write and delete
-- ════════════════════════════════════════════════════════════════════════════

select act_as('44444444-4444-4444-8444-444444444444');  -- Driver B
select assert_equals(
  (select count(*) from public.trucks where id = 'cccccccc-0000-4000-8000-000000000001'),
  0, 'driver B cannot read driver A''s truck');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. mass assignment (SECURITY.md §4, SENSITIVE_FIELDS.md)
-- ════════════════════════════════════════════════════════════════════════════

select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A

select assert_raises(
  $$update public.profiles set role = 'shipper' where id = '33333333-3333-4333-8333-333333333333'$$,
  'a user cannot change their own role');

select assert_raises(
  $$update public.drivers set verified_at = now() where profile_id = '33333333-3333-4333-8333-333333333333'$$,
  'a driver cannot self-verify');

select assert_raises(
  $$update public.trucks set verified_at = now() where id = 'cccccccc-0000-4000-8000-000000000001'$$,
  'a driver cannot verify their own truck');

select assert_raises(
  $$update public.legs set status = 'matched' where id = 'bbbbbbbb-0000-4000-8000-000000000001'$$,
  'a driver cannot set leg status directly');

select act_as_reset();

select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A

select assert_raises(
  $$update public.loads set price_baisa = 1 where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'a shipper cannot set a price');

select assert_raises(
  $$update public.loads set status = 'assigned' where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'a shipper cannot set load status directly');

select assert_raises(
  $$insert into public.offers (load_id, driver_id) values
      ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333')$$,
  'nobody can forge an offer from the client');

select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. match_load IDOR — the vulnerability this suite exists to catch
-- ════════════════════════════════════════════════════════════════════════════

select act_as('22222222-2222-4222-8222-222222222222');  -- Shipper B
select assert_equals(
  (select count(*) from public.match_load('aaaaaaaa-0000-4000-8000-000000000001')),
  0, 'match_load returns nothing for a load you do not own');
select act_as_reset();

-- Sanity check the positive case, so a function that always returns empty
-- cannot pass this suite by being broken.
select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A
select assert_equals(
  (select count(*) from public.match_load('aaaaaaaa-0000-4000-8000-000000000001')),
  1, 'match_load DOES find the matching leg for the owning shipper');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 5b. quotes — an owned table, so §14 requires it here
--
-- The pricing engine's own suite is `supabase/tests/pricing.sql`. This section is
-- the isolation half, kept with every other owned table so the "does each owned
-- table have a case here" check stays answerable by reading one file.
-- ════════════════════════════════════════════════════════════════════════════

select act_as('22222222-2222-4222-8222-222222222222');  -- Shipper B
select assert_equals(
  (select count(*) from public.quotes where id = 'eeeeeeee-0000-4000-8000-000000000001'),
  0, 'shipper B cannot read shipper A''s quote');
select assert_raises(
  $$update public.quotes set price_baisa = 1
     where id = 'eeeeeeee-0000-4000-8000-000000000001'$$,
  'shipper B cannot rewrite shipper A''s price');
select assert_raises(
  $$delete from public.quotes where id = 'eeeeeeee-0000-4000-8000-000000000001'$$,
  'shipper B cannot delete shipper A''s quote');
select act_as_reset();

-- A driver never sees a price. Cargo value is shipper commercial information, and
-- a driver's compensation is not the shipper's quote.
select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A
select assert_equals(
  (select count(*) from public.quotes),
  0, 'a driver can never read any quote');
select act_as_reset();

-- Even the owning shipper cannot amend their own quote: immutable by grant and
-- again by trigger (SECURITY.md §5).
select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A
select assert_equals(
  (select count(*) from public.quotes where id = 'eeeeeeee-0000-4000-8000-000000000001'),
  1, 'shipper A CAN read their own quote');
select assert_raises(
  $$update public.quotes set price_baisa = 1
     where id = 'eeeeeeee-0000-4000-8000-000000000001'$$,
  'shipper A cannot rewrite their own price either');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 6. reference data is read-only
-- ════════════════════════════════════════════════════════════════════════════

select act_as('33333333-3333-4333-8333-333333333333');
select assert_raises(
  $$update public.truck_types set capacity_kg = 999999 where code = '10t'$$,
  'a driver cannot inflate a truck type''s capacity');
select assert_raises(
  $$insert into public.cities (name_en, name_ar, country) values ('Fakeville', 'x', 'OM')$$,
  'a driver cannot add a city');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 7. privileged functions are not client-callable
-- ════════════════════════════════════════════════════════════════════════════

select act_as('33333333-3333-4333-8333-333333333333');
select assert_raises(
  $$select public.create_offer('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333')$$,
  'create_offer is not callable by a client');
select assert_raises(
  $$select public.check_rate_limit('x', 1, interval '1 hour')$$,
  'check_rate_limit is not callable by a client');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 8. hostile text is rejected server-side
-- ════════════════════════════════════════════════════════════════════════════

select act_as('11111111-1111-4111-8111-111111111111');
select assert_raises(
  format(
    $$select public.post_load(
        (select id from public.cities where name_en = 'Muscat'),
        (select id from public.cities where name_en = 'Sohar'),
        current_date + 1, current_date + 2, %L)$$,
    'furniture' || chr(8237) || 'spoofed'),
  'a bidi override in a goods description is rejected');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 9. ops dispatch is closed to everyone who is not an appointed dispatcher
--
-- These functions read across tenants by design — that is what dispatch is. So
-- the only thing standing between a signed-up driver and every shipper's cargo
-- is `private.require_ops()`. It gets the most assertions in this file.
-- ════════════════════════════════════════════════════════════════════════════

-- A plain shipper.
select act_as('11111111-1111-4111-8111-111111111111');
select assert_raises($$select * from public.ops_queue()$$,
  'a shipper cannot read the dispatch queue');
select assert_raises(
  $$select * from public.ops_candidates('aaaaaaaa-0000-4000-8000-000000000001')$$,
  'a shipper cannot list candidate drivers');
select assert_raises(
  $$select public.ops_send_offer('aaaaaaaa-0000-4000-8000-000000000001',
                                 '33333333-3333-4333-8333-333333333333')$$,
  'a shipper cannot send an offer');
select assert_raises(
  $$select public.ops_mark_finding_truck('aaaaaaaa-0000-4000-8000-000000000001')$$,
  'a shipper cannot move a load to finding_truck');
select act_as_reset();

-- A driver. This is the dangerous actor: dispatch reads are exactly the load
-- board that was deliberately removed from the product.
select act_as('33333333-3333-4333-8333-333333333333');
select assert_raises($$select * from public.ops_queue()$$,
  'a driver cannot read the dispatch queue — that would be the load board again');
select assert_raises(
  $$select * from public.ops_candidates('aaaaaaaa-0000-4000-8000-000000000001')$$,
  'a driver cannot enumerate other drivers'' declared routes');
select assert_raises(
  $$select public.ops_send_offer('aaaaaaaa-0000-4000-8000-000000000001',
                                 '33333333-3333-4333-8333-333333333333')$$,
  'a driver cannot mint themselves an offer');
select act_as_reset();

-- The membership table itself.
select act_as('33333333-3333-4333-8333-333333333333');
select assert_raises($$select * from private.ops_users$$,
  'the ops allow-list is not readable by a client');
select assert_raises(
  $$insert into private.ops_users (profile_id)
    values ('33333333-3333-4333-8333-333333333333')$$,
  'a driver cannot appoint themselves as a dispatcher');
select act_as_reset();

-- `create_offer` must stay unreachable even now that a wrapper exists.
select act_as('33333333-3333-4333-8333-333333333333');
select assert_raises(
  $$select public.create_offer('aaaaaaaa-0000-4000-8000-000000000001',
                               '33333333-3333-4333-8333-333333333333')$$,
  'create_offer is still not callable directly by a client');
select act_as_reset();

-- ── and it works for an appointed dispatcher ────────────────────────────────
-- A guard that denies everyone is indistinguishable from a broken function.

insert into private.ops_users (profile_id, note)
values ('22222222-2222-4222-8222-222222222222', 'test dispatcher');

select act_as('22222222-2222-4222-8222-222222222222');

select assert_equals(
  (select count(*) from public.ops_queue()
    where load_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1, 'a dispatcher sees the open load in the queue');

select assert_equals(
  (select count(*) from public.ops_candidates('aaaaaaaa-0000-4000-8000-000000000001')
    where driver_id = '33333333-3333-4333-8333-333333333333'),
  1, 'a dispatcher sees driver A as a candidate for the matching leg');

-- Every assertion about the offer is made through an ACTOR, never as the table
-- owner.
--
-- `offers` carries `force row level security` and its policies are written
-- `for select to authenticated`, so the `postgres` role matches no policy at all
-- and cannot observe the row either — an owner-level count is 0 whether or not the
-- offer exists, which makes it useless as ground truth. Driver A is the actor the
-- product says should see this offer, so driver A is who we ask.

-- Before: driver A has nothing.
select act_as('33333333-3333-4333-8333-333333333333');
select assert_equals(
  (select count(*) from public.offers
    where load_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0, 'driver A has no offer before dispatch');
select assert_equals(
  (select count(*) from public.loads
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0, 'and cannot see the cargo before dispatch');
select act_as_reset();

-- Dispatch.
select act_as('22222222-2222-4222-8222-222222222222');
do $$
declare v_offer uuid;
begin
  v_offer := public.ops_send_offer(
    'aaaaaaaa-0000-4000-8000-000000000001',
    '33333333-3333-4333-8333-333333333333',
    'bbbbbbbb-0000-4000-8000-000000000001');
  if v_offer is null then
    raise exception 'FAIL: ops_send_offer returned null';
  end if;
  raise notice 'pass: a dispatcher can send an offer';
end $$;
select act_as_reset();

-- After: the offer exists, and the offer is what grants sight of the cargo.
select act_as('33333333-3333-4333-8333-333333333333');
select assert_equals(
  (select count(*) from public.offers
    where load_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and driver_id = '33333333-3333-4333-8333-333333333333'
      and status = 'pending'),
  1, 'driver A can now read the pending offer addressed to them');
select assert_equals(
  (select count(*) from public.loads
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1, 'a driver WITH an offer can now read that one load');
select act_as_reset();

-- Driver B, never offered anything, still sees nothing — neither the offer nor
-- the cargo. Both tables, because `loads` and `offers` are guarded by separate
-- policies and one could open without the other.
select act_as('44444444-4444-4444-8444-444444444444');
select assert_equals(
  (select count(*) from public.offers
    where load_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0, 'an offer to driver A is invisible to driver B');
select assert_equals(
  (select count(*) from public.loads
    where id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0, 'and does not expose the cargo to driver B either');
select act_as_reset();

-- The shipper who owns the load can see that an offer went out.
select act_as('11111111-1111-4111-8111-111111111111');
select assert_equals(
  (select count(*) from public.offers
    where load_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1, 'the owning shipper can see the offer on their own load');
select assert_equals(
  (select count(*) from public.loads
    where id = 'aaaaaaaa-0000-4000-8000-000000000001' and status = 'matched'),
  1, 'sending an offer advances the load to matched');
select act_as_reset();

-- And the dispatcher still cannot read offers off the table, which is the point:
-- ops sees across tenants only through the four audited definer functions.
select act_as('22222222-2222-4222-8222-222222222222');
select assert_equals(
  (select count(*) from public.offers
    where load_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  0, 'a dispatcher reads offers only through ops_queue, never off the table');
select act_as_reset();

-- A dispatcher cannot staple one driver's leg to another driver's offer.
select act_as('22222222-2222-4222-8222-222222222222');
select assert_raises(
  $$select public.ops_send_offer('aaaaaaaa-0000-4000-8000-000000000001',
                                 '44444444-4444-4444-8444-444444444444',
                                 'bbbbbbbb-0000-4000-8000-000000000001')$$,
  'an offer cannot cite a leg belonging to a different driver');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 10. trip_truck — a shipper may see the truck carrying their cargo, and only
--     that one
--
-- `public.trucks` is owner-only on purpose: a readable trucks table leaks fleet
-- composition. `trip_truck()` is the single hole in that wall, so it gets the
-- same treatment as trip_counterpart.
-- ════════════════════════════════════════════════════════════════════════════

-- Establish a trip: driver A accepts the offer sent during section 9.
select act_as('33333333-3333-4333-8333-333333333333');
do $$
declare v_offer uuid; v_trip uuid;
begin
  select o.id into v_offer from public.offers o
  where o.load_id = 'aaaaaaaa-0000-4000-8000-000000000001'
    and o.driver_id = '33333333-3333-4333-8333-333333333333';

  v_trip := public.respond_to_offer(v_offer, true);
  if v_trip is null then
    raise exception 'FAIL: accepting the offer produced no trip';
  end if;
  raise notice 'pass: driver A accepted and a trip exists';
end $$;
select act_as_reset();

-- The truck is unreadable off the table by anyone but its owner...
select act_as('11111111-1111-4111-8111-111111111111');  -- shipper A
select assert_equals(
  (select count(*) from public.trucks
    where id = 'cccccccc-0000-4000-8000-000000000001'),
  0, 'a shipper cannot read the trucks table even for their own trip');
select act_as_reset();

-- ...but the shipper on the trip can see it through the function.
select act_as('11111111-1111-4111-8111-111111111111');
select assert_equals(
  (select count(*) from public.trip_truck(
    (select t.id from public.trips t
      where t.load_id = 'aaaaaaaa-0000-4000-8000-000000000001'))),
  1, 'the shipper on a trip can see the truck via trip_truck');
select act_as_reset();

-- Driver B, on no trip, cannot.
select act_as('44444444-4444-4444-8444-444444444444');
select assert_equals(
  (select count(*) from public.trip_truck(
    (select t.id from public.trips t
      where t.load_id = 'aaaaaaaa-0000-4000-8000-000000000001'))),
  0, 'a driver not on the trip gets nothing from trip_truck');
select act_as_reset();

-- And the shipper can see the driver, which is the other half of Principle #4.
select act_as('11111111-1111-4111-8111-111111111111');
select assert_equals(
  (select count(*) from public.trip_counterpart(
    (select t.id from public.trips t
      where t.load_id = 'aaaaaaaa-0000-4000-8000-000000000001'))),
  1, 'the shipper can see who is carrying their cargo');
select act_as_reset();

-- A shipper follows the trail but never writes it.
select act_as('11111111-1111-4111-8111-111111111111');
select assert_raises(
  $$insert into public.trip_events (trip_id, type)
    select t.id, 'delivered' from public.trips t
    where t.load_id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  'a shipper cannot author a trip event');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 11. tiered candidates, the offer lifecycle, and auto-dispatch (0012–0014)
--
-- The reach widened here: a dispatcher can now offer a load to a driver who
-- declared nothing, and `post_load` sends offers with no human in the loop. Both
-- are new ways for cargo to reach a driver, so both need the same proof as
-- everything above — that nothing leaked sideways while the reach grew.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function assert_sqlstate(p_sql text, p_state text, p_what text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then
      raise notice 'pass: % (%)', p_what, sqlstate;
      return;
    end if;
    raise exception 'FAIL: % — expected SQLSTATE %, got % (%)', p_what, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % — statement succeeded but should have been denied', p_what;
end $$;

create or replace function tests_seed_dispatch() returns void
language plpgsql as $$
declare
  v_shipper_a uuid := '11111111-1111-4111-8111-111111111111';
  v_driver_a  uuid := '33333333-3333-4333-8333-333333333333';
  v_driver_b  uuid := '44444444-4444-4444-8444-444444444444';
  v_driver_c  uuid := '55555555-5555-4555-8555-555555555555';
  v_muscat    bigint;
  v_salalah   bigint;
  v_seeb      bigint;
  v_taqah     bigint;
begin
  insert into auth.users (id, email) values (v_driver_c, 'driver-c@test.local')
  on conflict (id) do nothing;
  insert into public.profiles (id, role, full_name) values (v_driver_c, 'driver', 'Driver C')
  on conflict (id) do nothing;

  select id into v_muscat  from public.cities where name_en = 'Muscat';
  select id into v_salalah from public.cities where name_en = 'Salalah';
  -- Same corridors as Muscat and Salalah, different cities: exactly what tier 3
  -- is supposed to find and tiers 1 and 2 are supposed to miss.
  select id into v_seeb  from public.cities where name_en = 'Seeb';
  select id into v_taqah from public.cities where name_en = 'Taqah';

  -- A SECOND truck for driver A. The old ops_candidates joined trucks on
  -- owner_id, so this alone produced a duplicate candidate row.
  insert into public.trucks (id, owner_id, truck_type, plate, capacity_kg) values
    ('cccccccc-0000-4000-8000-000000000002', v_driver_a, '10t', 'A-5678', 10000),
    ('cccccccc-0000-4000-8000-000000000003', v_driver_b, '10t', 'B-1111', 10000),
    ('cccccccc-0000-4000-8000-000000000004', v_driver_c, '10t', 'C-1111', 10000)
  on conflict (id) do nothing;

  -- Give driver A's original truck a capacity too, so the capacity assertion is
  -- testing the filter rather than a NULL.
  update public.trucks set capacity_kg = 10000
   where id = 'cccccccc-0000-4000-8000-000000000001';

  -- Tier 1: driver A, empty, on the route.
  insert into public.legs (id, driver_id, origin_city, dest_city, depart_from, depart_to, is_empty)
  values ('bbbbbbbb-0000-4000-8000-000000000010', v_driver_a, v_muscat, v_salalah,
          current_date + 10, current_date + 12, true)
  on conflict (id) do nothing;

  -- Tier 2: driver B, part-loaded, same route.
  insert into public.legs (id, driver_id, origin_city, dest_city, depart_from, depart_to, is_empty)
  values ('bbbbbbbb-0000-4000-8000-000000000011', v_driver_b, v_muscat, v_salalah,
          current_date + 10, current_date + 12, false)
  on conflict (id) do nothing;

  -- Tier 3: driver C ran the corridor once, on different cities, and closed it.
  insert into public.legs (id, driver_id, origin_city, dest_city, depart_from, depart_to, is_empty, status)
  values ('bbbbbbbb-0000-4000-8000-000000000012', v_driver_c, v_seeb, v_taqah,
          current_date - 30, current_date - 28, true, 'closed')
  on conflict (id) do nothing;

  -- The load every assertion below is about. Truck type NULL = "advise me".
  insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to, goods_description)
  values ('aaaaaaaa-0000-4000-8000-000000000002', v_shipper_a, v_muscat, v_salalah,
          current_date + 10, current_date + 12, 'B cargo — also confidential')
  on conflict (id) do nothing;

  -- A heavier load than anyone's truck, for the capacity filter.
  insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                            goods_description, weight_kg, truck_type_code)
  values ('aaaaaaaa-0000-4000-8000-000000000003', v_shipper_a, v_muscat, v_salalah,
          current_date + 10, current_date + 12, 'Too heavy for any of them', 12000, '10t')
  on conflict (id) do nothing;
end $$;

select tests_seed_dispatch();

-- ─── the new owned table ────────────────────────────────────────────────────

select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A
select assert_raises(
  $$select count(*) from private.dispatch_log$$,
  'the dispatch log is not readable by a client');
select assert_raises(
  $$insert into private.dispatch_log (load_id, candidates, offers_sent)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 0, 0)$$,
  'the dispatch log is not writable by a client');
select act_as_reset();

-- ─── offers.source is withheld, but the rest of the row is not ─────────────
-- Proves the grant NARROWED rather than closed: a column-level grant that
-- accidentally revoked everything would pass the first assertion and fail the
-- second, and the driver's offers list would silently empty.

select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A
select assert_raises(
  $$select source from public.offers$$,
  'a driver cannot read how an offer was minted');
select assert_equals(
  (select count(*) from public.offers),
  1, 'but can still read the offer addressed to them');
select act_as_reset();

-- ─── tiers ──────────────────────────────────────────────────────────────────
-- Shipper B was appointed a dispatcher earlier in this file.

select act_as('22222222-2222-4222-8222-222222222222');  -- the dispatcher

-- The duplicate-row regression: driver A owns two trucks.
select assert_equals(
  (select count(*) from public.ops_candidates('aaaaaaaa-0000-4000-8000-000000000002')
    where driver_id = '33333333-3333-4333-8333-333333333333'),
  1, 'a driver with two trucks is one candidate, not two');

select assert_equals(
  (select tier from public.ops_candidates('aaaaaaaa-0000-4000-8000-000000000002')
    where driver_id = '33333333-3333-4333-8333-333333333333'),
  1, 'an empty leg on the route is tier 1');

select assert_equals(
  (select tier from public.ops_candidates('aaaaaaaa-0000-4000-8000-000000000002')
    where driver_id = '44444444-4444-4444-8444-444444444444'),
  2, 'a part-loaded leg on the route is tier 2');

select assert_equals(
  (select tier from public.ops_candidates('aaaaaaaa-0000-4000-8000-000000000002')
    where driver_id = '55555555-5555-4555-8555-555555555555'),
  3, 'a driver who has only run the corridor is tier 3');

-- Tier 3 declared nothing, so it must claim nothing.
select assert_equals(
  (select count(*) from public.ops_candidates('aaaaaaaa-0000-4000-8000-000000000002')
    where driver_id = '55555555-5555-4555-8555-555555555555'
      and leg_id is null and last_run_at is not null),
  1, 'a corridor-history candidate carries no leg and a last-run date');

-- A driver at two tiers is a dispatcher who cannot tell which offer they are
-- sending. Driver A qualifies for both tier 1 and corridor history.
select assert_equals(
  (select count(*) from (
     select driver_id from public.ops_candidates('aaaaaaaa-0000-4000-8000-000000000002')
     group by driver_id having count(distinct tier) > 1) d),
  0, 'no driver appears at more than one tier');

-- The filter ops_candidates never had. Every truck here is 10 t.
select assert_equals(
  (select count(*) from public.ops_candidates('aaaaaaaa-0000-4000-8000-000000000003')
    where driver_id = '33333333-3333-4333-8333-333333333333'),
  0, 'a load heavier than the truck produces no candidate');

select act_as_reset();

-- A city with no corridor must match nothing, rather than matching every other
-- city with no corridor. Rolled back with the transaction.
update public.cities set corridor = null where name_en = 'Muscat';
select act_as('22222222-2222-4222-8222-222222222222');
select assert_equals(
  (select count(*) from public.ops_candidates('aaaaaaaa-0000-4000-8000-000000000002')
    where tier = 3),
  0, 'a NULL corridor matches nobody rather than everybody');
select act_as_reset();
update public.cities set corridor = 'Muscat governorate' where name_en = 'Muscat';

-- ─── the shared matcher is not reachable ────────────────────────────────────
-- `private.candidates_for` has no ownership check. It is the load board with the
-- guard removed, and no client role may reach it.

select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A
select assert_raises(
  $$select count(*) from private.candidates_for('aaaaaaaa-0000-4000-8000-000000000002')$$,
  'a driver cannot call the unguarded matcher');
select act_as_reset();

select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A, the owner
select assert_raises(
  $$select count(*) from private.candidates_for('aaaaaaaa-0000-4000-8000-000000000002')$$,
  'not even the load''s own shipper can call it');
select act_as_reset();

-- ─── decline no longer dead-ends the load ───────────────────────────────────

select act_as('22222222-2222-4222-8222-222222222222');  -- the dispatcher
select assert_equals(
  (select count(*) from (select public.ops_send_offer(
     'aaaaaaaa-0000-4000-8000-000000000002',
     '33333333-3333-4333-8333-333333333333',
     'bbbbbbbb-0000-4000-8000-000000000010')) x),
  1, 'dispatcher offers the load to driver A');
select assert_equals(
  (select count(*) from (select public.ops_send_offer(
     'aaaaaaaa-0000-4000-8000-000000000002',
     '44444444-4444-4444-8444-444444444444',
     'bbbbbbbb-0000-4000-8000-000000000011')) x),
  1, 'and to driver B');
select act_as_reset();

select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A declines
select assert_equals(
  (select count(*) from (select public.respond_to_offer(
     (select id from public.offers
       where load_id = 'aaaaaaaa-0000-4000-8000-000000000002'
         and driver_id = '33333333-3333-4333-8333-333333333333'), false)) x),
  1, 'driver A declines');
select act_as_reset();

select assert_equals(
  (select count(*) from public.loads
    where id = 'aaaaaaaa-0000-4000-8000-000000000002' and status = 'matched'),
  1, 'one decline leaves the load matched — driver B is still live');

select act_as('44444444-4444-4444-8444-444444444444');  -- Driver B declines too
select assert_equals(
  (select count(*) from (select public.respond_to_offer(
     (select id from public.offers
       where load_id = 'aaaaaaaa-0000-4000-8000-000000000002'
         and driver_id = '44444444-4444-4444-8444-444444444444'), false)) x),
  1, 'driver B declines');
select act_as_reset();

-- The dead end, closed. Before 0013 this load was stranded in 'matched' with no
-- transition back and no dispatcher action possible.
select assert_equals(
  (select count(*) from public.loads
    where id = 'aaaaaaaa-0000-4000-8000-000000000002' and status = 'finding_truck'),
  1, 'the last decline returns the load to finding_truck');

select act_as('22222222-2222-4222-8222-222222222222');
select assert_equals(
  (select count(*) from public.ops_queue()
    where load_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  1, 'and it is back in the dispatcher''s queue');
select act_as_reset();

-- ─── an automated path may not talk over a decline ──────────────────────────

select assert_equals(
  (select count(*) from public.create_offer(
     'aaaaaaaa-0000-4000-8000-000000000002',
     '33333333-3333-4333-8333-333333333333',
     null, 'auto', false)),
  1, 'auto re-offer returns the existing row');
select assert_equals(
  (select count(*) from public.offers
    where load_id = 'aaaaaaaa-0000-4000-8000-000000000002'
      and driver_id = '33333333-3333-4333-8333-333333333333'
      and status = 'declined'),
  1, 'and leaves the decline standing');

-- The dispatcher's override, which is the whole reason allow_resend exists.
select act_as('22222222-2222-4222-8222-222222222222');
select assert_equals(
  (select count(*) from (select public.ops_send_offer(
     'aaaaaaaa-0000-4000-8000-000000000002',
     '33333333-3333-4333-8333-333333333333',
     'bbbbbbbb-0000-4000-8000-000000000010')) x),
  1, 'a dispatcher may deliberately ask again');
select act_as_reset();

select assert_equals(
  (select count(*) from public.offers
    where load_id = 'aaaaaaaa-0000-4000-8000-000000000002'
      and driver_id = '33333333-3333-4333-8333-333333333333'
      and status = 'pending'),
  1, 'and that revives the offer');

-- ─── marking no-match from a stuck state ────────────────────────────────────

select act_as('22222222-2222-4222-8222-222222222222');
select assert_equals(
  (select count(*) from (select public.ops_mark_finding_truck(
     'aaaaaaaa-0000-4000-8000-000000000002')) x),
  1, 'a dispatcher can mark a matched load as finding_truck');
-- Idempotent: a double tap is not an error.
select assert_equals(
  (select count(*) from (select public.ops_mark_finding_truck(
     'aaaaaaaa-0000-4000-8000-000000000002')) x),
  1, 'and marking it twice does not raise');
select act_as_reset();

select assert_equals(
  (select count(*) from public.offers
    where load_id = 'aaaaaaaa-0000-4000-8000-000000000002' and status = 'pending'),
  0, 'marking no-match takes back every outstanding offer');

-- ─── two drivers accepting the same load ────────────────────────────────────
-- The load lock makes the concurrent case equivalent to this sequential one.

select act_as('22222222-2222-4222-8222-222222222222');
select public.ops_send_offer('aaaaaaaa-0000-4000-8000-000000000002',
  '33333333-3333-4333-8333-333333333333', 'bbbbbbbb-0000-4000-8000-000000000010');
select public.ops_send_offer('aaaaaaaa-0000-4000-8000-000000000002',
  '44444444-4444-4444-8444-444444444444', 'bbbbbbbb-0000-4000-8000-000000000011');
select act_as_reset();

select act_as('33333333-3333-4333-8333-333333333333');
select assert_equals(
  (select count(*) from (select public.respond_to_offer(
     (select id from public.offers
       where load_id = 'aaaaaaaa-0000-4000-8000-000000000002'
         and driver_id = '33333333-3333-4333-8333-333333333333'), true)) x),
  1, 'driver A accepts first and gets the trip');
select act_as_reset();

-- 23514 is check_violation — a DOMAIN error the driver screen can apologise for.
-- 23505 would be the raw trips_load_id_key unique violation, which is the bug:
-- asserting only "it raised" would pass on that.
select act_as('44444444-4444-4444-8444-444444444444');
select assert_sqlstate(
  $$select public.respond_to_offer(
      (select id from public.offers
        where load_id = 'aaaaaaaa-0000-4000-8000-000000000002'
          and driver_id = '44444444-4444-4444-8444-444444444444'), true)$$,
  '23514', 'the second driver to accept gets a domain error, not a constraint');
select act_as_reset();

select assert_equals(
  (select count(*) from public.trips
    where load_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
  1, 'and exactly one trip exists for the load');

-- ─── auto-dispatch ──────────────────────────────────────────────────────────
-- A shipper posts, and a driver holds an offer, with no dispatcher acting.
--
-- Driver C gets a fresh empty leg here: driver A's was consumed by the accept
-- above, which set it to 'matched'. That is correct behaviour — a leg that is
-- carrying something is not an empty leg — and it is why this needs its own.

insert into public.legs (id, driver_id, origin_city, dest_city, depart_from, depart_to, is_empty)
values ('bbbbbbbb-0000-4000-8000-000000000013', '55555555-5555-4555-8555-555555555555',
        (select id from public.cities where name_en = 'Muscat'),
        (select id from public.cities where name_en = 'Salalah'),
        current_date + 10, current_date + 12, true)
on conflict (id) do nothing;

select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A
select public.post_load(
  (select id from public.cities where name_en = 'Muscat'),
  (select id from public.cities where name_en = 'Salalah'),
  current_date + 10, current_date + 12, 'Auto-dispatched cargo');
select act_as_reset();

select assert_equals(
  (select count(*) from public.offers o
    join public.loads l on l.id = o.load_id
   where l.goods_description = 'Auto-dispatched cargo'
     and o.driver_id = '55555555-5555-4555-8555-555555555555'
     and o.status = 'pending'
     and o.source = 'auto'),
  1, 'posting a load auto-offers it to the empty-leg driver');

-- Tier 2 is not "unambiguous". A part-loaded truck is a judgement call, and
-- judgements stay with the dispatcher.
select assert_equals(
  (select count(*) from public.offers o
    join public.loads l on l.id = o.load_id
   where l.goods_description = 'Auto-dispatched cargo'
     and o.driver_id = '44444444-4444-4444-8444-444444444444'),
  0, 'and never to a part-loaded leg');

select assert_equals(
  (select count(*) from private.dispatch_log dl
    join public.loads l on l.id = dl.load_id
   where l.goods_description = 'Auto-dispatched cargo' and dl.offers_sent = 1),
  1, 'and records what it did');

-- The kill switch.
update private.app_settings set value = 'false'::jsonb where key = 'auto_dispatch_enabled';

select act_as('11111111-1111-4111-8111-111111111111');
select public.post_load(
  (select id from public.cities where name_en = 'Muscat'),
  (select id from public.cities where name_en = 'Salalah'),
  current_date + 10, current_date + 12, 'Cargo posted with dispatch off');
select act_as_reset();

select assert_equals(
  (select count(*) from public.offers o
    join public.loads l on l.id = o.load_id
   where l.goods_description = 'Cargo posted with dispatch off'),
  0, 'the kill switch stops offers entirely');
select assert_equals(
  (select count(*) from private.dispatch_log dl
    join public.loads l on l.id = dl.load_id
   where l.goods_description = 'Cargo posted with dispatch off' and dl.skipped = 'disabled'),
  1, 'and says so in the log rather than looking like a normal quiet run');

update private.app_settings set value = 'true'::jsonb where key = 'auto_dispatch_enabled';

-- Auto-dispatch must not widen anyone's reads. Driver C was not offered.
select act_as('44444444-4444-4444-8444-444444444444');
select assert_equals(
  (select count(*) from public.loads where goods_description = 'Auto-dispatched cargo'),
  0, 'a driver who was not offered still cannot see the cargo');
select act_as_reset();

do $$ begin raise notice 'ALL TENANT ISOLATION ASSERTIONS HELD'; end $$;

rollback;
