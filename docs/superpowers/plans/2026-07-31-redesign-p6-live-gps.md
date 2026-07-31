# P6 · Live GPS — Implementation Plan

> **Status: complete (2026-07-31).** All nine tasks landed on
> `redesign/p0-foundations`. 447 JS tests, three SQL suites. Four departures from
> the plan as written are recorded at the end of this file.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace T4's invented truck position with one the driver's phone
actually reported, delete the elapsed-time estimate that stands in for it today,
and stamp every position with its age.

**Architecture:** One migration lands and is asserted before any screen changes,
as in P4 and P5. `public.trip_positions` has **no client grant**; a driver writes
through `report_position()` and a shipper reads through `trip_position()`, which
returns the latest fix only. Both ETAs — from a fix, and the corridor fallback —
are computed in SQL so the client holds no arrival-time arithmetic. The reporter
is one hook in `src/lib/position.ts`, the only thing in the app that touches
`expo-location`.

**Tech Stack:** Expo / React Native, expo-router, TanStack Query, Supabase
(Postgres + RLS), `expo-location` (new), `react-native-svg` + `d3-geo` for the
map, Jest + RNTL.

**Spec:** `docs/superpowers/specs/2026-07-31-redesign-p6-live-gps-design.md`

## Global Constraints

- **No marker without a real fix.** `progressOf`, `interpolate` and `midpoint`
  are deleted and nothing replaces them. A position on a map is always one a
  phone reported.
- **A position is never rendered without its age.**
- **Tracking is trip-scoped in the database**, not only in the UI:
  `report_position` stores nothing unless `trips.driver_id = auth.uid()` **and**
  `trips.status = 'in_transit'`.
- **No client reads the trail.** `trip_position()` returns one row. Every
  multi-row read is an `ops_*` function behind `private.require_ops()`.
- **Both ETAs live in SQL.** Never compute an arrival time in TypeScript.
- **Foreground location only.** No background modes, no foreground service, no
  `expo-task-manager`, no licensed library. Permission requested is
  `requestForegroundPermissionsAsync` and nothing else.
- **Every `security definer` function pins `search_path = ''`** and fully
  qualifies identifiers **and types** — `public.trip_status`, never bare. A
  `$function$` body reproduced from a live definition ends in a semicolon.
- **Deny by default.** New table → revoke from `anon, authenticated`, enable +
  force RLS. `trip_positions` gets **no** client grant at all.
- **Fetch scoped to the actor.** Return "not found", never "forbidden".
- **Money is integer baisa**, `src/lib/money.ts`, never `toFixed(2)`.
- **No payment surfaces.**
- **RTL is structural.** Logical properties only (`marginStart`, `paddingEnd`).
  Never `left`/`right`. All strings through `t()`. Use `align.start`, never
  `textAlign: 'left'`. **SVG coordinates are the exception** — a projected x is a
  place, not a reading direction.
- **Every type token names a `fontFamily`; none sets `fontWeight`.**
- **`font.button` stays ≥18.66px bold.**
- **`color.delivered` is spent on T5 and appears nowhere in P6.**
- **Nothing new may import `src/components/legacy`.**
- **Never fabricate proof.** A position absent is absent, never zeroed or guessed.
- Migrations are append-only. Never edit an applied one.
- Verify with `npm run verify` and `npm run test:db` (needs `npx supabase start`,
  and a fresh `npx supabase db reset` before `test:db` — seeding demo data makes
  `tenant_isolation` fail on assertions unrelated to the change).

---

## File Structure

**Created**
- `supabase/migrations/0032_trip_positions.sql` — the table, `report_position`,
  `trip_position`, `ops_sweep_positions`, `ops_position_health`,
  `private.point_km`, `avg_speed_kph`
- `src/lib/position.ts` — `useReportPosition(tripId, active)`, the only
  `expo-location` consumer
- `tests/unit/position-queries.test.tsx` — the hooks at the RPC seam
- `tests/components/truck-marker.test.tsx` — the stale state

**Modified**
- `src/lib/queries.ts` — `TripPosition`, `useTripPosition`, `useReportPositionRpc`
- `src/lib/format.ts` — `formatAge`
- `src/map/TruckMarker.tsx` — `stale` prop
- `src/i18n/index.ts` — P6 strings, en + ar
- `src/app/(app)/load/[id].tsx` — T4: real marker, age, server ETA; deletes
  `progressOf`, `interpolate`, `collectedAt`
- `src/app/(app)/trip/[id].tsx` — D7: reporter, sharing line; deletes `midpoint`
- `app.json` — `expo-location` plugin and its permission strings
- `supabase/tests/tenant_isolation.sql` — position assertions
- `SENSITIVE_FIELDS.md`, `OPEN_ISSUES.md`, `CLAUDE.md`

---

## Task 1: 0032 — the table and the write path ✅ DONE (`7527904`)

**Files:**
- Create: `supabase/migrations/0032_trip_positions.sql`
- Modify: `supabase/tests/tenant_isolation.sql`

**Interfaces:**
- Consumes: `private.check_rate_limit(text, integer, interval)` (0004),
  `private.route_km(bigint, bigint)` and `private.app_settings` (0024)
- Produces: table `public.trip_positions`,
  `public.report_position(p_trip_id uuid, p_lat numeric, p_lng numeric, p_accuracy_m numeric) returns boolean`

- [ ] **Step 1: Write the first half of the migration**

Create `supabase/migrations/0032_trip_positions.sql` with exactly this:

```sql
-- 0032 — where the truck actually is.
--
-- T4 has drawn a truck since P4 whose position is `elapsed time ÷ corridor
-- hours`, clamped away from both ends so it never quite arrives and never quite
-- fails to leave. It moves whether or not the driver does. This is the table
-- that lets it stop.
--
-- FOREGROUND ONLY (spec F1). Positions arrive while the driver has D7 open. That
-- is a client fact, not a schema fact: everything here — the shape, the RLS
-- posture, the read function, the retention — is what background tracking would
-- need too, so adopting it later is a client change and not a migration.

create table public.trip_positions (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips on delete cascade,
  -- Denormalised so the sweep and the retention delete never join. A position
  -- outlives nothing: the row dies with its trip.
  driver_id   uuid not null references public.profiles on delete cascade,
  lat         numeric(9,6) not null,
  lng         numeric(9,6) not null,
  accuracy_m  numeric,
  -- WHEN THE PHONE SAW IT, not when the row landed. A queued fix uploaded ten
  -- minutes later is ten minutes old, and the shipper is told so.
  seen_at     timestamptz not null,
  created_at  timestamptz not null default now(),

  -- Bounded, like every client-supplied number (SECURITY.md §6). A generous GCC
  -- box: Oman plus the five countries the fleet crosses into, with room to
  -- spare. Anything outside is a broken device or a forged call, not a truck.
  constraint trip_positions_in_region check (
    lat between 12 and 33 and lng between 34 and 60
  ),
  constraint trip_positions_accuracy_sane check (
    accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 100000)
  ),
  -- No fixes from the future. Clock skew of a minute is tolerated; an hour is a
  -- device lying about when it saw something.
  constraint trip_positions_not_future check (seen_at <= now() + interval '1 minute')
);

create index trip_positions_trip_idx   on public.trip_positions (trip_id, seen_at desc);
create index trip_positions_sweep_idx  on public.trip_positions (seen_at);
create index trip_positions_driver_idx on public.trip_positions (driver_id);

comment on table public.trip_positions is
  'Driver-reported positions during a live trip. No client grant: written by '
  'report_position(), read one row at a time by trip_position(), swept by ops.';

-- ═══ deny by default ════════════════════════════════════════════════════════
-- No grant of any kind, and therefore no policies: nothing reaches this table
-- except through the definer functions below. RLS is still enabled and forced,
-- so a grant added by accident later fails closed rather than open.

revoke all on public.trip_positions from anon, authenticated;
alter table public.trip_positions enable row level security;
alter table public.trip_positions force row level security;

-- ═══ how fast a truck goes ══════════════════════════════════════════════════
-- A SETTING, not a constant, for the same reason road_factor_pct is one: it is
-- wrong until there is real trip data to tune it against, and retuning it must
-- not need a migration.
insert into private.app_settings (key, value)
values ('avg_speed_kph', '65'::jsonb)
on conflict (key) do nothing;

-- ═══ the driver reports ═════════════════════════════════════════════════════
-- Returns FALSE rather than raising when the trip is no longer live (spec F9).
-- The delivery transition and the last queued ping race by seconds, and a driver
-- should not be shown an error at the gate because their own delivery landed
-- first. Authentication and out-of-range coordinates still raise.

create or replace function public.report_position(
  p_trip_id    uuid,
  p_lat        numeric,
  p_lng        numeric,
  p_accuracy_m numeric default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_ok    boolean;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if p_lat is null or p_lng is null
     or p_lat not between 12 and 33 or p_lng not between 34 and 60 then
    raise exception 'position out of range' using errcode = 'check_violation';
  end if;

  -- 240/hour is one fix every fifteen seconds sustained. The client asks for one
  -- per minute or per 500m, so this bounds a broken client rather than the real
  -- one.
  perform private.check_rate_limit('report_position', 240, interval '1 hour');

  -- THE WHOLE GUARD, and it is internal. The trip id comes from the client and
  -- is worth nothing without this: own trip, and live. Tracking that stops when
  -- a trip ends is a promise if the client does it and a fact if this does.
  select exists (
    select 1 from public.trips t
    where t.id = p_trip_id
      and t.driver_id = v_actor
      and t.status = 'in_transit'::public.trip_status
  ) into v_ok;

  if not v_ok then
    return false;
  end if;

  insert into public.trip_positions (trip_id, driver_id, lat, lng, accuracy_m, seen_at)
  values (p_trip_id, v_actor, p_lat, p_lng, p_accuracy_m, now());

  return true;
end;
$$;

revoke all on function public.report_position(uuid, numeric, numeric, numeric)
  from public, anon;
grant execute on function public.report_position(uuid, numeric, numeric, numeric)
  to authenticated;
```

