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

-- 0027. `quoted` and `accepted` arrived in 0022 and the matrix ended in
-- `else false`, so for four migrations a dispatcher could not move a load out of
-- either — not to finding_truck, not even to cancelled. Those are the two states
-- a load is MOST likely to be stuck in: a shipper who never answered a price, and
-- an agreed price no driver has taken. Asserted at the matrix rather than through
-- ops_set_load_status so the failure names the rule rather than a rate limit or a
-- missing reason.
select act_as_reset();

select assert_true(
  private.load_transition_ok('quoted', 'cancelled'),
  'a shipper who never answered their price can have the load cancelled');
select assert_true(
  private.load_transition_ok('quoted', 'finding_truck'),
  'or taken back into the hunt');
select assert_true(
  private.load_transition_ok('accepted', 'finding_truck'),
  'an agreed load with no driver can go back to the hunt');
select assert_true(
  private.load_transition_ok('accepted', 'cancelled'),
  'and can be cancelled');

-- Forward by hand is exactly what the reorder exists to prevent: it would put a
-- load in front of drivers at a price nobody agreed to. Only `accept_quote`
-- leaves `quoted` forwards, and only the shipper can call it.
select assert_true(
  not private.load_transition_ok('quoted', 'assigned'),
  'but a dispatcher cannot walk a quoted load forward past the shipper');
select assert_true(
  not private.load_transition_ok('quoted', 'accepted'),
  'and cannot accept a price on the shipper''s behalf');

-- `posted` describes a load nobody has agreed to. An accepted one is past that,
-- and putting it back would lose the fact that somebody said yes.
select assert_true(
  not private.load_transition_ok('accepted', 'posted'),
  'an accepted load does not go back to posted — that would discard the yes');

select act_as('33333333-0000-4000-8000-00000000cccc');

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

-- ─── 6j2. an accepted price is immutable (0023) ─────────────────────────────
--
-- A price the shipper has agreed to is a COMMITMENT. Rewriting it silently is
-- the difference between a quote and a note, and the shipper would find out at
-- the gate. Re-pricing has to become a NEW quote that they decide on again.
--
-- This was filed as unbuilt in OPEN_ISSUES at P0 — "ops_set_price can currently
-- move a price on a load in any state" — and closed by 0023. It is asserted here
-- rather than in tenant_isolation because the caller is a dispatcher, and only
-- this suite has one.
--
-- Worth knowing WHY the guard was nearly useless: the first attempt added a
-- three-argument `ops_set_price` overload and left the real two-argument
-- function untouched, so the guard sat beside an unguarded function of the same
-- name and the console went on calling the unguarded one. That is why this
-- assertion names the two-argument signature explicitly.

-- a0a0a0a0…0002 is open and priced from the section above. Take it through the
-- shipper's decision, then try to move the price under them.
select act_as('11111111-0000-4000-8000-00000000aaaa');
select public.accept_quote('a0a0a0a0-0000-4000-8000-000000000002');
select act_as_reset();

select act_as('33333333-0000-4000-8000-00000000cccc');
select assert_raises(
  $$select public.ops_set_price('a0a0a0a0-0000-4000-8000-000000000002', 99000)$$,
  'ops_set_price refuses a load the shipper has already accepted');
select act_as_reset();

select assert_true(
  (select price_baisa = 45000 from public.loads
    where id = 'a0a0a0a0-0000-4000-8000-000000000002'),
  'and the agreed price is still the agreed price');

select assert_equals(
  (select count(*) from private.ops_audit where action = 'ops_set_price'), 1,
  'a refused re-price writes no audit row — a rejection is not a write');

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

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Migration 0017 — account administration
-- ════════════════════════════════════════════════════════════════════════════

select assert_ops_only(
  $$select public.ops_verify_driver('22222222-0000-4000-8000-00000000bbbb', true)$$,
  'ops_verify_driver');
select assert_ops_only(
  $$select public.ops_verify_truck('c0c0c0c0-0000-4000-8000-000000000001', true)$$,
  'ops_verify_truck');
