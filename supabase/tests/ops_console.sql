-- Truckkoo — ops console suite. Covers migrations 0015 onward.
--
-- Run against a LOCAL database only (`supabase db reset` then psql -f this).
-- Never against production: it creates users and rows.
--
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ops_console.sql
--
-- Exit code 0 = all assertions held.
--
-- WHAT THIS FILE IS FOR
--
-- The ops console reads across every tenant by design. The only thing standing
-- between "the dispatcher can see everything" and "any signed-up user can see
-- everything" is that each function calls `private.require_ops()` on its first
-- line. That is one line per function, in a file of thousands, and it is exactly
-- the kind of thing that gets omitted once during a refactor and noticed never —
-- because the function still works perfectly for the person testing it, who is
-- a dispatcher.
--
-- So every ops RPC gets the same four assertions:
--
--   1. an anonymous caller is refused
--   2. a shipper is refused
--   3. a driver is refused
--   4. an appointed dispatcher succeeds
--
-- And the refusal must be `no_data_found` — "not found", never "forbidden".
-- A 403 confirms the row exists (SECURITY.md §3).

begin;

set local client_min_messages to notice;

-- ─── fixtures ───────────────────────────────────────────────────────────────

create or replace function ops_tests_seed() returns void
language plpgsql as $$
declare
  v_shipper uuid := '11111111-0000-4000-8000-00000000aaaa';
  v_driver  uuid := '22222222-0000-4000-8000-00000000bbbb';
  v_ops     uuid := '33333333-0000-4000-8000-00000000cccc';
  v_muscat  bigint;
  v_salalah bigint;
  v_load    uuid := 'a0a0a0a0-0000-4000-8000-000000000001';
  v_trip    uuid := 'b0b0b0b0-0000-4000-8000-000000000001';
  v_truck   uuid := 'c0c0c0c0-0000-4000-8000-000000000001';
  v_leg     uuid := 'd0d0d0d0-0000-4000-8000-000000000001';
begin
  insert into auth.users (id, email) values
    (v_shipper, 'ops-shipper@test.local'),
    (v_driver,  'ops-driver@test.local'),
    (v_ops,     'ops-dispatcher@test.local')
  on conflict (id) do nothing;

  insert into public.profiles (id, role, full_name, phone) values
    (v_shipper, 'shipper', 'Console Shipper', '+968 9000 0001'),
    (v_driver,  'driver',  'Console Driver',  '+968 9000 0002'),
    -- The dispatcher holds an ordinary role. Ops membership is additive and
    -- lives in private.ops_users — it is deliberately NOT a profiles.role value.
    (v_ops,     'shipper', 'Console Dispatcher', '+968 9000 0003')
  on conflict (id) do nothing;

  insert into private.ops_users (profile_id, note)
  values (v_ops, 'ops console test')
  on conflict (profile_id) do nothing;

  select id into v_muscat  from public.cities where name_en = 'Muscat';
  select id into v_salalah from public.cities where name_en = 'Salalah';

  insert into public.trucks (id, owner_id, truck_type, plate, capacity_kg)
  values (v_truck, v_driver, '10t', 'CON-1234', 10000)
  on conflict (id) do nothing;

  insert into public.drivers (profile_id, notes)
  values (v_driver, 'internal vetting note — never client readable')
  on conflict (profile_id) do nothing;

  insert into public.legs (id, driver_id, truck_id, origin_city, dest_city, depart_from, depart_to)
  values (v_leg, v_driver, v_truck, v_muscat, v_salalah, current_date + 1, current_date + 3)
  on conflict (id) do nothing;

  insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                            goods_description, weight_kg, status, price_baisa)
  values (v_load, v_shipper, v_muscat, v_salalah, current_date + 1, current_date + 3,
          'Console cargo — dates and pallets', 8000, 'assigned', 150000)
  on conflict (id) do nothing;

  insert into public.offers (load_id, driver_id, leg_id, status, source)
  values (v_load, v_driver, v_leg, 'accepted', 'ops')
  on conflict (load_id, driver_id) do nothing;

  insert into public.trips (id, load_id, driver_id, truck_id, leg_id, status)
  values (v_trip, v_load, v_driver, v_truck, v_leg, 'in_transit')
  on conflict (id) do nothing;

  insert into public.trip_events (trip_id, type, note, photo_path, created_by)
  values (v_trip, 'picked_up', 'Loaded at the yard', v_trip::text || '/pod.jpg', v_driver);

  insert into public.quotes (shipper_id, load_id, origin_city, dest_city,
                             pickup_from, pickup_to, price_baisa, outcome)
  values (v_shipper, v_load, v_muscat, v_salalah,
          current_date + 1, current_date + 3, 150000, 'quoted');

  insert into private.dispatch_log (load_id, candidates, offers_sent, skipped)
  values (v_load, 3, 1, null);

  -- A second load in a status ops_queue() cannot show. The read layer must be
  -- able to reach it; that is half the reason it exists.
  insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                            goods_description, status)
  values ('a0a0a0a0-0000-4000-8000-000000000002', v_shipper, v_muscat, v_salalah,
          current_date + 5, current_date + 6, 'Cancelled cargo', 'cancelled')
  on conflict (id) do nothing;