- [ ] **Step 2: Add the assertions** to `supabase/tests/tenant_isolation.sql`,
      immediately before the `do $$ begin raise notice 'ALL TENANT ISOLATION
      ASSERTIONS HELD'; end $$;` line

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- 10. positions (0032)
-- ════════════════════════════════════════════════════════════════════════════
-- Driver A carries `The full walk` from §7 and it is `delivered` by the time
-- this runs, so the live case needs a trip put deliberately back in transit.
-- Done as the owner: no client may set a status.

update public.trips set status = 'in_transit'::public.trip_status
 where load_id = (select id from public.loads where goods_description = 'The full walk');

select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A
select assert_true(
  (select public.report_position(
     (select t.id from public.trips t join public.loads l on l.id = t.load_id
       where l.goods_description = 'The full walk'),
     23.588, 58.408, 12)),
  'a driver reports a position on the trip they are actually driving');
select act_as_reset();

select assert_equals(
  (select count(*) from public.trip_positions), 1,
  'and exactly one row lands');

-- Somebody else's trip is not reportable, and says nothing about why.
select act_as('44444444-4444-4444-8444-444444444444');  -- Driver B
select assert_true(
  (select public.report_position(
     (select t.id from public.trips t join public.loads l on l.id = t.load_id
       where l.goods_description = 'The full walk'),
     23.588, 58.408, 12) = false),
  'another driver reporting on that trip stores nothing');
select act_as_reset();

select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A, who owns the load
select assert_true(
  (select public.report_position(
     (select t.id from public.trips t join public.loads l on l.id = t.load_id
       where l.goods_description = 'The full walk'),
     23.588, 58.408, 12) = false),
  'and the shipper cannot place their own truck on the map');
select act_as_reset();

select assert_equals(
  (select count(*) from public.trip_positions), 1,
  'neither of those wrote a row');

-- Garbage is refused at the function, and again at the table.
select act_as('33333333-3333-4333-8333-333333333333');
select assert_raises(
  $$select public.report_position(
      (select t.id from public.trips t join public.loads l on l.id = t.load_id
        where l.goods_description = 'The full walk'), 51.5, 0.12, 5)$$,
  'a position in London is a broken device, not a truck');
select act_as_reset();

-- The table itself is unreachable. No grant, so not even a read.
select act_as('33333333-3333-4333-8333-333333333333');
select assert_raises($$select count(*) from public.trip_positions$$,
  'a driver cannot read the positions table directly');
select act_as_reset();

select act_as('11111111-1111-4111-8111-111111111111');
select assert_raises($$select count(*) from public.trip_positions$$,
  'and neither can a shipper — the trail is nobody''s to enumerate');
select act_as_reset();

-- Tracking stops when the trip does, in the database and not merely in the UI.
update public.trips set status = 'delivered'::public.trip_status
 where load_id = (select id from public.loads where goods_description = 'The full walk');

select act_as('33333333-3333-4333-8333-333333333333');
select assert_true(
  (select public.report_position(
     (select t.id from public.trips t join public.loads l on l.id = t.load_id
       where l.goods_description = 'The full walk'),
     23.600, 58.400, 12) = false),
  'a delivered trip stores nothing, and does not raise at the gate either');
select act_as_reset();

select assert_equals(
  (select count(*) from public.trip_positions), 1,
  'the trail stops growing the moment the trip ends');

-- Put it back for the read assertions in §11.
update public.trips set status = 'in_transit'::public.trip_status
 where load_id = (select id from public.loads where goods_description = 'The full walk');
```

- [ ] **Step 3: Apply and run**

Run: `npx supabase db reset && npm run test:db:tenants`
Expected: nine new `pass:` lines, then `ALL TENANT ISOLATION ASSERTIONS HELD`.

> If a later section of the suite asserts on the trip's status, the two
> `update public.trips` statements above will have changed it. Run the whole
> file, not just the new section, and read the failure before touching anything:
> the fix is to restore the status at the end of §10, which the last statement
> already does.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0032_trip_positions.sql supabase/tests/tenant_isolation.sql
git commit -m "Record where the truck is, only while it is carrying something (0032)"
```

---

## Task 2: 0032 — the read path and the ETA ✅ DONE (`776e570`)

**Files:**
- Modify: `supabase/migrations/0032_trip_positions.sql` (append — it is not
  applied to any deployed database; if it has been, add `0033` instead)
- Modify: `supabase/tests/tenant_isolation.sql`

**Interfaces:**
- Consumes: `public.trip_positions` (Task 1), `private.owns_load(uuid)` (0001),
  `private.is_ops()` (0005), `private.app_settings`
- Produces: `private.point_km(p_lat numeric, p_lng numeric, p_city_id bigint) returns numeric`,
  `public.trip_position(p_trip_id uuid) returns table (lat numeric, lng numeric, seen_at timestamptz, accuracy_m numeric, remaining_km numeric, eta_at timestamptz, eta_source text)`

- [ ] **Step 1: Append to the migration**

