# Driver Background GPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Online drivers' phones report a GPS point in the background at low frequency, and dispatch ranks drivers by that point, so a load goes to the driver who is actually nearest.

**Architecture:** One migration (`0039`) adds a latest-point-only location to `driver_availability`, a guarded `report_location` RPC, and exact-distance ranking in `private.nearby_drivers`. On the phone, one `expo-task-manager` background task (`src/lib/background-location.ts`) sends the newest fix; a provider mounted in the `(app)` layout starts/stops it from the switch, the trip state and the permission level. A cream disclosure screen precedes the OS prompt. The P6 foreground reporter is removed.

**Tech Stack:** Postgres/Supabase (plpgsql, pg_cron), Expo SDK 57 managed, `expo-location`, `expo-task-manager`, React Query, Jest + RNTL, psql test suites.

**Spec:** `docs/superpowers/specs/2026-09-28-driver-background-gps-design.md` — read it first; this plan argues from it.

## Global Constraints

- Every `security definer` function: `set search_path = ''`, fully-qualified tables **and types** (`public.trip_status`), `revoke all ... from public, anon, authenticated` then grant back only what the spec says.
- **Any function that writes is `volatile`** (default — never write `stable` on one). dispatch.sql §10 checks this statically.
- New table columns: no client grant unless the spec lists one. `lat`, `lng`, `accuracy_m` get **none**; `located_at` gets `select`.
- Region bounds for a point: `lat 12–33`, `lng 34–60` (same as `report_position`).
- Cadence: online **15 min / 2 km**; `in_transit` **2 min / 500 m**; accuracy `Balanced`. Fresh window **45 min** (`dispatch_location_fresh_minutes`). Exact point used only when accuracy ≤ **1000 m**. Rate limit **120/hour**.
- All user-facing strings through `t()`; each language owns word order; Arabic additions go at the end of the `UNPROOFED DRAFTS` block in `src/i18n/index.ts`. Logical properties only; `align.start`/`align.end` for text.
- Migrations are append-only. `0039` is edited across Tasks 1–2 **only because it has not been applied anywhere but local**; after Task 2 it is frozen.
- `npm run verify`, `npm run test:db`, `node scripts/check-migrations.mjs local` must pass at the end of every task that touches their scope.
- Never push to production, publish an EAS update, or start an EAS build — those are founder steps (Task 7).

## Review Focus

1. **A driver on a trip is offline by trigger** — their point must still reach `trip_positions` (shipper tracking), and must not be written to `driver_availability`. Test in Task 1.
2. **A phone clock running fast** — the point is clamped to `now()` and stored, not rejected forever. Test in Task 1.
3. **A short trip ending** — the pre-trip point is < 45 min old and would outrank the delivery town; delivery must clear the point. Test in Task 1.
4. **Signing out on a shared phone** — tracking stops *before* the session is cleared. Test in Task 4.
5. **The background task firing with no session or no signal** — it must swallow the failure, never throw, never stop the task. Test in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0039_driver_location.sql` (new) | Columns, grants, setting, `report_location`, `set_available`/`trip_availability` clearing, ranking |
| `supabase/tests/dispatch.sql` | New §12 (reporting) and §13 (ranking); §8 coordinate assertion replaced |
| `supabase/tests/tenant_isolation.sql` | Coordinate columns unreadable by every client role |
| `src/lib/background-location.ts` (new) | The task, `sendNewest`, start/stop, permission read/request, one-shot fix. The **only** reporting importer of `expo-location` |
| `src/lib/location-tracking.tsx` (new) | `LocationTrackingProvider` + `useLocationAccess()` — decides mode, starts/stops, foreground fallback |
| `src/app/(app)/_layout.tsx` | Mounts the provider |
| `src/app/_layout.tsx` | Side-effect import of `@/lib/background-location` so the task is defined on a headless launch |
| `src/app/(app)/location-permission.tsx` (new) | Cream disclosure screen |
| `src/components/driver/Availability.tsx` | Location line + "Turn on" |
| `src/app/(app)/(tabs)/driver.tsx` | Passes location state; opens disclosure once per launch; switch-on fix via the new module |
| `src/app/(app)/trip/[id].tsx` | "Last sent" from `trip_position.seen_at`; reporter removed |
| `src/lib/position.ts`, `tests/unit/position-reporter.test.tsx` | **Deleted** |
| `src/lib/queries.ts` | `Availability.located_at`; `useMyAvailability` selects it |
| `src/lib/auth.ts` | `signOut` stops tracking first |
| `src/i18n/index.ts` | New `loc.*` strings; `drv.avail.why` rewritten (it says "We do not track you") |
| `tests/setup.ts`, `tests/integration/harness.tsx` | Mocks for `expo-task-manager`, `expo-location`, the new modules |
| `app.json`, `package.json` | `expo-location` plugin config, `expo-task-manager`, version `1.1.0` |
| `SENSITIVE_FIELDS.md`, `SECURITY.md`, `OPEN_ISSUES.md`, `CLAUDE.md` | Record the reversal and the new fields |

---

### Task 1: Store the latest point — `report_location`

**Files:**
- Create: `supabase/migrations/0039_driver_location.sql`
- Modify: `supabase/tests/dispatch.sql` (§8 coordinate assertion; new §12 before `-- 10. Static checks`; §10 function lists)
- Modify: `supabase/tests/tenant_isolation.sql` (end of the `driver_availability (0036)` block, ~line 1835)
- Modify: `SENSITIVE_FIELDS.md` (`driver_availability` section), `SECURITY.md`

**Interfaces:**
- Produces: `public.report_location(p_lat double precision, p_lng double precision, p_accuracy_m numeric default null, p_recorded_at timestamptz default null) returns table(stored boolean, on_trip boolean)`; columns `driver_availability.lat/lng double precision, accuracy_m numeric, located_at timestamptz`; setting `dispatch_location_fresh_minutes`.

- [ ] **Step 1: Write the failing tests** — in `dispatch.sql`, replace the §8 assertion `'no coordinate column exists to leak'` with:

```sql
select assert_equals(
  (select count(*) from unnest(array['lat', 'lng', 'accuracy_m']) c
    where has_column_privilege('authenticated', 'public.driver_availability', c, 'select')
       or has_column_privilege('anon', 'public.driver_availability', c, 'select')), 0,
  'no client role can read a coordinate — not even the driver''s own');
select assert_true(has_column_privilege('authenticated', 'public.driver_availability', 'located_at', 'select'),
  'a driver can read when their location was last sent');