select assert_ops_only(
  $$select public.ops_suspend_account('22222222-0000-4000-8000-00000000bbbb',
                                      true, 'test')$$,
  'ops_suspend_account');
select assert_ops_only(
  $$select public.ops_update_profile('22222222-0000-4000-8000-00000000bbbb',
                                     'Renamed')$$,
  'ops_update_profile');

-- ─── 7a. the suspension columns are not client-writable ─────────────────────

select act_as('22222222-0000-4000-8000-00000000bbbb');

select assert_raises(
  $$update public.profiles set suspended_at = null
     where id = '22222222-0000-4000-8000-00000000bbbb'$$,
  'a user cannot lift their own suspension');
select assert_raises(
  $$update public.profiles set suspended_reason = 'nothing to see'
     where id = '22222222-0000-4000-8000-00000000bbbb'$$,
  'nor rewrite the reason');
-- Which member of staff made the call is internal. Naming them to a suspended
-- user invites the wrong kind of follow-up.
select assert_raises(
  $$select suspended_by from public.profiles
     where id = '22222222-0000-4000-8000-00000000bbbb'$$,
  'nor read which dispatcher suspended them');

select act_as_reset();

-- ─── 7b. verification is the public trust claim ─────────────────────────────

select act_as('33333333-0000-4000-8000-00000000cccc');

select assert_raises(
  $$select public.ops_verify_driver('11111111-0000-4000-8000-00000000aaaa', true)$$,
  'a shipper cannot be verified as a driver');
-- Losing why someone was verified is not a thing a checkbox should do.
select assert_raises(
  $$select public.ops_verify_driver('22222222-0000-4000-8000-00000000bbbb', false)$$,
  'removing verification without saying why is refused');

select public.ops_verify_driver('22222222-0000-4000-8000-00000000bbbb', true,
                                'Licence and Mulkiya seen at Muscat depot');
select act_as_reset();

select assert_true(
  (select d.verified_at is not null and d.verified_by is not null
     from public.drivers d where d.profile_id = '22222222-0000-4000-8000-00000000bbbb'),
  'the driver is verified, and the record says by whom');

select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_verify_driver('22222222-0000-4000-8000-00000000bbbb', true, null);
select act_as_reset();
select assert_true(
  (select d.notes = 'Licence and Mulkiya seen at Muscat depot'
     from public.drivers d where d.profile_id = '22222222-0000-4000-8000-00000000bbbb'),
  'a null notes argument leaves existing vetting notes alone rather than erasing them');

-- ─── 7c. suspension blocks new commitments ──────────────────────────────────

select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_suspend_account('11111111-0000-4000-8000-00000000aaaa', true,
                                  'Three loads cancelled after a driver was dispatched');
select act_as_reset();

select act_as('11111111-0000-4000-8000-00000000aaaa');
select assert_raises(
  $$select public.post_load(
      (select id from public.cities where name_en = 'Muscat'),
      (select id from public.cities where name_en = 'Sohar'),
      current_date + 1, current_date + 2, 'Cargo from a suspended shipper')$$,
  'a suspended shipper cannot post a load');
select act_as_reset();

select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_suspend_account('22222222-0000-4000-8000-00000000bbbb', true,
                                  'Documents under review');
select act_as_reset();

select act_as('22222222-0000-4000-8000-00000000bbbb');
select assert_raises(
  $$select public.post_leg(
      (select id from public.cities where name_en = 'Muscat'),
      (select id from public.cities where name_en = 'Sohar'),
      current_date + 1, current_date + 2)$$,
  'a suspended driver cannot declare a leg');
select act_as_reset();

-- ─── 7d. …but does NOT strand a load in progress ────────────────────────────
--
-- This asymmetry is the whole design. A driver suspended halfway to Salalah is
-- still carrying somebody's cargo. Locking them out of marking the delivery
-- strands the load, denies the shipper their proof, and turns an account problem
-- into a freight problem.

insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                          goods_description, status)
values ('f0f0f0f0-0000-4000-8000-000000000001',
        '11111111-0000-4000-8000-00000000aaaa',
        (select id from public.cities where name_en = 'Muscat'),
        (select id from public.cities where name_en = 'Sohar'),
        current_date + 1, current_date + 3, 'Cargo already on the road', 'in_transit');
insert into public.trips (id, load_id, driver_id, status)
values ('f1f1f1f1-0000-4000-8000-000000000001',
        'f0f0f0f0-0000-4000-8000-000000000001',
        '22222222-0000-4000-8000-00000000bbbb', 'in_transit');

select act_as('22222222-0000-4000-8000-00000000bbbb');
select public.advance_trip('f1f1f1f1-0000-4000-8000-000000000001', 'delivered',
                           'Delivered to the yard', 'f1f1f1f1/pod.jpg');
select act_as_reset();

select assert_equals(
  (select count(*) from public.trips
    where id = 'f1f1f1f1-0000-4000-8000-000000000001' and status = 'delivered'),
  1, 'a suspended driver can still finish the load they are carrying');

-- A suspended driver must also still be able to decline. Refusing would leave
-- the offer pending until it expires and make the shipper wait days for an
-- answer that cannot come — punishing them for the driver's suspension.
insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                          goods_description, status)
values ('f0f0f0f0-0000-4000-8000-000000000002',
        '11111111-0000-4000-8000-00000000aaaa',
        (select id from public.cities where name_en = 'Muscat'),
        (select id from public.cities where name_en = 'Sohar'),
        current_date + 4, current_date + 5, 'Offered to a suspended driver', 'matched');
insert into public.offers (id, load_id, driver_id, status, source)
values ('f2f2f2f2-0000-4000-8000-000000000001',
        'f0f0f0f0-0000-4000-8000-000000000002',
        '22222222-0000-4000-8000-00000000bbbb', 'pending', 'ops');

select act_as('22222222-0000-4000-8000-00000000bbbb');
select assert_raises(
  $$select public.respond_to_offer('f2f2f2f2-0000-4000-8000-000000000001', true)$$,
  'a suspended driver cannot accept new work');
select public.respond_to_offer('f2f2f2f2-0000-4000-8000-000000000001', false);
select act_as_reset();

select assert_equals(
  (select count(*) from public.offers
    where id = 'f2f2f2f2-0000-4000-8000-000000000001' and status = 'declined'),
  1, 'but can still decline, so the shipper is not left waiting');

-- ─── 7e. lifting a suspension restores the account ──────────────────────────

select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_suspend_account('11111111-0000-4000-8000-00000000aaaa', false,
                                  'Spoke to them, misunderstanding resolved');
select act_as_reset();

select act_as('11111111-0000-4000-8000-00000000aaaa');
select assert_true(
  (select public.post_load(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Sohar'),
     current_date + 1, current_date + 2, 'Cargo after reinstatement') is not null),
  'lifting the suspension lets them post again');
select act_as_reset();

select assert_true(
  (select p.suspended_at is null and p.suspended_by is null and p.suspended_reason is null
     from public.profiles p where p.id = '11111111-0000-4000-8000-00000000aaaa'),
  'and clears every trace of it from the row — the history lives in the audit log');

-- ─── 7f. a dispatcher cannot suspend a dispatcher ───────────────────────────
--
-- Locking yourself out of the console is a support call at best. Locking out a
-- colleague is a way to remove a witness.

select act_as('33333333-0000-4000-8000-00000000cccc');
select assert_raises(
  $$select public.ops_suspend_account('33333333-0000-4000-8000-00000000cccc',
                                      true, 'suspending myself')$$,
  'a dispatcher cannot suspend themselves');

-- ─── 7g. role is not editable, by anyone, ever ──────────────────────────────

-- Not in the signature and never will be: changing a role crosses a tenant
-- boundary and changes every RLS outcome for every row that account owns.
select assert_equals(
  (select count(*) from information_schema.parameters
    where specific_schema = 'public'
      and specific_name like 'ops_update_profile%'
      and parameter_name = 'p_role'),
  0, 'ops_update_profile has no role parameter');