end $$;

select ops_tests_seed();

-- ─── helpers ────────────────────────────────────────────────────────────────

create or replace function assert_equals(p_actual bigint, p_expected bigint, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % — expected %, got %', p_what, p_expected, p_actual;
  end if;
  raise notice 'pass: %', p_what;
end $$;

create or replace function assert_true(p_actual boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is not true then
    raise exception 'FAIL: % — expected true, got %', p_what, coalesce(p_actual::text, 'null');
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

-- The refusal must be `no_data_found`. A distinct error code — or worse, a
-- permission error naming the table — tells an attacker their guess was right.
create or replace function assert_not_found(p_sql text, p_what text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when no_data_found then
    raise notice 'pass: %', p_what;
    return;
  when others then
    raise exception 'FAIL: % — rejected, but with % (%) rather than no_data_found. '
                    'A distinct error code confirms the resource exists.',
                    p_what, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL: % — statement succeeded but should have been denied', p_what;
end $$;

create or replace function act_as(p_uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function act_as_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function act_as_reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

/*
 * Run the same three refusals against one ops RPC.
 *
 * Anonymous callers are checked with `assert_raises` rather than
 * `assert_not_found`: the `anon` role has no EXECUTE grant at all, so Postgres
 * refuses before `require_ops()` ever runs. That is a stronger control, not a
 * weaker one — but it produces `insufficient_privilege`, not `no_data_found`.
 * Signed-in non-dispatchers are the case that must say "not found", because
 * they are the ones who could otherwise learn that a load exists.
 */
create or replace function assert_ops_only(p_sql text, p_what text)
returns void language plpgsql as $$
begin
  perform act_as_anon();
  perform assert_raises(p_sql, p_what || ' — anonymous is refused');
  perform act_as('11111111-0000-4000-8000-00000000aaaa');
  perform assert_not_found(p_sql, p_what || ' — a shipper is refused');
  perform act_as('22222222-0000-4000-8000-00000000bbbb');
  perform assert_not_found(p_sql, p_what || ' — a driver is refused');
  perform act_as_reset();
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Every read RPC is closed to everyone who is not an appointed dispatcher
-- ════════════════════════════════════════════════════════════════════════════

select assert_ops_only($$select * from public.ops_loads()$$, 'ops_loads');
select assert_ops_only(
  $$select * from public.ops_load('a0a0a0a0-0000-4000-8000-000000000001')$$, 'ops_load');
select assert_ops_only(
  $$select * from public.ops_load_offers('a0a0a0a0-0000-4000-8000-000000000001')$$, 'ops_load_offers');
select assert_ops_only($$select * from public.ops_dispatch_log()$$, 'ops_dispatch_log');
select assert_ops_only(
  $$select * from public.ops_quotes('a0a0a0a0-0000-4000-8000-000000000001')$$, 'ops_quotes');
select assert_ops_only($$select * from public.ops_trips()$$, 'ops_trips');
select assert_ops_only(
  $$select * from public.ops_trip('b0b0b0b0-0000-4000-8000-000000000001')$$, 'ops_trip');
select assert_ops_only(
  $$select * from public.ops_trip_events('b0b0b0b0-0000-4000-8000-000000000001')$$, 'ops_trip_events');
select assert_ops_only($$select * from public.ops_accounts()$$, 'ops_accounts');
select assert_ops_only(
  $$select * from public.ops_account('22222222-0000-4000-8000-00000000bbbb')$$, 'ops_account');
select assert_ops_only(
  $$select * from public.ops_account_trucks('22222222-0000-4000-8000-00000000bbbb')$$, 'ops_account_trucks');
select assert_ops_only(
  $$select * from public.ops_account_legs('22222222-0000-4000-8000-00000000bbbb')$$, 'ops_account_legs');
select assert_ops_only(
  $$select * from public.ops_account_loads('11111111-0000-4000-8000-00000000aaaa')$$, 'ops_account_loads');
select assert_ops_only($$select * from public.ops_legs()$$, 'ops_legs');
select assert_ops_only($$select * from public.ops_stats()$$, 'ops_stats');
select assert_ops_only($$select * from public.ops_audit_log()$$, 'ops_audit_log');

-- The driver is the subject of most of those rows. Being the subject of a record
-- is not a reason to be able to read the operator's view of it — `ops_account`
-- returns `drivers.notes`, which is internal vetting text.
select act_as('22222222-0000-4000-8000-00000000bbbb');
select assert_not_found(
  $$select * from public.ops_account('22222222-0000-4000-8000-00000000bbbb')$$,
  'a driver cannot read the ops view of their own account');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. The private surfaces stay private
-- ════════════════════════════════════════════════════════════════════════════

select act_as('22222222-0000-4000-8000-00000000bbbb');

select assert_raises($$select * from private.ops_audit$$,
  'the audit log is not directly readable by a client');
select assert_raises(
  $$insert into private.ops_audit (actor_id, action, target_kind)
    values ('22222222-0000-4000-8000-00000000bbbb', 'forged', 'load')$$,
  'a client cannot forge an audit row');
select assert_raises(
  $$select private.log_ops('forged', 'load', 'x')$$,
  'the audit writer is ungranted — only definer functions call it');
select assert_raises($$select * from private.dispatch_log$$,
  'the dispatch log is not directly readable by a client');
select assert_raises(
  $$select * from private.candidates_for('a0a0a0a0-0000-4000-8000-000000000001')$$,
  'candidates_for is still the load board with the guard removed, and still ungranted');

select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. The dispatcher can, and gets what the console actually needs
-- ════════════════════════════════════════════════════════════════════════════

select act_as('33333333-0000-4000-8000-00000000cccc');

-- The headline fix: a load outside posted|finding_truck|matched is reachable.
-- `ops_queue()` cannot see this row, which is why `ops/[id].tsx` could never
-- open it.
select assert_equals(
  (select count(*) from public.ops_queue() q
    where q.load_id = 'a0a0a0a0-0000-4000-8000-000000000002'),
  0, 'ops_queue still cannot see a cancelled load — unchanged, as intended');
select assert_equals(
  (select count(*) from public.ops_load('a0a0a0a0-0000-4000-8000-000000000002')),
  1, 'ops_load reaches a load the queue cannot show');
select assert_equals(
  (select count(*) from public.ops_loads(p_status => array['cancelled']::public.load_status[])),
  1, 'ops_loads filters by a status the queue never returns');

-- Identity: the deliberate widening. Without it the dispatcher cannot place a
-- call, which is most of what the detail screen is for.
select assert_true(
  (select l.shipper_name = 'Console Shipper' and l.shipper_phone = '+968 9000 0001'
     from public.ops_load('a0a0a0a0-0000-4000-8000-000000000001') l),
  'ops_load carries the shipper''s name and phone');

select assert_true(
  (select a.notes is not null
     from public.ops_account('22222222-0000-4000-8000-00000000bbbb') a),
  'ops_account carries the internal vetting notes');
-- ...and the list does not, so a screenshot of the accounts table cannot leak it.
select assert_equals(
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ops_accounts'
      and column_name = 'notes'),
  0, 'the accounts LIST does not return vetting notes');

-- Search: the two things a dispatcher actually types.
select assert_equals(
  (select count(*) from public.ops_loads(p_search => 'pallets')),
  1, 'ops_loads searches the goods description');
select assert_equals(
  (select count(*) from public.ops_loads(p_search => 'NO. A0A0A0A0')),
  2, 'ops_loads finds a load by the reference shown on screen');
select assert_equals(
  (select count(*) from public.ops_loads(p_search => 'a0a0a0a0')),
  2, 'and by a bare reference, however it was pasted');

-- Pagination is bounded. An unbounded limit from a client is a denial of
-- service against our own database.
select assert_equals(
  (select count(*) from public.ops_loads(p_limit => 100000)),
  2, 'ops_loads clamps an absurd page size rather than obeying it');
select assert_equals(
  (select count(*) from public.ops_loads(p_limit => 0)),
  1, 'ops_loads clamps a zero page size to one row rather than returning none');
select assert_true(
  (select l.total_count = 2 from public.ops_loads(p_limit => 1) l),
  'total_count reports the unpaged total so the UI need not ask twice');

-- Trips: previously invisible in every ops surface.
select assert_equals(
  (select count(*) from public.ops_trips()), 1, 'ops_trips returns the live trip');
select assert_true(
  (select t.driver_name = 'Console Driver' and t.truck_plate = 'CON-1234'
     from public.ops_trips() t),
  'ops_trips resolves the driver and the truck');
select assert_true(
  (select t.last_event = 'picked_up' from public.ops_trips() t),
  'ops_trips reports the last event, which is how a stale trip gets noticed');
select assert_equals(
  (select count(*) from public.ops_trip_events('b0b0b0b0-0000-4000-8000-000000000001')),
  1, 'ops_trip_events returns the timeline');
select assert_true(
  (select e.photo_path is not null
     from public.ops_trip_events('b0b0b0b0-0000-4000-8000-000000000001') e),
  'ops_trip_events returns the proof-of-delivery object path, never a URL');

-- The dispatch log: written on every post_load since 0014, read by nothing
-- until now. Same failure shape as trips.truck_id in OPEN_ISSUES.
select assert_equals(
  (select count(*) from public.ops_dispatch_log()), 1,
  'ops_dispatch_log surfaces what auto-dispatch did');

select assert_equals(
  (select count(*) from public.ops_quotes('a0a0a0a0-0000-4000-8000-000000000001')),
  1, 'ops_quotes returns the quote history');
-- The rate card itself stays in `private` until 0018 grants it deliberately.
select assert_equals(
  (select count(*) from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ops_quotes'
      and column_name = 'rate_card_id'),
  0, 'ops_quotes says whether a rate matched, not which card it was');

select assert_equals(
  (select count(*) from public.ops_legs()), 1, 'ops_legs returns the supply board');
select assert_equals(
  (select count(*) from public.ops_accounts()), 3, 'ops_accounts lists every account');
select assert_equals(
  (select count(*) from public.ops_accounts(p_role => 'driver')),
  1, 'ops_accounts filters by role');
select assert_equals(
  (select count(*) from public.ops_accounts(p_search => 'Console Driver')),
  1, 'ops_accounts searches by name');

-- The overview. Asserting the shape holds rather than exact counts, which move
-- with the fixtures — except the two that are the console's whole point.
select assert_equals((select s.loads_cancelled from public.ops_stats() s), 1,
  'ops_stats counts cancelled loads');
select assert_equals((select s.trips_in_transit from public.ops_stats() s), 1,
  'ops_stats counts live trips');
select assert_true((select s.auto_dispatch_enabled from public.ops_stats() s),
  'ops_stats reports the auto-dispatch kill switch, which is otherwise invisible');

select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Proof-of-delivery photos — the one new storage policy
-- ════════════════════════════════════════════════════════════════════════════
--
-- Storage cannot go through a definer function: a signed URL is minted by the
-- storage service against storage.objects RLS. So 0015 adds one additive policy
-- scoped to private.is_ops(). Check that it is scoped, and that the bucket did
-- not quietly become public.

select assert_equals(
  (select count(*) from storage.buckets where id = 'pod' and public = true),
  0, 'the pod bucket is still private');

select assert_equals(
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('UPDATE', 'DELETE')),
  0, 'proof of delivery is still append-only — no update or delete policy for anyone, ops included');

select assert_equals(
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'ops reads pod'),
  1, 'the ops read policy exists');

select assert_true(
  (select qual like '%is_ops%' from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'ops reads pod'),
  'and it is scoped to is_ops() rather than to every authenticated user');

-- ════════════════════════════════════════════════════════════════════════════
-- 5. No RLS policy on a public table was loosened for ops
-- ════════════════════════════════════════════════════════════════════════════
--
-- This is the property that makes it safe to give the console more power in
-- 0016-0018: a bug in an ops screen cannot widen what a shipper or driver sees,
-- because ops holds no table-level privilege at all.

select assert_equals(
  (select count(*) from pg_policies
    where schemaname = 'public' and qual like '%is_ops%'),
  0, 'no public table policy references ops membership');

select assert_equals(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'private' and grantee in ('anon', 'authenticated')),
  0, 'no client role holds any grant in the private schema');

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Migration 0016 — the write powers
-- ════════════════════════════════════════════════════════════════════════════
--
-- These are the functions that make the console dangerous. Every one of them
-- gets the ops-only treatment, a reason check, and a check that the audit row
-- was actually written — because an unaudited privileged write is the failure
-- this whole design is arranged to prevent.