```

Then add, after §11 and before `-- 10. Static checks`:

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- 12. Background location — the latest point, and only while it is wanted (0039)
-- ════════════════════════════════════════════════════════════════════════════

update public.driver_availability set available = false, lat = null, lng = null,
       accuracy_m = null, located_at = null;
update public.driver_availability set available = true
 where driver_id in ('d0000000-0000-4000-8000-000000000001',   -- A Muscat
                     'd0000000-0000-4000-8000-000000000004');  -- D Sohar

select act_as('d0000000-0000-4000-8000-000000000001');
select assert_text((select stored::text || '/' || on_trip::text
                      from public.report_location(23.60, 58.50, 20, now())),
  'true/false', 'an online driver''s point is stored');
select assert_text((select stored::text from public.report_location(23.00, 58.00, 20, now() - interval '10 minutes')),
  'false', 'a point older than the stored one never overwrites it');
select assert_text((select stored::text from public.report_location(23.60, 58.50, 20, now() - interval '25 hours')),
  'false', 'a point more than a day old is dropped');
select assert_raises($$select * from public.report_location(51.5, -0.1)$$, 'a point outside the region is refused');
select assert_raises($$select * from public.report_location(23.6, null)$$, 'half a coordinate is refused');
select assert_raises($$select lat from public.driver_availability$$, 'the driver cannot read their own coordinate');
select act_as_reset();

select assert_text(
  (select lat::text || '/' || (select name_en from public.cities where id = city_id) || '/' || source
     from public.driver_availability where driver_id = 'd0000000-0000-4000-8000-000000000001'),
  '23.6/Muscat/gps', 'the latest point is kept, and the town snapped from it');

-- A phone clock three hours fast is clamped, not locked out forever.
select act_as('d0000000-0000-4000-8000-000000000004');
select assert_text((select stored::text from public.report_location(24.35, 56.70, 30, now() + interval '3 hours')),
  'true', 'a future timestamp is stored');
select act_as_reset();
select assert_true(
  (select located_at = now() from public.driver_availability
    where driver_id = 'd0000000-0000-4000-8000-000000000004'),
  'and clamped to the server''s now');

-- Offline: nothing.
select act_as('d0000000-0000-4000-8000-000000000008');  -- X Offline
select assert_text((select stored::text || '/' || on_trip::text from public.report_location(23.6, 58.5)),
  'false/false', 'an offline driver''s point is not stored');
select act_as_reset();
select assert_true(
  (select lat is null from public.driver_availability where driver_id = 'd0000000-0000-4000-8000-000000000008'),
  'no tracking while off is a database fact');

-- On a trip: offline by trigger, but the load they carry is tracked.
update public.trips set status = 'in_transit' where load_id = 'b0000000-0000-4000-8000-000000000099';
update public.driver_availability set available = false where driver_id = 'd0000000-0000-4000-8000-000000000011';
select act_as('d0000000-0000-4000-8000-000000000011');  -- X Busy
select assert_text((select stored::text || '/' || on_trip::text from public.report_location(23.9, 57.9, 25)),
  'false/true', 'a driver on a trip: the trip gets the point, availability does not');
select act_as_reset();
select assert_equals(
  (select count(*) from public.trip_positions t join public.trips tr on tr.id = t.trip_id
    where tr.load_id = 'b0000000-0000-4000-8000-000000000099'), 1,
  'the shipper''s tracking gets it with the driver''s app closed');

-- Delivering clears the point, so a short trip's pickup-area fix never outranks the new town.
update public.driver_availability set lat = 23.6, lng = 58.5, located_at = now()
 where driver_id = 'd0000000-0000-4000-8000-000000000011';
update public.trips set status = 'delivered' where load_id = 'b0000000-0000-4000-8000-000000000099';
select assert_true(
  (select available and lat is null and located_at is null
     from public.driver_availability where driver_id = 'd0000000-0000-4000-8000-000000000011'),
  'delivery puts the driver online at the destination town, with no stale point');

-- Switching off forgets the point, keeps the town.
select act_as('d0000000-0000-4000-8000-000000000001');
select public.set_available(false);
select act_as_reset();
select assert_true(
  (select lat is null and located_at is null and city_id is not null
     from public.driver_availability where driver_id = 'd0000000-0000-4000-8000-000000000001'),
  'switching off erases the point and keeps the town');

-- Switching on with GPS stores the point too.
select act_as('d0000000-0000-4000-8000-000000000001');
select public.set_available(true, 23.59, 58.41);
select act_as_reset();
select assert_true(
  (select lat = 23.59 and located_at = now() from public.driver_availability
    where driver_id = 'd0000000-0000-4000-8000-000000000001'),
  'the switch-on fix is the first point');

-- Only drivers; and the rate limit holds.
select act_as('a0000000-0000-4000-8000-000000000001');
select assert_raises($$select * from public.report_location(23.6, 58.5)$$, 'a shipper cannot report a location');
select act_as('d0000000-0000-4000-8000-000000000001');
select assert_raises(
  $$select count(*) from generate_series(1, 130) g, lateral public.report_location(23.6, 58.5, 20, now())$$,
  'the rate limit holds (120 an hour)');
select act_as_reset();
```

Add `'report_location'` to the §10 definer list (the one checking `search_path`).

In `tenant_isolation.sql`, after `'driver A cannot switch driver B off'`:

```sql
select act_as('33333333-3333-4333-8333-333333333333');
select assert_raises($$select lat, lng from public.driver_availability$$,
  'driver A cannot read a coordinate, even their own');
select act_as_reset();
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:db:dispatch 2>&1 | grep -E "FAIL|ERROR" | head -3`
Expected: `ERROR: column "lat" of relation "driver_availability" does not exist` (from the §12 reset line).

- [ ] **Step 3: Write the migration**

`supabase/migrations/0039_driver_location.sql`:

```sql
-- 0039 · Driver background GPS — the latest point, used to find the nearest driver.
--
-- Spec: docs/superpowers/specs/2026-09-28-driver-background-gps-design.md.
-- REVERSES 0036's "a town, never a coordinate", on the founder's call
-- (2026-09-28). What is kept: one point per driver, overwritten — never a trail —
-- and only while they are online. No client role can read it, not even the
-- driver's own; `located_at` alone is readable, so the app can say "last sent".

alter table public.driver_availability
  add column if not exists lat        double precision,
  add column if not exists lng        double precision,
  add column if not exists accuracy_m numeric,
  add column if not exists located_at timestamptz;

alter table public.driver_availability drop constraint if exists driver_availability_point_whole;
alter table public.driver_availability add constraint driver_availability_point_whole
  check ((lat is null) = (lng is null) and (lat is null) = (located_at is null));

-- 0036 granted select by column list, so the three coordinate columns start
-- with no grant. Only the timestamp is granted back.
grant select (located_at) on public.driver_availability to authenticated;

insert into private.app_settings (key, value) values
  ('dispatch_location_fresh_minutes', '45'::jsonb)
on conflict (key) do nothing;

create or replace function public.report_location(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric default null,
  p_recorded_at timestamptz default null
)
returns table(stored boolean, on_trip boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_at      timestamptz;
  v_trip    uuid;
  v_stored  boolean := false;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if (select private.actor_role()) <> 'driver' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_active();
  -- 120/hour: the phone asks every 2 min at most (on a trip). This bounds a
  -- broken client, not the real one.
  perform private.check_rate_limit('report_location', 120, interval '1 hour');

  if p_lat is null or p_lng is null
     or p_lat not between 12 and 33 or p_lng not between 34 and 60 then
    raise exception 'position out of range' using errcode = 'check_violation';
  end if;
  if p_accuracy_m is not null and (p_accuracy_m < 0 or p_accuracy_m > 100000) then
    raise exception 'accuracy out of range' using errcode = 'check_violation';
  end if;

  -- A fast phone clock is clamped, not refused: refusing would lock that phone
  -- out for as long as its clock is wrong, silently. A day-old point is a
  -- replay from a phone that was off; it is dropped, not raised, so the
  -- rate-limit row stays spent.
  v_at := least(coalesce(p_recorded_at, now()), now());
  if v_at < now() - interval '24 hours' then
    return query select false, false;
    return;
  end if;

  -- The load being carried is tracked whatever the switch says: the trip
  -- trigger (0036) takes a driver on a job offline.
  select t.id into v_trip
  from public.trips t
  where t.driver_id = v_actor and t.status = 'in_transit'::public.trip_status
  order by t.created_at desc
  limit 1;

  if v_trip is not null then
    insert into public.trip_positions (trip_id, driver_id, lat, lng, accuracy_m, seen_at)
    values (v_trip, v_actor, p_lat, p_lng, p_accuracy_m, v_at);
  end if;

  -- Offline stores nothing. Older than what we have is ignored. `updated_at`
  -- is NOT touched: it records the switch, and 0037's re-ask rule reads it.
  update public.driver_availability da
     set lat = p_lat, lng = p_lng, accuracy_m = p_accuracy_m, located_at = v_at,
         city_id = private.nearest_city(p_lat, p_lng), source = 'gps'
   where da.driver_id = v_actor
     and da.available
     and (da.located_at is null or da.located_at < v_at);
  v_stored := found;

  return query select v_stored, v_trip is not null;
end;
$$;

revoke all on function public.report_location(double precision, double precision, numeric, timestamptz)
  from public, anon;
grant execute on function public.report_location(double precision, double precision, numeric, timestamptz)
  to authenticated;

-- 0036's set_available, plus: off erases the point; on with GPS stores it.
create or replace function public.set_available(
  p_available boolean,
  p_lat double precision default null,
  p_lng double precision default null
)
returns table(available boolean, city_id bigint, source text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_city   bigint;
  v_source text;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if (select private.actor_role()) <> 'driver' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_active();
  perform private.check_rate_limit('set_available', 60, interval '1 hour');

  if p_available is null then
    raise exception 'available required' using errcode = 'check_violation';
  end if;
  if (p_lat is null) <> (p_lng is null)
     or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception 'bad position' using errcode = 'check_violation';
  end if;

  if p_lat is not null then
    v_city := private.nearest_city(p_lat, p_lng);
    v_source := 'gps';
  else
    v_city := private.last_delivery_city(v_actor);
    v_source := case when v_city is not null then 'delivery' else 'manual' end;
  end if;

  insert into public.driver_availability as da (driver_id, available, city_id, source, updated_at)
  values (v_actor, p_available, v_city, v_source, now())
  on conflict (driver_id) do update
    set available  = excluded.available,
        city_id    = coalesce(excluded.city_id, da.city_id),
        source     = case when excluded.city_id is null then da.source else excluded.source end,
        updated_at = now();

  -- Off means we stop knowing, not just stop updating. The town stays: the next
  -- switch-on needs somewhere to rank from before its first fix.
  if not p_available then
    update public.driver_availability da
       set lat = null, lng = null, accuracy_m = null, located_at = null
     where da.driver_id = v_actor;
  elsif p_lat is not null
        and p_lat between 12 and 33 and p_lng between 34 and 60 then
    update public.driver_availability da
       set lat = p_lat, lng = p_lng, accuracy_m = null, located_at = now()
     where da.driver_id = v_actor;
  end if;

  return query
  select da.available, da.city_id, da.source
  from public.driver_availability da where da.driver_id = v_actor;
end;
$$;

revoke all on function public.set_available(boolean, double precision, double precision) from public, anon;
grant execute on function public.set_available(boolean, double precision, double precision) to authenticated;

-- 0036's trip trigger, plus: a job ending clears the point. A short trip's
-- pickup-area fix is under 45 minutes old at delivery and would otherwise
-- outrank the destination town it is no longer anywhere near.
create or replace function private.trip_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status) then
    insert into public.driver_availability (driver_id, available, source, updated_at)
    values (new.driver_id, false, 'manual', now())
    on conflict (driver_id) do update set available = false, updated_at = now();
  elsif new.status = 'delivered'::public.trip_status
        and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.driver_availability (driver_id, available, city_id, source, updated_at)
    select new.driver_id, true, l.dest_city, 'delivery', now()
    from public.loads l where l.id = new.load_id
    on conflict (driver_id) do update
      set available = true, city_id = excluded.city_id, source = 'delivery',
          updated_at = now(), lat = null, lng = null, accuracy_m = null, located_at = null;
  end if;
  return new;
end;
$$;

revoke all on function private.trip_availability() from public, anon, authenticated;
```