select public.ops_update_profile('22222222-0000-4000-8000-00000000bbbb',
                                 null, '+968 9999 9999', null);
select act_as_reset();

select assert_true(
  (select p.phone = '+968 9999 9999' and p.full_name = 'Console Driver'
     from public.profiles p where p.id = '22222222-0000-4000-8000-00000000bbbb'),
  'a null argument leaves the field alone rather than erasing it');

-- ─── 7h. the reason reaches the person it is about ──────────────────────────

select act_as('33333333-0000-4000-8000-00000000cccc');
select assert_raises(
  $$select public.ops_suspend_account('11111111-0000-4000-8000-00000000aaaa', true,
       'reason with a bidi override ' || U&'\202E')$$,
  'a suspension reason carrying a bidi override is refused — the user will read it');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 8. The unqualified-type trap
-- ════════════════════════════════════════════════════════════════════════════
--
-- `advance_trip` pinned `search_path = ''` correctly, qualified every table
-- correctly, and then cast to `'in_transit'::load_status` — a bare type name,
-- which with an empty search path resolves against nothing. Every call by every
-- driver since 0004 raised `type "load_status" does not exist`. The entire
-- delivery flow was dead and nothing noticed, because no test called it and
-- nothing has run on a real device.
--
-- Section 7d above is now the regression test for that specific function. This
-- section guards the class, because the next one will be written the same way.
--
-- The check is deliberately static: it reads the catalogue rather than calling
-- anything, so it covers functions no test happens to exercise — which is the
-- exact hole the bug lived in.

do $$
declare
  v_bad text;
