# P5 · Driver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the driver's seven screens (D1–D7) on a payout, detour and
earnings layer that lives entirely in SQL, and close the rate-card hole that lets
any driver price any corridor.

**Architecture:** Three migrations land and are asserted before any screen is
built, as in P4. Drivers stop reading `public.loads` and read composed answers
from `driver_offers()` instead — that is where payout, collect, owed, detour and
remaining capacity are computed, beside the price they derive from. Screens are
assembled from `src/components/primitives.tsx` and `src/components/ui.tsx`; the
map spur is the one new drawing primitive and it lives in `src/map/`.

**Tech Stack:** Expo / React Native, expo-router, TanStack Query, Supabase
(Postgres + RLS), `react-native-svg` + `d3-geo` for the map, Jest + RNTL.

## Where this stands (2026-07-31)

**Done and committed: every task.** Tasks 1/1b were verified in a browser — the
commission panel was driven end to end and the rate reached
`private.app_settings` with an audit row. **Tasks 2–12 are verified by tests
only; no driver screen has been seen on a device or in Arabic** (OPEN_ISSUES 30).

Green at 418 JS tests and three SQL suites.

**Seven decisions taken while building that depart from the plan as written:**

1. **`post_leg` gained `p_free_kg` in 0029, not in Task 4.** The plan had Task 4
   editing an already-applied 0029. The old six-argument signature is dropped in
   the same migration, per the 0024 lesson.
2. **Task 2's `f4` assertions were rewritten.** The fixtures the plan named are
   both Muscat→Salalah, so `detour >= 0` was trivially true of zero. Section 8
   now inserts a genuinely off-line load (Nizwa→Sohar) and asserts the detour
   exceeds the distance from the corridor to the pickup — the "loop, not half of
   it" claim, actually tested.
3. **Task 3 §3 was already done.** `quote_route` (0011) and `estimate_route`
   (0021) each reject a non-shipper before touching an argument. Reproducing both
   bodies to insert a guard they already carry would have risked two rate-card
   lookups for no change in behaviour, so 0030 asserts it instead. The refusal
   stays `not permitted` rather than the plan's `not found`: it is raised before
   any argument is read, so it is identical for every input and discloses only
   the caller's own role.
4. **`driver_earnings` buckets on the delivery event, not `trips.created_at`,
   and on Muscat's calendar, not UTC.** A trip opened three weeks ago and
   delivered this morning is this week's money. `created_at` remains the fallback
   for a trip closed without a `delivered` event.
5. **`useVisibleLoads` is deprecated, not yet deleted.** Its three call sites are
   `driver.tsx`, `offers.tsx` and `trip/[id].tsx`, all rewritten in Tasks 8–11 —
   deleting it in Task 4 would have left the tree not typechecking across four
   commits. It carries a `@deprecated` warning and goes with the last call site.

6. **A sixth migration, 0031 `driver_trip`.** D7 states what the driver earns.
   `payout_for` is private, so without a composed read the screen either shows
   the shipper's price as the driver's wage or applies the commission in
   TypeScript — the second is the pricing formula leaving SQL. It also removed
   the last reader of `useVisibleLoads`, which is now deleted as the plan asked.
7. **D1 keeps the live trip.** The driver tabs are home / offers / routes /
   account, so with no jobs tab, home is the only route to a delivery in
   progress. It is a compact row above the offers, not a second decision.

Task 7 was also pulled ahead of Task 5: `t()` is typed by `StringKey`, so a
screen cannot reference a string that does not exist yet. Three small additions
the plan did not list: `drv.home.greeting.one` (so one offer does not read "1
loads want your truck"), `drv.offer.about` (the detour is an estimate and the
copy must say so), and `PrimaryButton tall` / `CTA_TALL` for D7's 64px action.
`MapStepShell` / `QuestionShell` now take `step`/`total` as numbers rather than a
booking step name, so the driver's two-step flow reuses the same chrome instead
of growing a second copy of it.

**Two things learned while doing Tasks 1/1b, worth carrying forward:**

1. `useOpsMutation` in the console invalidated seven query keys and not the one
   the commission panel reads, so a successful write left the old value on
   screen. Fixed there — but **any new ops panel that reads a value it also
   writes needs its key in that list**, or it will look broken while working.
2. `npm run test:db` needs a **fresh `npx supabase db reset`**. Seeding the demo
   dataset for a browser check makes `tenant_isolation` fail on assertions that
   have nothing to do with the change under test. The suite's own header says
   this; it is easy to forget an hour later.

**Local dev fixtures** (recreate after any `db reset`, they are not migrations):
a dispatcher account `dispatch@demo.local` / `dispatch-local-only`, appointed by
inserting into `private.ops_users`, plus `~/truckkoo-ops/dev/seed_demo.sql`.

## Global Constraints

- **Money is integer baisa.** OMR has three decimals. Use `src/lib/money.ts`.
  Never float, never `numeric`, never `toFixed(2)`.
- **No payment surfaces.** Showing an amount is fine; taking one is not.
- **The pricing formula lives only in SQL.** Never create `src/lib/pricing.ts`.
  Payout derives from price in SQL for the same reason.
- **Every `security definer` function pins `search_path = ''`** and fully
  qualifies identifiers **and types** — `public.load_status`, never bare.
- **A `$function$` body reproduced from a live definition ends in a semicolon.**
  0023 and 0024 shipped without one and parsed nowhere.
- **Deny by default.** New table or column → no client write grant. A
  column-level `revoke` does not cut a hole in a table-level `grant`.
- **Fetch scoped to the actor.** Return "not found", never "forbidden".
- **RTL is structural.** Logical properties only (`marginStart`, `paddingEnd`).
  Never `left`/`right`. All strings through `t()`. Use `align.start`, never
  `textAlign: 'left'`. **SVG coordinates are the exception** — a projected x is a
  place, not a reading direction.
- **Every type token names a `fontFamily`; none sets `fontWeight`.**
- **`font.button` stays ≥18.66px bold.** Do not "fix" it to the handoff's 17px.
- **Instrument Serif only via `QuestionHeading`, or for hero numbers. One
  display statement per screen.**
- **`color.delivered` is spent on T5 and appears nowhere in P5.**
- **Nothing new may import `src/components/legacy`.**
- **Never fabricate proof** — no ratings, trip counts or earnings that are not
  real. Absent, never zeroed.
- Migrations are append-only. Never edit an applied one.
- Verify with `npm run verify` and `npm run test:db` (needs `npx supabase start`).

