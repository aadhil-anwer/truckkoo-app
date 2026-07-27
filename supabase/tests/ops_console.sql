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

do $$ begin raise notice 'ALL OPS CONSOLE ASSERTIONS HELD'; end $$;

rollback;