begin
  select string_agg(fn, ', ')
  into v_bad
  from (
    select p.oid::regprocedure::text as fn, p.prosrc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=%'
      and n.nspname in ('public', 'private')
  ) f
  where
    -- A cast to one of our enums with nothing in front of the `::`.
    f.prosrc ~ '::\s*(load_status|trip_status|leg_status|offer_status|user_role)\M';

  if v_bad is not null then
    raise exception
      'FAIL: unqualified enum cast inside a search_path-pinned definer function: %. '
      'With search_path = '''' a bare type name resolves against nothing and the '
      'function fails at runtime, every time. Write public.load_status.', v_bad;
  end if;
  raise notice 'pass: no definer function casts to an unqualified enum';
end $$;

-- The same trap, one step removed: a declared variable of a bare enum type.
do $$
declare
  v_bad text;
begin
  select string_agg(fn, ', ')
  into v_bad
  from (
    select p.oid::regprocedure::text as fn, p.prosrc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=%'
      and n.nspname in ('public', 'private')
  ) f
  where f.prosrc ~ '\mdeclare\M[\s\S]*?\m\w+\s+(load_status|trip_status|leg_status|offer_status|user_role)\s*(:=|;)';

  if v_bad is not null then
    raise exception
      'FAIL: unqualified enum in a declare block inside a definer function: %', v_bad;
  end if;
  raise notice 'pass: no definer function declares an unqualified enum variable';
end $$;

-- And the rule those two are corollaries of: SECURITY.md §12 — every definer
-- function pins its search path. An unpinned one is a privilege-escalation
-- primitive, not merely a latent runtime error.
do $$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ')
  into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname in ('public', 'private')
    and (p.proconfig is null or array_to_string(p.proconfig, ',') not like '%search_path=%');

  if v_bad is not null then
    raise exception 'FAIL: security definer function with no pinned search_path: %', v_bad;
  end if;
  raise notice 'pass: every security definer function pins its search_path';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Migration 0018 — settings and the rate card
-- ════════════════════════════════════════════════════════════════════════════

select assert_ops_only($$select * from public.ops_settings()$$, 'ops_settings');
select assert_ops_only(
  $$select public.ops_set_setting('auto_dispatch_enabled', 'false'::jsonb)$$,
  'ops_set_setting');
select assert_ops_only($$select * from public.ops_rate_cards()$$, 'ops_rate_cards');
select assert_ops_only($$select * from public.ops_corridors()$$, 'ops_corridors');
select assert_ops_only(
  $$select public.ops_upsert_rate_card('a','b','10t',1,1,1,'test')$$,
  'ops_upsert_rate_card');
select assert_ops_only($$select public.ops_delete_rate_card(1, 'test')$$,
  'ops_delete_rate_card');
select assert_ops_only($$select public.ops_preview_price(1,1,1,1000)$$,
  'ops_preview_price');

-- The crown jewel stays out of reach of the table itself, regardless of the RPCs.
select act_as('22222222-0000-4000-8000-00000000bbbb');
select assert_raises($$select * from private.rate_cards$$,
  'the rate card table is still unreadable by a client');
select assert_raises($$select * from private.app_settings$$,
  'so is the settings table');
select assert_raises($$select * from private.rate_card_audit$$,
  'and the rate audit trail');
select act_as_reset();

-- ─── 9a. the settings whitelist ─────────────────────────────────────────────

select act_as('33333333-0000-4000-8000-00000000cccc');

select assert_equals((select count(*) from public.ops_settings()), 5,
  'ops_settings returns exactly the five whitelisted keys');

-- `app_settings` is where kill switches live. A generic key/value writer
-- reachable from a browser turns one compromised session into arbitrary config.
select assert_not_found(
  $$select public.ops_set_setting('some_other_key', 'true'::jsonb)$$,
  'a key outside the whitelist is refused, and refused as "not found"');

select assert_raises(
  $$select public.ops_set_setting('auto_dispatch_enabled', '3'::jsonb)$$,
  'a boolean setting rejects a number');
select assert_raises(
  $$select public.ops_set_setting('auto_dispatch_max_offers', 'true'::jsonb)$$,
  'a numeric setting rejects a boolean');
select assert_raises(
  $$select public.ops_set_setting('auto_dispatch_max_offers', '0'::jsonb)$$,
  'and rejects a value below the range');
select assert_raises(
  $$select public.ops_set_setting('auto_dispatch_max_offers', '9999'::jsonb)$$,
  'and above it');

select public.ops_set_setting('auto_dispatch_enabled', 'false'::jsonb);
select act_as_reset();

select assert_true(
  (select not private.setting_bool('auto_dispatch_enabled', true)),
  'the kill switch can be thrown from the console');
select assert_true(
  (select a.after->>'value' = 'false' from private.ops_audit a
    where a.action = 'ops_set_setting'),
  'and the change is audited');

-- Prove it actually took effect, rather than only changing a row.
select act_as('11111111-0000-4000-8000-00000000aaaa');
select public.post_load(
  (select id from public.cities where name_en = 'Muscat'),
  (select id from public.cities where name_en = 'Sohar'),
  current_date + 8, current_date + 9, 'Posted with dispatch switched off');
select act_as_reset();

-- 0023: dispatch is attempted when the shipper ACCEPTS, not when they post — so
-- the kill switch has to be exercised there. The price is set directly rather
-- than through ops_set_price: this assertion is about the switch, and routing it
-- through the pricing guard would make it fail for reasons that have nothing to
-- do with dispatch being off.
update public.loads
   set price_baisa = 45000, status = 'quoted'
 where goods_description = 'Posted with dispatch switched off';

select act_as('11111111-0000-4000-8000-00000000aaaa');
select public.accept_quote(
  (select id from public.loads where goods_description = 'Posted with dispatch switched off'));
select act_as_reset();

select assert_equals(
  (select count(*) from private.dispatch_log dl
    join public.loads l on l.id = dl.load_id
   where l.goods_description = 'Posted with dispatch switched off'
     and dl.skipped = 'disabled'),
  1, 'and auto-dispatch really is off, and says so in the log');

select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_set_setting('auto_dispatch_enabled', 'true'::jsonb);
select act_as_reset();

-- ─── 9b. the rate card ──────────────────────────────────────────────────────

select act_as('33333333-0000-4000-8000-00000000cccc');

select assert_true((select count(*) > 0 from public.ops_corridors()),
  'the corridor bands are listed, so the console can offer a dropdown');

-- A typo'd corridor inserts cleanly and then silently never matches a load —
-- a rate that exists, looks configured, and prices nothing.
select assert_raises(
  $$select public.ops_upsert_rate_card('Not A Real Corridor',
      (select corridor from public.cities where corridor is not null limit 1),
      '10t', 50000, 5000, 30000, 'typo test')$$,
  'an unknown corridor is refused rather than silently never matching');

select assert_raises(
  $$select public.ops_upsert_rate_card(
      (select corridor from public.cities where corridor is not null limit 1),
      (select corridor from public.cities where corridor is not null limit 1),
      'not-a-truck', 50000, 5000, 30000, 'bad type')$$,
  'an unknown truck type is refused');

-- A zero floor lets a zero-weight quote price at zero, and loads_price_positive
-- then rejects the load's price with a constraint error the shipper cannot act on.
select assert_raises(
  $$select public.ops_upsert_rate_card(
      (select corridor from public.cities where corridor is not null limit 1),
      (select corridor from public.cities where corridor is not null limit 1),
      '10t', 50000, 5000, 0, 'zero floor')$$,
  'a zero minimum fare is refused at configuration time');

-- A rate card applies to every future load on that corridor, so a slipped
-- decimal here is not one bad quote, it is all of them.
select assert_raises(
  $$select public.ops_upsert_rate_card(
      (select corridor from public.cities where corridor is not null limit 1),
      (select corridor from public.cities where corridor is not null limit 1),
      '10t', 999999999999, 5000, 30000, 'slipped decimal')$$,
  'an absurd base fare is refused');

select assert_raises(
  $$select public.ops_upsert_rate_card(
      (select corridor from public.cities where corridor is not null limit 1),
      (select corridor from public.cities where corridor is not null limit 1),
      '10t', 50000, 5000, 30000, null)$$,
  'a rate change with no reason is refused');

-- The happy path. 50.000 OMR base + 5.000 per tonne, 30.000 floor — in baisa,
-- because OMR is a three-decimal currency and every amount in this schema is an
-- integer of minor units.
select set_config('tests.rate_id',
  public.ops_upsert_rate_card(
    (select corridor from public.cities where name_en = 'Muscat'),
    (select corridor from public.cities where name_en = 'Salalah'),
    '10t', 50000, 5000, 30000,
    'Diesel up 8%, reviewed with the yard')::text,
  true);

select assert_equals((select count(*) from public.ops_rate_cards()), 1,
  'the rate card is readable by a dispatcher');

select assert_true(
  (select rc.base_baisa = 50000 and rc.min_fare_baisa = 30000
     from public.ops_rate_cards() rc),
  'with the amounts it was given, in integer baisa');

-- The same formula the real quote path uses. Not a second implementation:
-- 50000 + 5000 * 8t = 90000 baisa = 90.000 OMR.
select assert_equals(public.ops_preview_price(50000, 5000, 30000, 8000), 90000,
  'the price preview runs the one real formula');
select assert_equals(public.ops_preview_price(50000, 5000, 30000, null), 50000,
  'and handles an unstated weight');
select assert_equals(public.ops_preview_price(1000, 0, 30000, 1000), 30000,
  'and applies the floor');

select act_as_reset();

-- Both audit trails, because neither subsumes the other: rate_card_audit is the
-- row-level history the pricing rules require, ops_audit is the who-and-why.
select assert_equals(
  (select count(*) from private.rate_card_audit where action = 'insert'), 1,
  'the 0010 row-level rate audit still fires');
select assert_true(
  (select a.reason like 'Diesel up 8%%' from private.ops_audit a
    where a.action = 'ops_upsert_rate_card'),
  'and the ops audit carries who changed it and why');

select act_as('33333333-0000-4000-8000-00000000cccc');
select public.ops_delete_rate_card(current_setting('tests.rate_id')::bigint,
                                   'Corridor no longer served');
select act_as_reset();

select assert_equals((select count(*) from private.rate_cards), 0,
  'a rate band can be removed');
select assert_true(
  (select a.before is not null and a.after is null from private.ops_audit a
    where a.action = 'ops_delete_rate_card'),
  'and the audit keeps what it was before it went');

-- ─── 9c. the driver's commission (0028) ─────────────────────────────────────
-- This rate decides what a person is paid for a day's work, so it gets the same
-- treatment as a rate band: bounded, reasoned, audited, and ops-only.

select act_as_reset();

-- Set explicitly rather than assumed. The rest of this suite leans on a fresh
-- `db reset`, but a commission is a value someone changes in dev — through the
-- console, on purpose — and an assertion that silently depends on it being
-- untouched fails later for a reason that has nothing to do with the code.
update private.app_settings set value = '0'::jsonb where key = 'commission_pct';

-- THE STATE WE SHIP IN. A commission invented in a migration is a number quoted
-- to a driver the first time somebody forgets it was a placeholder.
select assert_equals(private.payout_for(96000), 96000,
  'at 0 percent the driver keeps the whole price — the state the product ships in');

select act_as('33333333-0000-4000-8000-00000000cccc');

select assert_raises($$select public.ops_set_commission(50, 'too much')$$,
  'a commission over 40 percent is refused — that is a slipped decimal, not a rate');
select assert_raises($$select public.ops_set_commission(-5, 'negative')$$,
  'and a negative one is refused too');
select assert_raises($$select public.ops_set_commission(15, ' ')$$,
  'a rate change with no reason is refused, like every other audited write');

select public.ops_set_commission(18.75, 'Board rate, July 2026');
select act_as_reset();

select assert_equals(private.payout_for(96000), 78000,
  'at 18.75 percent, a 96.000 OMR load pays the driver 78.000');

select assert_true(
  (select a.after->>'pct' = '18.75' and a.reason like 'Board rate%'
     from private.ops_audit a where a.action = 'ops_set_commission'),
  'and the change is audited with its reason and its old value');

-- ROUNDING NEVER INVENTS MONEY. The driver's share plus the margin must equal
-- the price exactly — a payout rounded up hands over a baisa the shipper never
-- paid, and across enough loads that is real money from nowhere.
select assert_true(
  (select bool_and(private.payout_for(p) <= p)
     from generate_series(1, 100000, 997) p),
  'a payout never exceeds the price it came from, at any price');

-- A shipper is not a dispatcher, whatever they call.
select act_as('11111111-0000-4000-8000-00000000aaaa');
select assert_raises($$select public.ops_set_commission(5, 'helping myself')$$,
  'a shipper cannot set the commission');
select assert_raises($$select public.ops_commission()$$,
  'nor read it — it is not their business what a driver is paid');
select act_as_reset();

-- ─── 9d. position retention (0032) ──────────────────────────────────────────

select act_as('33333333-3333-4333-8333-333333333333');  -- a driver
select assert_raises($$select public.ops_sweep_positions(30, 'tidy')$$,
  'a driver cannot sweep the position trail');
select assert_raises($$select * from public.ops_position_health()$$,
  'nor ask how much of it there is');
select act_as_reset();

select act_as('33333333-0000-4000-8000-00000000cccc');  -- the dispatcher
select assert_raises($$select public.ops_sweep_positions(0, 'nonsense')$$,
  'a retention of zero days is refused, not obeyed');
select assert_raises($$select public.ops_sweep_positions(4000, 'forever')$$,
  'and neither is eleven years');
select assert_true((select public.ops_sweep_positions(30, 'Routine retention') >= 0),
  'a dispatcher sweeps, and is told how many rows went');
select act_as_reset();

select assert_true(
  (select a.after->>'days' = '30' and a.reason = 'Routine retention'
     from private.ops_audit a where a.action = 'ops_sweep_positions'),
  'and the sweep is audited with its reason, like every privileged write');

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Migration 0034 — scheduled jobs and the stuck-load alarm
-- ════════════════════════════════════════════════════════════════════════════

-- The scheduled path skips require_ops(), so it must be unreachable from every
-- client role — including a real dispatcher, who has the ops_ buttons instead.
select assert_true(
  (select bool_and(not has_function_privilege(r, f, 'execute'))
     from unnest(array['anon', 'authenticated']) r,
          unnest(array[
            'private.system_sweep_expired_offers()',
            'private.system_sweep_positions()',
            'private.system_watch_loads()',
            'private.system_watch_cron()',
            'private.system_raise_alert(text, text, jsonb)',
            'private.log_system(text, text, text, jsonb)',
            'private.setting_text(text)']) f),
  'no client role can execute a system_ function');

select assert_true(
  (select bool_and(not has_table_privilege(r, t, 'select'))
     from unnest(array['anon', 'authenticated']) r,
          unnest(array['private.load_watch', 'private.ops_alerts']) t),
  'the alarm tables are unreadable by any client role');

select assert_true(
  (select count(*) = 4 from cron.job
    where jobname in ('sweep-expired-offers', 'watch-loads', 'watch-cron', 'sweep-positions')
      and active),
  'all four jobs are scheduled and active');

-- ─── 10a. the offer sweep runs without a dispatcher ─────────────────────────

insert into public.loads (id, shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                          goods_description, status)
select 'f3f3f3f3-0000-4000-8000-000000000034', '11111111-0000-4000-8000-00000000aaaa',
       (select min(id) from public.cities), (select max(id) from public.cities),
       current_date + 1, current_date + 2, 'Ignored-offer cargo', 'matched';

insert into public.offers (load_id, driver_id, status, source, expires_at)
values ('f3f3f3f3-0000-4000-8000-000000000034', '22222222-0000-4000-8000-00000000bbbb',
        'pending', 'ops', now() - interval '1 hour');

select assert_true((select private.system_sweep_expired_offers() >= 1),
  'the scheduled sweep expires an ignored offer');
select assert_true(
  (select status = 'finding_truck' from public.loads
    where id = 'f3f3f3f3-0000-4000-8000-000000000034'),
  'and returns its load to a human, as the button does');
select assert_true(
  (select count(*) = 1 from private.ops_audit
    where action = 'system_sweep_expired_offers'
      and actor_id = '00000000-0000-0000-0000-000000000000'),
  'and is audited as the system actor');

-- ─── 10b. the alarm ─────────────────────────────────────────────────────────

delete from private.app_settings where key = 'alert_webhook_url';
select private.system_watch_loads();
select assert_true(
  (select count(*) = 1 from private.load_watch
    where load_id = 'f3f3f3f3-0000-4000-8000-000000000034'
      and status = 'finding_truck' and alerted_at is null),
  'a waiting load starts a clock and does not alert at once');

update private.load_watch set first_seen_at = now() - interval '2 hours'
 where load_id = 'f3f3f3f3-0000-4000-8000-000000000034';

select assert_true((select private.system_watch_loads() >= 1),
  'past the threshold, it alerts');
select assert_true(
  (select count(*) = 1 from private.ops_alerts
    where kind = 'stuck_loads' and request_id is null
      and detail->'load_ids' ? 'f3f3f3f3-0000-4000-8000-000000000034'),
  'the alert is recorded even with no webhook configured');
select assert_true((select private.system_watch_loads() = 0),
  'and a load alerts once, not every five minutes');

update public.loads set status = 'assigned'
 where id = 'f3f3f3f3-0000-4000-8000-000000000034';
select private.system_watch_loads();
select assert_true(
  (select not exists (select 1 from private.load_watch
                       where load_id = 'f3f3f3f3-0000-4000-8000-000000000034')),
  'a wait that ended is forgotten');

insert into private.app_settings (key, value)
values ('alert_webhook_url', '"http://127.0.0.1:9/alert"'::jsonb);
select private.system_raise_alert('test', 'hello', '{}'::jsonb);
select assert_true(
  (select request_id is not null from private.ops_alerts
    where kind = 'test' order by id desc limit 1),
  'with a webhook set, the alert is queued to pg_net');

do $$ begin raise notice 'ALL OPS CONSOLE ASSERTIONS HELD'; end $$;

rollback;