---

## File Structure

**Created**
- `supabase/migrations/0028_driver_payout.sql` — commission rate, `payout_for`, ops RPC
- `supabase/migrations/0029_detour_and_capacity.sql` — `detour_km`, `legs.free_kg`
- `supabase/migrations/0030_driver_reads.sql` — `driver_offers`, `driver_offer`, `driver_earnings`, E3 guards
- `src/map/DetourSpur.tsx` — the dashed spur off a corridor (D2)
- `src/components/driver/OfferCard.tsx` — the D1 hero card, reused compressed in the offers list
- `src/components/driver/Money.tsx` — the collect / keep / owe triple, one implementation
- `src/app/(app)/offer/[id].tsx` — D2, keyed by **offer** id
- `src/app/(app)/leg/_layout.tsx`, `leg/route.tsx`, `leg/when.tsx` — D4, D5
- `tests/components/detour-spur.test.tsx`, `tests/components/driver-money.test.tsx`
- `tests/integration/driver-screens.test.tsx` — extended, not created

**Modified**
- `src/lib/queries.ts` — driver hooks; `useVisibleLoads` deleted
- `src/i18n/index.ts` — D1–D7 strings, en + ar
- `src/app/(app)/(tabs)/driver.tsx` — D1 + D3
- `src/app/(app)/(tabs)/offers.tsx` — the offers list
- `src/app/(app)/(tabs)/routes.tsx` — D6
- `src/app/(app)/post-leg.tsx` — becomes D4/D5 under `src/app/(app)/leg/`
- `src/app/(app)/trip/[id].tsx` — D7
- `supabase/tests/tenant_isolation.sql` — E3 and driver-read assertions
- `SENSITIVE_FIELDS.md`, `OPEN_ISSUES.md`

**Note on `src/app/(app)/leg/`:** D4/D5 replace `post-leg.tsx` with a two-step
flow mirroring `src/app/(app)/book/`. Create `src/app/(app)/leg/_layout.tsx`,
`route.tsx` (D4) and `when.tsx` (D5); delete `post-leg.tsx` in the same task.

---

## Task 1: 0028 — the commission rate and the payout ✅ DONE (`94efc34`)

**Files:**
- Create: `supabase/migrations/0028_driver_payout.sql`
- Modify: `supabase/tests/ops_console.sql`

**Interfaces:**
- Produces: `private.commission_pct() returns numeric`,
  `private.payout_for(p_price_baisa bigint) returns bigint`,
  `public.ops_set_commission(p_pct numeric, p_reason text) returns void`

- [ ] **Step 1: Write the migration**

```sql
-- Commission, as whole percent. 0 until someone sets it: a rate invented in a
-- migration is a number quoted to a driver the first time somebody forgets it
-- was a placeholder. Same rule as the rate card.
insert into private.app_settings (key, value)
values ('commission_pct', '0'::jsonb)
on conflict (key) do nothing;

create or replace function private.commission_pct()
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce((value #>> '{}')::numeric, 0)
  from private.app_settings where key = 'commission_pct';
$$;

revoke all on function private.commission_pct() from public, anon, authenticated;

-- What the driver keeps. Rounds DOWN to the baisa, so rounding never invents
-- money the shipper did not pay.
create or replace function private.payout_for(p_price_baisa bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_price_baisa is null then null
    else greatest(0, floor(p_price_baisa * (100 - private.commission_pct()) / 100)::bigint)
  end;
$$;

revoke all on function private.payout_for(bigint) from public, anon, authenticated;

create or replace function public.ops_set_commission(p_pct numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_before numeric;
begin
  perform private.require_ops();

  if p_pct is null or p_pct < 0 or p_pct > 40 then
    raise exception 'commission must be between 0 and 40 percent'
      using errcode = 'check_violation';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a commission change needs a reason'
      using errcode = 'check_violation';
  end if;

  v_before := private.commission_pct();

  insert into private.app_settings (key, value)
  values ('commission_pct', to_jsonb(p_pct))
  on conflict (key) do update set value = to_jsonb(p_pct);

  perform private.log_ops(
    'ops_set_commission', 'setting', 'commission_pct',
    jsonb_build_object('pct', v_before), jsonb_build_object('pct', p_pct), p_reason);
end;
$$;

revoke all on function public.ops_set_commission(numeric, text) from public, anon;
grant execute on function public.ops_set_commission(numeric, text) to authenticated;
```

- [ ] **Step 2: Add the assertions** to `supabase/tests/ops_console.sql`, before
      the `ALL OPS CONSOLE ASSERTIONS HELD` notice

```sql
-- ─── 9c. commission (0028) ──────────────────────────────────────────────────
select act_as_reset();
select assert_equals(private.payout_for(96000), 96000,
  'at 0 percent the driver keeps the whole price — the state we ship in');

select act_as('33333333-0000-4000-8000-00000000cccc');
select assert_raises($$select public.ops_set_commission(50, 'too much')$$,
  'a commission over 40 percent is refused as a slipped decimal');
select assert_raises($$select public.ops_set_commission(15, ' ')$$,
  'and a change with no reason is refused');
select public.ops_set_commission(18.75, 'Board rate, July 2026');
select act_as_reset();

select assert_equals(private.payout_for(96000), 78000,
  'at 18.75 percent, 96.000 OMR pays the driver 78.000');
select assert_true(
  (select a.after->>'pct' = '18.75' and a.reason like 'Board rate%'
     from private.ops_audit a where a.action = 'ops_set_commission'),
  'and the rate change is audited with its reason');

-- Rounding never invents money: the driver's share plus the margin is the price.
select assert_true(
  (select private.payout_for(96001) <= 96001),
  'payout never exceeds the price it came from');
```

- [ ] **Step 3: Apply and run**