```sql
-- ═══ how far is left ════════════════════════════════════════════════════════
-- The point-to-city twin of private.route_km (0024), sharing its haversine and
-- its road factor rather than restating either. One distance implementation,
-- server-side, is the same rule the price follows.

create or replace function private.point_km(
  p_lat     numeric,
  p_lng     numeric,
  p_city_id bigint
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.cities;
  v_factor numeric;
  v_km     numeric;
begin
  select * into c from public.cities x where x.id = p_city_id;
  if c.id is null or p_lat is null or p_lng is null then
    return null;
  end if;

  v_km := 2 * 6371 * asin(
    sqrt(
      power(sin(radians(c.lat - p_lat) / 2), 2)
      + cos(radians(p_lat)) * cos(radians(c.lat))
        * power(sin(radians(c.lng - p_lng) / 2), 2)
    )
  );

  select coalesce((value #>> '{}')::numeric, 120) into v_factor
  from private.app_settings where key = 'road_factor_pct';

  return round(v_km * v_factor / 100, 1);
end;
$$;

revoke all on function private.point_km(numeric, numeric, bigint)
  from public, anon, authenticated;

-- ═══ what a screen may know about where the truck is ════════════════════════
-- ONE ROW, ALWAYS — for any trip the caller may see, whether or not a fix
-- exists. With no fix, lat/lng/seen_at are null and eta_source is 'corridor':
-- the arrival time from the pickup event plus the full corridor duration, which
-- is the estimate T4 shows today. With a fix, eta_source is 'fix'.
--
-- BOTH ETAs LIVE HERE. A client-side fallback would be a second arrival-time
-- implementation, and two of those disagree eventually — the same reason there
-- is no src/lib/pricing.ts.
--
-- THE LATEST FIX ONLY. The trail is never returned to a client: "where is my
-- truck" is the product; "where has this driver been for a month" is a movement
-- record, and the difference is this `limit 1`.

create or replace function public.trip_position(p_trip_id uuid)
returns table (
  lat          numeric,
  lng          numeric,
  seen_at      timestamptz,
  accuracy_m   numeric,
  remaining_km numeric,
  eta_at       timestamptz,
  eta_source   text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_trip     public.trips;
  v_load     public.loads;
  v_fix      public.trip_positions;
  v_speed    numeric;
  v_factor   numeric;
  v_from     timestamptz;
  v_km       numeric;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_trip from public.trips t where t.id = p_trip_id;
  if v_trip.id is null then
    return;
  end if;

  select * into v_load from public.loads l where l.id = v_trip.load_id;

  -- Scoped INSIDE the definer, like match_load and driver_offers: the driver on
  -- the trip, the shipper who owns the load, or ops. Anyone else gets no row —
  -- "not found", never "forbidden", because a distinct refusal confirms the
  -- trip exists.
  if not (
    v_trip.driver_id = v_actor
    or private.owns_load(v_trip.load_id)
    or private.is_ops()
  ) then
    return;
  end if;

  select * into v_fix
  from public.trip_positions p
  where p.trip_id = p_trip_id
  order by p.seen_at desc
  limit 1;

  select coalesce((value #>> '{}')::numeric, 65) into v_speed
  from private.app_settings where key = 'avg_speed_kph';
  if v_speed is null or v_speed <= 0 then
    v_speed := 65;
  end if;

  if v_fix.id is not null then
    v_km := private.point_km(v_fix.lat, v_fix.lng, v_load.dest_city);
    return query select
      v_fix.lat,
      v_fix.lng,
      v_fix.seen_at,
      v_fix.accuracy_m,
      v_km,
      -- From NOW, not from the fix: the remaining distance is what was left when
      -- the phone last looked, and the truck has been driving since.
      (now() + make_interval(secs => (v_km / v_speed * 3600)::int)),
      'fix'::text;
    return;
  end if;

  -- No fix. The corridor estimate, said to be one.
  v_from := coalesce(
    (select max(e.occurred_at) from public.trip_events e
      where e.trip_id = p_trip_id and e.type = 'picked_up'),
    v_trip.created_at);

  v_km := private.route_km(v_load.origin_city, v_load.dest_city);

  return query select
    null::numeric,
    null::numeric,
    null::timestamptz,
    null::numeric,
    v_km,
    case when v_km is null then null
         else v_from + make_interval(secs => (v_km / v_speed * 3600)::int) end,
    'corridor'::text;
end;
$$;

revoke all on function public.trip_position(uuid) from public, anon;
grant execute on function public.trip_position(uuid) to authenticated;
```

- [ ] **Step 2: Add the assertions** to `supabase/tests/tenant_isolation.sql`,
      immediately before the `ALL TENANT ISOLATION ASSERTIONS HELD` notice

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- 11. reading a position (0032)
-- ════════════════════════════════════════════════════════════════════════════
-- §10 left one fix on `The full walk`, and the trip back in transit.

select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A, who owns it
select assert_true(
  (select eta_source = 'fix' and lat is not null
     from public.trip_position(
       (select t.id from public.trips t join public.loads l on l.id = t.load_id
         where l.goods_description = 'The full walk'))),
  'the shipper reads the real fix, and is told it is one');
select assert_true(
  (select remaining_km > 0
     from public.trip_position(
       (select t.id from public.trips t join public.loads l on l.id = t.load_id
         where l.goods_description = 'The full walk'))),
  'with a distance measured from where the truck actually is');
select act_as_reset();

select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A, on the trip
select assert_equals(
  (select count(*) from public.trip_position(
     (select t.id from public.trips t join public.loads l on l.id = t.load_id
       where l.goods_description = 'The full walk'))),
  1, 'and so does the driver, about their own job');
select act_as_reset();

-- The whole point of scoping inside the definer.
select act_as('22222222-2222-4222-8222-222222222222');  -- Shipper B
select assert_equals(
  (select count(*) from public.trip_position(
     (select t.id from public.trips t join public.loads l on l.id = t.load_id
       where l.goods_description = 'The full walk'))),
  0, 'another shipper holding that trip id reads nothing at all');
select act_as_reset();

select act_as('44444444-4444-4444-8444-444444444444');  -- Driver B
select assert_equals(
  (select count(*) from public.trip_position(
     (select t.id from public.trips t join public.loads l on l.id = t.load_id
       where l.goods_description = 'The full walk'))),
  0, 'and neither does another driver');
select act_as_reset();

-- ONE ROW, NOT THE TRAIL. Two more fixes, and the shipper still gets one.
select act_as('33333333-3333-4333-8333-333333333333');
select public.report_position(
  (select t.id from public.trips t join public.loads l on l.id = t.load_id
    where l.goods_description = 'The full walk'), 22.500, 57.500, 8);
select public.report_position(
  (select t.id from public.trips t join public.loads l on l.id = t.load_id
    where l.goods_description = 'The full walk'), 21.000, 56.000, 8);
select act_as_reset();

select assert_equals((select count(*) from public.trip_positions), 3,
  'three fixes are stored');

select act_as('11111111-1111-4111-8111-111111111111');
select assert_equals(
  (select count(*) from public.trip_position(
     (select t.id from public.trips t join public.loads l on l.id = t.load_id
       where l.goods_description = 'The full walk'))),
  1, 'and the shipper still reads exactly one — the trail is not theirs');
select act_as_reset();

-- A trip that has never reported still answers, with the corridor estimate.
select act_as('11111111-1111-4111-8111-111111111111');
select assert_true(
  (select eta_source = 'corridor' and lat is null and eta_at is not null
     from public.trip_position(
       (select t.id from public.trips t join public.loads l on l.id = t.load_id
         where l.goods_description = 'A cargo — confidential'))),
  'a trip with no fix returns a corridor estimate and no position');
select act_as_reset();
```

> The second assertion assumes shipper A's seed load `A cargo — confidential`
> has a trip by the time §11 runs (§5 creates one). If it does not, use any trip
> the shipper owns that §10 did not report on; the assertion is about
> `eta_source`, not about which load.

- [ ] **Step 3: Apply and run**

Run: `npx supabase db reset && npm run test:db`
Expected: all three suites green, including the eight new lines from this task.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0032_trip_positions.sql supabase/tests/tenant_isolation.sql
git commit -m "Return the latest fix and an ETA measured from it, never the trail"
```

---

## Task 3: 0032 — the ops sweep and its visibility ✅ DONE (`996813a`)

**Files:**
- Modify: `supabase/migrations/0032_trip_positions.sql` (append)
- Modify: `supabase/tests/ops_console.sql`

**Interfaces:**
- Consumes: `private.require_ops()` (0005), `private.log_ops(text, text, text, jsonb, jsonb, text)` (0015)
- Produces: `public.ops_sweep_positions(p_days integer, p_reason text) returns integer`,
  `public.ops_position_health() returns table (rows bigint, oldest_seen_at timestamptz, oldest_days integer)`

- [ ] **Step 1: Append to the migration**

```sql
-- ═══ retention ══════════════════════════════════════════════════════════════
-- 30 days, swept by a dispatcher. pg_cron is not enabled on this project, and
-- the alternative — deleting on every write — was considered and not chosen.
--
-- THE KNOWN WEAKNESS, WRITTEN DOWN: this is the same shape as
-- ops_sweep_expired_offers, which OPEN_ISSUES 27 records going stale because
-- nothing runs it. ops_position_health() exists to make that visible rather
-- than silent — the console shows the age of the oldest stored point, so a
-- forgotten sweep is a number on a screen instead of an invisible pile.

create or replace function public.ops_sweep_positions(
  p_days   integer default 30,
  p_reason text    default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_deleted integer;
begin
  perform private.require_ops();

  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'retention must be between 1 and 365 days'
      using errcode = 'check_violation';
  end if;

  with gone as (
    delete from public.trip_positions
     where seen_at < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*) into v_deleted from gone;

  perform private.log_ops(
    'ops_sweep_positions', 'table', 'trip_positions',
    null,
    jsonb_build_object('deleted', v_deleted, 'days', p_days),
    p_reason);

  return v_deleted;
end;
$$;

revoke all on function public.ops_sweep_positions(integer, text) from public, anon;
grant execute on function public.ops_sweep_positions(integer, text) to authenticated;

create or replace function public.ops_position_health()
returns table (rows bigint, oldest_seen_at timestamptz, oldest_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    count(*)::bigint,
    min(p.seen_at),
    coalesce(extract(day from (now() - min(p.seen_at)))::int, 0)
  from public.trip_positions p;
end;
$$;

revoke all on function public.ops_position_health() from public, anon;
grant execute on function public.ops_position_health() to authenticated;
```