-- Fresh fixtures, so the assertions above keep their arrangement.
create or replace function ops_tests_seed_writes() returns void
language plpgsql as $$
declare
  v_shipper uuid := '11111111-0000-4000-8000-00000000aaaa';
  v_driver  uuid := '22222222-0000-4000-8000-00000000bbbb';
  v_muscat  bigint;
  v_sohar   bigint;
begin
  select id into v_muscat from public.cities where name_en = 'Muscat';
  select id into v_sohar  from public.cities where name_en = 'Sohar';

  -- W1: posted, one pending offer on a leg. The transition playground.
  insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                            goods_description, status)
  values ('e0e0e0e0-0000-4000-8000-000000000001', v_shipper, v_muscat, v_sohar,
          current_date + 1, current_date + 3, 'Transition test cargo', 'matched');

  insert into public.legs (id, driver_id, truck_id, origin_city, dest_city, depart_from, depart_to)
  values ('e1e1e1e1-0000-4000-8000-000000000001', v_driver,
          'c0c0c0c0-0000-4000-8000-000000000001', v_muscat, v_sohar,
          current_date + 1, current_date + 3);

  insert into public.offers (id, load_id, driver_id, leg_id, status, source)
  values ('e2e2e2e2-0000-4000-8000-000000000001',
          'e0e0e0e0-0000-4000-8000-000000000001', v_driver,
          'e1e1e1e1-0000-4000-8000-000000000001', 'pending', 'ops');

  -- W2: a second posted load with a pending offer, for the expire path.
  insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                            goods_description, status)
  values ('e0e0e0e0-0000-4000-8000-000000000002', v_shipper, v_muscat, v_sohar,
          current_date + 1, current_date + 3, 'Expire test cargo', 'matched');

  insert into public.offers (id, load_id, driver_id, status, source)
  values ('e2e2e2e2-0000-4000-8000-000000000002',
          'e0e0e0e0-0000-4000-8000-000000000002', v_driver, 'pending', 'ops');

  -- A second driver, so reassignment has somewhere to go.
  insert into auth.users (id, email)
  values ('44444444-0000-4000-8000-00000000dddd', 'ops-driver-2@test.local')
  on conflict (id) do nothing;
  insert into public.profiles (id, role, full_name, phone)
  values ('44444444-0000-4000-8000-00000000dddd', 'driver', 'Second Driver', '+968 9000 0004')
  on conflict (id) do nothing;
  insert into public.trucks (id, owner_id, truck_type, plate, capacity_kg)
  values ('c0c0c0c0-0000-4000-8000-000000000002',
          '44444444-0000-4000-8000-00000000dddd', '10t', 'CON-5678', 10000)
  on conflict (id) do nothing;