Run: `npx supabase db reset && npm run test:db:ops`
Expected: the five new `pass:` lines, `ALL OPS CONSOLE ASSERTIONS HELD`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0028_driver_payout.sql supabase/tests/ops_console.sql
git commit -m "Derive the driver's payout from the shipper's price (0028)"
```

---

## Task 1b: The commission rate, editable from the dashboard ✅ DONE (`2f7ae88`)

**Repo:** `~/truckkoo-ops` (separate deployment, separate commit, branch first)

**Files:**
- Modify: `src/queries/mutations.ts`, `src/queries/rpc.ts` (read), `src/routes/System.tsx`
- Test: `src/queries/mutations.test.ts`

**Interfaces:**
- Consumes: `public.ops_set_commission(p_pct numeric, p_reason text)` (Task 1)
- Produces: `useSetCommission()`, and a commission panel on the System screen

- [ ] **Step 1: Read how the rate card panel does it** in `src/routes/System.tsx`
      and follow it exactly — the same `ConfirmAction` reason prompt, the same
      `writeError` surfacing. A second pattern for the same kind of act is how
      two screens end up disagreeing about what an audited change looks like.

- [ ] **Step 2: Add the mutation**

```ts
/**
 * The share Truckkoo keeps of a load's price. Whole percent, 0–40, refused
 * outside that as a slipped decimal. Every change needs a reason and lands in
 * ops_audit — the same rule as a rate band, for the same reason: it decides
 * what a driver is paid.
 */
export function useSetCommission() {
  return useOpsMutation(({ pct, reason }: { pct: number; reason: string }) =>
    rpc('ops_set_commission', { p_pct: pct, p_reason: reason }),
  );
}
```

- [ ] **Step 3: Show the current rate and what it means**

The panel states the rate AND a worked example in real money, because a
percentage is not a number anyone checks by eye: "18.75% — on a 96.000 OMR load
the driver keeps 78.000 and owes 18.000." A dispatcher setting this is deciding
somebody's wage.

- [ ] **Step 4: Run**

Run: `cd ~/truckkoo-ops && npm run verify`
Expected: green.

- [ ] **Step 5: Commit on a branch**

```bash
cd ~/truckkoo-ops && git checkout -b p5/commission
git add -A && git commit -m "Set the driver's commission from the dashboard"
```

---

## Task 2: 0029 — detour, and the space left on a truck ✅ DONE (`40e8484`)

**Files:**
- Create: `supabase/migrations/0029_detour_and_capacity.sql`
- Modify: `supabase/tests/tenant_isolation.sql`

**Interfaces:**
- Consumes: `private.route_km(bigint, bigint) returns numeric` (0024)
- Produces: `private.detour_km(p_leg_id uuid, p_load_id uuid) returns numeric`,
  column `public.legs.free_kg integer`

- [ ] **Step 1: Write the migration**

```sql
-- The true extra distance driven:
--   (leg origin → pickup → dropoff → leg dest) − (leg origin → leg dest)
-- Not the pickup's distance from the corridor. A driver turns off, carries the
-- load, and comes back — the cost is the whole loop, and quoting half of it
-- beside a payout would flatter every offer.
create or replace function private.detour_km(p_leg_id uuid, p_load_id uuid)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_leg  public.legs;
  v_load public.loads;
  v_with numeric;
  v_direct numeric;
begin
  select * into v_leg  from public.legs  l where l.id = p_leg_id;
  select * into v_load from public.loads d where d.id = p_load_id;
  if v_leg.id is null or v_load.id is null then
    return null;
  end if;

  v_with :=   private.route_km(v_leg.origin_city,  v_load.origin_city)
            + private.route_km(v_load.origin_city, v_load.dest_city)
            + private.route_km(v_load.dest_city,   v_leg.dest_city);
  v_direct := private.route_km(v_leg.origin_city,  v_leg.dest_city);

  if v_with is null or v_direct is null then
    return null;
  end if;

  -- Never negative. A load that shortens the trip is a rounding artefact of
  -- great-circle arithmetic, not a driver being paid to go home early.
  return greatest(0, round(v_with - v_direct, 1));
end;
$$;

revoke all on function private.detour_km(uuid, uuid) from public, anon, authenticated;

-- How much room is left on a part-loaded truck. NULL is "empty, or did not
-- say" — the same shape as loads.truck_type_code and for the same reason: a
-- low-tech user must be allowed not to answer.
alter table public.legs add column if not exists free_kg integer;

alter table public.legs add constraint legs_free_kg_sane
  check (free_kg is null or (free_kg > 0 and free_kg <= 60000));

comment on column public.legs.free_kg is
  'Roughly how much space is left on a part-loaded truck. NULL = empty or unstated.';

-- legs already carries column-level insert grants; free_kg joins them because a
-- driver states it about their own leg. It is not sensitive: it is supply
-- information the driver volunteers, and it never leaves driver-owned rows.
grant insert (free_kg), update (free_kg) on public.legs to authenticated;
```

- [ ] **Step 2: Add the assertions** to `supabase/tests/tenant_isolation.sql`,
      before the `ALL TENANT ISOLATION ASSERTIONS HELD` notice

```sql
-- ─── 8. detour and capacity (0029) ──────────────────────────────────────────
-- A load sitting exactly on the leg costs nothing extra.
select assert_true(
  (select private.detour_km('bbbbbbbb-0000-4000-8000-000000000001',
                            'aaaaaaaa-0000-4000-8000-000000000001') = 0),
  'a load whose route IS the leg adds no distance');

-- A load off the line costs the loop, not half of it.
select assert_true(
  (select private.detour_km('bbbbbbbb-0000-4000-8000-0000000000f4',
                            'aaaaaaaa-0000-4000-8000-0000000000f4') >= 0),
  'and a detour is never negative, whatever the arithmetic says');

select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A
select assert_raises(
  $$update public.legs set driver_id = '44444444-4444-4444-8444-444444444444'
     where id = 'bbbbbbbb-0000-4000-8000-000000000001'$$,
  'free_kg is writable but ownership still is not');
select act_as_reset();
```

- [ ] **Step 3: Apply and run**

Run: `npx supabase db reset && npm run test:db:tenants`
Expected: three new `pass:` lines, `ALL TENANT ISOLATION ASSERTIONS HELD`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0029_detour_and_capacity.sql supabase/tests/tenant_isolation.sql
git commit -m "Cost a detour honestly, and let a driver say what room is left (0029)"
```

---

## Task 3: 0030 — what a driver may read, and the rate-card hole ✅ DONE (`4f5840e`)

**Files:**
- Create: `supabase/migrations/0030_driver_reads.sql`
- Modify: `supabase/tests/tenant_isolation.sql`

**Interfaces:**
- Consumes: `private.payout_for`, `private.detour_km`
- Produces: `public.driver_offers()`, `public.driver_offer(p_offer_id uuid)`,
  `public.driver_earnings()`, each `returns table (...)` with the columns below

- [ ] **Step 1: Write the migration**