- [ ] **Step 4: Apply locally and run**

```bash
docker exec -i supabase_db_truckkoo-app psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 < supabase/migrations/0039_driver_location.sql
docker exec -i supabase_db_truckkoo-app psql -U postgres -d postgres -c "insert into supabase_migrations.schema_migrations(version,name) values ('0039','driver_location') on conflict do nothing"
npm run test:db
```
Expected: no `FAIL`/`ERROR:` lines; §12 passes print `pass:`. If `trip_positions_in_region` or another check rejects 23.9/57.9, pick a point inside Oman and keep the assertion.

- [ ] **Step 5: Docs** — `SENSITIVE_FIELDS.md`, in the `driver_availability` table add rows:

```markdown
| `lat`, `lng`, `accuracy_m` | **Where a driver is, to the metre.** Ranks who is offered cargo; also where someone lives. No client grant at all — not even the driver's own row. Overwritten, never kept as a trail; erased on switch-off and at delivery. | `report_location()` (online only), `set_available()`, the trip trigger |
| `located_at` | When the phone took the fix (clamped to server time). Client may read its own. | Same as above |
```

and replace the paragraph "No coordinate column exists — …" with: "Since 0039 the latest GPS point is stored (founder's decision, 2026-09-28, reversing 0036). No client role can read a coordinate; asserted in `dispatch.sql` §8 and `tenant_isolation.sql`." In `SECURITY.md`, wherever driver position is described, add one dated line recording the reversal and pointing at the spec.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0039_driver_location.sql supabase/tests/dispatch.sql supabase/tests/tenant_isolation.sql SENSITIVE_FIELDS.md SECURITY.md
git commit -m "Store each online driver's latest GPS point, and nothing else"
```

---

### Task 2: Rank by the exact point

**Files:**
- Modify: `supabase/migrations/0039_driver_location.sql` (append)
- Modify: `supabase/tests/dispatch.sql` (new §13 after §12)

**Interfaces:**
- Consumes: Task 1 columns and `dispatch_location_fresh_minutes`.
- Produces: `private.nearby_drivers(uuid, numeric, boolean, integer)` — **same signature and return shape** `(driver_id uuid, truck_id uuid, deadhead_km numeric, pending bigint)`; new ordering.

- [ ] **Step 1: Write the failing test** — §13:

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- 13. Ranked by where the truck is, not where its town says (0039)
-- ════════════════════════════════════════════════════════════════════════════
-- Seeb is ~30 km from Muscat; Sohar ~231. Wave 1 reaches 150.

update public.driver_availability set available = false, lat = null, lng = null,
       accuracy_m = null, located_at = null;
update public.driver_availability                         -- D: town Sohar, fresh point in Seeb
   set available = true, city_id = city('Sohar'), lat = 23.67, lng = 58.19,
       accuracy_m = 30, located_at = now() - interval '10 minutes'
 where driver_id = 'd0000000-0000-4000-8000-000000000004';
update public.driver_availability                         -- E: town Salalah, STALE point in Seeb
   set available = true, city_id = city('Salalah'), lat = 23.67, lng = 58.19,
       accuracy_m = 30, located_at = now() - interval '2 hours'
 where driver_id = 'd0000000-0000-4000-8000-000000000005';
update public.driver_availability                         -- F: no town, COARSE point in Seeb
   set available = true, city_id = null, lat = 23.67, lng = 58.19,
       accuracy_m = 5000, located_at = now() - interval '5 minutes'
 where driver_id = 'd0000000-0000-4000-8000-000000000006';

select act_as('a0000000-0000-4000-8000-000000000001');
create temp table located on commit drop as
select * from public.book_load(city('Muscat'), city('Dubai'), current_date + 6, current_date + 6,
                               'Located cargo', 8000, null, :p8000);
select act_as_reset();

select assert_text(asked((select load_id from located)), 'D Sohar',
  'a fresh, accurate point wins wave 1 though the town is 231 km away; stale and coarse points do not count');

-- Fresh first: A Muscat's town is 0 km, D's fresh point ~40 km — with one offer per wave, D is asked.
update public.driver_availability set available = true, city_id = city('Muscat')
 where driver_id = 'd0000000-0000-4000-8000-000000000001';
update private.app_settings set value = '1'::jsonb where key = 'auto_dispatch_max_offers';
select act_as('a0000000-0000-4000-8000-000000000001');
create temp table located_one on commit drop as
select * from public.book_load(city('Muscat'), city('Dubai'), current_date + 7, current_date + 7,
                               'Fresh first', 8000, null, :p8000);
select act_as_reset();
select assert_text(asked((select load_id from located_one)), 'D Sohar',
  'a driver we know is 40 km away outranks a town that says 0 km');
update private.app_settings set value = '3'::jsonb where key = 'auto_dispatch_max_offers';
```