end $$;

select ops_tests_seed_writes();

-- ─── 6a. closed to everyone who is not a dispatcher ─────────────────────────

select assert_ops_only(
  $$select public.ops_set_load_status('e0e0e0e0-0000-4000-8000-000000000001',
                                      'cancelled', 'test')$$,
  'ops_set_load_status');
select assert_ops_only(
  $$select public.ops_set_trip_status('b0b0b0b0-0000-4000-8000-000000000001',
                                      'cancelled', 'test')$$,
  'ops_set_trip_status');
select assert_ops_only(
  $$select public.ops_reassign_trip('b0b0b0b0-0000-4000-8000-000000000001',
       '22222222-0000-4000-8000-00000000bbbb', null, 'test')$$,
  'ops_reassign_trip');
select assert_ops_only(
  $$select public.ops_accept_offer_for_driver('e2e2e2e2-0000-4000-8000-000000000001',
                                              'test')$$,
  'ops_accept_offer_for_driver');
select assert_ops_only(
  $$select public.ops_expire_offer('e2e2e2e2-0000-4000-8000-000000000001', 'test')$$,
  'ops_expire_offer');
select assert_ops_only(
  $$select public.ops_set_leg_status('e1e1e1e1-0000-4000-8000-000000000001',
                                     'cancelled', 'test')$$,
  'ops_set_leg_status');