- [ ] **Step 2: Add the assertions** to `supabase/tests/ops_console.sql`, before
      the `ALL OPS CONSOLE ASSERTIONS HELD` notice

```sql
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
```

- [ ] **Step 3: Apply and run**

Run: `npx supabase db reset && npm run test:db`
Expected: three suites green, six new `pass:` lines in the ops suite.

- [ ] **Step 4: Check the definer-hygiene sweep still passes**

`supabase/tests/ops_console.sql` §8 checks every definer function statically for
unqualified type casts. It runs as part of the suite above; if it fails, the
cause is a bare `trip_status` or `load_status` somewhere in this migration.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0032_trip_positions.sql supabase/tests/ops_console.sql
git commit -m "Sweep the position trail on purpose, and show when nobody has"
```

---

## Task 4: The client query layer ✅ DONE (`3185571`)

**Files:**
- Modify: `src/lib/queries.ts`
- Test: `tests/unit/position-queries.test.tsx` (create)

**Interfaces:**
- Consumes: `public.trip_position(uuid)`, `public.report_position(uuid, numeric, numeric, numeric)`
- Produces: type `TripPosition`, `useTripPosition(tripId: string | undefined)`,
  `useReportPosition()` (the mutation — the *hook that watches* is Task 6)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/position-queries.test.tsx`:

```tsx
/**
 * The position seam, where SQL becomes TypeScript.
 *
 * Two things can only go wrong here: a numeric arriving as a string (PostgREST
 * serialises `numeric` as a JSON string, so `lat` is `"23.588000"` and
 * `project()` given a string puts the truck in the corner of the map), and the
 * no-fix row being mistaken for no row at all — `trip_position` always returns
 * one, and a screen that treats "no fix" as "no answer" loses the corridor ETA.
 */

import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useTripPosition } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  (supabase.rpc as jest.Mock).mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => client.clear());

describe('useTripPosition', () => {
  it('turns the numerics into numbers, so the projection gets a coordinate', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [
        {
          lat: '23.588000',
          lng: '58.408000',
          seen_at: '2026-07-31T09:00:00Z',
          accuracy_m: '12',
          remaining_km: '1030.4',
          eta_at: '2026-07-31T20:00:00Z',
          eta_source: 'fix',
        },
      ],
      error: null,
    });

    const { result } = await renderHook(() => useTripPosition('trip-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(supabase.rpc).toHaveBeenCalledWith('trip_position', { p_trip_id: 'trip-1' });
    expect(result.current.data?.lat).toBe(23.588);
    expect(typeof result.current.data?.remaining_km).toBe('number');
  });

  it('keeps the corridor row, which is an answer and not an absence', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [
        {
          lat: null,
          lng: null,
          seen_at: null,
          accuracy_m: null,
          remaining_km: '1030.4',
          eta_at: '2026-07-31T20:00:00Z',
          eta_source: 'corridor',
        },
      ],
      error: null,
    });

    const { result } = await renderHook(() => useTripPosition('trip-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.eta_source).toBe('corridor');
    expect(result.current.data?.lat).toBeNull();
  });

  it('is null when the trip is not the caller s to see', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    const { result } = await renderHook(() => useTripPosition('trip-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  it('does not ask without a trip id', async () => {
    const { result } = await renderHook(() => useTripPosition(undefined), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx jest tests/unit/position-queries.test.tsx`
Expected: FAIL — `useTripPosition` is not exported from `@/lib/queries`.

- [ ] **Step 3: Add the type and hooks** to `src/lib/queries.ts`, immediately
      above `export function useMyTrips() {`

```ts
/**
 * Where the truck is, and when it lands (0032).
 *
 * ALWAYS ONE ROW for a trip the caller may see. `eta_source` says which answer
 * it is: `'fix'` means `lat`/`lng`/`seen_at` are a real position a phone
 * reported, `'corridor'` means there has never been one and the ETA is the
 * old corridor estimate — in which case the screen must say so.
 *
 * There is no third state and no trail. "Where is my truck" is the product;
 * "where has this driver been" is a movement record, and the server never
 * returns more than this row.
 */
export type TripPosition = {
  lat: number | null;
  lng: number | null;
  seen_at: string | null;
  accuracy_m: number | null;
  remaining_km: number | null;
  eta_at: string | null;
  eta_source: 'fix' | 'corridor';
};

export function useTripPosition(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip', 'position', tripId],
    enabled: !!tripId,
    // A position is the one thing on T4 that changes without the shipper doing
    // anything. Sixty seconds matches the driver's own reporting interval —
    // asking faster cannot produce a newer fix.
    refetchInterval: 60_000,
    queryFn: async (): Promise<TripPosition | null> => {
      const { data, error } = await supabase.rpc('trip_position', { p_trip_id: tripId });
      if (error) throw error;
      const r = ((data ?? []) as Record<string, string | number | null>[])[0];
      if (!r) return null;
      // numeric arrives as a string over PostgREST. Number() here, once, so
      // nothing downstream hands a string to the projection and wonders why the
      // truck is in the corner of the map.
      const num = (v: string | number | null) => (v == null ? null : Number(v));
      return {
        lat: num(r.lat),
        lng: num(r.lng),
        seen_at: (r.seen_at as string | null) ?? null,
        accuracy_m: num(r.accuracy_m),
        remaining_km: num(r.remaining_km),
        eta_at: (r.eta_at as string | null) ?? null,
        eta_source: r.eta_source === 'fix' ? 'fix' : 'corridor',
      };
    },
  });
}

/**
 * Report one fix. Resolves `false` when the trip is no longer live, which is
 * not an error — the delivery transition and the last queued ping race by
 * seconds, and the driver must not see a failure at the gate.
 */
export function useReportPosition() {
  return useMutation({
    mutationFn: async ({
      tripId,
      lat,
      lng,
      accuracyM,
    }: {
      tripId: string;
      lat: number;
      lng: number;
      accuracyM?: number | null;
    }): Promise<boolean> => {
      const { data, error } = await supabase.rpc('report_position', {
        p_trip_id: tripId,
        p_lat: lat,
        p_lng: lng,
        p_accuracy_m: accuracyM ?? null,
      });
      if (error) throw error;
      return data === true;
    },
  });
}
```

- [ ] **Step 4: Run and pass**

Run: `npx jest tests/unit/position-queries.test.tsx && npx tsc --noEmit`
Expected: 4 passed, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries.ts tests/unit/position-queries.test.tsx
git commit -m "Read one position, and never a string where a coordinate goes"
```

---

## Task 5: `formatAge`, the marker's stale state, and the strings ✅ DONE (`42bb3ea`)

**Files:**
- Modify: `src/lib/format.ts`, `src/map/TruckMarker.tsx`, `src/i18n/index.ts`
- Test: `tests/components/truck-marker.test.tsx` (create),
  `tests/unit/format.test.ts` (extend)

**Interfaces:**
- Produces: `formatAge(iso: string | null): string | null`,
  `<TruckMarker at={{lng,lat}} stale? />`, i18n keys `pos.*`

- [ ] **Step 1: Write the failing tests**

Create `tests/components/truck-marker.test.tsx`:

```tsx
/**
 * A position is never drawn without its age, and an old one must not look like
 * a fresh one. Dimming is the whole of that distinction on the map; the
 * timestamp beside it carries the rest.
 */

import { render } from '@testing-library/react-native';

import { MapCanvas, TruckMarker } from '@/map';

const at = { lng: 58.4, lat: 23.6 };

function draw(stale: boolean) {
  return render(
    <MapCanvas framing="domestic" width={300} height={300}>
      <TruckMarker at={at} stale={stale} />
    </MapCanvas>,
  );
}

/** react-native-svg packs a colour into an AARRGGBB integer. */
function alphaOf(node: { props: { fill: { payload: number } } }): number {
  return ((node.props.fill.payload >>> 24) & 255) / 255;
}