(D may hit its pending cap of 3 by now — if the second assertion fails on that, expire D's earlier pending offers with an `update public.offers set status = 'expired' where driver_id = ... and status = 'pending'` before the second booking.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:db:dispatch 2>&1 | grep FAIL | head -2`
Expected: `FAIL: a fresh, accurate point wins wave 1 ... — expected D Sohar, got` (today D ranks by Sohar, outside wave 1).

- [ ] **Step 3: Append to 0039** — `nearby_drivers` as in 0037, with the distance lateral and ordering replaced:

```sql
-- 0037's nearby_drivers, measured from the exact point when it is fresh and
-- accurate, else from the town as before. Fresh first: a driver we KNOW is 40 km
-- away outranks a town that says 0 km for a truck last seen yesterday.
create or replace function private.nearby_drivers(
  p_load_id uuid, p_radius_km numeric, p_include_unlocated boolean, p_limit integer
)
returns table(driver_id uuid, truck_id uuid, deadhead_km numeric, pending bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with l as (
    select lo.id, lo.origin_city, lo.weight_kg, lo.truck_type_code
    from public.loads lo where lo.id = p_load_id
  )
  select p.id, tk.id, km.v, coalesce(pc.n, 0)
  from public.profiles p
  cross join l
  join public.driver_availability da on da.driver_id = p.id and da.available
  join lateral (
    select t.id, t.capacity_kg
    from public.trucks t
    where t.owner_id = p.id
      and (l.truck_type_code is null or t.truck_type = l.truck_type_code)
      and (l.weight_kg is null or coalesce(t.capacity_kg, 2147483647) >= l.weight_kg)
    order by t.capacity_kg asc nulls last
    limit 1
  ) tk on true
  cross join lateral (
    select (da.lat is not null
            and da.located_at > now() - make_interval(
                  mins => private.setting_int('dispatch_location_fresh_minutes', 45))
            and coalesce(da.accuracy_m, 0) <= 1000) as fresh
  ) fr
  left join lateral (
    select case
      when fr.fresh then private.point_km(da.lat::numeric, da.lng::numeric, l.origin_city)
      when da.city_id is not null then private.route_km(da.city_id, l.origin_city)
    end as v
  ) km on true
  left join lateral (
    select count(*) as n from public.offers o
    where o.driver_id = p.id and o.status = 'pending' and o.expires_at > now()
  ) pc on true
  where p.role = 'driver'
    and p.suspended_at is null
    and (not private.setting_bool('require_verified_driver', true)
         or private.is_verified_driver(p.id))
    and not exists (
      select 1 from public.offers o
      where o.load_id = p_load_id and o.driver_id = p.id
        and not (
          (o.status = 'expired' or (o.status = 'pending' and o.expires_at <= now()))
          and da.updated_at > o.created_at
        )
    )
    and not exists (
      select 1 from public.trips t
      where t.driver_id = p.id
        and t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
    )
    and (
      (km.v is not null and km.v <= p_radius_km)
      or (km.v is null and p_include_unlocated)
    )
  order by fr.fresh desc, km.v asc nulls last, coalesce(pc.n, 0) asc,
           tk.capacity_kg asc nulls last, p.id
  limit p_limit;
$$;

revoke all on function private.nearby_drivers(uuid, numeric, boolean, integer)
  from public, anon, authenticated;
```

- [ ] **Step 4: Re-apply and run everything**

```bash
docker exec -i supabase_db_truckkoo-app psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 < supabase/migrations/0039_driver_location.sql
npm run test:db && node scripts/check-migrations.mjs local
```
Expected: no `FAIL`/`ERROR:`; `✓ 39 migrations (local)`.

- [ ] **Step 5: Commit** — `0039` is now frozen.

```bash
git add supabase/migrations/0039_driver_location.sql supabase/tests/dispatch.sql
git commit -m "Offer loads to the driver who is nearest by GPS, not by town"
```

---

### Task 3: The background task

**Files:**
- Create: `src/lib/background-location.ts`
- Create: `tests/unit/background-location.test.ts`
- Modify: `tests/setup.ts` (global mocks), `src/app/_layout.tsx` (side-effect import)
- Modify: `package.json` via `npx expo install expo-task-manager`

**Interfaces:**
- Produces:
  - `LOCATION_TASK = 'truckkoo-driver-location'`
  - `type TrackingMode = 'online' | 'trip'`, `CADENCE: Record<TrackingMode, { timeInterval: number; distanceInterval: number }>`
  - `type LocationAccess = 'always' | 'foreground' | 'none'`
  - `sendNewest(locations: Location.LocationObject[]): Promise<void>` — never throws
  - `startTracking(mode: TrackingMode): Promise<boolean>` — false when background permission is missing
  - `stopTracking(): Promise<void>`
  - `locationAccess(): Promise<LocationAccess>`, `requestLocationAccess(): Promise<LocationAccess>`
  - `reportOnce(): Promise<{ lat: number; lng: number } | null>` — one fix within 8 s, sent; returns it
  - `currentFix(): Promise<{ lat: number; lng: number } | null>` — one fix within 8 s, not sent (for the switch)

- [ ] **Step 1: Install**

Run: `npx expo install expo-task-manager`
Expected: `expo-task-manager` added to `package.json` at the SDK 57 version.

- [ ] **Step 2: Global mocks** — append to `tests/setup.ts`:

```ts
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  ActivityType: { AutomotiveNavigation: 2 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  getCurrentPositionAsync: jest.fn(async () => null),
}));
```

- [ ] **Step 3: Write the failing tests** — `tests/unit/background-location.test.ts`:

```ts
/**
 * The background task at its boundaries: the OS (expo-location/task-manager)
 * and the RPC. What matters most is that a bad moment — no session, no signal —
 * never throws out of the task, and that only the newest fix is sent.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { supabase } from '@/lib/supabase';
import {
  CADENCE,
  LOCATION_TASK,
  locationAccess,
  requestLocationAccess,
  sendNewest,
  startTracking,
  stopTracking,
} from '@/lib/background-location';

const L = Location as jest.Mocked<typeof Location>;
const fix = (ts: number, lat = 23.6) =>
  ({ timestamp: ts, coords: { latitude: lat, longitude: 58.5, accuracy: 20 } }) as Location.LocationObject;

beforeEach(() => {
  jest.clearAllMocks();
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: [{ stored: true, on_trip: false }], error: null });
});

it('defines the task once, at import', () => {
  expect(TaskManager.defineTask).toHaveBeenCalledWith(LOCATION_TASK, expect.any(Function));
});

it('sends only the newest fix of a batch', async () => {
  await sendNewest([fix(1000, 23.1), fix(3000, 23.3), fix(2000, 23.2)]);
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith('report_location', {
    p_lat: 23.3, p_lng: 58.5, p_accuracy_m: 20, p_recorded_at: new Date(3000).toISOString(),
  });
});

it('never throws — no session, no signal', async () => {
  (supabase.rpc as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
  await expect(sendNewest([fix(1)])).resolves.toBeUndefined();
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: null, error: { message: 'JWT expired' } });
  await expect(sendNewest([fix(2)])).resolves.toBeUndefined();
});

it('the task handler swallows an OS error', async () => {
  const handler = (TaskManager.defineTask as jest.Mock).mock.calls[0][1];
  await expect(handler({ data: null, error: { message: 'denied' } })).resolves.toBeUndefined();
  expect(supabase.rpc).not.toHaveBeenCalled();
});

it('does not start without background permission', async () => {
  L.getBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
  await expect(startTracking('online')).resolves.toBe(false);
  expect(L.startLocationUpdatesAsync).not.toHaveBeenCalled();
});

it('starts at the online cadence, with the notification', async () => {
  L.getBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  await expect(startTracking('online')).resolves.toBe(true);
  expect(L.startLocationUpdatesAsync).toHaveBeenCalledWith(
    LOCATION_TASK,
    expect.objectContaining({
      timeInterval: CADENCE.online.timeInterval,
      distanceInterval: 2000,
      foregroundService: expect.objectContaining({ notificationTitle: expect.any(String) }),
    }),
  );
  expect(CADENCE.online.timeInterval).toBe(15 * 60_000);
  expect(CADENCE.trip).toEqual({ timeInterval: 2 * 60_000, distanceInterval: 500 });
});

it('restarts when the mode changes, not when it is the same', async () => {
  L.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true } as never);
  L.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
  await startTracking('trip');
  expect(L.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  await startTracking('trip');
  expect(L.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
});

it('stops only what is running', async () => {
  L.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(false);
  await stopTracking();
  expect(L.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  L.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(true);
  await stopTracking();
  expect(L.stopLocationUpdatesAsync).toHaveBeenCalledWith(LOCATION_TASK);
});

it('reads and requests permission in Android order', async () => {
  L.getForegroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  L.getBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
  await expect(locationAccess()).resolves.toBe('foreground');

  L.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  L.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  await expect(requestLocationAccess()).resolves.toBe('always');
  expect(L.requestForegroundPermissionsAsync.mock.invocationCallOrder[0]).toBeLessThan(
    L.requestBackgroundPermissionsAsync.mock.invocationCallOrder[0],
  );
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx jest tests/unit/background-location.test.ts`
Expected: FAIL — `Cannot find module '@/lib/background-location'`.

- [ ] **Step 5: Implement** — `src/lib/background-location.ts`:

```ts
/**
 * Driver location, in the background (spec 2026-09-28).
 *
 * The one module that reports a driver's position. It runs only while the driver
 * is online or carrying a load (the provider in `location-tracking.tsx` decides),
 * at low frequency — the concern is battery and data — and sends only the newest
 * fix. The server keeps only the latest point, and stores nothing while the
 * driver is off (0039): this file is the client half, not the control.
 *
 * `defineTask` must run at module scope on every launch, including a headless
 * one after the OS restarts the service — which is why `src/app/_layout.tsx`
 * imports this file for its side effect.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';

export const LOCATION_TASK = 'truckkoo-driver-location';

export type TrackingMode = 'online' | 'trip';
export type LocationAccess = 'always' | 'foreground' | 'none';

/** Online: often enough that a point is rarely 15 min old at dispatch. On a trip: the shipper is watching. */
export const CADENCE: Record<TrackingMode, { timeInterval: number; distanceInterval: number }> = {
  online: { timeInterval: 15 * 60_000, distanceInterval: 2000 },
  trip: { timeInterval: 2 * 60_000, distanceInterval: 500 },
};

/** Waiting longer than this for a fix is a driver staring at a switch. */
const FIX_TIMEOUT_MS = 8000;

export async function sendNewest(locations: Location.LocationObject[]): Promise<void> {
  if (locations.length === 0) return;
  const newest = locations.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
  try {
    await supabase.rpc('report_location', {
      p_lat: newest.coords.latitude,
      p_lng: newest.coords.longitude,
      p_accuracy_m: newest.coords.accuracy ?? null,
      p_recorded_at: new Date(newest.timestamp).toISOString(),
    });
  } catch {
    // No signal in the Hajar, or no session on a headless launch. The next
    // update is minutes away; a throw here would only kill the task.
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    await sendNewest(data.locations);
  },
);

let runningMode: TrackingMode | null = null;

export async function startTracking(mode: TrackingMode): Promise<boolean> {
  const bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted) return false;

  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (started && runningMode === mode) return true;
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: CADENCE[mode].timeInterval,
    distanceInterval: CADENCE[mode].distanceInterval,
    deferredUpdatesInterval: CADENCE[mode].timeInterval,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: t('loc.notify.title'),
      notificationBody: t('loc.notify.body'),
      killServiceOnDestroy: false,
    },
  });
  runningMode = mode;
  return true;
}

export async function stopTracking(): Promise<void> {
  runningMode = null;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

export async function locationAccess(): Promise<LocationAccess> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return 'none';
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.granted ? 'always' : 'foreground';
}

/** Android order: while-using first, then all-the-time (Settings, on 11+). */
export async function requestLocationAccess(): Promise<LocationAccess> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return 'none';
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.granted ? 'always' : 'foreground';
}

export async function currentFix(): Promise<{ lat: number; lng: number } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), FIX_TIMEOUT_MS);
      }),
    ]);
    return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The while-using fallback: one fix, sent. */
export async function reportOnce(): Promise<{ lat: number; lng: number } | null> {
  const fix = await currentFix();
  if (fix) {
    await sendNewest([
      { timestamp: Date.now(), coords: { latitude: fix.lat, longitude: fix.lng, accuracy: null } },
    ] as unknown as Location.LocationObject[]);
  }
  return fix;
}
```

Add `loc.notify.title` / `loc.notify.body` to `en` in `src/i18n/index.ts` now (Task 5 adds the rest):

```ts
  'loc.notify.title': 'You are available',
  'loc.notify.body': 'Sharing your location to find loads near you.',
```

and to the end of the Arabic `UNPROOFED DRAFTS` block:

```ts
  'loc.notify.title': 'أنت متاح',
  'loc.notify.body': 'نشارك موقعك لنجد لك شحنات قريبة منك.',
```

In `src/app/_layout.tsx`, add near the other imports:

```ts
// Side effect: defines the background location task. It must exist on every
// launch — including a headless one the OS starts to deliver a location.
import '@/lib/background-location';
```

- [ ] **Step 6: Run**

Run: `npx jest tests/unit/background-location.test.ts && npm run verify`
Expected: PASS; verify green.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/background-location.ts tests/unit/background-location.test.ts tests/setup.ts src/app/_layout.tsx src/i18n/index.ts
git commit -m "Add the background location task: newest fix only, never throws"
```

---

### Task 4: Decide when it runs — the provider, and sign-out

**Files:**
- Create: `src/lib/location-tracking.tsx`
- Create: `tests/unit/location-tracking.test.tsx`
- Modify: `src/app/(app)/_layout.tsx`, `src/lib/auth.ts`

**Interfaces:**
- Consumes: Task 3 exports; `useSession()` (`profile?.role`), `useMyAvailability()` (`data?.available`), `useMyTrips()` (`data[].status`).
- Produces: `LocationTrackingProvider({ children })`; `useLocationAccess(): { access: LocationAccess | null; refresh: () => void; request: () => Promise<LocationAccess> }`; pure `trackingMode(role, available, trips): TrackingMode | null`.

- [ ] **Step 1: Write the failing tests** — `tests/unit/location-tracking.test.tsx`:

```tsx
import { render, waitFor, act } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

const mockStart = jest.fn(async () => true);
const mockStop = jest.fn(async () => undefined);
const mockAccess = jest.fn(async () => 'always');
const mockReportOnce = jest.fn(async () => null);
jest.mock('@/lib/background-location', () => ({
  startTracking: (...a: unknown[]) => mockStart(...a),
  stopTracking: () => mockStop(),
  locationAccess: () => mockAccess(),
  requestLocationAccess: jest.fn(),
  reportOnce: () => mockReportOnce(),
}));

let mockRole: 'driver' | 'shipper' | undefined = 'driver';
let mockAvailable = true;
let mockTrips: { status: string }[] = [];
jest.mock('@/lib/session', () => ({ useSession: () => ({ profile: mockRole ? { role: mockRole } : null }) }));
jest.mock('@/lib/queries', () => ({
  useMyAvailability: () => ({ data: { available: mockAvailable } }),
  useMyTrips: () => ({ data: mockTrips }),
}));

import { LocationTrackingProvider, trackingMode, useLocationAccess } from '@/lib/location-tracking';

function Probe() {
  const { access } = useLocationAccess();
  return <Text>{access ?? 'unknown'}</Text>;
}
const mount = () => render(<LocationTrackingProvider><Probe /></LocationTrackingProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'driver'; mockAvailable = true; mockTrips = [];
  mockAccess.mockResolvedValue('always');
});

