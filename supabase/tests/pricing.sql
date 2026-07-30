-- Truckkoo — pricing suite. Required by SECURITY.md §14:
--   * "Pricing unit tests — the §5 edge cases"
--   * "Authorization matrix — each RPC × each role"
--   * "Price integrity — submit a tampered price ... assert rejected"
--
-- Run against a LOCAL database only. Never production: it creates users, loads,
-- and rate-card rows.
--
--   psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pricing.sql
--
-- Exit code 0 = all assertions held.
--
-- WHY THESE ARE SQL AND NOT JEST
--
-- The pricing formula deliberately has no TypeScript twin (see 0010's header):
-- one implementation cannot disagree with itself, and a client-side formula would
-- ship the rate card's shape in the app bundle. So the "pure and unit-tested"
-- requirement in §5 is discharged here, against `private.compute_price` itself.
--
-- THE ASSERTION THIS FILE EXISTS FOR MOST
--
-- CLAUDE.md records that `force row level security` applies to the table owner
-- too, and that a definer function is often the first reader of a column — so
-- "nothing errored" can mean "nothing looked" (the `trips.truck_id` incident).
-- `private.rate_cards` is force-RLS with no policies, and `quote_load()` reads it
-- as a definer. The 'quoted' happy path below is the test that proves the rate is
-- actually visible to that function rather than silently invisible, which would
-- present as a permanent 'no_rate' and look exactly like an unconfigured card.

begin;

set local client_min_messages to notice;

-- ─── helpers ────────────────────────────────────────────────────────────────

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
    raise exception 'FAIL: % — expected %, got %', p_what, p_expected, coalesce(p_actual, 'NULL');
  end if;
  raise notice 'pass: %', p_what;
end $$;

-- For counts where the exact number is an artefact of how many times the suite
-- happened to call an RPC, and pinning it would break on an unrelated edit.
create or replace function assert_at_least(p_actual bigint, p_min bigint, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is null or p_actual < p_min then
    raise exception 'FAIL: % — expected at least %, got %', p_what, p_min, coalesce(p_actual, 0);
  end if;
  raise notice 'pass: % (%)', p_what, p_actual;
end $$;

create or replace function assert_null(p_actual bigint, p_what text)
returns void language plpgsql as $$
begin
  if p_actual is not null then
    raise exception 'FAIL: % — expected NULL, got %', p_what, p_actual;
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

-- ════════════════════════════════════════════════════════════════════════════
-- 1. private.compute_price — the §5 edge cases
--
-- Fixed inputs, no lookups: base 50.000 OMR, 10.000 per tonne, floor 1.000 OMR.
-- The low floor is deliberate here so the weight arithmetic is what decides the
-- answer; the floor gets its own section below.
-- ════════════════════════════════════════════════════════════════════════════

select assert_equals(
  private.compute_price(50000, 10000, 1000, 12000),
  170000, '12 t prices as base + 12 x per-tonne');

-- Rounding. This is the assertion that distinguishes ceil() from truncation: a
-- 1,200 kg load occupies two tonnes of deck, so it bills two.
select assert_equals(
  private.compute_price(50000, 10000, 1000, 1200),
  70000, '1,200 kg bills 2 billable tonnes (rounds UP, not down)');

-- ...and the other half of rounding: an exact tonnage must NOT round up to the
-- next one. ceil(2.0) = 2. Getting this wrong overcharges every round load.
select assert_equals(
  private.compute_price(50000, 10000, 1000, 2000),
  70000, '2,000 kg bills exactly 2 tonnes, not 3');

select assert_equals(
  private.compute_price(50000, 10000, 1000, 1),
  60000, '1 kg still bills a whole tonne');

-- Unstated weight prices the leg alone rather than guessing a tonnage.
select assert_equals(
  private.compute_price(50000, 10000, 1000, null),
  50000, 'NULL weight prices the base leg with no tonnage component');

-- ─── the minimum-fare floor (§5 names it explicitly) ────────────────────────

select assert_equals(
  private.compute_price(50000, 10000, 80000, 1200),
  80000, 'a computed 70.000 is lifted to the 80.000 floor');

select assert_equals(
  private.compute_price(50000, 10000, 80000, 12000),
  170000, 'the floor does not cap a price above it');

select assert_equals(
  private.compute_price(0, 0, 80000, null),
  80000, 'a zero base and zero rate still cannot price below the floor');

-- ─── absurd, zero, and negative weight (§5 names all three) ─────────────────
-- `loads_weight_sane` already rejects these at the table, so none can arrive
-- through a load. Asserted at the function anyway: the formula must not be the
-- thing that depends on a constraint two layers away for a sane answer.

select assert_equals(
  private.compute_price(50000, 10000, 80000, 0),
  80000, 'zero weight falls back to the floor, never to zero');

-- The floor is what makes a negative weight harmless rather than a negative
-- price — which `loads_price_positive` would then reject with an error the
-- shipper could do nothing about.
select assert_equals(
  private.compute_price(50000, 10000, 80000, -5000),
  80000, 'a negative weight cannot produce a price below the floor');

select assert_equals(
  private.compute_price(50000, 10000, 1000, 60000),
  650000, '60 t (the table maximum) prices without overflow');

-- ════════════════════════════════════════════════════════════════════════════
-- 2. fixtures
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pricing_seed() returns void
language plpgsql as $$
declare
  -- Everything in this file runs inside a transaction that rolls back, so this
  -- delete is local to the test and cannot outlive it.
  --
  -- It exists because the suite asserts the EMPTY-card behaviour (section 3) and
  -- was silently depending on the card happening to be empty. Running
  -- `npm run seed:rates` first made those assertions fail — correctly, since a
  -- seeded corridor really is priceable. Clearing here makes the suite hermetic
  -- rather than dependent on what the developer last loaded.
  v_shipper_a uuid := '11111111-1111-4111-8111-111111111111';
  v_shipper_b uuid := '22222222-2222-4222-8222-222222222222';
  v_driver    uuid := '33333333-3333-4333-8333-333333333333';
  v_ops       uuid := '55555555-5555-4555-8555-555555555555';
  v_muscat    bigint;
  v_salalah   bigint;
  v_sohar     bigint;
begin
  delete from private.rate_cards;

  insert into auth.users (id, email) values
    (v_shipper_a, 'p-shipper-a@test.local'),
    (v_shipper_b, 'p-shipper-b@test.local'),
    (v_driver,    'p-driver@test.local'),
    (v_ops,       'p-ops@test.local')
  on conflict (id) do nothing;

  insert into public.profiles (id, role, full_name) values
    (v_shipper_a, 'shipper', 'Shipper A'),
    (v_shipper_b, 'shipper', 'Shipper B'),
    (v_driver,    'driver',  'Driver'),
    (v_ops,       'shipper', 'Dispatcher')
  on conflict (id) do nothing;

  -- Ops membership is a private allow-list, never a profiles.role value (0005).
  insert into private.ops_users (profile_id, note) values (v_ops, 'pricing test')
  on conflict (profile_id) do nothing;

  select id into v_muscat  from public.cities where name_en = 'Muscat';
  select id into v_salalah from public.cities where name_en = 'Salalah';
  select id into v_sohar   from public.cities where name_en = 'Sohar';

  -- A load with a truck type, priceable once a rate exists. 9,600 kg on a 10 t
  -- truck: inside capacity, and it bills 10 tonnes rather than 9, so the happy
  -- path also exercises the rounding rule end to end.
  insert into public.loads (id, shipper_id, origin_city, dest_city,
                            pickup_from, pickup_to, goods_description,
                            weight_kg, truck_type_code)
  values ('dddddddd-0000-4000-8000-000000000001', v_shipper_a, v_muscat, v_salalah,
          current_date + 1, current_date + 3, 'Building materials', 9600, '10t')
  on conflict (id) do nothing;

  -- Exactly at capacity. The capacity check is `>`, not `>=` — a 10,000 kg load
  -- on a 10 t truck is a full truck, not an over-capacity one, and rejecting it
  -- would refuse a price for every fully-loaded trip Truckkoo runs.
  insert into public.loads (id, shipper_id, origin_city, dest_city,
                            pickup_from, pickup_to, goods_description,
                            weight_kg, truck_type_code)
  values ('dddddddd-0000-4000-8000-000000000005', v_shipper_a, v_muscat, v_salalah,
          current_date + 1, current_date + 3, 'A full 10-ton truck', 10000, '10t')
  on conflict (id) do nothing;

  -- "Not sure — advise me": truck_type_code IS NULL.
  insert into public.loads (id, shipper_id, origin_city, dest_city,
                            pickup_from, pickup_to, goods_description, weight_kg)
  values ('dddddddd-0000-4000-8000-000000000002', v_shipper_a, v_muscat, v_salalah,
          current_date + 1, current_date + 3, 'Furniture, not sure what truck', 800)
  on conflict (id) do nothing;

  -- 12 t of cargo on a 3 t hi-up. Physically impossible; must not be priced.
  insert into public.loads (id, shipper_id, origin_city, dest_city,
                            pickup_from, pickup_to, goods_description,
                            weight_kg, truck_type_code)
  values ('dddddddd-0000-4000-8000-000000000003', v_shipper_a, v_muscat, v_salalah,
          current_date + 1, current_date + 3, 'Too heavy for the truck asked for',
          12000, 'hiup')
  on conflict (id) do nothing;

  -- A band with no rate loaded, to prove the empty-card path.
  insert into public.loads (id, shipper_id, origin_city, dest_city,
                            pickup_from, pickup_to, goods_description,
                            weight_kg, truck_type_code)
  values ('dddddddd-0000-4000-8000-000000000004', v_shipper_a, v_muscat, v_sohar,
          current_date + 1, current_date + 3, 'Unpriced corridor', 5000, '10t')
  on conflict (id) do nothing;
end $$;

select pricing_seed();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. the empty rate card is not a dead end
--
-- The shipped state of this system: no rows in private.rate_cards. A quote
-- request must still succeed, still record a quote, and hand the load to a human.
-- ════════════════════════════════════════════════════════════════════════════

select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A

select assert_text(
  (select outcome from public.quote_load('dddddddd-0000-4000-8000-000000000004')),
  'no_rate', 'an unpriced corridor returns no_rate rather than failing');

select assert_null(
  (select price_baisa from public.quotes
    where load_id = 'dddddddd-0000-4000-8000-000000000004'),
  'a no_rate quote carries no price');

select act_as_reset();

select assert_text(
  (select status::text from public.loads where id = 'dddddddd-0000-4000-8000-000000000004'),
  'finding_truck', 'an unpriceable load goes to finding_truck, never a dead end');

-- ─── "Not sure — advise me" is priced by a human, not guessed ───────────────

select act_as('11111111-1111-4111-8111-111111111111');
select assert_text(
  (select outcome from public.quote_load('dddddddd-0000-4000-8000-000000000002')),
  'advise_me', 'a NULL truck type yields advise_me, not an invented truck choice');
select act_as_reset();

-- ─── over capacity is refused a price (§5) ──────────────────────────────────

select act_as('11111111-1111-4111-8111-111111111111');
select assert_text(
  (select outcome from public.quote_load('dddddddd-0000-4000-8000-000000000003')),
  'over_capacity', '12 t on a 3 t hi-up is refused a price');
select act_as_reset();

select assert_null(
  (select price_baisa from public.loads where id = 'dddddddd-0000-4000-8000-000000000003'),
  'an over-capacity load never receives a price');

-- ════════════════════════════════════════════════════════════════════════════
-- 4. the happy path — and the force-RLS visibility check
--
-- Muscat → Salalah is 'Muscat governorate' → 'Wusta and Dhofar (Salalah
-- corridor)'. Loading a real rate for that band must produce a real price. If
-- `force row level security` hid the row from the definer function, this returns
-- 'no_rate' and the whole engine would look merely unconfigured forever.
-- ════════════════════════════════════════════════════════════════════════════

insert into private.rate_cards
  (origin_corridor, dest_corridor, truck_type_code,
   base_baisa, per_tonne_baisa, min_fare_baisa)
select
  private.corridor_of((select id from public.cities where name_en = 'Muscat')),
  private.corridor_of((select id from public.cities where name_en = 'Salalah')),
  '10t', 50000, 10000, 80000;

select act_as('11111111-1111-4111-8111-111111111111');

select assert_text(
  (select outcome from public.quote_load('dddddddd-0000-4000-8000-000000000001')),
  'quoted', 'a loaded band prices the load — the rate card IS visible to the definer');

select assert_equals(
  (select price_baisa from public.quote_load('dddddddd-0000-4000-8000-000000000001')),
  150000, 'Muscat -> Salalah, 9,600 kg on a 10t: 50.000 + 10 x 10.000 = 150.000 OMR');

-- The boundary the fixture above exists for: a full truck still gets a price.
select assert_text(
  (select outcome from public.quote_load('dddddddd-0000-4000-8000-000000000005')),
  'quoted', 'a load exactly at truck capacity is priced, not refused');

select act_as_reset();

select assert_equals(
  (select price_baisa from public.loads where id = 'dddddddd-0000-4000-8000-000000000001'),
  150000, 'the price lands on the load');

-- The shipper can read their own price back through the granted columns.
select act_as('11111111-1111-4111-8111-111111111111');
select assert_equals(
  (select count(*) from public.current_quote('dddddddd-0000-4000-8000-000000000001')),
  1, 'the shipper can read their current quote');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. the rate card is not reachable from a client
-- ════════════════════════════════════════════════════════════════════════════

select act_as('11111111-1111-4111-8111-111111111111');
select assert_raises(
  $$select count(*) from private.rate_cards$$,
  'a shipper cannot read the rate card at all');
select assert_raises(
  $$select private.compute_price(1, 1, 1, 1)$$,
  'a shipper cannot call the pricing formula directly');
select assert_raises(
  $$select count(*) from private.rate_card_audit$$,
  'a shipper cannot read the rate-card audit log');
select act_as_reset();

select act_as('33333333-3333-4333-8333-333333333333');  -- a driver
select assert_raises(
  $$select count(*) from private.rate_cards$$,
  'a driver cannot read the rate card either');
select act_as_reset();

-- Provenance is withheld even on a row the shipper owns: which quotes shared a
-- card is enough to map the band structure of the moat.
select act_as('11111111-1111-4111-8111-111111111111');
select assert_raises(
  $$select rate_card_id from public.quotes limit 1$$,
  'rate_card_id is not in the shipper''s column grant');
select act_as_reset();

-- Every rate mutation is logged with before/after (§5).
--
-- Scoped to the exact rate this suite created, not a count of all inserts: the
-- audit log is deliberately append-only and survives outside this transaction, so
-- it also carries every row `npm run seed:rates` ever wrote.
select assert_equals(
  (select count(*) from private.rate_card_audit a
    where a.action = 'insert'
      and a.rate_id = (select q.rate_card_id from public.quotes q
                        where q.load_id = 'dddddddd-0000-4000-8000-000000000001'
                          and q.rate_card_id is not null
                        limit 1)),
  1, 'loading a rate wrote an audit row');

-- ════════════════════════════════════════════════════════════════════════════
-- 6. IDOR — quote_load is a definer function taking an id (the match_load lesson)
-- ════════════════════════════════════════════════════════════════════════════

select act_as('22222222-2222-4222-8222-222222222222');  -- Shipper B
select assert_raises(
  $$select public.quote_load('dddddddd-0000-4000-8000-000000000001')$$,
  'shipper B cannot quote shipper A''s load');
select assert_equals(
  (select count(*) from public.current_quote('dddddddd-0000-4000-8000-000000000001')),
  0, 'shipper B gets nothing from current_quote on another shipper''s load');
select assert_equals(
  (select count(*) from public.quotes),
  0, 'shipper B cannot read any of shipper A''s quotes');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 7. price integrity — no client writes a price (§14)
-- ════════════════════════════════════════════════════════════════════════════

select act_as('11111111-1111-4111-8111-111111111111');

select assert_raises(
  $$update public.loads set price_baisa = 1
     where id = 'dddddddd-0000-4000-8000-000000000001'$$,
  'a shipper cannot tamper with the price on their own load');

select assert_raises(
  $$insert into public.quotes
      (shipper_id, load_id, origin_city, dest_city, pickup_from, pickup_to,
       price_baisa, outcome)
    select id, 'dddddddd-0000-4000-8000-000000000001', 1, 2,
           current_date, current_date, 1, 'quoted'
    from public.profiles limit 1$$,
  'a shipper cannot forge a quote');

-- Immutability: no grant, and a trigger behind the grant.
select assert_raises(
  $$update public.quotes set price_baisa = 1$$,
  'a shipper cannot rewrite an issued quote');
select assert_raises(
  $$delete from public.quotes$$,
  'a shipper cannot delete an issued quote');

select assert_raises(
  $$select public.ops_set_price('dddddddd-0000-4000-8000-000000000001', 1)$$,
  'a shipper cannot reach the ops override');

select act_as_reset();

-- The trigger binds the owner too, which is the layer a grant cannot provide.
select assert_raises(
  $$update public.quotes set price_baisa = 999$$,
  'not even the table owner can edit a quote');

-- ════════════════════════════════════════════════════════════════════════════
-- 8. authorization matrix — each new RPC x each role (§14)
-- ════════════════════════════════════════════════════════════════════════════

select act_as_anon();
select assert_raises($$select public.quote_load('dddddddd-0000-4000-8000-000000000001')$$,
  'anon cannot quote');
select assert_raises($$select public.current_quote('dddddddd-0000-4000-8000-000000000001')$$,
  'anon cannot read a quote');
select assert_raises($$select public.ops_set_price('dddddddd-0000-4000-8000-000000000001', 50000)$$,
  'anon cannot set a price');
select act_as_reset();

-- A driver holds EXECUTE (the grant is to `authenticated`), so the check that
-- matters is the one inside the function.
select act_as('33333333-3333-4333-8333-333333333333');
select assert_raises(
  $$select public.quote_load('dddddddd-0000-4000-8000-000000000001')$$,
  'a driver cannot quote a load they do not own');
select assert_raises(
  $$select public.ops_set_price('dddddddd-0000-4000-8000-000000000001', 50000)$$,
  'a driver is not ops');
select act_as_reset();

-- ─── ops can, and is bounded ────────────────────────────────────────────────

select act_as('55555555-5555-4555-8555-555555555555');  -- dispatcher

select assert_raises(
  $$select public.ops_set_price('dddddddd-0000-4000-8000-000000000002', 0)$$,
  'ops cannot set a zero price');
select assert_raises(
  $$select public.ops_set_price('dddddddd-0000-4000-8000-000000000002', -5)$$,
  'ops cannot set a negative price');
-- 1,000,001 OMR. The fat-finger guard: OMR's three decimals make every amount
-- look 1000x larger than it is, so an extra keystroke is easy and expensive.
select assert_raises(
  $$select public.ops_set_price('dddddddd-0000-4000-8000-000000000002', 1000000001)$$,
  'ops cannot set an absurd price');

select public.ops_set_price('dddddddd-0000-4000-8000-000000000002', 45000);
select act_as_reset();

select assert_equals(
  (select price_baisa from public.loads where id = 'dddddddd-0000-4000-8000-000000000002'),
  45000, 'ops can hand-price the advise-me load');

select assert_equals(
  (select count(*) from public.quotes
    where load_id = 'dddddddd-0000-4000-8000-000000000002'
      and outcome = 'quoted' and rate_card_id is null),
  1, 'a hand-priced load is recorded as a quote with no rate card');

-- The dispatcher must be able to SEE the price they set, or they will send it
-- twice. 0009's lesson: a column that no function reads stays wrong silently, so
-- the new ops_queue column gets read here rather than only in a screen.
select act_as('55555555-5555-4555-8555-555555555555');
select assert_equals(
  (select q.price_baisa from public.ops_queue() q
    where q.load_id = 'dddddddd-0000-4000-8000-000000000002'),
  45000, 'ops_queue reports the price back to the dispatcher');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 8b. quote_route — pricing before commitment (0011)
--
-- The estimate the shipper sees on the post-load review step. Must agree with the
-- quote they are subsequently issued, must write nothing, and must not become a
-- cheaper way to sweep the rate card than posting loads was.
-- ════════════════════════════════════════════════════════════════════════════

select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A

-- The estimate and the issued quote come from one implementation, so they cannot
-- drift. This is the assertion that would catch someone re-inlining the outcome
-- rules into one of the two functions.
select assert_equals(
  (select r.price_baisa from public.quote_route(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Salalah'),
     '10t', 9600) r),
  150000, 'quote_route agrees with the price quote_load issued for the same route');

select assert_text(
  (select r.outcome from public.quote_route(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Salalah'),
     null, 9600) r),
  'advise_me', 'quote_route keeps "advise me" unpriceable rather than guessing');

select assert_text(
  (select r.outcome from public.quote_route(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Salalah'),
     'hiup', 12000) r),
  'over_capacity', 'quote_route refuses to price an overloaded truck');

select assert_text(
  (select r.outcome from public.quote_route(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Sohar'),
     '10t', 5000) r),
  'no_rate', 'quote_route reports an unpriced corridor rather than failing');

-- An estimate is not a commitment. Nothing is written, so exploring the form does
-- not fill `quotes` with prices nobody agreed to.
select assert_equals(
  (select count(*) from public.quotes
    where load_id is null or load_id not in (
      'dddddddd-0000-4000-8000-000000000001','dddddddd-0000-4000-8000-000000000002',
      'dddddddd-0000-4000-8000-000000000003','dddddddd-0000-4000-8000-000000000004',
      'dddddddd-0000-4000-8000-000000000005')),
  0, 'quote_route issues no quote row');

-- Bounds mirror the `loads` constraints, so nothing is priceable that could not
-- also be posted.
select assert_raises(
  $$select public.quote_route(
      (select id from public.cities where name_en = 'Muscat'),
      (select id from public.cities where name_en = 'Muscat'), '10t', 5000)$$,
  'quote_route rejects a circular route');
select assert_raises(
  $$select public.quote_route(999999, 999998, '10t', 5000)$$,
  'quote_route rejects an unknown city');
select assert_raises(
  $$select public.quote_route(
      (select id from public.cities where name_en = 'Muscat'),
      (select id from public.cities where name_en = 'Salalah'), '10t', 99999)$$,
  'quote_route rejects an absurd weight');

select act_as_reset();

-- The rate card stays unreachable, and the new entry point does not become a
-- back door to the formula.
select act_as('33333333-3333-4333-8333-333333333333');  -- a driver
select assert_raises(
  $$select public.quote_route(
      (select id from public.cities where name_en = 'Muscat'),
      (select id from public.cities where name_en = 'Salalah'), '10t', 5000)$$,
  'a driver cannot price a route — only shippers quote');
select assert_raises(
  $$select private.price_for(1, 2, '10t', 5000)$$,
  'a driver cannot reach the shared pricing decision directly');
select act_as_reset();

select act_as_anon();
select assert_raises(
  $$select public.quote_route(1, 2, '10t', 5000)$$,
  'anon cannot price a route');
select act_as_reset();

select act_as('11111111-1111-4111-8111-111111111111');
select assert_raises(
  $$select private.price_for(1, 2, '10t', 5000)$$,
  'a shipper cannot reach the shared pricing decision directly either');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 9. the binding guard — a price never survives a change to what it priced (§5)
-- ════════════════════════════════════════════════════════════════════════════

update public.loads
   set dest_city = (select id from public.cities where name_en = 'Sohar')
 where id = 'dddddddd-0000-4000-8000-000000000001';

select assert_null(
  (select price_baisa from public.loads where id = 'dddddddd-0000-4000-8000-000000000001'),
  're-routing a load drops its price rather than carrying it to a new destination');

-- The quote itself survives as the record of what was priced under the old
-- binding, which is what makes the drop auditable rather than a silent erase.
-- (Section 4 quotes this load more than once, and each call correctly issues a
-- new immutable row rather than amending the last one — hence "at least".)
select assert_at_least(
  (select count(*) from public.quotes
    where load_id = 'dddddddd-0000-4000-8000-000000000001' and price_baisa = 150000),
  1, 'the superseded quote remains on the record');

-- ════════════════════════════════════════════════════════════════════════════
-- 10. expiry is enforced server-side (§5)
-- ════════════════════════════════════════════════════════════════════════════

-- Age the quote past its window. Done as owner with the trigger disabled, since
-- the immutability trigger correctly refuses even this.
alter table public.quotes disable trigger quotes_no_update;
update public.quotes set expires_at = now() - interval '1 minute'
where load_id = 'dddddddd-0000-4000-8000-000000000002';
alter table public.quotes enable trigger quotes_no_update;

select act_as('11111111-1111-4111-8111-111111111111');
select assert_equals(
  (select count(*) from public.current_quote('dddddddd-0000-4000-8000-000000000002')),
  0, 'an expired quote is not returned as current');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- 11. rate-card configuration is validated, not silently accepted
-- ════════════════════════════════════════════════════════════════════════════

select assert_raises(
  $$insert into private.rate_cards
      (origin_corridor, dest_corridor, truck_type_code,
       base_baisa, per_tonne_baisa, min_fare_baisa)
    values ('Muscat govrenorate', 'UAE', '10t', 50000, 10000, 80000)$$,
  'a mistyped corridor is rejected rather than silently pricing nothing');

select assert_raises(
  $$insert into private.rate_cards
      (origin_corridor, dest_corridor, truck_type_code,
       base_baisa, per_tonne_baisa, min_fare_baisa)
    values ('UAE', 'Sharqiyah', 'lorry', 50000, 10000, 80000)$$,
  'an unknown truck type is rejected');

select assert_raises(
  $$insert into private.rate_cards
      (origin_corridor, dest_corridor, truck_type_code,
       base_baisa, per_tonne_baisa, min_fare_baisa)
    values ('UAE', 'Sharqiyah', '10t', 50000, 10000, 0)$$,
  'a zero minimum fare is rejected at configuration time');

-- ════════════════════════════════════════════════════════════════════════════
-- estimate_route (0021) — the pre-commit RANGE on the review screen.
--
-- The graceful path is the DEFAULT path today: the rate card ships empty, so
-- every call returns NULL prices and the screen says a person will price it. A
-- shipper must never see an error there (CLAUDE.md #6), so that case is asserted
-- first and hardest.
-- ════════════════════════════════════════════════════════════════════════════

select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A

-- A card IS loaded at this point in the file (Muscat -> Salalah, 10t), so this
-- is the priced path: 150.000 OMR +/- 15%, rounded outward to whole rials.
select assert_text(
  (select outcome from public.estimate_route(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Salalah'),
     '10t', 9600)),
  'estimated', 'a loaded band produces a range');

select assert_equals(
  (select low_baisa from public.estimate_route(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Salalah'),
     '10t', 9600)),
  127000, 'low is 150.000 less 15%, floored to a whole rial');

select assert_equals(
  (select high_baisa from public.estimate_route(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Salalah'),
     '10t', 9600)),
  173000, 'high is 150.000 plus 15%, ceiled to a whole rial');

-- The range must bracket what quote_route would actually charge. If it does not,
-- the shipper is shown a band their real price falls outside of.
select assert_equals(
  (select count(*)::bigint from public.estimate_route(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Salalah'),
     '10t', 9600) e
   where e.low_baisa <= 150000 and e.high_baisa >= 150000),
  1, 'the range brackets the price the load would actually be quoted');

-- "Not sure — advise me" is the default choice in the product. It must produce a
-- human path, not an error and not a guessed price.
select assert_text(
  (select outcome from public.estimate_route(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Salalah'),
     null, 9600)),
  'advise_me', 'a NULL truck type asks a person rather than guessing');

select assert_equals(
  (select count(*)::bigint from public.estimate_route(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Salalah'),
     null, 9600) e
   where e.low_baisa is null and e.high_baisa is null),
  1, 'an unpriced outcome carries no numbers at all');

select act_as_reset();

-- Now the shipped state: a corridor with no card. Today that is EVERY corridor,
-- because the card ships empty — so this is the path a real shipper takes.
--
-- Deliberately not `delete from private.rate_cards` here: a quote issued above
-- references the card, and quotes are immutable, so the cascade is refused. That
-- refusal is correct and worth knowing about — a priced quote keeps its
-- provenance even if the card is later retired.
select act_as('11111111-1111-4111-8111-111111111111');

select assert_text(
  (select outcome from public.estimate_route(
     (select id from public.cities where name_en = 'Sohar'),
     (select id from public.cities where name_en = 'Sur'),
     '10t', 9600)),
  'no_rate', 'an unpriced corridor returns no_rate rather than raising');

select assert_equals(
  (select count(*)::bigint from public.estimate_route(
     (select id from public.cities where name_en = 'Sohar'),
     (select id from public.cities where name_en = 'Sur'),
     '10t', 9600) e
   where e.low_baisa is null and e.high_baisa is null),
  1, 'no card means no numbers, and the screen says a person will price it');

select act_as_reset();

-- A driver cannot price a route. Same rule as quote_route: it halves the set of
-- accounts that can probe the card.
select act_as('33333333-3333-4333-8333-333333333333');
select assert_raises(
  $$select * from public.estimate_route(1::bigint, 2::bigint, null, null)$$,
  'a driver cannot estimate a route');
select act_as_reset();

-- ════════════════════════════════════════════════════════════════════════════
-- Per-kilometre pricing (0024).
--
-- The card keys on a CORRIDOR PAIR, so before this every city inside a band cost
-- the same: Muscat→Sohar and Muscat→Shinas priced identically despite 40 km
-- between them. OPEN_ISSUES has carried that since 0010.
-- ════════════════════════════════════════════════════════════════════════════

insert into private.rate_cards
  (origin_corridor, dest_corridor, truck_type_code,
   base_baisa, per_tonne_baisa, min_fare_baisa, per_km_baisa)
select
  private.corridor_of((select id from public.cities where name_en = 'Muscat')),
  private.corridor_of((select id from public.cities where name_en = 'Sohar')),
  '10t', 20000, 5000, 25000, 150
on conflict (origin_corridor, dest_corridor, truck_type_code) do update
  set per_km_baisa = 150, base_baisa = 20000, per_tonne_baisa = 5000, min_fare_baisa = 25000;

-- Superuser, not act_as: `private.price_for` is revoked from `authenticated`
-- (asserted earlier in this file), so a shipper cannot call it directly. The
-- shipper-facing path is quote_route, which is exercised above.

-- Two cities in the SAME corridor pair, at different distances, must now differ.
select assert_at_least(
  (select (select price_baisa from private.price_for(
             (select id from public.cities where name_en = 'Muscat'),
             (select id from public.cities where name_en = 'Sohar'), '10t', 9600))
        - (select price_baisa from private.price_for(
             (select id from public.cities where name_en = 'Muscat'),
             (select id from public.cities where name_en = 'Barka'), '10t', 9600))),
  1, 'a farther city in the same corridor band costs more');

-- The floor holds however badly a card is configured. Nothing is ever free.
select assert_equals(
  private.compute_price(0, 0, 25000, null, 0, 0),
  25000, 'a card with no base and no per-km still charges the minimum fare');

select assert_equals(
  private.compute_price(0, 0, 25000, 100, 0, 5),
  25000, 'a tiny load over a short distance still charges the minimum fare');

-- Distance is resolved server-side from cities.lat/lng, never supplied by a
-- caller: a client-supplied multiplier on a price is a client-supplied price.
select assert_at_least(
  (select private.route_km(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Salalah'))::bigint),
  900, 'Muscat to Salalah is resolved as a long road, not a straight line');

select assert_equals(
  (select count(*) from (select private.route_km(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Barka')) as km) q
   where q.km between 60 and 95),
  1, 'Muscat to Barka lands near the real road distance');

do $$ begin raise notice 'ALL PRICING ASSERTIONS HELD'; end $$;

rollback;