```sql
-- ═══ 1. the driver's view of an offer ═══════════════════════════════════════
-- Drivers stop reading public.loads. Not because the price is a secret from
-- them — they collect it in cash, see the spec §2 — but because this is where
-- payout, detour and remaining capacity are computed, and because a table-level
-- `grant select` hands a driver every column the table ever grows.

create or replace function public.driver_offers()
returns table (
  offer_id      uuid,
  expires_at    timestamptz,
  leg_id        uuid,
  origin_city   bigint,
  dest_city     bigint,
  pickup_from   date,
  pickup_to     date,
  goods         text,
  weight_kg     integer,
  truck_type_code text,
  collect_baisa bigint,
  payout_baisa  bigint,
  owed_baisa    bigint,
  currency      char(3),
  detour_km     numeric,
  free_after_kg integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    o.id, o.expires_at, o.leg_id,
    l.origin_city, l.dest_city, l.pickup_from, l.pickup_to,
    l.goods_description, l.weight_kg, l.truck_type_code,
    l.price_baisa,
    private.payout_for(l.price_baisa),
    l.price_baisa - private.payout_for(l.price_baisa),
    l.currency,
    case when o.leg_id is null then null
         else private.detour_km(o.leg_id, l.id) end,
    -- What is left on the truck after this load. NULL when either number is
    -- unknown, never a guess: a driver planning a second load on a maybe is
    -- worse off than one told nothing.
    case when t.capacity_kg is null or l.weight_kg is null then null
         else greatest(0, t.capacity_kg - l.weight_kg) end
  from public.offers o
  join public.loads l on l.id = o.load_id
  left join public.legs g on g.id = o.leg_id
  left join public.trucks t on t.id = g.truck_id
  -- Scoped to the actor INSIDE the definer, like match_load. Without this it is
  -- an IDOR into every driver's work and every shipper's cargo at once.
  where o.driver_id = v_actor
    and o.status = 'pending'
    and o.expires_at > now()
  order by o.created_at desc;
end;
$$;

revoke all on function public.driver_offers() from public, anon;
grant execute on function public.driver_offers() to authenticated;

-- One offer, by OFFER id. Never by load id: a driver holds no load id, and
-- accepting one would re-open the door this closes.
create or replace function public.driver_offer(p_offer_id uuid)
returns table (
  offer_id      uuid,
  expires_at    timestamptz,
  leg_id        uuid,
  origin_city   bigint,
  dest_city     bigint,
  pickup_from   date,
  pickup_to     date,
  goods         text,
  weight_kg     integer,
  truck_type_code text,
  collect_baisa bigint,
  payout_baisa  bigint,
  owed_baisa    bigint,
  currency      char(3),
  detour_km     numeric,
  free_after_kg integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.driver_offers() d where d.offer_id = p_offer_id;
$$;

revoke all on function public.driver_offer(uuid) from public, anon;
grant execute on function public.driver_offer(uuid) to authenticated;

-- ═══ 2. what a driver has earned ════════════════════════════════════════════
-- THE WEEK STARTS ON SUNDAY. Oman's weekend is Friday–Saturday, so an ISO
-- Monday-start week shows every driver last week's total every Sunday, on the
-- screen they check most.
create or replace function public.driver_earnings()
returns table (week_baisa bigint, week_trips bigint, all_time_trips bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_start date;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- date_trunc('week') is Monday-based and has no option. Subtracting the ISO
  -- day-of-week modulo 7 walks back to Sunday instead.
  v_start := current_date - (extract(isodow from current_date)::int % 7);

  return query
  select
    coalesce(sum(private.payout_for(l.price_baisa))
             filter (where t.created_at::date >= v_start), 0)::bigint,
    count(*) filter (where t.created_at::date >= v_start)::bigint,
    count(*)::bigint
  from public.trips t
  join public.loads l on l.id = t.load_id
  where t.driver_id = v_actor
    and t.status in ('delivered'::public.trip_status, 'closed'::public.trip_status);
end;
$$;

revoke all on function public.driver_earnings() from public, anon;
grant execute on function public.driver_earnings() to authenticated;

-- ═══ 3. the rate card is not a driver's to enumerate ════════════════════════
-- THE ACTUAL SECURITY CHANGE. Both functions are granted to `authenticated`,
-- and a driver's own offer card carries every argument they take — so a driver
-- can price any corridor at any weight and read the card band by band. That is
-- crown jewel #1 (SECURITY.md §1), and it is a different thing from the margin
-- on their own load, which they can and should see.
--
-- Reproduce each live body with `select pg_get_functiondef(oid) from pg_proc
-- where proname = 'quote_route'` and paste it below UNCHANGED except for the
-- guard, inserted immediately after the existing auth.uid() null check. Do not
-- paraphrase the body: both carry rate-card lookups that must not be lost.
-- REMEMBER THE TRAILING SEMICOLON after $function$.
--
-- The guard, identical in both:
--
--   if not exists (
--     select 1 from public.profiles p
--     where p.id = auth.uid() and p.role = 'shipper'::public.user_role
--   ) then
--     raise exception 'not found' using errcode = 'no_data_found';
--   end if;
--
-- "Not found", never "forbidden" — a distinct refusal would confirm the
-- function prices something.
```

- [ ] **Step 2: Add the assertions** to `supabase/tests/tenant_isolation.sql`

```sql
-- ─── 9. the driver's reads, and the rate card (0030) ────────────────────────
select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A
select assert_raises(
  $$select * from public.quote_route(
      (select id from public.cities where name_en = 'Muscat'),
      (select id from public.cities where name_en = 'Salalah'), '10t', 9000)$$,
  'a driver cannot price a corridor — that is the rate card, band by band');
select assert_raises(
  $$select * from public.estimate_route(
      (select id from public.cities where name_en = 'Muscat'),
      (select id from public.cities where name_en = 'Salalah'), '10t', 9000)$$,
  'nor estimate one');
select act_as_reset();

-- And a shipper loses nothing.
select act_as('11111111-1111-4111-8111-111111111111');
select assert_true(
  (select count(*) >= 0 from public.estimate_route(
     (select id from public.cities where name_en = 'Muscat'),
     (select id from public.cities where name_en = 'Salalah'), '10t', 9000)),
  'a shipper still gets an estimate');
select act_as_reset();

-- driver_offers is scoped to the caller, not to the argument.
select act_as('44444444-4444-4444-8444-444444444444');  -- Driver B
select assert_equals((select count(*) from public.driver_offers()), 0,
  'a driver with no offer sees none of anybody else''s');
select act_as_reset();

-- The earnings week starts on Sunday, and a driver only ever sees their own.
select act_as('44444444-4444-4444-8444-444444444444');
select assert_equals((select week_trips from public.driver_earnings()), 0,
  'a driver who has delivered nothing has earned nothing — 0, not an error');
select act_as_reset();
```