describe('TruckMarker', () => {
  it('draws solid when the fix is fresh', async () => {
    const { getByTestId } = await draw(false);
    expect(alphaOf(getByTestId('truck-body'))).toBeGreaterThan(0.9);
  });

  it('dims when the fix is old, so age is visible on the map itself', async () => {
    const { getByTestId } = await draw(true);
    expect(alphaOf(getByTestId('truck-body'))).toBeLessThan(0.9);
  });

  it('is the same shape either way — dimming is not a different marker', async () => {
    const fresh = await draw(false);
    const stale = await draw(true);
    expect(fresh.getByTestId('truck-body').props.r).toBe(
      stale.getByTestId('truck-body').props.r,
    );
  });
});
```

Add to `tests/unit/format.test.ts`:

```ts
describe('formatAge', () => {
  it('says nothing about an absent time rather than saying zero', () => {
    // Rule #5: absent, never zeroed. "Seen 0 minutes ago" for a truck nobody
    // has heard from is the exact lie this phase exists to delete.
    expect(formatAge(null)).toBeNull();
  });

  it('reads in minutes inside an hour', () => {
    const iso = new Date(Date.now() - 4 * 60_000).toISOString();
    expect(formatAge(iso)).toMatch(/4/);
  });

  it('reads in hours past one', () => {
    const iso = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(formatAge(iso)).toMatch(/3/);
  });

  it('reads in days past one', () => {
    const iso = new Date(Date.now() - 50 * 3600_000).toISOString();
    expect(formatAge(iso)).toMatch(/2/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx jest tests/components/truck-marker.test.tsx tests/unit/format.test.ts`
Expected: FAIL — `formatAge` is not exported, `truck-body` has no testID.

- [ ] **Step 3: Add the strings** to `src/i18n/index.ts`, in the `en` object
      after the `drv.*` block

```
'pos.seen'        'Seen'
'pos.now'         'just now'
'pos.min'         'min ago'
'pos.hour'        'h ago'
'pos.day'         'd ago'
'pos.none'        'No position yet'
'pos.estimate'    'Estimated arrival'
'pos.sharing'     'Sharing your position with the shipper'
'pos.sharingWhy'  'Only while you are carrying this load.'
'pos.lastSent'    'Last sent'
```

And in the `ar` object — **translate, do not paste the English**:

```
'pos.seen'        'شوهدت'
'pos.now'         'الآن'
'pos.min'         'دقيقة مضت'
'pos.hour'        'ساعة مضت'
'pos.day'         'يوم مضى'
'pos.none'        'لا يوجد موقع بعد'
'pos.estimate'    'الوصول المتوقع'
'pos.sharing'     'تتم مشاركة موقعك مع الشاحن'
'pos.sharingWhy'  'فقط أثناء نقلك لهذه الشحنة.'
'pos.lastSent'    'آخر إرسال'
```

Verify each key appears exactly twice:

```bash
node -e "const s=require('fs').readFileSync('src/i18n/index.ts','utf8');
const m=[...s.matchAll(/'(pos\.[a-zA-Z.]+)':/g)].map(x=>x[1]);
const c={};m.forEach(k=>c[k]=(c[k]||0)+1);
console.log('distinct',Object.keys(c).length,'bad',JSON.stringify(Object.entries(c).filter(([,n])=>n!==2)));"
```

- [ ] **Step 4: Add `formatAge`** to `src/lib/format.ts`

```ts
/**
 * How long ago, in the coarsest unit that is still useful.
 *
 * Returns null for a missing time — absent, never zeroed (CLAUDE.md #5). "Seen
 * 0 minutes ago" for a truck nobody has heard from is exactly the claim P6
 * exists to stop making.
 *
 * Coarse on purpose: a shipper reading "Seen 2h ago" knows what to do with it,
 * and "Seen 127 minutes ago" is arithmetic they have to perform.
 */
export function formatAge(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const mins = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (mins < 1) return t('pos.now');
  if (mins < 60) return `${formatNumber(mins)} ${t('pos.min')}`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${formatNumber(hours)} ${t('pos.hour')}`;

  return `${formatNumber(Math.floor(hours / 24))} ${t('pos.day')}`;
}
```

`format.ts` imports `{ getLanguage, toArabicIndic }` from `@/i18n` today. Widen
it to `{ formatNumber, getLanguage, t, toArabicIndic }` — `formatAge` needs both
of the new ones, and the numerals must go through `formatNumber` like every other
number in the product.

- [ ] **Step 5: Add the `stale` prop** to `src/map/TruckMarker.tsx`

Replace the component body with:

```tsx
export function TruckMarker({
  at,
  stale = false,
}: {
  at: { lng: number; lat: number };
  /**
   * The fix is old (T4 uses 30 minutes). Dimmed, same geometry — a different
   * shape would read as a different kind of thing, where this is the same truck
   * seen longer ago. The timestamp beside the map says how much longer.
   */
  stale?: boolean;
}) {
  const projection = useProjection();
  const { x, y } = project(projection, at.lng, at.lat);
  return (
    <G testID="truck-marker">
      <Circle
        cx={x}
        cy={y}
        r={9.5}
        fill={stale ? 'rgba(241,85,31,.07)' : 'rgba(241,85,31,.16)'}
      />
      <Circle
        testID="truck-body"
        cx={x}
        cy={y}
        r={6.5}
        fill={stale ? 'rgba(241,85,31,.45)' : color.accent}
        stroke={color.ink}
        strokeWidth={2.5}
      />
    </G>
  );
}
```

Also update the file's docblock: the line "Position interpolation between fixes
belongs to the caller" is no longer true — there is no interpolation anywhere.
Replace it with: "The caller passes a position a phone reported. Nothing
interpolates; there is no such thing as a computed position in this product."

- [ ] **Step 6: Run and pass**

Run: `npx jest tests/components/truck-marker.test.tsx tests/unit/format.test.ts tests/unit/i18n.test.ts && npx tsc --noEmit`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/format.ts src/map/TruckMarker.tsx src/i18n/index.ts tests
git commit -m "Say how old a position is, and dim the marker when it is"
```

---

## Task 6: The reporter ✅ DONE (`9802158`)

**Files:**
- Create: `src/lib/position.ts`
- Modify: `app.json`, `package.json` (via `npx expo install`)
- Test: `tests/unit/position-reporter.test.tsx` (create)

**Interfaces:**
- Consumes: `useReportPosition()` (Task 4)
- Produces: `useReportPosition` is the mutation; this task produces
  `usePositionReporter(tripId: string | undefined, active: boolean): { lastSentAt: string | null; denied: boolean }`

- [ ] **Step 1: Install the dependency**

Run: `npx expo install expo-location`

Then add to `app.json`'s `expo.plugins` array, after the `expo-image-picker`
entry:

```json
[
  "expo-location",
  {
    "locationAlwaysAndWhenInUsePermission": false,
    "locationWhenInUsePermission": "Truckkoo shares your position with the shipper while you are carrying their load, so they can see where their cargo is. It is only shared during a delivery.",
    "isAndroidBackgroundLocationEnabled": false,
    "isIosBackgroundLocationEnabled": false
  }
]
```

**Both background flags stay false.** Turning either on is what puts the build
into App Store background-mode review and Play Console foreground-service
declaration — the thing spec F1 exists to avoid.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/position-reporter.test.tsx`:

```tsx
/**
 * The reporter, at its two boundaries: the OS permission and the RPC.
 *
 * What matters here is not that it reports — it is that it STOPS. Tracking that
 * runs outside a live trip is the thing STACK.md warns about and the thing spec
 * F6 makes structurally impossible server-side; this is the client half.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

const mockRequest = jest.fn();
const mockWatch = jest.fn();
const mockRemove = jest.fn();

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: (...a: unknown[]) => mockRequest(...a),
  watchPositionAsync: (...a: unknown[]) => mockWatch(...a),
  Accuracy: { Balanced: 3 },
}));

const mockReport = jest.fn();
jest.mock('@/lib/queries', () => ({
  useReportPosition: () => ({ mutateAsync: mockReport }),
}));

import { usePositionReporter } from '@/lib/position';

beforeEach(() => {
  mockRequest.mockReset().mockResolvedValue({ granted: true });
  mockWatch.mockReset().mockResolvedValue({ remove: mockRemove });
  mockRemove.mockReset();
  mockReport.mockReset().mockResolvedValue(true);
});

describe('usePositionReporter', () => {
  it('asks for foreground permission only — never background', async () => {
    await renderHook(() => usePositionReporter('trip-1', true));
    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    expect(mockWatch).toHaveBeenCalled();
  });

  it('does not watch at all when the trip is not live', async () => {
    await renderHook(() => usePositionReporter('trip-1', false));
    await waitFor(() => expect(mockRequest).not.toHaveBeenCalled());
    expect(mockWatch).not.toHaveBeenCalled();
  });

  it('does not watch without a trip', async () => {
    await renderHook(() => usePositionReporter(undefined, true));
    await waitFor(() => expect(mockWatch).not.toHaveBeenCalled());
  });

  it('stops watching when the trip stops being live', async () => {
    const { rerender } = await renderHook(
      ({ active }: { active: boolean }) => usePositionReporter('trip-1', active),
      { initialProps: { active: true } },
    );
    await waitFor(() => expect(mockWatch).toHaveBeenCalled());

    await rerender({ active: false });
    await waitFor(() => expect(mockRemove).toHaveBeenCalled());
  });

  it('reports a fix through the RPC, with its accuracy', async () => {
    await renderHook(() => usePositionReporter('trip-1', true));
    await waitFor(() => expect(mockWatch).toHaveBeenCalled());

    // The callback the watcher was handed, invoked as the OS would.
    const onFix = mockWatch.mock.calls[0][1] as (r: unknown) => void;
    onFix({ coords: { latitude: 23.588, longitude: 58.408, accuracy: 12 } });

    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        tripId: 'trip-1',
        lat: 23.588,
        lng: 58.408,
        accuracyM: 12,
      }),
    );
  });

  it('reports a denied permission as a state, not as a crash', async () => {
    mockRequest.mockResolvedValue({ granted: false });
    const { result } = await renderHook(() => usePositionReporter('trip-1', true));

    await waitFor(() => expect(result.current.denied).toBe(true));
    expect(mockWatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx jest tests/unit/position-reporter.test.tsx`
Expected: FAIL — cannot resolve `@/lib/position`.

- [ ] **Step 4: Implement**

Create `src/lib/position.ts`:

```ts
/**
 * The position reporter.
 *
 * FOREGROUND ONLY, and that is a product decision, not a shortcut. Continuous
 * background tracking needs an App Store background-mode justification, an
 * Android foreground service with a Play Console demo video, and a licensed
 * library — `STACK.md` calls it "the single hardest thing in the whole product"
 * and defers it to Phase 3. Everything server-side is already shaped for it, so
 * adopting it later changes this file and nothing else.
 *
 * THE HONEST COST: the driver's phone is in their pocket for most of an
 * eleven-hour run, so most of that run produces no fixes. The shipper sees a
 * correctly-stamped old position rather than a moving one. That is the trade,
 * and `OPEN_ISSUES.md` records it.
 *
 * This is the only module in the app that imports `expo-location`.
 */

import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

import { useReportPosition } from './queries';

/** One fix a minute, or every 500 metres — whichever comes first. */
const INTERVAL_MS = 60_000;
const DISTANCE_M = 500;

export function usePositionReporter(
  tripId: string | undefined,
  active: boolean,
): { lastSentAt: string | null; denied: boolean } {
  const report = useReportPosition();
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  // The mutation object is new on every render; the effect must not restart the
  // watcher because of that, so it reads through a ref instead of depending on it.
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    if (!tripId || !active) return;

    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      // FOREGROUND ONLY. There is deliberately no call to
      // requestBackgroundPermissionsAsync anywhere in this codebase.
      const permission = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (!permission.granted) {
        setDenied(true);
        return;
      }
      setDenied(false);

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: INTERVAL_MS,
          distanceInterval: DISTANCE_M,
        },
        (reading) => {
          reportRef.current
            .mutateAsync({
              tripId,
              lat: reading.coords.latitude,
              lng: reading.coords.longitude,
              accuracyM: reading.coords.accuracy ?? null,
            })
            .then((stored) => {
              // `false` means the trip is no longer live — the delivery landed
              // while this fix was in flight. Not an error, and not something
              // to show a driver standing at a gate.
              if (stored) setLastSentAt(new Date().toISOString());
            })
            .catch(() => {
              // A dropped fix on bad signal is the normal case, not an event.
              // The next one is a minute away, and the shipper's screen already
              // says how old the last one is.
            });
        },
      );

      if (cancelled) {
        subscription.remove();
        subscription = null;
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [tripId, active]);

  return { lastSentAt, denied };
}
```

- [ ] **Step 5: Run and pass**

Run: `npx jest tests/unit/position-reporter.test.tsx && npx tsc --noEmit`
Expected: 6 passed.

- [ ] **Step 6: Confirm nothing asks for background location**

Run: `grep -rn "requestBackgroundPermissions\|startLocationUpdatesAsync\|TaskManager" src/`
Expected: no hits. This is spec F1, and it is the assertion that keeps the build
out of store-review territory.

- [ ] **Step 7: Commit**

```bash
git add src/lib/position.ts app.json package.json package-lock.json tests/unit/position-reporter.test.tsx
git commit -m "Report position while the driver is on the job, and only then"
```

---

## Task 7: D7 — the driver sends, and is told so ✅ DONE (`9506033`)

**Files:**
- Modify: `src/app/(app)/trip/[id].tsx`
- Test: `tests/integration/driver-screens.test.tsx`, `tests/integration/harness.tsx`

**Interfaces:**
- Consumes: `usePositionReporter` (Task 6), `useTripPosition` (Task 4),
  `formatAge` (Task 5), `TruckMarker stale` (Task 5)

- [ ] **Step 1: Extend the harness**

In `tests/integration/harness.tsx`, add `useTripPosition` and `useReportPosition`
to the `jest.mock('@/lib/queries', …)` list, and in `resetQueries` add:

```ts
  // DEFAULT: NO FIX. A trip nobody has reported on is the state every trip
  // starts in, so it is what a fresh test renders.
  m('useTripPosition').mockReturnValue(ok(null));
  m('useReportPosition').mockReturnValue({ mutateAsync: jest.fn() });
```

Also add, near the other fixtures:

```tsx
import type { TripPosition } from '@/lib/queries';

/** A fix, as `trip_position()` composes it. Fresh unless a test says otherwise. */
export function tripPosition(over: Partial<TripPosition> = {}): TripPosition {
  return {
    lat: 22.5,
    lng: 57.5,
    seen_at: new Date(Date.now() - 4 * 60_000).toISOString(),
    accuracy_m: 12,
    remaining_km: 640,
    eta_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
    eta_source: 'fix',
    ...over,
  };
}
```

And mock the reporter module, beside the existing `jest.mock` calls:

```tsx
export const mockReporter = { lastSentAt: null as string | null, denied: false };
jest.mock('@/lib/position', () => ({
  usePositionReporter: (...a: unknown[]) => {
    mockReporterArgs.length = 0;
    mockReporterArgs.push(...a);
    return mockReporter;
  },
}));
export const mockReporterArgs: unknown[] = [];
```

- [ ] **Step 2: Write the failing tests**

Add to `tests/integration/driver-screens.test.tsx`, inside the existing
`describe('OnTheJob', …)`:

```tsx
  it('tells the driver their position is being shared, while it is', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(
      ok(driverTrip({ status: 'in_transit' })),
    );
    await render(<TripDetail />);
    expect(screen.getByText('Sharing your position with the shipper')).toBeTruthy();
    expect(screen.getByText('Only while you are carrying this load.')).toBeTruthy();
  });

  it('says nothing about sharing before the load is collected', async () => {
    // Nothing is sent on an `assigned` trip — report_position refuses it — so a
    // line claiming otherwise would be false.
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip()));
    await render(<TripDetail />);
    expect(screen.queryByText('Sharing your position with the shipper')).toBeNull();
  });

  it('reports only while the trip is live', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip()));
    await render(<TripDetail />);
    // usePositionReporter(tripId, active)
    expect(mockReporterArgs[1]).toBe(false);
  });

  it('draws its own last reported position, never a guess', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(
      ok(driverTrip({ status: 'in_transit' })),
    );
    (queries.useTripPosition as jest.Mock).mockReturnValue(ok(tripPosition()));
    const { getByTestId } = await render(<TripDetail />);
    expect(getByTestId('truck-marker')).toBeTruthy();
  });

  it('draws no truck at all when nothing has been reported', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(
      ok(driverTrip({ status: 'in_transit' })),
    );
    (queries.useTripPosition as jest.Mock).mockReturnValue(ok(null));
    const { queryByTestId } = await render(<TripDetail />);
    expect(queryByTestId('truck-marker')).toBeNull();
  });
```

- [ ] **Step 3: Run and watch fail**

Run: `npx jest tests/integration/driver-screens.test.tsx -t OnTheJob`
Expected: FAIL on the copy and on the marker.

- [ ] **Step 4: Change D7**

In `src/app/(app)/trip/[id].tsx`:

1. Add the imports: `usePositionReporter` from `@/lib/position`, `useTripPosition`
   from `@/lib/queries`, `formatAge` from `@/lib/format`.
2. After `const trip = job.data;` add:

```tsx
  const live = trip?.status === 'in_transit';
  // The reporter runs only on a live trip. `report_position` refuses anything
  // else server-side (0032), so this is the client agreeing with the database
  // rather than the client being the control.
  const { lastSentAt } = usePositionReporter(id, live);
  const position = useTripPosition(live ? id : undefined);
```

3. Replace the `{collected && (<TruckMarker at={midpoint(origin, dest)} />)}`
   block inside `MapCanvas` with:

```tsx
                  {position.data?.lat != null && position.data.lng != null && (
                    <TruckMarker
                      at={{ lng: position.data.lng, lat: position.data.lat }}
                      stale={isStale(position.data.seen_at)}
                    />
                  )}
```

4. Delete the `midpoint` function and its docblock entirely, and drop `type City`
   from the `@/lib/queries` import if nothing else uses it.
5. Add, above the `styles`:

```tsx
/** Older than half an hour. The marker dims; the timestamp says how much older. */
const STALE_MS = 30 * 60_000;

function isStale(seenAt: string | null | undefined): boolean {
  if (!seenAt) return true;
  return Date.now() - new Date(seenAt).getTime() > STALE_MS;
}
```

6. In the sheet, immediately above the `action` block, add:

```tsx
          {/* Stated while it is happening, and gone when it stops — which is
              also when the database stops accepting fixes. There is no toggle:
              the OS permission is the real control, and a switch would give the
              shipper a truck that vanishes for reasons they cannot see. */}
          {live && (
            <View style={styles.sharing}>
              <Text style={styles.sharingTitle}>{t('pos.sharing')}</Text>
              <Text style={styles.sharingWhy}>{t('pos.sharingWhy')}</Text>
              {!!formatAge(lastSentAt) && (
                <Text style={styles.sharingWhy}>
                  {`${t('pos.lastSent')} ${formatAge(lastSentAt)}`}
                </Text>
              )}
            </View>
          )}
```

7. Add the styles:

```tsx
  sharing: {
    gap: 2,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: hairline.inner,
  },
  sharingTitle: {
    ...arabicIfNeeded(font.rowTitle),
    color: color.lightText,
    textAlign: align.start,
  },
  sharingWhy: {
    ...arabicIfNeeded(font.bodySmall),
    color: alpha.onInk.secondary,
    textAlign: align.start,
  },
```

- [ ] **Step 5: Run and pass**

Run: `npx jest tests/integration/driver-screens.test.tsx && npx tsc --noEmit`
Expected: green, and `grep -n "midpoint" src/app/\(app\)/trip/\[id\].tsx` returns
nothing.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/trip src/lib tests
git commit -m "Send the driver's position while they are on the job, and say so (D7)"
```

---

## Task 8: T4 — a real truck, or none ✅ DONE (`7e25517`)

**Files:**
- Modify: `src/app/(app)/load/[id].tsx`
- Test: `tests/integration/shipper-screens.test.tsx`

**Interfaces:**
- Consumes: `useTripPosition` (Task 4), `formatAge` (Task 5),
  `TruckMarker stale` (Task 5)

- [ ] **Step 1: Write the failing tests**

`tests/integration/shipper-screens.test.tsx` already has
`describe('T4 · in transit', …)` with a `beforeEach` that puts the load in
`in_transit` and mocks `useMyTrips` with `tripOn()`. Add these **inside that
describe** — the setup is already done. The screen is imported there as
`TrackLoad`, not `LoadDetail`.

```tsx
    it('draws the truck where it was actually reported', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(ok(tripPosition()));
      const { getByTestId } = await render(<TrackLoad />);
      expect(getByTestId('truck-marker')).toBeTruthy();
    });

    it('draws no truck when nobody has reported one', async () => {
      // The whole phase in one assertion: an unreported truck is absent, not
      // guessed at from the clock.
      (queries.useTripPosition as jest.Mock).mockReturnValue(
        ok(tripPosition({ lat: null, lng: null, seen_at: null, eta_source: 'corridor' })),
      );
      const { queryByTestId } = await render(<TrackLoad />);
      expect(queryByTestId('truck-marker')).toBeNull();
    });

    it('stamps every position it draws with its age', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(ok(tripPosition()));
      await render(<TrackLoad />);
      expect(screen.getByText(/Seen/)).toBeTruthy();
    });

    it('dims a marker the shipper should not read as current', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(
        ok(tripPosition({ seen_at: new Date(Date.now() - 3 * 3600_000).toISOString() })),
      );
      const { getByTestId } = await render(<TrackLoad />);
      const fill = getByTestId('truck-body').props.fill as { payload: number };
      expect(((fill.payload >>> 24) & 255) / 255).toBeLessThan(0.9);
    });

    it('says the arrival is an estimate when there has been no fix', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(
        ok(tripPosition({ lat: null, lng: null, seen_at: null, eta_source: 'corridor' })),
      );
      await render(<TrackLoad />);
      expect(screen.getByText('Estimated arrival')).toBeTruthy();
    });

    it('does not call it an estimate once it comes from a fix', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(ok(tripPosition()));
      await render(<TrackLoad />);
      expect(screen.queryByText('Estimated arrival')).toBeNull();
    });

    it('says plainly that there is no position, rather than showing nothing', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(
        ok(tripPosition({ lat: null, lng: null, seen_at: null, eta_source: 'corridor' })),
      );
      await render(<TrackLoad />);
      expect(screen.getByText('No position yet')).toBeTruthy();
    });