describe('trackingMode', () => {
  it('trip beats the switch; off and shippers get nothing', () => {
    expect(trackingMode('driver', false, [{ status: 'in_transit' }])).toBe('trip');
    expect(trackingMode('driver', true, [{ status: 'assigned' }])).toBe('online');
    expect(trackingMode('driver', false, [])).toBeNull();
    expect(trackingMode('shipper', true, [])).toBeNull();
    expect(trackingMode(undefined, true, [])).toBeNull();
  });
});

it('an online driver with Always is tracked at the online cadence', async () => {
  await mount();
  await waitFor(() => expect(mockStart).toHaveBeenCalledWith('online'));
});

it('a driver carrying a load is tracked at the trip cadence, switch or not', async () => {
  mockAvailable = false; mockTrips = [{ status: 'in_transit' }];
  await mount();
  await waitFor(() => expect(mockStart).toHaveBeenCalledWith('trip'));
});

it('off: stopped', async () => {
  mockAvailable = false;
  await mount();
  await waitFor(() => expect(mockStop).toHaveBeenCalled());
  expect(mockStart).not.toHaveBeenCalled();
});

it('a shipper is never tracked', async () => {
  mockRole = 'shipper';
  await mount();
  await waitFor(() => expect(mockStop).toHaveBeenCalled());
  expect(mockStart).not.toHaveBeenCalled();
});