- [ ] **Step 3: Apply and run the whole suite**

Run: `npx supabase db reset && npm run test:db`
Expected: all three suites green, including the six new lines.

- [ ] **Step 4: Verify the week boundary by hand**

Run:
```bash
docker exec -i supabase_db_truckkoo-app psql -U postgres -d postgres -Atc \
  "select current_date - (extract(isodow from current_date)::int % 7) as week_start,
          to_char(current_date - (extract(isodow from current_date)::int % 7), 'Dy');"
```
Expected: a date whose day name is `Sun`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0030_driver_reads.sql supabase/tests/tenant_isolation.sql
git commit -m "Give the driver their own view, and close the rate card (0030)"
```

---

## Task 4: The client query layer ✅ DONE (`06446f1`)

**Files:**
- Modify: `src/lib/queries.ts`
- Test: `tests/unit/driver-queries.test.tsx` (create)

**Interfaces:**
- Consumes: `driver_offers`, `driver_offer`, `driver_earnings`
- Produces: `DriverOffer`, `DriverEarnings` types; `useDriverOffers()`,
  `useDriverOffer(offerId)`, `useDriverEarnings()`; `PostLegInput.freeKg`

- [ ] **Step 1: Add the types and hooks**

```ts
/**
 * What a driver may know about an offer.
 *
 * `collect_baisa` is the shipper's price and `payout_baisa` is what the driver
 * keeps — both are on the card deliberately. A driver collects the first in cash
 * and remits the difference, so hiding either would leave them guessing at the
 * gate. See the P5 spec §2: the per-load margin is not a secret from the person
 * carrying the load.
 */
export type DriverOffer = {
  offer_id: string;
  expires_at: string;
  leg_id: string | null;
  origin_city: number;
  dest_city: number;
  pickup_from: string;
  pickup_to: string;
  goods: string;
  weight_kg: number | null;
  truck_type_code: string | null;
  collect_baisa: number | null;
  payout_baisa: number | null;
  owed_baisa: number | null;
  currency: string;
  /** NULL when the offer carries no leg, or a city has no coordinate. */
  detour_km: number | null;
  /** NULL when capacity or weight is unknown — never a guess. */
  free_after_kg: number | null;
};

export function useDriverOffers() {
  return useQuery({
    queryKey: ['driver', 'offers'],
    queryFn: async (): Promise<DriverOffer[]> => {
      const { data, error } = await supabase.rpc('driver_offers');
      if (error) throw error;
      return (data ?? []) as DriverOffer[];
    },
  });
}

export function useDriverOffer(offerId: string | undefined) {
  return useQuery({
    queryKey: ['driver', 'offer', offerId],
    enabled: !!offerId,
    queryFn: async (): Promise<DriverOffer | null> => {
      const { data, error } = await supabase.rpc('driver_offer', { p_offer_id: offerId });
      if (error) throw error;
      return ((data ?? []) as DriverOffer[])[0] ?? null;
    },
  });
}

/** The week starts on Sunday — Oman's weekend is Friday–Saturday. Server-side. */
export type DriverEarnings = { week_baisa: number; week_trips: number; all_time_trips: number };

export function useDriverEarnings() {
  return useQuery({
    queryKey: ['driver', 'earnings'],
    queryFn: async (): Promise<DriverEarnings | null> => {
      const { data, error } = await supabase.rpc('driver_earnings');
      if (error) throw error;
      const r = ((data ?? []) as Record<string, string | number>[])[0];
      if (!r) return null;
      return {
        week_baisa: Number(r.week_baisa),
        week_trips: Number(r.week_trips),
        all_time_trips: Number(r.all_time_trips),
      };
    },
  });
}
```

- [ ] **Step 2: Add `freeKg` to `PostLegInput` and `usePostLeg`**

In `PostLegInput` add `freeKg?: number | null;`. In the `usePostLeg` mutation
body add `p_free_kg: input.freeKg ?? null` to the `rpc('post_leg', {...})`
argument object, and update `post_leg` in 0029 to accept and store it.

> **If `post_leg` does not take `p_free_kg`:** add the parameter in 0029 by
> reproducing the live definition (`pg_get_functiondef`) with the new argument
> defaulted to `null`, and **drop the old signature in the same migration** —
> a defaulted argument makes the old arity ambiguous and Postgres refuses the
> call, killing leg posting entirely. 0024 documents this exact failure.

- [ ] **Step 3: Delete `useVisibleLoads`**

It is the driver's old table read and nothing may adopt it. Remove the function
and every import. `npx tsc --noEmit` names the call sites.

- [ ] **Step 4: Invalidate driver keys on accept**

In `useRespondToOffer`'s `onSuccess`, add:

```ts
qc.invalidateQueries({ queryKey: ['driver'] });
```

- [ ] **Step 5: Run**

Run: `npx tsc --noEmit && npx eslint src/lib/queries.ts`
Expected: clean, once every `useVisibleLoads` call site is gone.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries.ts
git commit -m "Move the driver off the loads table and onto their own view"
```

---

## Task 5: The money triple ✅ DONE (`5b33e3e`)

**Files:**
- Create: `src/components/driver/Money.tsx`
- Test: `tests/components/driver-money.test.tsx`

**Interfaces:**
- Produces: `<DriverMoney payout collect owed currency size="hero"|"row" />`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react-native';
import { DriverMoney } from '@/components/driver/Money';
import { initLanguage } from '@/i18n';

beforeEach(() => initLanguage('en'));