```

Import `tripPosition` from `./harness` (Task 7 added it).

- [ ] **Step 1b: Update the one existing test that asserts the old behaviour**

`it('narrates arrival without claiming a live fix', …)` at roughly line 453
asserts `ARRIVING` and a progressbar, with a comment saying "the position is
interpolated". Both assertions still hold — keep them — but **rewrite the
comment**, because it will otherwise be the only place in the repo still
claiming an interpolated position exists:

```tsx
    it('narrates arrival without overstating what it knows', async () => {
      // The copy says "arriving", never "the truck is here". Since P6 the
      // position is a real reported fix or nothing at all; the bar is driven by
      // distance remaining rather than by the clock.
      (queries.useTripPosition as jest.Mock).mockReturnValue(ok(tripPosition()));
      await render(<TrackLoad />);
      expect(screen.getByText('ARRIVING')).toBeTruthy();
      expect(screen.getByRole('progressbar')).toBeTruthy();
    });
```

> The progressbar now renders only when `remaining_km` is non-null, so this test
> needs the `useTripPosition` mock above. Without it the harness default of
> `null` gives no bar, and the test fails for a reason that has nothing to do
> with what it is checking.

- [ ] **Step 2: Run and watch fail**

Run: `npx jest tests/integration/shipper-screens.test.tsx`
Expected: FAIL — no marker, no age, no estimate label.

- [ ] **Step 3: Change T4**

In `src/app/(app)/load/[id].tsx`:

1. Import `useTripPosition` from `@/lib/queries` and `formatAge` from
   `@/lib/format`. Remove `roadHours` from the `@/map` import.
2. Beside the other trip-scoped hooks (`const events = useTripEvents(trip?.id);`)
   add:

```tsx
  const position = useTripPosition(trip?.id);