select assert_ops_only(
  $$select public.ops_add_trip_note('b0b0b0b0-0000-4000-8000-000000000001', 'test')$$,
  'ops_add_trip_note');
select assert_ops_only(
  $$select * from public.ops_candidates_tuned('e0e0e0e0-0000-4000-8000-000000000001')$$,
  'ops_candidates_tuned');

-- Nothing above may have taken effect. If a refusal ever half-executes, the
-- guard is in the wrong place.
select assert_equals(
  (select count(*) from public.offers where id = 'e2e2e2e2-0000-4000-8000-000000000001'
     and status = 'pending'),
  1, 'a refused call changed nothing');
select assert_equals(
  (select count(*) from private.ops_audit), 0,
  'and wrote no audit row — a refusal is not an event');

-- ─── 6b. the transition matrix ──────────────────────────────────────────────

select act_as('33333333-0000-4000-8000-00000000cccc');

select assert_raises(
  $$select public.ops_set_load_status('e0e0e0e0-0000-4000-8000-000000000001',
                                      'delivered', 'skipping ahead')$$,
  'a load cannot jump from matched straight to delivered');

select assert_raises(
  $$select public.ops_set_load_status('e0e0e0e0-0000-4000-8000-000000000001',
                                      'assigned', 'no trip exists')$$,
  'a load cannot be assigned with no trip — that is the invariant, not the matrix');

select assert_raises(
  $$select public.ops_set_load_status('a0a0a0a0-0000-4000-8000-000000000002',
                                      'delivered', 'reviving a cancelled load too far')$$,
  'a cancelled load revives only to posted');

select assert_raises(
  $$select public.ops_set_load_status('e0e0e0e0-0000-4000-8000-000000000001',
                                      'matched', 'already there')$$,
  'a no-op transition is an error, not a silent success');