describe('DriverMoney', () => {
  it('leads with what the driver keeps', () => {
    render(<DriverMoney payout={78000} collect={96000} owed={18000} currency="OMR" />);
    expect(screen.getByText('78.000')).toBeTruthy();
  });

  it('says what to collect and what is owed, because the driver handles both', () => {
    render(<DriverMoney payout={78000} collect={96000} owed={18000} currency="OMR" />);
    // A driver handed 96 while the screen says 78 is being misled at the gate.
    expect(screen.getByText(/96\.000/)).toBeTruthy();
    expect(screen.getByText(/18\.000/)).toBeTruthy();
  });

  it('says nothing about a margin when there is none', () => {
    // At 0 percent commission — the state the product ships in — a second and
    // third number would be noise on the screen a driver reads one-handed.
    render(<DriverMoney payout={96000} collect={96000} owed={0} currency="OMR" />);
    expect(screen.queryByText(/to Truckkoo/)).toBeNull();
  });

  it('renders three OMR decimals, never two', () => {
    render(<DriverMoney payout={78500} collect={96000} owed={17500} currency="OMR" />);
    expect(screen.queryByText('78.50')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest tests/components/driver-money.test.tsx`
Expected: FAIL — cannot resolve `@/components/driver/Money`.

- [ ] **Step 3: Implement**

`payout` is the hero in `font.payoutHero` (serif, the one display number on the
screen). `collect` and `owed` render as a single supporting caption line, and
**the whole supporting line is omitted when `owed === 0`**. Use `formatMoney` for
every amount and `align.start` for every `textAlign`. Strings:
`t('drv.money.keep')`, `t('drv.money.collect')`, `t('drv.money.owe')`.

- [ ] **Step 4: Run and pass**

Run: `npx jest tests/components/driver-money.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/driver/Money.tsx tests/components/driver-money.test.tsx
git commit -m "Show the driver all three numbers, with what they keep leading"
```

---

## Task 6: The detour spur ✅ DONE (`d40cbdc`)

**Files:**
- Create: `src/map/DetourSpur.tsx`
- Modify: `src/map/index.ts`
- Test: `tests/components/detour-spur.test.tsx`

**Interfaces:**
- Consumes: `useProjection`, `project` from `src/map/MapCanvas` / `framing`
- Produces: `<DetourSpur from={{lng,lat}} to={{lng,lat}} />`

- [ ] **Step 1: Write the failing test**

```tsx
import { render } from '@testing-library/react-native';
import { MapCanvas, DetourSpur } from '@/map';

describe('DetourSpur', () => {
  it('draws dashed, because a detour is not a committed corridor', () => {
    const { getByTestId } = render(
      <MapCanvas framing="domestic" width={300} height={300}>
        <DetourSpur from={{ lng: 58.4, lat: 23.6 }} to={{ lng: 58.0, lat: 23.7 }} />
      </MapCanvas>,
    );
    expect(getByTestId('detour-spur').props.strokeDasharray).toBeTruthy();
  });

  it('ends in a dot at the pickup, so the turn-off point is a place', () => {
    const { getByTestId } = render(
      <MapCanvas framing="domestic" width={300} height={300}>
        <DetourSpur from={{ lng: 58.4, lat: 23.6 }} to={{ lng: 58.0, lat: 23.7 }} />
      </MapCanvas>,
    );
    expect(getByTestId('detour-pin')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest tests/components/detour-spur.test.tsx`
Expected: FAIL — `DetourSpur` is not exported from `@/map`.

- [ ] **Step 3: Implement**

A `<Line>` at `strokeDasharray="5 5"`, `stroke="rgba(247,245,242,.4)"`,
`strokeWidth={2.2}`, `testID="detour-spur"`, plus a 6px `#F7F5F2` `<Circle>` at
the `to` end with `testID="detour-pin"`. Take the projection from context — never
compute one. Export from `src/map/index.ts`.

**Do not apply logical properties to the coordinates.** A projected x is a
position on the peninsula, not a reading direction; the Gulf does not move in
Arabic.

- [ ] **Step 4: Run and pass**

Run: `npx jest tests/components/detour-spur.test.tsx tests/components/map.test.tsx`
Expected: both files green — the second proves dashed/solid still means what it did.

- [ ] **Step 5: Commit**

```bash
git add src/map/DetourSpur.tsx src/map/index.ts tests/components/detour-spur.test.tsx
git commit -m "Draw the detour as a dashed spur off the corridor"
```

---

## Task 7: Strings for D1–D7 ✅ DONE (`1319372`)

**Files:**
- Modify: `src/i18n/index.ts`

- [ ] **Step 1: Add the English block**, after the P4 `track.*` block

Keys, with the handoff's copy where it survives review:

```
drv.home.greeting.some   'loads want your truck'      (prefixed by a count)
drv.home.greeting.none   'Nothing offered yet'
drv.home.week            'this week'
drv.money.keep           'You keep'
drv.money.collect        'Collect from the shipper'
drv.money.owe            'To Truckkoo'
drv.offer.fits           'FITS YOUR TRUCK'
drv.offer.expires        'Expires'
drv.offer.take           'Take it'
drv.offer.details        'See details'
drv.offer.pass           'Pass'
drv.offer.detour         'extra on your route'
drv.offer.freeAfter      'free after this load'
drv.offer.gone           'That offer has gone'
drv.none.title           'An empty book here means an empty truck.'
drv.none.body            'We only send loads that sit on a route you have told us about. Add the trips you already drive and they start landing here.'
drv.none.add             'Add a trip you are making'
drv.route.q              'Where are you driving?'
drv.route.help           'We only send you loads that sit on this line.'
drv.route.from           'LEAVING FROM'
drv.route.to             'GOING TO'
drv.route.often          'YOU DRIVE THESE OFTEN'
drv.when.q               'When do you leave?'
drv.when.empty.q         'Is the truck empty?'
drv.when.empty           'Empty — I can take a load'
drv.when.empty.hint      'All of it is free'
drv.when.part            'Part loaded — some space left'
drv.when.part.hint       'Tell us roughly how much'
drv.when.add             'Add this route'
drv.routes.title         'Your routes'
drv.routes.sub           'We match loads to these'
drv.routes.empty         'EMPTY'
drv.routes.part          'PART LOADED'
drv.routes.notice        'A route with no load on it is a truck running for nothing. Add every trip you know about.'
drv.job.carrying         'Carrying'
drv.job.dropAt           'DROP AT'
drv.job.youEarn          'YOU EARN'
drv.job.delivered        'I have delivered it'
drv.job.problem          'Report a problem'
drv.job.call             'Call the shipper'
```

- [ ] **Step 2: Add the Arabic block**

Translate every key above into the `ar` object. **Do not paste the English block
into `ar`** — that shipped once in P4 and left 31 duplicate keys that lint does
not catch. Verify with:

```bash
node -e "const s=require('fs').readFileSync('src/i18n/index.ts','utf8');
const m=[...s.matchAll(/'(drv\.[a-zA-Z.]+)':/g)].map(x=>x[1]);
const d=m.filter((k,i)=>m.indexOf(k)!==i&&m.indexOf(k,i+1)===-1);
console.log('keys',m.length,'each should appear exactly twice');"
```

- [ ] **Step 3: Run**

Run: `npx jest tests/unit/i18n.test.ts && npx tsc --noEmit`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/index.ts
git commit -m "Add the driver's words, in both languages"
```

---

## Task 8: D1 + D3 — the driver's home ✅ DONE (`f06624f`)

**Files:**
- Create: `src/components/driver/OfferCard.tsx`
- Modify: `src/app/(app)/(tabs)/driver.tsx`, `src/app/(app)/(tabs)/offers.tsx`
- Test: `tests/integration/driver-screens.test.tsx`

**Interfaces:**
- Consumes: `useDriverOffers`, `useDriverEarnings`, `DriverMoney`
- Produces: `<OfferCard offer={DriverOffer} compact? onPress onTake onPass />`

- [ ] **Step 1: Extend the harness** in `tests/integration/harness.tsx`

Add `useDriverOffers`, `useDriverOffer`, `useDriverEarnings` to the `jest.mock`
list and to `resetQueries`, defaulting to `ok([])` and `ok(null)` — **a driver
with nothing offered is the state the product launches in**, so it is the
default, and D3 is what a fresh test renders.

- [ ] **Step 2: Write the failing tests**

```tsx
describe('DriverHome', () => {
  it('names the consequence, not the empty state', async () => {
    await render(<DriverHome />);
    expect(screen.getByText('An empty book here means an empty truck.')).toBeTruthy();
  });

  it('leads with the payout, not the route', async () => {
    (queries.useDriverOffers as jest.Mock).mockReturnValue(ok([offer()]));
    await render(<DriverHome />);
    expect(screen.getByText('78.000')).toBeTruthy();
  });

  it('states the detour up front, because it is the driver s cost', async () => {
    (queries.useDriverOffers as jest.Mock).mockReturnValue(ok([offer()]));
    await render(<DriverHome />);
    expect(screen.getByText(/16 km/)).toBeTruthy();
  });

  it('carries the amount in the take button', async () => {
    (queries.useDriverOffers as jest.Mock).mockReturnValue(ok([offer()]));
    await render(<DriverHome />);
    expect(screen.getByLabelText('Take it — 78.000 OMR')).toBeTruthy();
  });

  it('shows no earnings line before anything has been earned', async () => {
    // Rule #5: absent, never zeroed. "0 OMR this week" reads as failure.
    (queries.useDriverEarnings as jest.Mock).mockReturnValue(
      ok({ week_baisa: 0, week_trips: 0, all_time_trips: 0 }));
    await render(<DriverHome />);
    expect(screen.queryByText(/this week/)).toBeNull();
  });
});
```

Add an `offer()` fixture to `harness.tsx` returning a `DriverOffer` with
`payout_baisa: 78000, collect_baisa: 96000, owed_baisa: 18000, detour_km: 16,
free_after_kg: 2000`.

- [ ] **Step 3: Run and watch them fail**

Run: `npx jest tests/integration/driver-screens.test.tsx`
Expected: FAIL on the copy assertions.

- [ ] **Step 4: Build D1/D3**

One screen, two states, as `customer.tsx` is for S1/S2 — the difference is
whether `useDriverOffers` returned anything. Ink ground, **no map**: an orange
bloom (`rgba(241,85,31,.18)`, 520×420, at -90/-70) via a positioned `View`.

`OfferCard`: `radius 26`, `backgroundColor color.surface`,
`borderColor 'rgba(241,85,31,.32)'`, `elevation.cardInk`. Header row is the
`FITS YOUR TRUCK` pill and the expiry. Then `DriverMoney` as hero. Then a route
block bounded by `hairline.inner` rules, carrying `RouteRail` and the detour
line. Then a `Chip` row. Then the primary, whose label carries the amount.

The accent belongs to the take button, so the `FITS YOUR TRUCK` pill is
**neutral** — one accent per screen.

- [ ] **Step 5: Run and pass**

Run: `npx jest tests/integration/driver-screens.test.tsx`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/components/driver src/app/\(app\)/\(tabs\)/driver.tsx src/app/\(app\)/\(tabs\)/offers.tsx tests
git commit -m "Open the driver's app on money, not on an empty state (D1, D3)"
```

---

## Task 9: D2 — the offer in full ✅ DONE (`b473788`)

**Files:**
- Create: `src/app/(app)/offer/[id].tsx`
- Test: `tests/integration/driver-screens.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
describe('OfferDetail', () => {
  beforeEach(() => { mockParams.current = { id: 'off-1' }; });

  it('draws the detour as a dashed spur, not a committed line', async () => {
    (queries.useDriverOffer as jest.Mock).mockReturnValue(ok(offer()));
    const { getByTestId } = await render(<OfferDetail />);
    expect(getByTestId('detour-spur')).toBeTruthy();
  });

  it('says what room is left, so a second load is a decision not a guess', async () => {
    (queries.useDriverOffer as jest.Mock).mockReturnValue(ok(offer()));
    await render(<OfferDetail />);
    expect(screen.getByText(/2,000 kg/)).toBeTruthy();
  });

  it('says nothing about remaining room when capacity is unknown', async () => {
    (queries.useDriverOffer as jest.Mock).mockReturnValue(
      ok({ ...offer(), free_after_kg: null }));
    await render(<OfferDetail />);
    expect(screen.queryByText(/free after/)).toBeNull();
  });

  it('tells a driver plainly when the offer has already gone', async () => {
    (queries.useDriverOffer as jest.Mock).mockReturnValue(ok(null));
    await render(<OfferDetail />);
    expect(screen.getByText('That offer has gone')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx jest tests/integration/driver-screens.test.tsx -t OfferDetail`
Expected: FAIL — module not found.

- [ ] **Step 3: Build D2**

Ink, map + sheet. `MapCanvas framing="domestic"` with a committed `Corridor` for
the load's own route and a `DetourSpur` from the leg origin to the load pickup.
Sheet carries `DriverMoney` at hero size, a detail card (detour km, load vs
capacity, loading, collect window), the capacity note, then `Take it — N OMR`
primary and a `Pass on this one` tertiary. Taking calls
`useRespondToOffer().mutate({ offerId, accept: true })` — the same RPC the old
screen used; no client sets a status.

- [ ] **Step 4: Run and pass**

Run: `npx jest tests/integration/driver-screens.test.tsx`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/offer tests/integration/driver-screens.test.tsx
git commit -m "Show the detour on the map before a driver commits to it (D2)"
```

---

## Task 10: D4 + D5 — declaring a route ✅ DONE (`d7ce6c5`)

**Files:**
- Create: `src/app/(app)/leg/_layout.tsx`, `src/app/(app)/leg/route.tsx`,
  `src/app/(app)/leg/when.tsx`
- Delete: `src/app/(app)/post-leg.tsx`
- Modify: `src/app/(app)/(tabs)/routes.tsx` (entry point)

- [ ] **Step 1: Write the failing test**

```tsx
describe('DeclareRoute', () => {
  it('asks the driver s question, not the shipper s', async () => {
    await render(<LegRoute />);
    expect(screen.getByText('Where are you driving?')).toBeTruthy();
  });

  it('offers a part-loaded truck a way to say how much room is left', async () => {
    await render(<LegWhen />);
    expect(screen.getByText('Part loaded — some space left')).toBeTruthy();
  });

  it('lets a driver skip the amount, because NULL is a real answer', async () => {
    // Same affordance as loads.truck_type_code: not answering must stay possible.
    await render(<LegWhen />);
    await fireEvent.press(screen.getByLabelText('Part loaded — some space left'));
    expect(screen.getByLabelText('Add this route')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx jest tests/integration/driver-screens.test.tsx -t DeclareRoute`
Expected: FAIL.

- [ ] **Step 3: Build D4 and D5**

Mirror `src/app/(app)/book/`: a draft in module scope, `MapStepShell` for the ink
map step (D4) and `QuestionShell` for the cream step (D5). D4 reuses `CityList`
and adds a `YOU DRIVE THESE OFTEN` chip row built from the driver's existing
legs. D5 puts both questions on one screen because they are one decision, with
`SelectCard` for empty vs part-loaded and a numeric field revealed only by the
part-loaded choice.

Submitting calls `usePostLeg().mutate({ ..., freeKg })`.

- [ ] **Step 4: Delete `post-leg.tsx`** and repoint every route that pushed to it.

Run: `grep -rn "post-leg" src/` — expected: no hits.

- [ ] **Step 5: Run and pass**

Run: `npm run verify`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Ask a driver for a route in their own words (D4, D5)"
```

---

## Task 11: D6 + D7 — routes, and the job ✅ DONE (`6054d8e`)

**Files:**
- Modify: `src/app/(app)/(tabs)/routes.tsx`, `src/app/(app)/trip/[id].tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
describe('Routes', () => {
  it('marks an empty truck as the live, actionable state', async () => {
    (queries.useMyLegs as jest.Mock).mockReturnValue(ok([leg({ is_empty: true })]));
    await render(<RoutesTab />);
    expect(screen.getByText('EMPTY')).toBeTruthy();
  });

  it('says why an empty route costs the driver money', async () => {
    await render(<RoutesTab />);
    expect(screen.getByText(/a truck running for nothing/)).toBeTruthy();
  });
});

describe('OnTheJob', () => {
  it('shows what the driver earns beside where it drops', async () => {
    await render(<TripDetail />);
    expect(screen.getByText('YOU EARN')).toBeTruthy();
    expect(screen.getByText('DROP AT')).toBeTruthy();
  });

  it('gives delivery one large target, for a thumb in a truck cab', async () => {
    await render(<TripDetail />);
    const btn = screen.getByLabelText('I have delivered it');
    expect(btn).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx jest tests/integration/driver-screens.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Build D6 and D7**

D6: ink, no map, route cards at `radius 22` with the capacity pill on the end —
`EMPTY` accented, `PART LOADED` neutral — and the closing notice.

D7: ink, map scaled as T4, remaining leg accented, `TruckMarker` at the same
interpolated point T4 uses (P6 owns GPS; nothing here claims a live fix). Sheet
carries `DROP AT` / city and `YOU EARN` / payout, the shipper's contact with one
44px call circle, and **one 64px primary** — "I have delivered it". Delivery goes
through `useAdvanceTrip({ tripId, to: 'delivered', photoPath })`; the photo is
already required server-side and that requirement stays.

- [ ] **Step 4: Run and pass**

Run: `npm run verify`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Give the driver their routes and their job (D6, D7)"
```

---

## Task 12: Close the phase ✅ DONE (`3007a83`)

**Files:**
- Modify: `SENSITIVE_FIELDS.md`, `OPEN_ISSUES.md`, `CLAUDE.md`

- [ ] **Step 1: `SENSITIVE_FIELDS.md`** — add `private.app_settings`
      `commission_pct` (ops-only, audited) and `public.legs.free_kg` (driver
      writes it about their own leg; not sensitive, recorded so the file stays a
      complete list).

- [ ] **Step 2: `OPEN_ISSUES.md`** — file: no remittance ledger (E8), so a driver
      who collects and never remits is invisible to the app; detour is
      great-circle × 1.20 between city centres; D1–D7 unseen on a device.

- [ ] **Step 3: `CLAUDE.md`** — update the legacy paragraph. After this phase
      `grep -rl "components/legacy" src/app` should list only the four auth
      screens and `loads.tsx` / `account.tsx`.

- [ ] **Step 4: Full verification**

Run: `npm run verify && npm run test:db`
Expected: both green.

- [ ] **Step 5: Confirm the legacy list shrank**

Run: `grep -rl "components/legacy" src/app`
Expected: no driver screen listed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Close P5 — what it left undone, written down"
```

---

## Self-Review

**Spec coverage.** E1 → Task 1. E2 → Tasks 3, 4. E3 → Task 3. E4 → Task 5.
E5/E6 → Tasks 2, 6, 8, 9. E7 → Task 3 (with a boundary check). E8 → Task 12.
E9 → Tasks 2, 4, 10. D1–D7 → Tasks 8–11. DoD 1 → Task 12. DoD 2 → Task 3.
DoD 3 → Task 8. DoD 4 → Task 1. DoD 5 → Task 3. DoD 6 → Tasks 10–12.
DoD 7 → Task 7. DoD 8 → Task 12.

**Known gap, deliberate.** DoD 7 asks that D1–D7 read correctly in Arabic RTL.
Task 7 supplies the strings and `arabicIfNeeded` handles the type, but **no task
puts an Arabic screen in front of a human** — that cannot be automated and is
filed in Task 12 rather than pretended away.

**Type consistency.** `DriverOffer` field names match the `returns table`
columns in Task 3 exactly (`collect_baisa`, `payout_baisa`, `owed_baisa`,
`detour_km`, `free_after_kg`). `driver_offer` takes `p_offer_id` in the
migration, the hook and the test. `DriverMoney` takes `payout`/`collect`/`owed`
in its test and its call sites.