```

3. Delete `const hours = roadHours(...)` and its comment.
4. Replace the marker block inside `MapCanvas` with:

```tsx
              {position.data?.lat != null && position.data.lng != null && (
                <TruckMarker
                  at={{ lng: position.data.lng, lat: position.data.lat }}
                  stale={isStale(position.data.seen_at)}
                />
              )}
```

5. Change the `InTransit` props: replace `trip`, `events` and `hours` with
   `position: TripPosition | null | undefined`, and replace its body's first
   three lines and the ETA/progress block with:

```tsx
  const fix = position?.eta_source === 'fix';
  const age = formatAge(position?.seen_at);
  const remaining = position?.remaining_km ?? null;

  return (
    <View style={styles.block}>
      <StatusPill label={t('track.transit.arriving')} tone="accent" />
      <Text style={styles.eta} accessibilityRole="header">
        {position?.eta_at ? formatDeadline(position.eta_at) : localized(dest)}
      </Text>

      {/* An arrival time derived from the corridor rather than from the truck
          says so. The one derived from a real fix does not need to. */}
      <Text style={styles.positionMeta}>
        {fix && age ? `${t('pos.seen')} ${age}` : t('pos.estimate')}
      </Text>

      {!fix && <Text style={styles.positionMeta}>{t('pos.none')}</Text>}
```

6. Replace the `ProgressBar` line with one driven by distance rather than time:

```tsx
      {remaining != null && (
        <View style={styles.progress}>
          {/* Whole percent rather than a fraction: ProgressBar announces its own
              value, and "62 of 100" is a number a person can hold. Derived from
              distance left, so it moves when the truck does. */}
          <ProgressBar step={progressPercent(remaining, corridorKm)} total={100} ground="ink" />
        </View>
      )}
```

7. Add, beside the other module-level helpers, and **delete `progressOf`,
   `interpolate` and `collectedAt` entirely**:

```tsx
/** Older than half an hour. The marker dims; the timestamp says how much older. */
const STALE_MS = 30 * 60_000;

function isStale(seenAt: string | null | undefined): boolean {
  if (!seenAt) return true;
  return Date.now() - new Date(seenAt).getTime() > STALE_MS;
}

/**
 * How far along, from distance left over distance total.
 *
 * Clamped to 2–98 so the bar never reads as "not started" or "arrived" — this
 * function knows neither. It is the only place a progress number is computed,
 * and it is computed from a measurement rather than from the clock.
 */
function progressPercent(remainingKm: number, totalKm: number): number {
  if (totalKm <= 0) return 2;
  const done = 1 - remainingKm / totalKm;
  return Math.min(98, Math.max(2, Math.round(done * 100)));
}
```

`corridorKm` is `roadKm({lng: origin.lng, lat: origin.lat}, {lng: dest.lng, lat: dest.lat})`
from `@/map` — computed once in the parent beside the other derived values and
passed into `InTransit`, so the bar and the map cannot disagree.

- [ ] **Step 4: Run and pass**

Run: `npx jest tests/integration/shipper-screens.test.tsx && npx tsc --noEmit`
Expected: green.

- [ ] **Step 5: Confirm the estimate is gone**

Run: `grep -rn "progressOf\|interpolate\|midpoint" src/`
Expected: no hits. This is DoD 3.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/load tests/integration/shipper-screens.test.tsx
git commit -m "Draw the truck where it was reported, or not at all (T4)"
```

---

## Task 9: Close the phase ✅ DONE (`25e57ce`)

**Files:**
- Modify: `SENSITIVE_FIELDS.md`, `OPEN_ISSUES.md`, `CLAUDE.md`, `STACK.md`

- [ ] **Step 1: `SENSITIVE_FIELDS.md`** — add a `public.trip_positions` section
      after `trip_events`, stating: no client grant of any kind, RLS enabled and
      forced with no policies, written only by `report_position()` (own trip,
      `in_transit` only), read one row at a time by `trip_position()` (the
      trip's driver, the load's shipper, or ops), swept by
      `ops_sweep_positions()` at 30 days. Say explicitly that **the trail is
      never returned to a client**, and why: the difference between "where is my
      truck" and a movement record is the `limit 1`.

- [ ] **Step 2: `OPEN_ISSUES.md`** — three entries under a `## P6 · live GPS`
      heading:

- **The app is backgrounded for most of a long haul, so few fixes arrive.**
  Foreground-only was chosen deliberately (spec F1). The shipper sees a
  correctly-stamped old position. Done when either background tracking ships
  (a client change — the schema already fits) or shippers stop asking.
- **Nothing runs the position sweep.** Same shape as issue 27.
  `ops_position_health()` makes it visible; it does not make it happen. Done
  when `pg_cron` runs it or the dispatcher's routine formally includes it.
- **`avg_speed_kph` is a guess.** 65 across every corridor, ignoring terrain,
  border crossings and rest. Done when there is enough trip history to fit it
  per corridor.

- [ ] **Step 3: `CLAUDE.md`** — add to the security bullets, beside the driver
      reads paragraph:

```
- **A position is only ever one row.** `trip_positions` has no client grant;
  `report_position` stores nothing outside an `in_transit` trip owned by the
  caller, and `trip_position` returns the latest fix only. The trail is ops-only
  and swept at 30 days. **Nothing computes a position** — `progressOf` and
  `interpolate` were deleted in P6 and a marker without a reported fix is a bug.
```

- [ ] **Step 4: `STACK.md`** — the "Background location · Phase 3" row is still
      true and stays. Add one line to it: *"P6 ships foreground-only reporting;
      the schema and RLS are already what background tracking needs, so it is a
      client change."*

- [ ] **Step 5: Full verification**

Run: `npx supabase db reset && npm run test:db && npm run verify`
Expected: both green.

- [ ] **Step 6: Confirm no background location anywhere**

Run:
```bash
grep -rn "requestBackgroundPermissions\|startLocationUpdatesAsync\|TaskManager" src/
grep -n "BackgroundLocation" app.json
```
Expected: no hits, and both `app.json` background flags `false`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Close P6 — what it left undone, written down"
```

---

## Self-Review

**Spec coverage.** F1 → Tasks 6, 9 (and asserted by grep in both). F2 → Tasks 5, 8. F3 → Task 8 (and DoD 3
checked twice, in Tasks 7 and 8). F4 → Task 3. F5 → Task 2 (`limit 1`, asserted).
F6 → Task 1 (asserted from three actors). F7 → Task 7. F8 → Task 2. F9 → Tasks 1,
4, 6. §4 table → Task 1. §4 functions → Tasks 1–3. §5 T4 → Task 8. §5 D7 →
Task 7. §5 `TruckMarker` → Task 5. §5 reporter → Task 6. DoD 1 → Task 9.
DoD 2 → Tasks 1, 2. DoD 3 → Task 8 step 5. DoD 4 → Task 8. DoD 5 → Task 8.
DoD 6 → Task 7. DoD 7 → Task 3. DoD 8 → Task 9.

**Known gap, deliberate.** Nothing here puts a screen in front of a human, in
either language — the same gap P5 closed with an `OPEN_ISSUES` entry rather than
a pretended test. `expo-location` also cannot be exercised without a real device:
Task 6 tests the reporter against a mocked module, which proves the wiring and
the teardown but not that a fix ever arrives on an Android phone in a truck.

**Type consistency.** `TripPosition` field names match the `returns table`
columns in Task 2 exactly (`lat`, `lng`, `seen_at`, `accuracy_m`,
`remaining_km`, `eta_at`, `eta_source`). `report_position` takes
`p_trip_id, p_lat, p_lng, p_accuracy_m` in the migration, the hook and the tests.
`usePositionReporter(tripId, active)` has the same signature in Task 6, its test,
and both screens. `TruckMarker` takes `at` and `stale` in Task 5 and both call
sites. `formatAge` returns `string | null` everywhere it is used.

---

## What actually happened

Four departures from the plan, all found by running it rather than reading it.

1. **T4's map had to move off `onLayout`.** The plan assumed the marker would be
   assertable; it was not, because `onLayout` never fires under RNTL and
   `mapSize.width` stayed 0. T4 now takes its width from `useWindowDimensions`
   with a fixed `MAP_HEIGHT`, which is the pattern D2 and D7 already used since
   P5. It also removes a frame where the coastline is not drawn yet.
2. **`react-hooks/refs` rejected the reporter's ref write.** `reportRef.current =
   report` during render is forbidden — correctly, because it makes the value
   read depend on render order. The assignment moved into its own effect. Caught
   by `npm run verify`, not by the tests.
3. **The DoD greps had to be tightened.** `grep "interpolate"` matches prose in
   `safe-text.ts` and `i18n/index.ts`, and the reporter's own comment named the
   background-permission API it promises not to call — so both checks always
   found themselves. The checks are now `\b(progressOf|interpolate|midpoint)\(`
   and the comment no longer names the API.
4. **One stale docblock survived the first pass.** `InTransit` still described a
   position "interpolated from the collection time" after the code stopped doing
   that. Nothing failed; the tests do not read comments. It is the reason DoD 3
   is a grep and not a memory.

**Not done, and filed rather than pretended away:** `OPEN_ISSUES` 32–35 — the
backgrounded-app gap, the unswept trail, `avg_speed_kph` as a guess, and the fact
that `expo-location` has never run on a device. The reporter's tests mock the
module: they prove the wiring and the teardown, and nothing about whether a fix
arrives on a cheap Android phone in a moving truck.