-- A reason is mandatory, and "x" is not a reason.
select assert_raises(
  $$select public.ops_set_load_status('e0e0e0e0-0000-4000-8000-000000000001',
                                      'posted', null)$$,
  'a status change with no reason is refused');
select assert_raises(
  $$select public.ops_set_load_status('e0e0e0e0-0000-4000-8000-000000000001',
                                      'posted', '  ')$$,
  'and whitespace is not a reason');

-- ─── 6c. cancelling a load cascades ─────────────────────────────────────────

select public.ops_set_load_status(
  'e0e0e0e0-0000-4000-8000-000000000001', 'cancelled',
  'Shipper rang to cancel — cargo sold locally');

-- Ground truth is read as superuser, not as the dispatcher. The dispatcher is an
-- ordinary `authenticated` user who happens to be on the ops allow-list, so a
-- direct `select from public.loads` under their session returns nothing at all —
-- which is exactly the isolation this design depends on, and exactly the thing
-- that makes a table read a useless assertion here.
select act_as_reset();

select assert_equals(
  (select count(*) from public.loads
    where id = 'e0e0e0e0-0000-4000-8000-000000000001' and status = 'cancelled'),
  1, 'the load is cancelled');
select assert_equals(
  (select count(*) from public.offers
    where load_id = 'e0e0e0e0-0000-4000-8000-000000000001' and status = 'pending'),
  0, 'and its live offers died with it — a driver must not accept a dead load');

select assert_true(
  (select a.reason like 'Shipper rang to cancel%' and a.before->>'status' = 'matched'
      and a.after->>'status' = 'cancelled'
     from private.ops_audit a where a.action = 'ops_set_load_status'),
  'the audit row carries the before, the after and the reason');
select assert_true(
  (select a.actor_id = '33333333-0000-4000-8000-00000000cccc'
     from private.ops_audit a where a.action = 'ops_set_load_status'),
  'and names the dispatcher who did it, from auth.uid() rather than a parameter');

-- ─── 6d. accepting for a driver who rang in ─────────────────────────────────

select assert_equals(
  (select count(*) from public.trips
    where load_id = 'e0e0e0e0-0000-4000-8000-000000000002'),
  0, 'no trip yet');

select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_accept_offer_for_driver(
  'e2e2e2e2-0000-4000-8000-000000000002',
  'Driver rang from Nizwa, no signal for the app');
select act_as_reset();

select assert_equals(
  (select count(*) from public.trips
    where load_id = 'e0e0e0e0-0000-4000-8000-000000000002' and status = 'assigned'),
  1, 'a trip exists, created through the same body respond_to_offer uses');
select assert_equals(
  (select count(*) from public.loads
    where id = 'e0e0e0e0-0000-4000-8000-000000000002' and status = 'assigned'),
  1, 'and the load followed it');
select assert_equals(
  (select count(*) from public.offers
    where id = 'e2e2e2e2-0000-4000-8000-000000000002' and status = 'accepted'),
  1, 'and the offer is accepted');

-- Stash the generated trip id while we are still superuser. A subselect for it
-- later, under the dispatcher's session, returns nothing: a dispatcher holds no
-- table privilege on public.trips and reaches trips only through ops_trip().
-- That is the isolation working, and it is worth tripping over once here.
select set_config('tests.trip2',
  (select t.id::text from public.trips t
    where t.load_id = 'e0e0e0e0-0000-4000-8000-000000000002'), true);

-- Visible on the trip itself, not only in an audit table nobody opens.
select assert_equals(
  (select count(*) from public.trip_events e
    join public.trips t on t.id = e.trip_id
   where t.load_id = 'e0e0e0e0-0000-4000-8000-000000000002'
     and e.note like 'Accepted by dispatch%'),
  1, 'the trip says the driver never touched a screen');

select act_as('33333333-0000-4000-8000-00000000cccc');
select assert_raises(
  $$select public.ops_accept_offer_for_driver('e2e2e2e2-0000-4000-8000-000000000002',
                                              'again')$$,
  'an already-accepted offer cannot be accepted twice');

-- ─── 6e. reassignment refuses to tell a paperwork lie ───────────────────────

select assert_raises(
  $$select public.ops_reassign_trip('b0b0b0b0-0000-4000-8000-000000000001',
      '11111111-0000-4000-8000-00000000aaaa', null, 'shipper is not a driver')$$,
  'a trip cannot be reassigned to a shipper');

-- c0c0c0c0…0001 belongs to the driver, not to the shipper. Putting one
-- operator's plate on another's trip is a lie with consequences at a checkpoint.
select assert_raises(
  $$select public.ops_reassign_trip('b0b0b0b0-0000-4000-8000-000000000001',
      '11111111-0000-4000-8000-00000000aaaa',
      'c0c0c0c0-0000-4000-8000-000000000001', 'wrong owner')$$,
  'a truck cannot be attached to a driver who does not own it');