it('while-using only: one fix now, none in the background', async () => {
  mockAccess.mockResolvedValue('foreground');
  await mount();
  await waitFor(() => expect(mockReportOnce).toHaveBeenCalledTimes(1));
  expect(mockStart).not.toHaveBeenCalled();
});

it('re-reads permission when the driver comes back from Settings', async () => {
  const listeners: ((s: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, fn) => {
    listeners.push(fn as (s: string) => void);
    return { remove: jest.fn() } as never;
  });
  mockAccess.mockResolvedValueOnce('foreground').mockResolvedValue('always');
  const { findByText } = await mount();
  await findByText('foreground');
  await act(async () => listeners.forEach((l) => l('active')));
  await findByText('always');
});
```

And in a new `describe` in the same file, for sign-out ordering (Review Focus 4):

```tsx
describe('signOut', () => {
  it('stops tracking before the session is cleared', async () => {
    // auth.ts imports the mocked background-location above, so mockStop is its stopTracking.
    const { supabase } = jest.requireMock('@/lib/supabase') as { supabase: { auth: { signOut: jest.Mock } } };
    const { signOut } = jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');
    await signOut();
    expect(mockStop.mock.invocationCallOrder[0]).toBeLessThan(
      supabase.auth.signOut.mock.invocationCallOrder[0],
    );
  });
});
```

(`@/lib/supabase` is already mocked globally in `tests/setup.ts`; if `supabase.auth.signOut` is not a `jest.fn()` there, add it to that mock.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/location-tracking.test.tsx`
Expected: FAIL — `Cannot find module '@/lib/location-tracking'`.

- [ ] **Step 3: Implement** — `src/lib/location-tracking.tsx`:

```tsx
/**
 * When the driver's location is reported — the policy half of
 * `background-location.ts`.
 *
 * Tracked while ONLINE or CARRYING A LOAD, never otherwise, never a shipper.
 * With "Allow all the time" the OS task does it; with while-using only, one fix
 * on opening the app and every five minutes it stays open; with nothing, the
 * server ranks by town. Mounted once, in the (app) layout.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import {
  type LocationAccess,
  type TrackingMode,
  locationAccess,
  reportOnce,
  requestLocationAccess,
  startTracking,
  stopTracking,
} from '@/lib/background-location';
import { useMyAvailability, useMyTrips } from '@/lib/queries';
import { useSession } from '@/lib/session';

const FOREGROUND_INTERVAL_MS = 5 * 60_000;

export function trackingMode(
  role: string | undefined,
  available: boolean | undefined,
  trips: { status: string }[] | undefined,
): TrackingMode | null {
  if (role !== 'driver') return null;
  if ((trips ?? []).some((tr) => tr.status === 'in_transit')) return 'trip';
  return available ? 'online' : null;
}

type Ctx = {
  access: LocationAccess | null;
  refresh: () => void;
  request: () => Promise<LocationAccess>;
};
const LocationCtx = createContext<Ctx>({
  access: null,
  refresh: () => {},
  request: async () => 'none',
});

export function useLocationAccess() {
  return useContext(LocationCtx);
}

export function LocationTrackingProvider({ children }: { children: ReactNode }) {
  const { profile } = useSession();
  const role = profile?.role;
  const availability = useMyAvailability();
  const trips = useMyTrips();
  const mode = trackingMode(role, availability.data?.available, trips.data);
  const [access, setAccess] = useState<LocationAccess | null>(null);

  const refresh = useCallback(() => {
    locationAccess().then(setAccess, () => setAccess('none'));
  }, []);

  // On mount, and every time the app comes back — Settings is where Android 11+
  // grants "Allow all the time", so returning from it is the moment it changes.
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!mode || access === null) {
      if (!mode) stopTracking().catch(() => {});
      return;
    }
    if (access === 'always') {
      startTracking(mode).catch(() => {});
      return;
    }
    stopTracking().catch(() => {});
    if (access === 'foreground') {
      reportOnce().catch(() => {});
      const id = setInterval(() => {
        if (AppState.currentState === 'active') reportOnce().catch(() => {});
      }, FOREGROUND_INTERVAL_MS);
      return () => clearInterval(id);
    }
  }, [mode, access]);

  const request = useCallback(async () => {
    const next = await requestLocationAccess();
    setAccess(next);
    return next;
  }, []);

  const value = useMemo(() => ({ access, refresh, request }), [access, refresh, request]);
  return <LocationCtx.Provider value={value}>{children}</LocationCtx.Provider>;
}
```

Mount it — `src/app/(app)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

import { MapPlacesProvider } from '@/map';
import { LocationTrackingProvider } from '@/lib/location-tracking';
import { useCities } from '@/lib/queries';
import { color } from '@/theme/tokens';

export default function AppLayout() {
  const { data: cities } = useCities();
  return (
    <LocationTrackingProvider>
      <MapPlacesProvider places={cities}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.creamCard },
          }}
        />
      </MapPlacesProvider>
    </LocationTrackingProvider>
  );
}
```

Sign-out — `src/lib/auth.ts`:

```ts
import { stopTracking } from '@/lib/background-location';

export async function signOut(): Promise<void> {
  // Before the session goes: a shared phone must never report a position under
  // the account that just left. A failure to stop does not block signing out.
  await stopTracking().catch(() => {});
  // Global scope revokes server-side, not just locally (SECURITY.md §2).
  await supabase.auth.signOut({ scope: 'global' });
}
```

- [ ] **Step 4: Run**

Run: `npx jest tests/unit/location-tracking.test.tsx && npm run verify`
Expected: PASS. If integration tests fail because `(app)/_layout` now needs the provider's hooks, add to `tests/integration/harness.tsx`:

```tsx
jest.mock('@/lib/location-tracking', () => ({
  LocationTrackingProvider: ({ children }: { children: React.ReactNode }) => children,
  useLocationAccess: () => mockLocationAccess,
}));
export const mockLocationAccess = { access: 'always' as string | null, refresh: jest.fn(), request: jest.fn() };
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/location-tracking.tsx tests/unit/location-tracking.test.tsx "src/app/(app)/_layout.tsx" src/lib/auth.ts tests/integration/harness.tsx
git commit -m "Track a driver only while online or carrying a load; stop before sign-out"
```

---

### Task 5: What the driver sees — disclosure screen and the card

**Files:**
- Create: `src/app/(app)/location-permission.tsx`
- Modify: `src/components/driver/Availability.tsx`, `src/app/(app)/(tabs)/driver.tsx`, `src/lib/queries.ts` (`Availability`, `useMyAvailability`), `src/i18n/index.ts`
- Test: `tests/integration/driver-screens.test.tsx` (extend), `tests/integration/harness.tsx`

**Interfaces:**
- Consumes: `useLocationAccess()` (Task 4), `currentFix()` (Task 3), `formatAge(iso)` from `@/lib/format`.
- Produces: route `/location-permission`; `AvailabilityCard` props gain `location: LocationAccess | null`, `lastSentAge: string | null`, `onFixLocation: () => void`; `Availability.located_at: string | null`.

- [ ] **Step 1: Strings** — `en` in `src/i18n/index.ts`, next to `drv.avail.*`:

```ts
  'drv.avail.why': 'Go available to get loads near you. We only use your location while you are available.',
  'loc.ask.q': 'Let Truckkoo see where your truck is, even when the app is closed?',
  'loc.ask.body': 'We use it to send you loads near you — only while you are available, and we keep only your latest location.',
  'loc.ask.android': 'On the next screen, choose “Allow all the time”.',
  'loc.ask.later': 'Not now',
  'loc.card.always': 'Location on · last sent {age}',
  'loc.card.waiting': 'Location on · waiting for the first reading',
  'loc.card.foreground': 'Location only while the app is open',
  'loc.card.none': 'Location off · you get loads near your town',
  'loc.card.turnOn': 'Turn on location',
```

(`drv.avail.why` replaces the existing line — it currently says "We do not track you", which becomes false.) Arabic — replace `drv.avail.why` in place, and append the rest to the end of the `UNPROOFED DRAFTS` block:

```ts
  'drv.avail.why': 'كن متاحاً لتصلك الشحنات القريبة منك. نستخدم موقعك فقط وأنت متاح.',
  'loc.ask.q': 'هل تسمح لتروكو بمعرفة مكان شاحنتك حتى عندما يكون التطبيق مغلقاً؟',
  'loc.ask.body': 'نستخدمه لنرسل لك الشحنات القريبة منك، فقط وأنت متاح، ولا نحتفظ إلا بآخر موقع لك.',
  'loc.ask.android': 'في الشاشة التالية، اختر «السماح طوال الوقت».',
  'loc.ask.later': 'ليس الآن',
  'loc.card.always': 'الموقع مفعّل · آخر إرسال {age}',
  'loc.card.waiting': 'الموقع مفعّل · بانتظار أول قراءة',
  'loc.card.foreground': 'الموقع يعمل فقط والتطبيق مفتوح',
  'loc.card.none': 'الموقع متوقف · تصلك الشحنات القريبة من مدينتك',
  'loc.card.turnOn': 'تفعيل الموقع',
```

If `drv.avail.why` (Arabic) sits outside the drafts block, move it into it — it is now a drafted string. Update the unproofed count in `OPEN_ISSUES.md` (211 → 223: 10 above + 2 from Task 3).

- [ ] **Step 2: Write the failing tests** — add to `tests/integration/driver-screens.test.tsx` (it already renders the driver home through the harness):

```tsx
describe('driver home — location', () => {
  it.each([
    ['always', 'Location on · waiting for the first reading'],
    ['foreground', 'Location only while the app is open'],
    ['none', 'Location off · you get loads near your town'],
  ])('%s shows its line', async (access, line) => {
    mockLocationAccess.access = access;
    const screen = await renderDriverHome({ available: true });
    expect(await screen.findByText(line)).toBeTruthy();
  });

  it('offers "Turn on location" unless it is already Always', async () => {
    mockLocationAccess.access = 'foreground';
    const screen = await renderDriverHome({ available: true });
    expect(await screen.findByText('Turn on location')).toBeTruthy();
    mockLocationAccess.access = 'always';
    const again = await renderDriverHome({ available: true });
    expect(again.queryByText('Turn on location')).toBeNull();
  });

  it('says when the last point was sent', async () => {
    mockLocationAccess.access = 'always';
    const screen = await renderDriverHome({
      available: true,
      located_at: new Date(Date.now() - 4 * 60_000).toISOString(),
    });
    expect(await screen.findByText(/Location on · last sent/)).toBeTruthy();
  });

  it('opens the disclosure — never the OS prompt directly — once per launch', async () => {
    mockLocationAccess.access = 'foreground';
    await renderDriverHome({ available: true });
    await renderDriverHome({ available: true });
    expect(mockRouterPush.mock.calls.filter((c) => c[0] === '/location-permission')).toHaveLength(1);
    expect(mockLocationAccess.request).not.toHaveBeenCalled();
  });
});

describe('location permission screen', () => {
  it('asks one question, then requests in order on Continue', async () => {
    mockLocationAccess.request.mockResolvedValue('always');
    const screen = await renderRoute('location-permission');
    expect(screen.getByText('Let Truckkoo see where your truck is, even when the app is closed?')).toBeTruthy();
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(mockLocationAccess.request).toHaveBeenCalledTimes(1));
    expect(mockRouterBack).toHaveBeenCalled();
  });

  it('"Not now" asks nothing', async () => {
    const screen = await renderRoute('location-permission');
    fireEvent.press(screen.getByText('Not now'));
    expect(mockLocationAccess.request).not.toHaveBeenCalled();
    expect(mockRouterBack).toHaveBeenCalled();
  });
});
```

Use the file's existing render helper and router mocks; if they are named differently (e.g. `renderScreen`, `mockPush`), use those names — and extend the availability fixture in `harness.tsx` to accept `located_at`. Add a module-level reset for the once-per-launch flag: export `__resetLocationPrompt()` from `driver.tsx`'s helper module (below) and call it in `beforeEach`.

- [ ] **Step 3: Run to verify failure**

Run: `npx jest tests/integration/driver-screens.test.tsx -t location`
Expected: FAIL — lines not found / route missing.

- [ ] **Step 4: Implement**

`src/lib/queries.ts` — `Availability` gains `located_at: string | null;` and the select becomes `'available, city_id, source, updated_at, located_at'`.

`src/app/(app)/location-permission.tsx`:

```tsx
/**
 * The disclosure before the OS asks (spec §5.3). Google Play's background
 * location policy requires it, and it is what its reviewers look for: what is
 * collected, why, and that it happens with the app closed — in our words, before
 * the system's.
 */
import { router } from 'expo-router';
import { Platform, StyleSheet, Text } from 'react-native';

import { QuestionShell } from '@/components/booking/shells';
import { arabicIfNeeded } from '@/components/text-direction';
import { align, t } from '@/i18n';
import { useLocationAccess } from '@/lib/location-tracking';
import { color, font } from '@/theme/tokens';

export default function LocationPermission() {
  const { request } = useLocationAccess();
  return (
    <QuestionShell
      step={1}
      total={1}
      question={t('loc.ask.q')}
      helper={t('loc.ask.body')}
      onBack={() => router.back()}
      cta={t('action.continue')}
      onCta={async () => {
        await request().catch(() => 'none');
        router.back();
      }}
      tertiary={t('loc.ask.later')}
      onTertiary={() => router.back()}
    >
      {Platform.OS === 'android' && <Text style={styles.hint}>{t('loc.ask.android')}</Text>}
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  hint: { ...arabicIfNeeded(font.body), color: color.inkText, textAlign: align.start },
});
```

(If `color.inkText` is not a token, use the token `cargo.tsx` uses for body text on cream.)

`src/components/driver/Availability.tsx` — add props and a location block after the help text, shown only while available:

```tsx
import type { LocationAccess } from '@/lib/background-location';
// …props:
  location: LocationAccess | null;
  /** From formatAge(located_at); null when nothing has been sent yet. */
  lastSentAge: string | null;
  onFixLocation: () => void;
// …inside the card, after <Text style={styles.help}>:
      {available && location !== null && (
        <>
          <Text style={styles.help}>
            {location === 'always'
              ? lastSentAge
                ? t('loc.card.always', { age: lastSentAge })
                : t('loc.card.waiting')
              : location === 'foreground'
                ? t('loc.card.foreground')
                : t('loc.card.none')}
          </Text>
          {location !== 'always' && (
            <SecondaryButton label={t('loc.card.turnOn')} onPress={onFixLocation} icon="pickup" />
          )}
        </>
      )}
```