-- ─── 6f. expiring an offer returns the load to the dispatcher ───────────────

select public.ops_set_load_status(
  'a0a0a0a0-0000-4000-8000-000000000002', 'posted', 'Shipper re-booked it');

select act_as_reset();
insert into public.offers (id, load_id, driver_id, status, source)
values ('e2e2e2e2-0000-4000-8000-000000000003',
        'a0a0a0a0-0000-4000-8000-000000000002',
        '22222222-0000-4000-8000-00000000bbbb', 'pending', 'ops');
update public.loads set status = 'matched'
where id = 'a0a0a0a0-0000-4000-8000-000000000002';

select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_expire_offer('e2e2e2e2-0000-4000-8000-000000000003',
                               'Driver stopped answering');
select act_as_reset();

select assert_equals(
  (select count(*) from public.loads
    where id = 'a0a0a0a0-0000-4000-8000-000000000002' and status = 'finding_truck'),
  1, 'killing the last live offer returns the load to finding_truck, never a dead end');

-- ─── 6g. legs ───────────────────────────────────────────────────────────────

-- The trip on a0a0a0a0…0001 is in_transit and sits on leg d0d0d0d0…0001.
update public.legs set status = 'matched' where id = 'd0d0d0d0-0000-4000-8000-000000000001';
select act_as('33333333-0000-4000-8000-00000000cccc');
select assert_raises(
  $$select public.ops_set_leg_status('d0d0d0d0-0000-4000-8000-000000000001',
                                     'open', 'freeing it up')$$,
  'a leg carrying a live trip cannot be reopened as available supply');

-- ─── 6h. tuned matching clamps its arguments ────────────────────────────────

select assert_equals(
  (select count(*) from public.ops_candidates_tuned(
     'e0e0e0e0-0000-4000-8000-000000000002', 99::smallint, 9999, 999999)),
  (select count(*) from public.ops_candidates_tuned(
     'e0e0e0e0-0000-4000-8000-000000000002', 3::smallint, 14, 200)),
  'absurd matching arguments are clamped, not obeyed');

-- ─── 6i. notes are sanitised at the boundary ────────────────────────────────

-- U+202E RIGHT-TO-LEFT OVERRIDE. In a bilingual product a note containing one
-- can display as its own reverse, so the database refuses it as well as the
-- client stripping it — both layers on purpose.
select assert_raises(
  $$select public.ops_add_trip_note('b0b0b0b0-0000-4000-8000-000000000001',
                                    'delivered ' || U&'\202E' || ' not')$$,
  'a note carrying a bidi override is refused');
select assert_raises(
  $$select public.ops_add_trip_note('b0b0b0b0-0000-4000-8000-000000000001', '')$$,
  'an empty note is refused');

select assert_true(
  (select public.ops_add_trip_note('b0b0b0b0-0000-4000-8000-000000000001',
     'Rang the driver, running two hours late at Bidbid') is not null),
  'a normal note is written');

-- ─── 6i2. the writes that succeed ───────────────────────────────────────────
--
-- Everything asserted for reassignment, trip status and leg status so far has
-- been a refusal. A guard that refuses everything is not a working feature, so
-- each one is also exercised on its happy path.

select act_as('33333333-0000-4000-8000-00000000cccc');

select public.ops_reassign_trip(
  'b0b0b0b0-0000-4000-8000-000000000001',
  '44444444-0000-4000-8000-00000000dddd',
  'c0c0c0c0-0000-4000-8000-000000000002',
  'First driver broke down at Barka, second driver collected the load');

select act_as_reset();
select assert_true(
  (select t.driver_id = '44444444-0000-4000-8000-00000000dddd'
      and t.truck_id  = 'c0c0c0c0-0000-4000-8000-000000000002'
      and t.leg_id is null
     from public.trips t where t.id = 'b0b0b0b0-0000-4000-8000-000000000001'),
  'the trip moved to the second driver and their own truck, and left its leg behind');
select assert_equals(
  (select count(*) from public.legs
    where id = 'd0d0d0d0-0000-4000-8000-000000000001' and status = 'open'),
  1, 'and the old leg went back to being available supply');

-- Marking delivered without a photo. `advance_trip` refuses this for a driver
-- and still does; ops may, because the case is a driver ringing in from
-- somewhere with no signal. The weakening is made visible rather than hidden.
select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_set_trip_status(
  'b0b0b0b0-0000-4000-8000-000000000001', 'delivered',
  'Driver confirmed delivery by phone, consignee signed the paper note');
select act_as_reset();

select assert_equals(
  (select count(*) from public.trips
    where id = 'b0b0b0b0-0000-4000-8000-000000000001' and status = 'delivered'),
  1, 'ops can mark a trip delivered');