(Use whichever `Icon` name `src/components/icon.tsx` has for a location/pin — `pickup` names a place; do not add a glyph.) Include the location line in the card's `accessibilityLabel` array so it is announced.

`src/app/(app)/(tabs)/driver.tsx`:

```tsx
import { currentFix } from '@/lib/background-location';
import { useLocationAccess } from '@/lib/location-tracking';

/** Once per launch: a driver who said "Not now" is not asked on every visit. */
let promptedThisLaunch = false;
export function __resetLocationPrompt() { promptedThisLaunch = false; }

// inside the component:
  const location = useLocationAccess();
  useEffect(() => {
    if (availability.data?.available && location.access && location.access !== 'always' && !promptedThisLaunch) {
      promptedThisLaunch = true;
      router.push('/location-permission');
    }
  }, [availability.data?.available, location.access]);
```

Replace the body of `toggleAvailable`'s position read (the `requestForegroundPermissionsAsync` … `Promise.race` block) with:

```tsx
    if (goingOn) {
      const fix = await currentFix();
      if (fix) coords = fix;
    }
```

and drop the `expo-location` import from this file. Pass the new props:

```tsx
          <AvailabilityCard
            available={availability.data?.available ?? false}
            town={availability.data?.city_id != null ? cityName(availability.data.city_id) : null}
            pending={setAvailable.isPending}
            onToggle={toggleAvailable}
            location={location.access}
            lastSentAge={formatAge(availability.data?.located_at ?? null)}
            onFixLocation={() => router.push('/location-permission')}
          />
```

(`formatAge` is in `@/lib/format`; import it if not already.) When the driver was previously `none` and taps Continue, the OS may refuse to show the prompt again — `requestLocationAccess` then returns `none` and the card stays; that is acceptable for this version (note in OPEN_ISSUES: link to app Settings).

- [ ] **Step 5: Run**

Run: `npx jest tests/integration/driver-screens.test.tsx && npm run verify && npm run preview:rtl | grep -A2 "loc\."`
Expected: PASS; the Arabic `loc.*` strings appear in the RTL preview.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/location-permission.tsx" src/components/driver/Availability.tsx "src/app/(app)/(tabs)/driver.tsx" src/lib/queries.ts src/i18n/index.ts tests/integration OPEN_ISSUES.md
git commit -m "Ask for background location in our words first, and show the driver what we have"
```

---

### Task 6: Retire the foreground trip reporter

**Files:**
- Delete: `src/lib/position.ts`, `tests/unit/position-reporter.test.tsx`
- Modify: `src/app/(app)/trip/[id].tsx` (~lines 49, 87, 329), `tests/integration/harness.tsx` (the `@/lib/position` mock, ~line 84), any test asserting `mockReporterArgs`

**Interfaces:**
- Consumes: `useTripPosition(id)` → `data.seen_at: string | null` (existing).

- [ ] **Step 1: Write the failing test** — in the D7 test (grep `mockReporterArgs` in `tests/integration`), replace assertions about the reporter's arguments with:

```tsx
it('D7 says when the truck was last seen, from the server', async () => {
  mockTripPosition = { seen_at: new Date(Date.now() - 3 * 60_000).toISOString(), /* …existing fields */ };
  const screen = await renderTrip({ status: 'in_transit' });
  expect(await screen.findByText(/Last sent/)).toBeTruthy();
});
```

(Adapt to the harness's existing `useTripPosition` mock name.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/integration -t "last seen"`
Expected: FAIL — D7 still reads `lastSentAt` from the reporter mock (null).

- [ ] **Step 3: Implement** — in `trip/[id].tsx`: remove `import { usePositionReporter } from '@/lib/position';` and `const { lastSentAt } = usePositionReporter(id, live);`; after `const position = useTripPosition(live ? id : undefined);` add:

```tsx
  // The background task (0039) reports; D7 only reads what the server has.
  const lastSentAt = position.data?.seen_at ?? null;
```

Delete `src/lib/position.ts` and `tests/unit/position-reporter.test.tsx`; remove the `@/lib/position` mock, `mockReporter` and `mockReporterArgs` from `harness.tsx` and every test referencing them.

- [ ] **Step 4: Run**

Run: `grep -rn "lib/position\b\|usePositionReporter" src tests; npm run verify`
Expected: grep prints nothing; verify green.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/position.ts tests/unit/position-reporter.test.tsx "src/app/(app)/trip/[id].tsx" tests/integration
git commit -m "Retire the foreground trip reporter; the background task tracks trips"
```

---

### Task 7: Native config, version, docs, and the device checklist

**Files:**
- Modify: `app.json`, `CLAUDE.md`, `OPEN_ISSUES.md`, `tests/README.md`

- [ ] **Step 1: `app.json`** — add to `plugins`:

```json
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "Truckkoo uses your location to send you loads near your truck.",
          "locationAlwaysAndWhenInUsePermission": "While you are available, Truckkoo uses your location in the background to send you loads near your truck. Only your latest location is kept.",
          "isIosBackgroundLocationEnabled": true,
          "isAndroidBackgroundLocationEnabled": true,
          "isAndroidForegroundServiceEnabled": true
        }
      ]
```

and set `"version": "1.1.0"`. **Why the bump:** EAS Update uses `runtimeVersion: appVersion`; an update calling `expo-task-manager` on a 1.0.0 build (which lacks it) crashes on launch.

- [ ] **Step 2: Verify config resolves**

Run: `npx expo config --type introspect | grep -E "ACCESS_BACKGROUND_LOCATION|FOREGROUND_SERVICE_LOCATION|UIBackgroundModes" -A1 | head`
Expected: both Android permissions and `location` in `UIBackgroundModes`.

- [ ] **Step 3: Docs**
  - `CLAUDE.md` — in the Security list, replace "A position is only ever one row" paragraph's first sentence context with: since 0039 each online driver's **latest** GPS point is stored in `driver_availability` (no client grant on the coordinates; erased on switch-off and delivery); `report_location` stores nothing while offline except to an `in_transit` trip. Note that `src/lib/background-location.ts` is the only reporter.
  - `OPEN_ISSUES.md` — "Driver GPS" entry: built, **not seen on a real phone**; founder steps (Play declaration + video, 1.1.0 builds, drivers reinstall); iOS permission strings English-only; no in-app link to Settings after a hard "Don't allow".
  - `tests/README.md` — the background task itself (OS delivery, OEM killers, reboot) is not covered by Jest; only the device checklist covers it.

- [ ] **Step 4: Device checklist** — append to `OPEN_ISSUES.md` under the Driver GPS entry:

```markdown
Device check (preview build 1.1.0, one Android phone, ~1 hour driving):
1. Fresh install → driver → Go available → disclosure appears → Continue → "While using" → Settings → "Allow all the time".
2. Notification "You are available" is in the status bar.
3. Lock the phone, drive 5 km. In SQL: `select located_at, city_id from public.driver_availability where driver_id = '<id>'` — updated within ~15 min / 2 km.
4. Go offline → notification gone; drive 3 km; `located_at` and `lat` are null.
5. Take a demo load, start the trip → shipper's T4 moves every ~2 min with the driver's app closed.
6. Reboot the phone, open the app once → notification returns.
7. Sign out → notification gone.
```

- [ ] **Step 5: Full verification**

```bash
npm run verify && npm run test:db && node scripts/check-migrations.mjs local
```
Expected: all green; `✓ 39 migrations (local)`.

- [ ] **Step 6: Commit**

```bash
git add app.json CLAUDE.md OPEN_ISSUES.md tests/README.md
git commit -m "Enable background location in the native config and bump to 1.1.0"
```

- [ ] **Step 7: Hand to the founder** (do not run):
  1. `npx supabase db push` — applies 0039.
  2. `eas build --profile preview --platform android` — the 1.1.0 build.
  3. Google Play Console background-location declaration + video of the disclosure flow.
  4. Run the device checklist.