select assert_equals(
  (select count(*) from public.loads
    where id = 'a0a0a0a0-0000-4000-8000-000000000001' and status = 'delivered'),
  1, 'and the load followed');
select assert_equals(
  (select count(*) from public.trip_events
    where trip_id = 'b0b0b0b0-0000-4000-8000-000000000001'
      and note like '%without proof photo%'),
  1, 'and the trip itself records that there was no proof photo — findable, countable');

-- A cancelled trip must return its load to the dispatcher, never to a dead end.
select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_set_trip_status(
  current_setting('tests.trip2')::uuid,
  'cancelled', 'Driver withdrew before pickup');
select act_as_reset();
select assert_equals(
  (select count(*) from public.loads
    where id = 'e0e0e0e0-0000-4000-8000-000000000002' and status = 'finding_truck'),
  1, 'a cancelled trip returns its load to finding_truck, not to a dead end');

select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_set_leg_status(
  'e1e1e1e1-0000-4000-8000-000000000001', 'cancelled',
  'Driver withdrew the declared trip');
select act_as_reset();
select assert_equals(
  (select count(*) from public.legs
    where id = 'e1e1e1e1-0000-4000-8000-000000000001' and status = 'cancelled'),
  1, 'ops can cancel a leg that is not carrying anything');

-- ─── 6j. every write left a trace ───────────────────────────────────────────

select act_as_reset();

select assert_equals(
  (select count(distinct a.action) from private.ops_audit a),
  7, 'all seven kinds of successful write above are represented in the audit log');
select assert_equals(
  (select count(*) from private.ops_audit a where a.actor_id is null),
  0, 'no audit row is anonymous');

-- The four pre-existing ops functions were recreated to log. An audit log with
-- known holes invites the assumption that silence means nothing happened.
select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_sweep_expired_offers();

-- a0a0a0a0…0001 was marked delivered in 6i2, so it is no longer open.
select assert_raises(
  $$select public.ops_set_price('a0a0a0a0-0000-4000-8000-000000000001', 45000)$$,
  'ops_set_price refuses a load that has already been delivered');
select act_as_reset();

select assert_equals(
  (select count(*) from private.ops_audit where action = 'ops_sweep_expired_offers'),
  1, 'the sweep logs even when it sweeps nothing — "nobody ran it" is a different fact');
select assert_equals(
  (select count(*) from private.ops_audit where action = 'ops_set_price'), 0,
  'and a refused price change logs nothing — a rejection is not a write');

-- a0a0a0a0…0002 was returned to finding_truck in 6f, so it is open again.
select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_set_price('a0a0a0a0-0000-4000-8000-000000000002', 45000);
select act_as_reset();

select assert_true(
  (select a.after->>'price_baisa' = '45000' from private.ops_audit a
    where a.action = 'ops_set_price'),
  'a price that was set does log, in integer baisa — 45000 is 45.000 OMR');

-- ─── 6k. the refactor did not break the driver's own path ───────────────────
--
-- respond_to_offer was recreated to delegate to private.accept_offer so trip
-- creation has exactly one implementation. This is the regression check.

select act_as_reset();
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                          goods_description, status)
values ('e0e0e0e0-0000-4000-8000-000000000003',
        '11111111-0000-4000-8000-00000000aaaa',
        (select id from public.cities where name_en = 'Muscat'),
        (select id from public.cities where name_en = 'Sohar'),
        current_date + 1, current_date + 3, 'Driver accepts this one himself', 'matched');
insert into public.offers (id, load_id, driver_id, status, source)
values ('e2e2e2e2-0000-4000-8000-000000000004',
        'e0e0e0e0-0000-4000-8000-000000000003',
        '22222222-0000-4000-8000-00000000bbbb', 'pending', 'ops');

select act_as('11111111-0000-4000-8000-00000000aaaa');
select assert_raises(
  $$select public.respond_to_offer('e2e2e2e2-0000-4000-8000-000000000004', true)$$,
  'a shipper still cannot accept a driver''s offer');

select act_as('22222222-0000-4000-8000-00000000bbbb');
select assert_true(
  (select public.respond_to_offer('e2e2e2e2-0000-4000-8000-000000000004', true) is not null),
  'the driver''s own accept still creates a trip after the refactor');
select act_as_reset();

select assert_equals(
  (select count(*) from public.trips
    where load_id = 'e0e0e0e0-0000-4000-8000-000000000003'),
  1, 'exactly one trip — the unique constraint and the load lock still hold');
select assert_equals(
  (select count(*) from private.ops_audit
    where target_id = 'e2e2e2e2-0000-4000-8000-000000000004'),
  0, 'a driver acting for themselves is not an ops event and is not logged as one');

do $$ begin raise notice 'ALL OPS CONSOLE ASSERTIONS HELD'; end $$;

rollback;
