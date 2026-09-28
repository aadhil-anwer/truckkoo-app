# Shipper Places Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shipper can choose the exact pickup and drop-off spot — by Google place search or current location, fine-tuned on a real map — with an optional note and contact, and the driver gets that spot, note, contact and turn-by-turn directions.

**Architecture:** A new `load_places` table beside `loads` (the city stays; the server derives it from the point). Writes only through `book_load`; drivers read only through `driver_offers()`/`driver_offer()`/`driver_trip()`. Place search goes through a Supabase Edge Function that holds the Google key and rate-limits via an RPC called with the user's own JWT. One booking screen uses `react-native-maps`; everything else keeps the drawn map.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), Supabase Edge Functions (Deno), Google Places API (New), Expo 57 / React Native, `react-native-maps`, `expo-location`, TanStack Query, Jest.

**Spec:** `docs/superpowers/specs/2026-09-28-shipper-places-design.md`

## Global Constraints

- Migration is `supabase/migrations/0041_load_places.sql`, append-only; tasks 1–3 build it, then it is frozen.
- Every `security definer` function: `set search_path = ''`, fully-qualified tables **and types** (`public.trip_status`), `revoke all … from public, anon` then grant.
- Any function that writes (incl. `check_rate_limit`) is `volatile`; read-only ones `stable`.
- New table: `revoke all from anon, authenticated`, `enable` + `force row level security`, grant back with a reason.
- No service-role key anywhere. The Edge Function uses the anon key + the caller's `Authorization` header.
- Search restricted to `['OM','AE','SA','QA','KW','BH']`; Place Details field mask exactly `location,formattedAddress`.
- Rate limits: `places_autocomplete` 300/hour, `places_details` 60/hour, shippers only.
- Text limits: `place_name` ≤200, `note` ≤300, `contact_name` ≤80, `contact_phone` matches `^\+?[0-9 ]{6,24}$`.
- All user-facing strings through `t()` with typed placeholders; new Arabic goes in the `UNPROOFED DRAFTS` block at the end of `ar`.
- Logical properties only; `align.start`/`align.end` for text alignment; no `left`/`right`.
- Only `src/components/booking/PinAdjustMap.tsx` may import `react-native-maps`.
- One accent per screen: the pin screen's accent is its primary button, so the pin itself is ink.
- Coordinates in URLs and payloads are plain JS numbers (never `formatNumber`).
- Money untouched. `private.compute_price`, dispatch and the rate card are not modified.

## Review Focus

1. **Pickup and drop-off resolve to the same city** (a move inside Muscat) — `loads_not_circular` forbids it; the pin screen must disable Confirm and say why, with a WhatsApp way out, not let `book_load` fail at the end.
2. **Arabic-Indic digits typed into the phone field** (`٩٦٨٩…` from an Arabic keyboard) — normalised to Latin digits before validation and before saving, or every Arabic-keyboard contact is rejected by the DB.
3. **Shipper picks a place, then picks a city instead / changes country / taps a recent / swaps ends** — the place must be cleared or swapped with its city, or `book_load` raises "city does not match place" at the last step.
4. **Search while the network drops or the function errors** — the stale suggestions go, a notice appears, and the city list remains usable.
5. **Location permission refused or GPS returns nothing** — the current-location row disappears silently; nothing else on the screen changes.

Each is pinned by a test in the task that owns it (Tasks 6, 8, 9).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0041_load_places.sql` | table, `city_near`, `use_places_quota`, `ops_load_places`, `book_load` v2, driver reads v2 |
| `supabase/tests/places.sql` + `package.json` `test:db:places` | SQL proofs for all of the above |
| `supabase/tests/tenant_isolation.sql` | §12: `load_places` isolation |
| `supabase/functions/places/core.ts` | the whole handler, pure TS, injected `fetch`/env — Jest-tested |
| `supabase/functions/places/index.ts` | `Deno.serve` wrapper, nothing else |
| `src/lib/places.ts` | client: search hook, details, `cityNear`, current location, reverse geocode |
| `src/lib/booking.ts` | draft gains `originPlace`/`destinationPlace`; `toPlacePayload`, `normalizePhone` |
| `src/lib/queries.ts` | `BookInput` places, `LoadPlace`, `placeOf`, `useLoadPlaces`, driver row types |
| `app.config.ts` | injects `GOOGLE_MAPS_ANDROID_KEY` |
| `src/components/booking/PinAdjustMap.tsx` | the only `react-native-maps` importer |
| `src/components/booking/PlaceSearch.tsx` | search field, suggestions, current location |
| `src/app/(app)/book/pin.tsx` | "Put the pin on the gate" (`?end=pickup|drop`) |
| `src/app/(app)/book/place-details.tsx` | "Anything the driver should know?" (`?end=pickup|drop`) |
| `src/components/driver/PlaceDetails.tsx` | driver-facing place block: name, note, contact + Call |

One pin screen and one details screen, parameterised by `end`, replace the spec's four files — same behaviour, half the code. The draft keeps its v1 key: `loadDraft()` already spreads a stored draft over `EMPTY_DRAFT`, so new `null` fields need no migration (spec §3 updated in Task 11).

---

### Task 1: `load_places`, `city_near`, `use_places_quota`, `ops_load_places`

**Files:**
- Create: `supabase/migrations/0041_load_places.sql`
- Create: `supabase/tests/places.sql`
- Modify: `package.json` (scripts)
- Modify: `supabase/tests/tenant_isolation.sql` (new §12 before the final `raise notice`)
- Modify: `SENSITIVE_FIELDS.md`

**Interfaces:**
- Produces: table `public.load_places(load_id, kind, lat, lng, place_name, note, contact_name, contact_phone, created_at)`; `public.city_near(p_lat double precision, p_lng double precision) returns bigint`; `public.use_places_quota(p_kind text) returns void`; `public.ops_load_places(p_load_id uuid)`.

- [ ] **Step 1: Write the failing SQL suite** — `supabase/tests/places.sql`:

```sql
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
  (select count(*) from generate_series(1, 60) g, lateral (select public.use_places_quota('details')) q), 60,
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

do $$ begin raise notice 'ALL PLACES ASSERTIONS HELD'; end $$;
rollback;
```

- [ ] **Step 2: Register the suite** — in `package.json` scripts add after `test:db:dispatch`:

```json
    "test:db:places": "docker exec -i supabase_db_truckkoo-app psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/places.sql",
```

and change `test:db` to end `… && npm run test:db:dispatch && npm run test:db:places`.

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:db:places`
Expected: FAIL — `relation "public.load_places" does not exist`.

- [ ] **Step 4: Write the migration** — `supabase/migrations/0041_load_places.sql`:

```sql
-- 0041 · Shipper places — the exact pickup and drop-off, beside the city.
--
-- Spec: docs/superpowers/specs/2026-09-28-shipper-places-design.md.
--
-- THE CITY STAYS. Pricing, dispatch and the rate card are per city; the server
-- derives the city from the point (private.nearest_city), so this changes none
-- of them.
--
-- A SEPARATE TABLE, NOT COLUMNS ON `loads`. `loads` carries a table-level select
-- grant and a policy letting a driver read any load they ever had an offer for.
-- A contact phone there would outlive the offer. Here no driver has a policy at
-- all: they read places only through driver_offers()/driver_offer()/driver_trip(),
-- which decide inside the definer.
--
-- FOUNDER'S CALL (2026-09-28): the exact point, note and contact are shown in the
-- offer — every offered driver sees them — but only while that offer is pending.

-- ═══ 1. the table ═══════════════════════════════════════════════════════════

create table public.load_places (
  load_id       uuid not null references public.loads (id) on delete cascade,
  kind          text not null constraint load_places_kind check (kind in ('pickup', 'drop')),
  lat           double precision not null,
  lng           double precision not null,
  place_name    text,
  note          text,
  contact_name  text,
  contact_phone text,
  created_at    timestamptz not null default now(),
  primary key (load_id, kind),
  constraint load_places_in_region check (lat between 12 and 33 and lng between 34 and 60),
  constraint load_places_name_len  check (place_name   is null or char_length(place_name)   between 1 and 200),
  constraint load_places_note_len  check (note         is null or char_length(note)         between 1 and 300),
  constraint load_places_cname_len check (contact_name is null or char_length(contact_name) between 1 and 80),
  constraint load_places_phone     check (contact_phone is null or contact_phone ~ '^\+?[0-9 ]{6,24}$'),
  -- Bidi overrides are a spoofing vector in an RTL UI. Rejected here AND
  -- sanitised at output by src/lib/safe-text.ts, on purpose.
  constraint load_places_safe_text check (
    not private.contains_unsafe_text(place_name)
    and not private.contains_unsafe_text(note)
    and not private.contains_unsafe_text(contact_name))
);

-- Deny by default. The shipper reads their own; nobody writes except book_load.
revoke all on table public.load_places from anon, authenticated;
alter table public.load_places enable row level security;
alter table public.load_places force row level security;

drop policy if exists "shipper reads own load places" on public.load_places;
create policy "shipper reads own load places" on public.load_places
  for select to authenticated using ((select private.owns_load(load_places.load_id)));

-- Select only. There is no driver policy, so a driver's select returns nothing;
-- the grant exists for the shipper's own T3/T4.
grant select (load_id, kind, lat, lng, place_name, note, contact_name, contact_phone, created_at)
  on public.load_places to authenticated;

-- ═══ 2. the nearest city, for "Near Barka" ══════════════════════════════════
-- One nearest-city rule, server-side, shared with book_load. Read-only.

create or replace function public.city_near(p_lat double precision, p_lng double precision)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between 12 and 33 or p_lng not between 34 and 60 then
    raise exception 'position out of range' using errcode = 'check_violation';
  end if;
  return private.nearest_city(p_lat, p_lng);
end;
$$;

revoke all on function public.city_near(double precision, double precision) from public, anon;
grant execute on function public.city_near(double precision, double precision) to authenticated;

-- ═══ 3. the search quota ════════════════════════════════════════════════════
-- Called by the `places` Edge Function WITH THE CALLER'S JWT, so the function
-- needs no service-role key. Writes a rate event, so VOLATILE.

create or replace function public.use_places_quota(p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if (select private.actor_role()) <> 'shipper' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_active();
  if p_kind = 'autocomplete' then
    perform private.check_rate_limit('places_autocomplete', 300, interval '1 hour');
  elsif p_kind = 'details' then
    perform private.check_rate_limit('places_details', 60, interval '1 hour');
  else
    raise exception 'unknown quota' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.use_places_quota(text) from public, anon;
grant execute on function public.use_places_quota(text) to authenticated;

-- ═══ 4. ops reads a load's places ═══════════════════════════════════════════

create or replace function public.ops_load_places(p_load_id uuid)
returns table (
  kind text, lat double precision, lng double precision, place_name text,
  note text, contact_name text, contact_phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return query
  select p.kind, p.lat, p.lng, p.place_name, p.note, p.contact_name, p.contact_phone
  from public.load_places p
  where p.load_id = p_load_id
  order by p.kind desc;  -- pickup before drop
end;
$$;

revoke all on function public.ops_load_places(uuid) from public, anon;
grant execute on function public.ops_load_places(uuid) to authenticated;
```

- [ ] **Step 5: Apply and run**

Run: `npx supabase migration up --local && npm run test:db:places`
Expected: `ALL PLACES ASSERTIONS HELD`.

- [ ] **Step 6: Tenant isolation §12** — insert before `do $$ begin raise notice 'ALL TENANT ISOLATION ASSERTIONS HELD'; end $$;` in `supabase/tests/tenant_isolation.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- 12. places (0041)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.load_places (load_id, kind, lat, lng, place_name, contact_phone)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'pickup', 23.59, 58.41, 'A warehouse', '+968 9111 1111');

select act_as('11111111-1111-4111-8111-111111111111');  -- Shipper A
select assert_equals((select count(*) from public.load_places), 1, 'shipper A reads the place on their load');
select act_as('22222222-2222-4222-8222-222222222222');  -- Shipper B
select assert_equals((select count(*) from public.load_places), 0, 'shipper B reads no other shipper''s place');
select act_as('33333333-3333-4333-8333-333333333333');  -- Driver A
select assert_equals((select count(*) from public.load_places), 0,
  'a driver reads no place from the table — only through the driver functions');
select act_as_reset();
```

Run: `npm run test:db:tenants` — Expected: `ALL TENANT ISOLATION ASSERTIONS HELD`.

- [ ] **Step 7: `SENSITIVE_FIELDS.md`** — add a `load_places` section:

```markdown
### `load_places` (0041)

| Column | Client write | Why |
|---|---|---|
| every column | **none** | Written only by `book_load`, which derives the city from the point. |
| `contact_name`, `contact_phone` | none | A third party's personal data (the person at the gate). Readable by the owning shipper; by a driver only through `driver_offers()` while pending and `driver_trip()` until delivery; by ops through `ops_load_places`. |
| `lat`, `lng` | none | The shipper's premises. Same readers as above. |
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0041_load_places.sql supabase/tests/places.sql supabase/tests/tenant_isolation.sql package.json SENSITIVE_FIELDS.md
git commit -m "Add load_places: the exact pickup and drop-off, readable only by their shipper"
```

---

### Task 2: `book_load` writes places

**Files:**
- Modify: `supabase/migrations/0041_load_places.sql` (append §5)
- Modify: `supabase/tests/places.sql` (new §7 before the final notice)

**Interfaces:**
- Consumes: `public.load_places` (Task 1).
- Produces: `public.book_load(p_origin_city bigint, p_dest_city bigint, p_pickup_from date, p_pickup_to date, p_goods text, p_weight_kg integer default null, p_truck_type_code text default null, p_seen_price_baisa bigint default null, p_origin_place jsonb default null, p_dest_place jsonb default null)`; place JSON shape `{lat, lng, place_name, note, contact_name, contact_phone}`.

- [ ] **Step 1: Failing tests** — append to `places.sql` before the final notice:

```sql
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:db:places`
Expected: FAIL — `function public.book_load(bigint, bigint, date, date, unknown, …, jsonb, jsonb) does not exist`.

- [ ] **Step 3: Append to 0041**:

```sql
-- ═══ 5. book_load v2 — the same call, with two optional places ══════════════
-- Body is 0036's, plus: each place's city must be the city passed (only a
-- client bug disagrees), checked BEFORE post_load so a refusal spends no rate
-- limit; the places are inserted in the same transaction as the load.

create or replace function private.place_city(p jsonb)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
begin
  if v_lat is null or v_lng is null
     or v_lat not between 12 and 33 or v_lng not between 34 and 60 then
    raise exception 'place out of range' using errcode = 'check_violation';
  end if;
  return private.nearest_city(v_lat, v_lng);
end;
$$;

revoke all on function private.place_city(jsonb) from public, anon, authenticated;

create or replace function private.insert_load_place(p_load_id uuid, p_kind text, p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p is null then
    return;
  end if;
  insert into public.load_places (load_id, kind, lat, lng, place_name, note, contact_name, contact_phone)
  values (
    p_load_id, p_kind,
    (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
    nullif(btrim(p ->> 'place_name'), ''),
    nullif(btrim(p ->> 'note'), ''),
    nullif(btrim(p ->> 'contact_name'), ''),
    nullif(btrim(p ->> 'contact_phone'), ''));
end;
$$;

revoke all on function private.insert_load_place(uuid, text, jsonb) from public, anon, authenticated;

drop function if exists public.book_load(bigint, bigint, date, date, text, integer, text, bigint);

create function public.book_load(
  p_origin_city bigint, p_dest_city bigint,
  p_pickup_from date, p_pickup_to date, p_goods text,
  p_weight_kg integer default null, p_truck_type_code text default null,
  p_seen_price_baisa bigint default null,
  p_origin_place jsonb default null, p_dest_place jsonb default null
)
returns table(load_id uuid, status public.load_status, price_baisa bigint, price_matched boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_price   bigint;
  v_status  public.load_status;
  v_matched boolean;
begin
  if p_origin_place is not null and private.place_city(p_origin_place) is distinct from p_origin_city then
    raise exception 'city does not match place' using errcode = 'check_violation';
  end if;
  if p_dest_place is not null and private.place_city(p_dest_place) is distinct from p_dest_city then
    raise exception 'city does not match place' using errcode = 'check_violation';
  end if;

  v_id := public.post_load(p_origin_city, p_dest_city, p_pickup_from, p_pickup_to,
                           p_goods, p_weight_kg, p_truck_type_code);

  perform private.insert_load_place(v_id, 'pickup', p_origin_place);
  perform private.insert_load_place(v_id, 'drop', p_dest_place);

  select l.price_baisa into v_price from public.loads l where l.id = v_id;

  v_matched := v_price is not null and p_seen_price_baisa is not distinct from v_price;

  if v_matched then
    perform public.accept_quote(v_id);
  end if;

  select l.status into v_status from public.loads l where l.id = v_id;
  return query select v_id, v_status, v_price,
    (v_matched or (v_price is null and p_seen_price_baisa is null));
end;
$$;

revoke all on function public.book_load(bigint, bigint, date, date, text, integer, text, bigint, jsonb, jsonb)
  from public, anon;
grant execute on function public.book_load(bigint, bigint, date, date, text, integer, text, bigint, jsonb, jsonb)
  to authenticated;
```

- [ ] **Step 4: Re-apply and run everything** (0041 is not applied anywhere but local):

Run: `npx supabase db reset --local && npm run test:db`
Expected: all five suites pass; `dispatch.sql`'s positional 8-argument `book_load` calls still resolve through the defaults.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0041_load_places.sql supabase/tests/places.sql
git commit -m "book_load takes optional places and refuses a city that does not match"
```

---

### Task 3: Drivers read places through their functions

**Files:**
- Modify: `supabase/migrations/0041_load_places.sql` (append §6)
- Modify: `supabase/tests/places.sql` (new §8)

**Interfaces:**
- Produces: `driver_offers()`, `driver_offer(uuid)` and `driver_trip(uuid)` each gain, after their existing columns: `pickup_lat double precision, pickup_lng double precision, pickup_name text, pickup_note text, pickup_contact_name text, pickup_contact_phone text, drop_lat double precision, drop_lng double precision, drop_name text, drop_note text, drop_contact_name text, drop_contact_phone text`.

- [ ] **Step 1: Failing tests** — append to `places.sql`:

```sql
-- ═══ 8. drivers read places only through their functions ════════════════════
insert into public.offers (id, load_id, driver_id, status)
values ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-00000000000d', 'pending');

select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_text(
  (select pickup_contact_phone from public.driver_offer('c2000000-0000-4000-8000-000000000001')),
  '+968 9000 0000', 'a pending offer carries the contact at the gate');
select assert_text(
  (select pickup_name from public.driver_offers() where offer_id = 'c2000000-0000-4000-8000-000000000001'),
  'Ruwi warehouse', 'and the list carries the place name');
select act_as_reset();

update public.offers set status = 'declined' where id = 'c2000000-0000-4000-8000-000000000001';
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_equals(
  (select count(*) from public.driver_offer('c2000000-0000-4000-8000-000000000001')), 0,
  'after a pass the offer — and its contact — is gone');
select act_as_reset();

insert into public.trips (id, load_id, driver_id, status)
values ('c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-00000000000d', 'assigned');
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_text((select pickup_note from public.driver_trip('c3000000-0000-4000-8000-000000000001')),
  'Gate 3', 'the driver on the job reads the note');
select assert_text((select pickup_contact_phone from public.driver_trip('c3000000-0000-4000-8000-000000000001')),
  '+968 9000 0000', 'and the contact, while the job is open');
select act_as_reset();

update public.trips set status = 'delivered' where id = 'c3000000-0000-4000-8000-000000000001';
select act_as('c0000000-0000-4000-8000-00000000000d');
select assert_text(
  (select coalesce(pickup_contact_phone, 'NULL') from public.driver_trip('c3000000-0000-4000-8000-000000000001')),
  'NULL', 'after delivery the contact is hidden');
select assert_text((select pickup_name from public.driver_trip('c3000000-0000-4000-8000-000000000001')),
  'Ruwi warehouse', 'and the place stays, as a record');
select act_as_reset();
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:db:places`
Expected: FAIL — `column "pickup_contact_phone" does not exist`.

- [ ] **Step 3: Append to 0041** — the 0030/0031 bodies, with two lateral joins and twelve columns added:

```sql
-- ═══ 6. drivers read places through their functions ═════════════════════════
-- driver_offers() already returns pending, unexpired offers only, so the places
-- it carries vanish with the offer — the founder's safeguard, for free.
-- driver_trip() hides the contact once the job is over. Return types change,
-- so each is dropped and recreated; driver_offer depends on driver_offers.

drop function if exists public.driver_offer(uuid);
drop function if exists public.driver_offers();
drop function if exists public.driver_trip(uuid);

create function public.driver_offers()
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
  free_after_kg integer,
  pickup_lat double precision, pickup_lng double precision, pickup_name text, pickup_note text,
  pickup_contact_name text, pickup_contact_phone text,
  drop_lat double precision, drop_lng double precision, drop_name text, drop_note text,
  drop_contact_name text, drop_contact_phone text
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
    case when t.capacity_kg is null or l.weight_kg is null then null
         else greatest(0, t.capacity_kg - l.weight_kg) end,
    pp.lat, pp.lng, pp.place_name, pp.note, pp.contact_name, pp.contact_phone,
    dp.lat, dp.lng, dp.place_name, dp.note, dp.contact_name, dp.contact_phone
  from public.offers o
  join public.loads l on l.id = o.load_id
  left join public.legs g on g.id = o.leg_id
  left join public.trucks t on t.id = g.truck_id
  left join public.load_places pp on pp.load_id = l.id and pp.kind = 'pickup'
  left join public.load_places dp on dp.load_id = l.id and dp.kind = 'drop'
  -- Scoped to the actor INSIDE the definer. Pending and unexpired only: a place
  -- and its contact are visible exactly as long as the offer is (0041).
  where o.driver_id = v_actor
    and o.status = 'pending'::public.offer_status
    and o.expires_at > now()
  order by o.created_at desc;
end;
$$;

revoke all on function public.driver_offers() from public, anon;
grant execute on function public.driver_offers() to authenticated;

create function public.driver_offer(p_offer_id uuid)
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
  free_after_kg integer,
  pickup_lat double precision, pickup_lng double precision, pickup_name text, pickup_note text,
  pickup_contact_name text, pickup_contact_phone text,
  drop_lat double precision, drop_lng double precision, drop_name text, drop_note text,
  drop_contact_name text, drop_contact_phone text
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

create function public.driver_trip(p_trip_id uuid)
returns table (
  trip_id       uuid,
  status        public.trip_status,
  load_id       uuid,
  origin_city   bigint,
  dest_city     bigint,
  pickup_from   date,
  pickup_to     date,
  goods         text,
  weight_kg     integer,
  collect_baisa bigint,
  payout_baisa  bigint,
  owed_baisa    bigint,
  currency      char(3),
  shipper_name  text,
  shipper_phone text,
  pickup_lat double precision, pickup_lng double precision, pickup_name text, pickup_note text,
  pickup_contact_name text, pickup_contact_phone text,
  drop_lat double precision, drop_lng double precision, drop_name text, drop_note text,
  drop_contact_name text, drop_contact_phone text
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
    t.id, t.status, l.id,
    l.origin_city, l.dest_city, l.pickup_from, l.pickup_to,
    l.goods_description, l.weight_kg,
    l.price_baisa,
    private.payout_for(l.price_baisa),
    l.price_baisa - private.payout_for(l.price_baisa),
    l.currency,
    p.full_name, p.phone,
    pp.lat, pp.lng, pp.place_name, pp.note,
    case when t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
         then pp.contact_name end,
    case when t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
         then pp.contact_phone end,
    dp.lat, dp.lng, dp.place_name, dp.note,
    case when t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
         then dp.contact_name end,
    case when t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
         then dp.contact_phone end
  from public.trips t
  join public.loads l on l.id = t.load_id
  join public.profiles p on p.id = l.shipper_id
  left join public.load_places pp on pp.load_id = l.id and pp.kind = 'pickup'
  left join public.load_places dp on dp.load_id = l.id and dp.kind = 'drop'
  where t.id = p_trip_id
    and t.driver_id = v_actor;
end;
$$;

revoke all on function public.driver_trip(uuid) from public, anon;
grant execute on function public.driver_trip(uuid) to authenticated;
```

- [ ] **Step 4: Reset and run every suite**

Run: `npx supabase db reset --local && npm run test:db && node scripts/check-migrations.mjs local`
Expected: all suites pass (ops_console §8 and dispatch §10 static checks included); `✓ 41 migrations (local)`.

- [ ] **Step 5: Commit** — 0041 is now frozen.

```bash
git add supabase/migrations/0041_load_places.sql supabase/tests/places.sql
git commit -m "Drivers read places in a pending offer and on their own trip; contact hidden after delivery"
```

---

### Task 4: The `places` Edge Function

**Files:**
- Create: `supabase/functions/places/core.ts`
- Create: `supabase/functions/places/index.ts`
- Modify: `tsconfig.json` (`allowImportingTsExtensions`)
- Test: `tests/unit/places-function.test.ts`

**Interfaces:**
- Produces (HTTP, used by Task 5): `POST {action:'autocomplete', input, sessionToken, language:'en'|'ar'}` → `200 {suggestions: {placeId, main, secondary}[]}`; `POST {action:'details', placeId, sessionToken, language}` → `200 {place: {lat, lng, address}}`; errors `400 {error:'bad_request'}`, `429 {error:'limited'}`, `503 {error:'unavailable'}`.
- Produces (TS): `handle(req: Request, deps: Deps): Promise<Response>`; `type Deps = { key: string; supabaseUrl: string; anonKey: string; fetch: typeof fetch }`.

- [ ] **Step 1: Failing tests** — `tests/unit/places-function.test.ts`:

```ts
/**
 * @jest-environment node
 *
 * The Node environment, not jest-expo's: the function uses the web-standard
 * Request, Response and AbortSignal.timeout, as Deno provides them.
 *
 * The places Edge Function, run under Jest with a fake fetch.
 *
 * Everything that matters is in core.ts: what Google is asked (the field mask
 * decides the bill), what the app is told (never Google's raw payload), and that
 * the quota is spent as the CALLER — the function holds no service-role key.
 */
import { handle, REGIONS, type Deps } from '../../supabase/functions/places/core';

const SESSION = '0b9e8f6e-1c2d-4a5b-8c7d-6e5f4a3b2c1d';

function deps(responses: Record<string, { status: number; body: unknown }>): Deps & { calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = [];
  const fakeFetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push([u, init ?? {}]);
    const hit = Object.keys(responses).find((k) => u.includes(k));
    if (!hit) throw new Error(`unexpected fetch ${u}`);
    const r = responses[hit];
    // A 204 may not carry a body — that is PostgREST's answer for a void RPC.
    return new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status });
  });
  return { key: 'google-key', supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon', fetch: fakeFetch as unknown as typeof fetch, calls };
}

function post(body: unknown, auth = 'Bearer user-jwt') {
  return new Request('https://fn/places', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const QUOTA_OK = { 'rpc/use_places_quota': { status: 204, body: null } };

it('spends the quota as the caller, then asks Google for GCC suggestions', async () => {
  const d = deps({
    ...QUOTA_OK,
    'places:autocomplete': {
      status: 200,
      body: { suggestions: [{ placePrediction: {
        placeId: 'ChIJabc123', text: { text: 'Lulu Barka, Barka, Oman' },
        structuredFormat: { mainText: { text: 'Lulu Barka' }, secondaryText: { text: 'Barka, Oman' } },
      } }] },
    },
  });
  const res = await handle(post({ action: 'autocomplete', input: 'lulu bar', sessionToken: SESSION, language: 'en' }), d);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ suggestions: [{ placeId: 'ChIJabc123', main: 'Lulu Barka', secondary: 'Barka, Oman' }] });

  const [quotaUrl, quotaInit] = d.calls[0];
  expect(quotaUrl).toBe('https://proj.supabase.co/rest/v1/rpc/use_places_quota');
  expect((quotaInit.headers as Record<string, string>).Authorization).toBe('Bearer user-jwt');
  expect(JSON.parse(String(quotaInit.body))).toEqual({ p_kind: 'autocomplete' });

  const sent = JSON.parse(String(d.calls[1][1].body));
  expect(sent.includedRegionCodes).toEqual(REGIONS);
  expect(sent.sessionToken).toBe(SESSION);
  expect(sent.languageCode).toBe('en');
  expect((d.calls[1][1].headers as Record<string, string>)['X-Goog-Api-Key']).toBe('google-key');
});

it('asks Place Details for location and address only — the cheap tier', async () => {
  const d = deps({
    ...QUOTA_OK,
    'places/ChIJabc123': {
      status: 200,
      body: { location: { latitude: 23.69, longitude: 57.88 }, formattedAddress: 'Barka, Oman', displayName: { text: 'x' } },
    },
  });
  const res = await handle(post({ action: 'details', placeId: 'ChIJabc123', sessionToken: SESSION, language: 'ar' }), d);
  expect(await res.json()).toEqual({ place: { lat: 23.69, lng: 57.88, address: 'Barka, Oman' } });
  const [url, init] = d.calls[1];
  expect(url).toContain(`sessionToken=${SESSION}`);
  expect(url).toContain('languageCode=ar');
  expect((init.headers as Record<string, string>)['X-Goog-FieldMask']).toBe('location,formattedAddress');
});

it('says "limited" when the shipper has used their hour, and never calls Google', async () => {
  const d = deps({ 'rpc/use_places_quota': { status: 400, body: { message: 'rate limit exceeded' } } });
  const res = await handle(post({ action: 'autocomplete', input: 'sohar', sessionToken: SESSION, language: 'en' }), d);
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: 'limited' });
  expect(d.calls).toHaveLength(1);
});

it('says "unavailable" when Google fails, without passing its body on', async () => {
  const d = deps({ ...QUOTA_OK, 'places:autocomplete': { status: 500, body: { error: { message: 'internal detail' } } } });
  const res = await handle(post({ action: 'autocomplete', input: 'sohar', sessionToken: SESSION, language: 'en' }), d);
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ error: 'unavailable' });
});

it.each([
  [{ action: 'autocomplete', input: 'x'.repeat(101), sessionToken: SESSION, language: 'en' }],
  [{ action: 'autocomplete', input: 'ok', sessionToken: 'not-a-uuid', language: 'en' }],
  [{ action: 'autocomplete', input: 'ok', sessionToken: SESSION, language: 'fr' }],
  [{ action: 'details', placeId: '../../v1/other', sessionToken: SESSION, language: 'en' }],
  [{ action: 'geocode' }],
])('refuses a malformed request before spending anything: %j', async (body) => {
  const d = deps({});
  const res = await handle(post(body), d);
  expect(res.status).toBe(400);
  expect(d.calls).toHaveLength(0);
});

it('refuses a request with no user token', async () => {
  const d = deps({});
  const res = await handle(post({ action: 'autocomplete', input: 'x', sessionToken: SESSION, language: 'en' }, ''), d);
  expect(res.status).toBe(401);
  expect(d.calls).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/unit/places-function.test.ts`
Expected: FAIL — `Cannot find module '../../supabase/functions/places/core'`.

- [ ] **Step 3: Implement `core.ts`**:

```ts
/**
 * The places Edge Function — all of it, as plain TypeScript.
 *
 * No Deno imports, so Jest runs it with a fake fetch; index.ts only hands it
 * the environment. Three things it guarantees:
 *
 * 1. THE KEY STAYS HERE. The app never holds the Google Places key.
 * 2. THE QUOTA IS THE CALLER'S. `use_places_quota` is called with the user's
 *    own JWT, so no service-role key exists anywhere in this function.
 * 3. THE BILL IS BOUNDED. Place Details asks for `location,formattedAddress`
 *    only (Essentials tier), and autocomplete sessions end in one Details call,
 *    which makes the suggestions themselves free.
 */

export const REGIONS = ['OM', 'AE', 'SA', 'QA', 'KW', 'BH'];
const OMAN_BIAS = { rectangle: { low: { latitude: 16.6, longitude: 52.0 }, high: { latitude: 26.4, longitude: 59.9 } } };
const TIMEOUT_MS = 5000;

export type Deps = { key: string; supabaseUrl: string; anonKey: string; fetch: typeof fetch };
type Lang = 'en' | 'ar';
type Body =
  | { action: 'autocomplete'; input: string; sessionToken: string; language: Lang }
  | { action: 'details'; placeId: string; sessionToken: string; language: Lang };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function parse(raw: unknown): Body | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (b.language !== 'en' && b.language !== 'ar') return null;
  if (typeof b.sessionToken !== 'string' || !UUID.test(b.sessionToken)) return null;
  if (b.action === 'autocomplete') {
    if (typeof b.input !== 'string') return null;
    const input = b.input.trim();
    if (input.length < 1 || input.length > 100) return null;
    return { action: 'autocomplete', input, sessionToken: b.sessionToken, language: b.language };
  }
  if (b.action === 'details') {
    if (typeof b.placeId !== 'string' || !PLACE_ID.test(b.placeId)) return null;
    return { action: 'details', placeId: b.placeId, sessionToken: b.sessionToken, language: b.language };
  }
  return null;
}

async function spendQuota(auth: string, kind: Body['action'], d: Deps): Promise<'ok' | 'limited' | 'failed'> {
  try {
    const res = await d.fetch(`${d.supabaseUrl}/rest/v1/rpc/use_places_quota`, {
      method: 'POST',
      headers: { apikey: d.anonKey, Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_kind: kind }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return 'ok';
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return body.message?.includes('rate limit') ? 'limited' : 'failed';
  } catch {
    return 'failed';
  }
}

async function autocomplete(b: Extract<Body, { action: 'autocomplete' }>, d: Deps) {
  const res = await d.fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': d.key },
    body: JSON.stringify({
      input: b.input,
      sessionToken: b.sessionToken,
      languageCode: b.language,
      includedRegionCodes: REGIONS,
      locationBias: OMAN_BIAS,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    suggestions?: { placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
    } }[];
  };
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p?.placeId)
    .map((p) => ({
      placeId: p.placeId as string,
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
      secondary: p.structuredFormat?.secondaryText?.text ?? '',
    }))
    .filter((s) => s.main.length > 0);
}

async function details(b: Extract<Body, { action: 'details' }>, d: Deps) {
  const url =
    `https://places.googleapis.com/v1/places/${b.placeId}` +
    `?sessionToken=${encodeURIComponent(b.sessionToken)}&languageCode=${b.language}`;
  const res = await d.fetch(url, {
    method: 'GET',
    headers: { 'X-Goog-Api-Key': d.key, 'X-Goog-FieldMask': 'location,formattedAddress' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { location?: { latitude?: number; longitude?: number }; formattedAddress?: string };
  const lat = data.location?.latitude;
  const lng = data.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng, address: data.formattedAddress ?? '' };
}

export async function handle(req: Request, d: Deps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'bad_request' });
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json(401, { error: 'unauthorized' });

  const body = parse(await req.json().catch(() => null));
  if (!body) return json(400, { error: 'bad_request' });

  const quota = await spendQuota(auth, body.action, d);
  if (quota === 'limited') return json(429, { error: 'limited' });
  if (quota === 'failed') return json(503, { error: 'unavailable' });

  try {
    if (body.action === 'autocomplete') {
      const suggestions = await autocomplete(body, d);
      return suggestions ? json(200, { suggestions }) : json(503, { error: 'unavailable' });
    }
    const place = await details(body, d);
    return place ? json(200, { place }) : json(503, { error: 'unavailable' });
  } catch {
    return json(503, { error: 'unavailable' });
  }
}
```

- [ ] **Step 4: Implement `index.ts`**:

```ts
/**
 * Entry point. Everything is in core.ts; this only reads the environment.
 * `GOOGLE_PLACES_KEY` is a Supabase secret. SUPABASE_URL and SUPABASE_ANON_KEY
 * are provided by the platform. There is deliberately no service-role key.
 */
import { handle } from './core.ts';

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(key: string): string | undefined };
};

Deno.serve((req) =>
  handle(req, {
    key: Deno.env.get('GOOGLE_PLACES_KEY') ?? '',
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    fetch,
  }),
);
```

- [ ] **Step 5: Let `tsc` accept Deno's `.ts` import** — in `tsconfig.json` `compilerOptions` add `"allowImportingTsExtensions": true` (safe: the base config sets `noEmit`).

- [ ] **Step 6: Run**

Run: `npx jest tests/unit/places-function.test.ts && npm run typecheck`
Expected: PASS; typecheck clean. (If `package.json` names the typecheck script differently, use the one `npm run verify` calls.)

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/places tests/unit/places-function.test.ts tsconfig.json
git commit -m "Add the places Edge Function: Google key server-side, quota spent as the caller"
```

---

### Task 5: Client place helpers

**Files:**
- Create: `src/lib/places.ts`
- Modify: `tests/setup.ts` (supabase `functions.invoke`; `expo-location` `reverseGeocodeAsync`)
- Test: `tests/unit/places.test.tsx`

**Interfaces:**
- Consumes: the Edge Function contract (Task 4); `public.city_near` (Task 1).
- Produces: `type Suggestion = { placeId: string; main: string; secondary: string }`; `type PickedPlace = { lat: number; lng: number; placeName: string | null }`; `usePlaceSearch(): { query: string; setQuery(q: string): void; suggestions: Suggestion[]; status: 'idle' | 'loading' | 'ready' | 'failed'; pick(s: Suggestion): Promise<PickedPlace | null> }`; `cityNear(lat: number, lng: number): Promise<number | null>`; `nameAt(lat: number, lng: number): Promise<string | null>`; `currentPlace(): Promise<PickedPlace | null>`; `newSessionToken(): string`.

- [ ] **Step 1: Test setup** — in `tests/setup.ts`, inside the `@/lib/supabase` mock's `supabase` object add `functions: { invoke: jest.fn() },` next to `rpc`; in the `expo-location` mock add `reverseGeocodeAsync: jest.fn(async () => []),`.

- [ ] **Step 2: Failing tests** — `tests/unit/places.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { initLanguage } from '@/i18n';
import { cityNear, currentPlace, nameAt, newSessionToken, usePlaceSearch } from '@/lib/places';
import { supabase } from '@/lib/supabase';

const invoke = supabase.functions.invoke as jest.Mock;
const L = Location as jest.Mocked<typeof Location>;

beforeEach(() => {
  initLanguage('en');
  invoke.mockReset();
  (supabase.rpc as jest.Mock).mockReset();
});

describe('usePlaceSearch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for three characters and a pause before asking', async () => {
    invoke.mockResolvedValue({ data: { suggestions: [{ placeId: 'p1', main: 'Lulu Barka', secondary: 'Barka' }] }, error: null });
    const { result } = await renderHook(() => usePlaceSearch());
    await act(async () => result.current.setQuery('lu'));
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => result.current.setQuery('lulu'));
    await act(async () => { jest.advanceTimersByTime(299); });
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.suggestions[0].main).toBe('Lulu Barka');
    expect(invoke).toHaveBeenCalledWith('places', {
      body: expect.objectContaining({ action: 'autocomplete', input: 'lulu', language: 'en' }),
    });
  });

  it('drops stale suggestions and says so when search fails', async () => {
    invoke
      .mockResolvedValueOnce({ data: { suggestions: [{ placeId: 'p1', main: 'Sohar Port', secondary: '' }] }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('503') });
    const { result } = await renderHook(() => usePlaceSearch());
    await act(async () => result.current.setQuery('soha'));
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    await act(async () => result.current.setQuery('sohar p'));
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.suggestions).toEqual([]);
  });

  it('ends the session with one details call, then starts a new one', async () => {
    invoke
      .mockResolvedValueOnce({ data: { suggestions: [{ placeId: 'p1', main: 'Lulu Barka', secondary: '' }] }, error: null })
      .mockResolvedValueOnce({ data: { place: { lat: 23.69, lng: 57.88, address: 'Barka' } }, error: null })
      .mockResolvedValueOnce({ data: { suggestions: [] }, error: null });
    const { result } = await renderHook(() => usePlaceSearch());
    await act(async () => result.current.setQuery('lulu'));
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let picked: Awaited<ReturnType<typeof result.current.pick>> = null;
    await act(async () => { picked = await result.current.pick(result.current.suggestions[0]); });
    expect(picked).toEqual({ lat: 23.69, lng: 57.88, placeName: 'Lulu Barka' });

    const first = invoke.mock.calls[0][1].body.sessionToken;
    expect(invoke.mock.calls[1][1].body).toEqual(expect.objectContaining({ action: 'details', placeId: 'p1', sessionToken: first }));

    await act(async () => result.current.setQuery('sohar'));
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    expect(invoke.mock.calls[2][1].body.sessionToken).not.toBe(first);
  });
});

it('makes a v4-shaped session token', () => {
  expect(newSessionToken()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

it('asks the server which city a point is near', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: 7, error: null });
  await expect(cityNear(23.69, 57.88)).resolves.toBe(7);
  expect(supabase.rpc).toHaveBeenCalledWith('city_near', { p_lat: 23.69, p_lng: 57.88 });
});

it('names a point from the phone geocoder, or says nothing', async () => {
  L.reverseGeocodeAsync.mockResolvedValueOnce([{ name: 'Lulu Hypermarket', district: 'Barka' } as never]);
  await expect(nameAt(23.69, 57.88)).resolves.toBe('Lulu Hypermarket, Barka');
  L.reverseGeocodeAsync.mockRejectedValueOnce(new Error('no geocoder'));
  await expect(nameAt(23.69, 57.88)).resolves.toBeNull();
});

it('gives no current place when permission is refused', async () => {
  L.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
  await expect(currentPlace()).resolves.toBeNull();
  expect(L.getCurrentPositionAsync).not.toHaveBeenCalled();
});

it('gives the phone position, named, when permitted', async () => {
  L.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  L.getCurrentPositionAsync.mockResolvedValueOnce({ coords: { latitude: 23.6, longitude: 58.4 } } as never);
  L.reverseGeocodeAsync.mockResolvedValueOnce([{ name: 'Ruwi' } as never]);
  await expect(currentPlace()).resolves.toEqual({ lat: 23.6, lng: 58.4, placeName: 'Ruwi' });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest tests/unit/places.test.tsx`
Expected: FAIL — `Cannot find module '@/lib/places'`.

- [ ] **Step 4: Implement `src/lib/places.ts`**:

```ts
/**
 * Where exactly — the client side of shipper places (0041).
 *
 * Search goes through our `places` Edge Function; this file never sees a Google
 * key. Names for a GPS point or a dragged pin come from the PHONE's geocoder,
 * which is free and keyless. The city is always the server's (`city_near`), so
 * "Near Barka" and the city book_load checks are one rule, not two.
 *
 * Every failure here resolves to null or `failed`, never a throw: the screen's
 * answer to any of them is the city list, which always works.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

import { getLanguage } from '@/i18n';
import { supabase } from '@/lib/supabase';

export type Suggestion = { placeId: string; main: string; secondary: string };
export type PickedPlace = { lat: number; lng: number; placeName: string | null };
type Status = 'idle' | 'loading' | 'ready' | 'failed';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

/** Uniqueness, not secrecy: a session token only groups one search for billing. */
export function newSessionToken(): string {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const n = (count: number) => Array.from({ length: count }, hex).join('');
  const variant = '89ab'[Math.floor(Math.random() * 4)];
  return `${n(8)}-${n(4)}-4${n(3)}-${variant}${n(3)}-${n(12)}`;
}

function language(): 'en' | 'ar' {
  return getLanguage() === 'ar' ? 'ar' : 'en';
}

export function usePlaceSearch() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const session = useRef(newSessionToken());
  const latest = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setSuggestions([]);
      setStatus('idle');
      return;
    }
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setStatus('loading');
      const { data, error } = await supabase.functions.invoke('places', {
        body: { action: 'autocomplete', input: q, sessionToken: session.current, language: language() },
      });
      if (ticket !== latest.current) return; // a newer query owns the screen
      const list = (data as { suggestions?: Suggestion[] } | null)?.suggestions;
      if (error || !list) {
        setSuggestions([]);
        setStatus('failed');
        return;
      }
      setSuggestions(list);
      setStatus('ready');
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const pick = useCallback(async (s: Suggestion): Promise<PickedPlace | null> => {
    const { data, error } = await supabase.functions.invoke('places', {
      body: { action: 'details', placeId: s.placeId, sessionToken: session.current, language: language() },
    });
    // The Details call ends the billing session, whatever it returned.
    session.current = newSessionToken();
    const place = (data as { place?: { lat: number; lng: number } } | null)?.place;
    if (error || !place) {
      setStatus('failed');
      return null;
    }
    return { lat: place.lat, lng: place.lng, placeName: s.main };
  }, []);

  return { query, setQuery, suggestions, status, pick };
}

export async function cityNear(lat: number, lng: number): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc('city_near', { p_lat: lat, p_lng: lng });
    if (error || data == null) return null;
    return Number(data);
  } catch {
    return null;
  }
}

export async function nameAt(lat: number, lng: number): Promise<string | null> {
  try {
    const [r] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!r) return null;
    const parts = [r.name, r.district ?? r.city].filter((p): p is string => !!p && p.trim().length > 0);
    const unique = parts.filter((p, i) => parts.indexOf(p) === i);
    return unique.length ? unique.join(', ') : null;
  } catch {
    return null;
  }
}

/** "Ship from where I am." Null when refused or unavailable — the row just goes. */
export async function currentPlace(): Promise<PickedPlace | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    if (!fix) return null;
    const { latitude: lat, longitude: lng } = fix.coords;
    return { lat, lng, placeName: await nameAt(lat, lng) };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run**

Run: `npx jest tests/unit/places.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/places.ts tests/unit/places.test.tsx tests/setup.ts
git commit -m "Client place helpers: debounced search, one session per pick, server city, phone geocoder"
```

---

### Task 6: The draft, the book call, and the row types

**Files:**
- Modify: `src/lib/booking.ts`
- Modify: `src/lib/queries.ts` (`BookInput`, `useBookLoad`, `DriverOffer`, `DriverTrip`, new `LoadPlace`, `placeOf`, `useLoadPlaces`)
- Test: `tests/unit/booking.test.ts` (existing file — append), `tests/unit/place-queries.test.tsx` (new)

**Interfaces:**
- Produces:
  - `type DraftPlace = { lat: number; lng: number; placeName: string | null; note: string; contactName: string; contactPhone: string }`; `BookingDraft.originPlace: DraftPlace | null`, `BookingDraft.destinationPlace: DraftPlace | null` (both `null` in `EMPTY_DRAFT`).
  - `type PlacePayload = { lat: number; lng: number; place_name: string | null; note: string | null; contact_name: string | null; contact_phone: string | null }`; `toPlacePayload(p: DraftPlace | null): PlacePayload | null`.
  - `normalizePhone(raw: string): string` — Arabic-Indic and Persian digits → Latin, trimmed; `isValidPhone(raw: string): boolean` — empty is valid, else `^\+?[0-9 ]{6,24}$` after normalising.
  - `BookInput.originPlace: PlacePayload | null`, `BookInput.destPlace: PlacePayload | null` → sent as `p_origin_place` / `p_dest_place`.
  - `type LoadPlace = { lat: number; lng: number; name: string | null; note: string | null; contactName: string | null; contactPhone: string | null }`; `placeOf(row: Record<string, unknown>, end: 'pickup' | 'drop'): LoadPlace | null`; `useLoadPlaces(loadId: string | undefined)` → `{ pickup: LoadPlace | null; drop: LoadPlace | null }`.
  - `DriverOffer` and `DriverTrip` gain the twelve `pickup_*` / `drop_*` fields, typed `number | null` (lat/lng) and `string | null` (text).

- [ ] **Step 1: Find the booking test file**

Run: `ls tests/unit | grep -i booking`
Use that file (create `tests/unit/booking.test.ts` if none exists, importing from `@/lib/booking`).

- [ ] **Step 2: Failing tests** — append (merge these imports into the file's existing import lines rather than duplicating them):

```ts
import { EMPTY_DRAFT, isValidPhone, loadDraft, normalizePhone, toPlacePayload } from '@/lib/booking';
import AsyncStorage from '@react-native-async-storage/async-storage';

describe('places in the draft', () => {
  it('opens a draft saved before places existed, with no place', async () => {
    await AsyncStorage.setItem('truckkoo.booking.draft.v1', JSON.stringify({ originCityId: 3 }));
    const d = await loadDraft();
    expect(d.originCityId).toBe(3);
    expect(d.originPlace).toBeNull();
    expect(d.destinationPlace).toBeNull();
  });

  it('sends blank details as nothing, not as empty strings', () => {
    expect(
      toPlacePayload({ lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '  ', contactName: '', contactPhone: '' }),
    ).toEqual({ lat: 23.6, lng: 58.4, place_name: 'Ruwi', note: null, contact_name: null, contact_phone: null });
    expect(toPlacePayload(null)).toBeNull();
  });

  it('turns Arabic-keyboard digits into digits the database accepts', () => {
    // An Arabic keyboard types ٩٦٨; the DB check accepts only 0-9.
    expect(normalizePhone(' +٩٦٨ ٩٠٠٠ ٠٠٠٠ ')).toBe('+968 9000 0000');
    expect(normalizePhone('۹۶۸')).toBe('968');
    expect(isValidPhone('+٩٦٨ ٩٠٠٠ ٠٠٠٠')).toBe(true);
    expect(isValidPhone('')).toBe(true);
    expect(isValidPhone('call me')).toBe(false);
    expect(isValidPhone('12')).toBe(false);
  });

  it('keeps places out of the empty draft', () => {
    expect(EMPTY_DRAFT.originPlace).toBeNull();
    expect(EMPTY_DRAFT.destinationPlace).toBeNull();
  });
});
```

and `tests/unit/place-queries.test.tsx`:

```tsx
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { placeOf, useBookLoad, useLoadPlaces } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => client.clear());

it('reads one end of a driver row as a place, or nothing', () => {
  const row = {
    pickup_lat: 23.6, pickup_lng: 58.4, pickup_name: 'Ruwi', pickup_note: 'Gate 3',
    pickup_contact_name: 'Rashid', pickup_contact_phone: '+968 9000 0000',
    drop_lat: null, drop_lng: null, drop_name: null, drop_note: null, drop_contact_name: null, drop_contact_phone: null,
  };
  expect(placeOf(row, 'pickup')).toEqual({
    lat: 23.6, lng: 58.4, name: 'Ruwi', note: 'Gate 3', contactName: 'Rashid', contactPhone: '+968 9000 0000',
  });
  expect(placeOf(row, 'drop')).toBeNull();
});

it('sends places to book_load by name', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: [{ load_id: 'L1', price_matched: true }], error: null });
  const { result } = await renderHook(() => useBookLoad(), { wrapper });
  const place = { lat: 23.6, lng: 58.4, place_name: 'Ruwi', note: null, contact_name: null, contact_phone: null };
  await result.current.mutateAsync({
    originCity: 1, destCity: 2, collectionDate: '2026-10-01', goods: 'x', weightKg: null,
    truckTypeCode: null, seenPriceBaisa: null, originPlace: place, destPlace: null,
  });
  expect(supabase.rpc).toHaveBeenCalledWith('book_load', expect.objectContaining({
    p_origin_place: place, p_dest_place: null,
  }));
});

it('reads the shipper\u2019s own places for a load', async () => {
  const eq = jest.fn().mockResolvedValue({
    data: [{ kind: 'drop', lat: 17.0, lng: 54.1, place_name: 'Port', note: null, contact_name: null, contact_phone: null }],
    error: null,
  });
  (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn(() => ({ eq })) });
  const { result } = await renderHook(() => useLoadPlaces('L1'), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(supabase.from).toHaveBeenCalledWith('load_places');
  expect(eq).toHaveBeenCalledWith('load_id', 'L1');
  expect(result.current.data?.pickup).toBeNull();
  expect(result.current.data?.drop?.name).toBe('Port');
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest tests/unit/booking.test.ts tests/unit/place-queries.test.tsx`
Expected: FAIL — `normalizePhone`, `toPlacePayload`, `placeOf`, `useLoadPlaces` are not exported.

- [ ] **Step 4: Implement in `src/lib/booking.ts`** — add to `BookingDraft` and `EMPTY_DRAFT`, and new exports:

```ts
/** An exact place (0041). The city beside it is always the server's `city_near`. */
export type DraftPlace = {
  lat: number;
  lng: number;
  placeName: string | null;
  note: string;
  contactName: string;
  contactPhone: string;
};
```

In `BookingDraft` add:

```ts
  /** Null when the shipper chose a city only — a real answer, not a gap. */
  originPlace: DraftPlace | null;
  destinationPlace: DraftPlace | null;
```

In `EMPTY_DRAFT` add `originPlace: null, destinationPlace: null,`. Then:

```ts
/** What book_load's p_origin_place / p_dest_place receive. Blank means nothing. */
export type PlacePayload = {
  lat: number;
  lng: number;
  place_name: string | null;
  note: string | null;
  contact_name: string | null;
  contact_phone: string | null;
};

const blank = (s: string | null | undefined) => {
  const v = (s ?? '').trim();
  return v.length ? v : null;
};

export function toPlacePayload(p: DraftPlace | null): PlacePayload | null {
  if (!p) return null;
  return {
    lat: p.lat,
    lng: p.lng,
    place_name: blank(p.placeName),
    note: blank(p.note),
    contact_name: blank(p.contactName),
    contact_phone: blank(normalizePhone(p.contactPhone)),
  };
}

/**
 * An Arabic keyboard types ٩٦٨, a Persian one ۹۶۸; the database accepts 0-9.
 * Normalised here, before validation and before saving, or every contact typed
 * on an Arabic phone would be refused at the last step.
 */
export function normalizePhone(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim();
}

/** Empty is fine — the contact is optional. Mirrors load_places_phone. */
export function isValidPhone(raw: string): boolean {
  const v = normalizePhone(raw);
  return v.length === 0 || /^\+?[0-9 ]{6,24}$/.test(v);
}
```

- [ ] **Step 5: Implement in `src/lib/queries.ts`**:

Import `type PlacePayload` from `@/lib/booking`. Add to `BookInput`:

```ts
  /** Exact places (0041); null when the shipper chose a city only. */
  originPlace: PlacePayload | null;
  destPlace: PlacePayload | null;
```

In `useBookLoad`'s rpc args add `p_origin_place: input.originPlace, p_dest_place: input.destPlace,`.

Add to both `DriverOffer` and `DriverTrip`:

```ts
  /** The exact places (0041). All null when the shipper chose cities only. */
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_name: string | null;
  pickup_note: string | null;
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  drop_name: string | null;
  drop_note: string | null;
  drop_contact_name: string | null;
  drop_contact_phone: string | null;
```

And new exports:

```ts
/** One end of a load, as the driver or shipper reads it (0041). */
export type LoadPlace = {
  lat: number;
  lng: number;
  name: string | null;
  note: string | null;
  contactName: string | null;
  contactPhone: string | null;
};

const num = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown) => (typeof v === 'string' && v.length ? v : null);

/** Reads `pickup_*` / `drop_*` off a driver row. No point means no place. */
export function placeOf(row: Record<string, unknown>, end: 'pickup' | 'drop'): LoadPlace | null {
  const lat = num(row[`${end}_lat`]);
  const lng = num(row[`${end}_lng`]);
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return {
    lat,
    lng,
    name: str(row[`${end}_name`]),
    note: str(row[`${end}_note`]),
    contactName: str(row[`${end}_contact_name`]),
    contactPhone: str(row[`${end}_contact_phone`]),
  };
}

/** The shipper's own places for one load. RLS scopes it; a miss is simply none. */
export function useLoadPlaces(loadId: string | undefined) {
  return useQuery({
    queryKey: ['load', 'places', loadId],
    enabled: !!loadId,
    queryFn: async (): Promise<{ pickup: LoadPlace | null; drop: LoadPlace | null }> => {
      const { data, error } = await supabase
        .from('load_places')
        .select('kind, lat, lng, place_name, note, contact_name, contact_phone')
        .eq('load_id', loadId);
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      const as = (kind: 'pickup' | 'drop') => {
        const r = rows.find((x) => x.kind === kind);
        if (!r) return null;
        return placeOf(
          {
            [`${kind}_lat`]: r.lat, [`${kind}_lng`]: r.lng, [`${kind}_name`]: r.place_name,
            [`${kind}_note`]: r.note, [`${kind}_contact_name`]: r.contact_name,
            [`${kind}_contact_phone`]: r.contact_phone,
          },
          kind,
        );
      };
      return { pickup: as('pickup'), drop: as('drop') };
    },
  });
}
```

- [ ] **Step 6: Fix fixtures and callers** — `npm run typecheck` will flag `driverTrip()` / offer fixtures in `tests/integration/harness.tsx` and the `useBookLoad` call in `src/app/(app)/book/review.tsx`. In the harness add the twelve fields as `null` to both `driverTrip()` and the offer fixture. In `review.tsx`'s `mutateAsync` call add `originPlace: toPlacePayload(draft.originPlace), destPlace: toPlacePayload(draft.destinationPlace),` (import `toPlacePayload` from `@/lib/booking`).

- [ ] **Step 7: Run**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/booking.ts src/lib/queries.ts src/app/\(app\)/book/review.tsx tests
git commit -m "Draft and book call carry places; driver rows and the shipper read them"
```

---

### Task 7: The one real map

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npx expo install react-native-maps`)
- Create: `app.config.ts`
- Create: `src/components/booking/PinAdjustMap.tsx`
- Modify: `tests/setup.ts` (mock)
- Create: `tests/unit/map-import-guard.test.ts`
- Test: `tests/components/pin-adjust-map.test.tsx`
- Modify: `CLAUDE.md` (Design → map exception)

**Interfaces:**
- Produces: `PinAdjustMap({ initial, onSettle }: { initial: { lat: number; lng: number }; onSettle: (p: { lat: number; lng: number }) => void })`, rendering a map with `testID="pin-map"` and a centred pin with `testID="pin-centre"`.

- [ ] **Step 1: Install** — `npx expo install react-native-maps`.

- [ ] **Step 2: Mock** — append to `tests/setup.ts`:

```ts
/* ─── react-native-maps (native; one screen uses it) ─────────────────────── */

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = (props: Record<string, unknown>) =>
    React.createElement(View, { testID: props.testID, onRegionChangeComplete: props.onRegionChangeComplete });
  return { __esModule: true, default: MapView, PROVIDER_GOOGLE: 'google' };
});
```

- [ ] **Step 3: Failing tests** — `tests/unit/map-import-guard.test.ts`:

```ts
/**
 * The drawn map (src/map) is the product's map. ONE screen — the pin on the
 * gate — needs streets and panning, and it alone may import react-native-maps.
 * A second importer is a design decision, not a convenience: change this list
 * only with CLAUDE.md.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ALLOWED = ['src/components/booking/PinAdjustMap.tsx'];

it('lets exactly one file import react-native-maps', () => {
  const root = join(__dirname, '..', '..');
  const files = (readdirSync(join(root, 'src'), { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => `src/${f.split('\\').join('/')}`);
  const importers = files.filter((f) => /from ['"]react-native-maps['"]/.test(readFileSync(join(root, f), 'utf8')));
  expect(importers).toEqual(ALLOWED);
});
```

and `tests/components/pin-adjust-map.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PinAdjustMap } from '@/components/booking/PinAdjustMap';

it('reports where the map settled, not every frame of the drag', async () => {
  const onSettle = jest.fn();
  await render(<PinAdjustMap initial={{ lat: 23.6, lng: 58.4 }} onSettle={onSettle} />);
  expect(screen.getByTestId('pin-centre')).toBeTruthy();
  await fireEvent(screen.getByTestId('pin-map'), 'regionChangeComplete', {
    latitude: 23.61, longitude: 58.42, latitudeDelta: 0.005, longitudeDelta: 0.005,
  });
  expect(onSettle).toHaveBeenCalledWith({ lat: 23.61, lng: 58.42 });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx jest tests/unit/map-import-guard.test.ts tests/components/pin-adjust-map.test.tsx`
Expected: FAIL — guard finds `[]`, component module not found.

- [ ] **Step 5: Implement `src/components/booking/PinAdjustMap.tsx`**:

```tsx
/**
 * The one real map in the product (0041, spec §6).
 *
 * Everywhere else the map is src/map: bundled geometry, fixed framings, about a
 * pixel a kilometre. Putting a pin on a gate needs streets and panning, so this
 * screen — and only this file, which tests/unit/map-import-guard enforces —
 * uses react-native-maps: Google on Android, Apple Maps on iOS for now.
 *
 * THE PIN IS FIXED; THE MAP MOVES. The shipper drags the world under a pin at
 * the centre, the Uber way, so the thumb never hides the point being chosen.
 * The pin is ink, not accent: this screen spends its accent on Confirm.
 */
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';

import { color } from '@/theme/tokens';

const CLOSE = 0.004; // roughly a few streets across

export function PinAdjustMap({
  initial,
  onSettle,
}: {
  initial: { lat: number; lng: number };
  onSettle: (p: { lat: number; lng: number }) => void;
}) {
  return (
    <View style={styles.fill}>
      <MapView
        testID="pin-map"
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={{ latitude: initial.lat, longitude: initial.lng, latitudeDelta: CLOSE, longitudeDelta: CLOSE }}
        onRegionChangeComplete={(r) => onSettle({ lat: r.latitude, lng: r.longitude })}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsUserLocation={false}
      />
      <View pointerEvents="none" style={styles.centre}>
        <View testID="pin-centre" style={styles.head} />
        <View style={styles.stem} />
      </View>
    </View>
  );
}

const HEAD = 22;
const STEM = 14;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // The stem's foot sits on the exact centre of the map.
  centre: {
    position: 'absolute',
    top: '50%',
    insetInlineStart: '50%',
    marginTop: -(HEAD + STEM),
    marginInlineStart: -HEAD / 2,
    alignItems: 'center',
  },
  head: {
    width: HEAD,
    height: HEAD,
    borderRadius: HEAD / 2,
    backgroundColor: color.ink,
    borderWidth: 3,
    borderColor: color.lightText,
  },
  stem: { width: 3, height: STEM, backgroundColor: color.ink },
});
```

Note on `insetInlineStart: '50%'`: the centre of the screen is the centre in both directions, so this is correct under RTL too.

- [ ] **Step 6: `app.config.ts`** — the key reaches the build from an EAS environment variable and is never committed:

```ts
/**
 * app.json is the configuration; this only adds what must not be committed.
 * GOOGLE_MAPS_ANDROID_KEY is an EAS environment variable, restricted in Google
 * Cloud to this package's signing certificate and to Maps SDK for Android.
 * Without it (a local `expo start`) the pin screen shows a blank map and the
 * city list still works.
 */
import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY },
    },
  },
});
```

Verify: `GOOGLE_MAPS_ANDROID_KEY=test-key npx expo config --type introspect | grep -n "com.google.android.geo.API_KEY" -A2`
Expected: the meta-data entry with `test-key`. If it is absent, the installed `react-native-maps` expects its own plugin instead: add `["react-native-maps", { "androidGoogleMapsApiKey": process.env.GOOGLE_MAPS_ANDROID_KEY }]` to `plugins` in `app.config.ts` (spread over `config.plugins`) and re-run until the entry appears.

- [ ] **Step 7: `CLAUDE.md`** — after the paragraph beginning "**The map is `src/map/`, and nothing outside it computes a projection**", add:

```markdown
**One exception (0041, 2026-09-28):** the booking pin screen
(`src/components/booking/PinAdjustMap.tsx`) uses `react-native-maps` — Google on
Android, Apple Maps on iOS — because putting a pin on a gate needs streets and
panning. It is the only importer (`tests/unit/map-import-guard.test.ts`); the
key comes from the EAS env var `GOOGLE_MAPS_ANDROID_KEY` via `app.config.ts`.
Every other map stays `src/map`.
```

- [ ] **Step 8: Run**

Run: `npm run verify`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json app.config.ts src/components/booking/PinAdjustMap.tsx tests CLAUDE.md
git commit -m "Add the pin map: react-native-maps on one screen only, key from EAS env"
```

---

### Task 8: Booking — search, pin, details

**Files:**
- Create: `src/components/booking/PlaceSearch.tsx`
- Create: `src/app/(app)/book/pin.tsx`
- Create: `src/app/(app)/book/place-details.tsx`
- Modify: `src/app/(app)/book/origin.tsx`, `src/app/(app)/book/destination.tsx`
- Modify: `src/i18n/index.ts` (en + Arabic drafts)
- Test: `tests/integration/places-booking.test.tsx`

**Interfaces:**
- Consumes: `usePlaceSearch`, `currentPlace`, `cityNear`, `nameAt` (Task 5); `DraftPlace`, `isValidPhone`, `normalizePhone` (Task 6); `PinAdjustMap` (Task 7).
- Produces: routes `/book/pin?end=pickup|drop` and `/book/place-details?end=pickup|drop`; `PlaceSearch({ onPicked }: { onPicked: (p: PickedPlace) => void })`.

- [ ] **Step 1: Strings** — `en` (next to the `book.*` keys):

```ts
  'places.search.placeholder': 'Search a place, area or company',
  'places.search.current': 'Use my current location',
  'places.search.locating': 'Finding where you are…',
  'places.search.or': 'OR CHOOSE A CITY',
  'places.search.none': 'No places found. Try another name, or choose a city.',
  'places.search.unavailable': "Search isn't working right now. Choose a city instead.",
  'places.pin.q': 'Put the pin on the gate',
  'places.pin.help': 'Move the map, not the pin.',
  'places.pin.near': 'Near {city}',
  'places.pin.unnamed': 'This spot',
  'places.pin.sameCity': 'Pickup and drop-off are both in {city}. Choose another place, or message us on WhatsApp.',
  'places.pin.noCity': "We couldn't check this spot. Choose a city instead.",
  'places.pin.chooseCity': 'Choose a city instead',
  'places.pin.confirmPickup': 'Confirm pickup',
  'places.pin.confirmDrop': 'Confirm drop-off',
  'places.details.q': 'Anything the driver should know?',
  'places.details.help': 'Optional. It helps the driver find the gate.',
  'places.details.note': 'e.g. Gate 3, behind the Shell station',
  'places.details.someonePickup': 'SOMEONE ELSE AT PICKUP?',
  'places.details.someoneDrop': 'WHO RECEIVES IT?',
  'places.details.name': 'Name',
  'places.details.phone': 'Phone number',
  'places.details.badPhone': 'Check the number: digits only, with + for the country code.',
  'places.details.skip': 'Skip',
```

`ar`, appended inside the `UNPROOFED DRAFTS` block (before its closing `};`):

```ts
  'places.search.placeholder': 'ابحث عن مكان أو منطقة أو شركة',
  'places.search.current': 'استخدم موقعي الحالي',
  'places.search.locating': 'نحدد موقعك…',
  'places.search.or': 'أو اختر مدينة',
  'places.search.none': 'لم نجد أماكن. جرّب اسماً آخر، أو اختر مدينة.',
  'places.search.unavailable': 'البحث لا يعمل الآن. اختر مدينة بدلاً من ذلك.',
  'places.pin.q': 'ضع الدبوس على البوابة',
  'places.pin.help': 'حرّك الخريطة، لا الدبوس.',
  'places.pin.near': 'قرب {city}',
  'places.pin.unnamed': 'هذا الموقع',
  'places.pin.sameCity': 'الاستلام والتسليم كلاهما في {city}. اختر مكاناً آخر، أو راسلنا على واتساب.',
  'places.pin.noCity': 'تعذّر التحقق من هذا الموقع. اختر مدينة بدلاً من ذلك.',
  'places.pin.chooseCity': 'اختر مدينة بدلاً من ذلك',
  'places.pin.confirmPickup': 'تأكيد الاستلام',
  'places.pin.confirmDrop': 'تأكيد التسليم',
  'places.details.q': 'هل هناك ما يجب أن يعرفه السائق؟',
  'places.details.help': 'اختياري. يساعد السائق على إيجاد البوابة.',
  'places.details.note': 'مثال: البوابة ٣ خلف محطة شل',
  'places.details.someonePickup': 'شخص آخر عند الاستلام؟',
  'places.details.someoneDrop': 'من سيستلمها؟',
  'places.details.name': 'الاسم',
  'places.details.phone': 'رقم الهاتف',
  'places.details.badPhone': 'تحقق من الرقم: أرقام فقط، مع + لرمز الدولة.',
  'places.details.skip': 'تخطَّ',
```

- [ ] **Step 2: Failing tests** — `tests/integration/places-booking.test.tsx`. Mock `@/lib/places` and `@/lib/queries` (for `useCities`) and render the screens directly, following the existing harness (`tests/integration/harness.tsx`: import `setupWorld`/`ok`/`MUSCAT`/`SALALAH` as the other integration files do; `mockParams` for `useLocalSearchParams`; `mockPush` for the router — copy the router/params mock block from `tests/integration/shipper-screens.test.tsx`).

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Origin from '@/app/(app)/book/origin';
import Pin from '@/app/(app)/book/pin';
import PlaceDetails from '@/app/(app)/book/place-details';
import Destination from '@/app/(app)/book/destination';
import * as places from '@/lib/places';
import { EMPTY_DRAFT, loadDraft } from '@/lib/booking';
// + the harness imports and router/params mocks, as in shipper-screens.test.tsx

jest.mock('@/lib/places', () => ({
  usePlaceSearch: jest.fn(),
  currentPlace: jest.fn(),
  cityNear: jest.fn(),
  nameAt: jest.fn(async () => 'Lulu Barka'),
}));
const search = places.usePlaceSearch as jest.Mock;

function searchState(over: Partial<ReturnType<typeof places.usePlaceSearch>> = {}) {
  return { query: '', setQuery: jest.fn(), suggestions: [], status: 'idle', pick: jest.fn(), ...over };
}

async function seed(patch: Partial<typeof EMPTY_DRAFT>) {
  await AsyncStorage.setItem('truckkoo.booking.draft.v1', JSON.stringify({ ...EMPTY_DRAFT, ...patch }));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  search.mockReturnValue(searchState());
});

it('takes a searched place to the pin screen', async () => {
  const pick = jest.fn(async () => ({ lat: 23.69, lng: 57.88, placeName: 'Lulu Barka' }));
  search.mockReturnValue(searchState({
    status: 'ready', suggestions: [{ placeId: 'p1', main: 'Lulu Barka', secondary: 'Barka, Oman' }], pick,
  }));
  await render(<Origin />);
  await fireEvent.press(await screen.findByText('Lulu Barka'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: '/book/pin', params: { end: 'pickup' } }));
  expect((await loadDraft()).originPlace).toEqual(expect.objectContaining({ lat: 23.69, placeName: 'Lulu Barka' }));
});

it('keeps the city list usable when search is down', async () => {
  search.mockReturnValue(searchState({ status: 'failed' }));
  await render(<Origin />);
  expect(await screen.findByText("Search isn't working right now. Choose a city instead.")).toBeTruthy();
  await fireEvent.press(screen.getByText('Muscat'));
  expect((await loadDraft()).originCityId).toBe(MUSCAT.id);
});

it('hides "Use my current location" once the shipper refuses it', async () => {
  (places.currentPlace as jest.Mock).mockResolvedValue(null);
  await render(<Origin />);
  await fireEvent.press(screen.getByLabelText('Use my current location'));
  await waitFor(() => expect(screen.queryByLabelText('Use my current location')).toBeNull());
  expect(mockPush).not.toHaveBeenCalled();
});

it('clears the place when the shipper picks a city instead', async () => {
  await seed({ originPlace: { lat: 23.69, lng: 57.88, placeName: 'Lulu', note: '', contactName: '', contactPhone: '' } });
  await render(<Origin />);
  await fireEvent.press(await screen.findByText('Muscat'));
  const d = await loadDraft();
  expect(d.originPlace).toBeNull();
  expect(d.originCityId).toBe(MUSCAT.id);
});

it('confirms the pin with the server\u2019s city', async () => {
  mockParams.current = { end: 'pickup' };
  (places.cityNear as jest.Mock).mockResolvedValue(MUSCAT.id);
  await seed({ originPlace: { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' } });
  await render(<Pin />);
  await fireEvent(await screen.findByTestId('pin-map'), 'regionChangeComplete', {
    latitude: 23.61, longitude: 58.41, latitudeDelta: 0.004, longitudeDelta: 0.004,
  });
  expect(await screen.findByText('Near Muscat')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Confirm pickup'));
  const d = await loadDraft();
  expect(d.originCityId).toBe(MUSCAT.id);
  expect(d.originPlace).toEqual(expect.objectContaining({ lat: 23.61, lng: 58.41 }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/book/place-details', params: { end: 'pickup' } });
});

it('will not confirm a drop-off in the pickup\u2019s city, and says why', async () => {
  mockParams.current = { end: 'drop' };
  (places.cityNear as jest.Mock).mockResolvedValue(MUSCAT.id);
  await seed({
    originCityId: MUSCAT.id,
    destinationPlace: { lat: 23.6, lng: 58.5, placeName: 'Qurum', note: '', contactName: '', contactPhone: '' },
  });
  await render(<Pin />);
  await fireEvent(await screen.findByTestId('pin-map'), 'regionChangeComplete', {
    latitude: 23.6, longitude: 58.5, latitudeDelta: 0.004, longitudeDelta: 0.004,
  });
  expect(await screen.findByText(/both in Muscat/)).toBeTruthy();
  expect(screen.getByLabelText('Confirm drop-off').props.accessibilityState.disabled).toBe(true);
});

it('offers the city list when the spot cannot be checked', async () => {
  mockParams.current = { end: 'pickup' };
  (places.cityNear as jest.Mock).mockResolvedValue(null);
  await seed({ originPlace: { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' } });
  await render(<Pin />);
  expect(await screen.findByText("We couldn't check this spot. Choose a city instead.")).toBeTruthy();
  expect(screen.getByLabelText('Confirm pickup').props.accessibilityState.disabled).toBe(true);
});

it('saves an Arabic-keyboard phone in digits the database accepts', async () => {
  mockParams.current = { end: 'pickup' };
  await seed({ originPlace: { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' } });
  await render(<PlaceDetails />);
  await fireEvent.changeText(await screen.findByLabelText('Phone number'), '+٩٦٨ ٩٠٠٠ ٠٠٠٠');
  await fireEvent.press(screen.getByLabelText('Continue'));
  expect((await loadDraft()).originPlace?.contactPhone).toBe('+968 9000 0000');
  expect(mockPush).toHaveBeenCalledWith('/book/destination');
});

it('refuses a phone that is not a phone, and says what to fix', async () => {
  mockParams.current = { end: 'pickup' };
  await seed({ originPlace: { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' } });
  await render(<PlaceDetails />);
  await fireEvent.changeText(await screen.findByLabelText('Phone number'), 'call me');
  expect(screen.getByText('Check the number: digits only, with + for the country code.')).toBeTruthy();
  expect(screen.getByLabelText('Continue').props.accessibilityState.disabled).toBe(true);
});

it('lets the shipper skip the details, and clears what they typed', async () => {
  mockParams.current = { end: 'drop' };
  await seed({ destinationPlace: { lat: 17, lng: 54, placeName: 'Port', note: 'x', contactName: 'y', contactPhone: '9' } });
  await render(<PlaceDetails />);
  await fireEvent.press(await screen.findByLabelText('Skip'));
  const d = await loadDraft();
  expect(d.destinationPlace).toEqual(expect.objectContaining({ note: '', contactName: '', contactPhone: '' }));
  expect(mockPush).toHaveBeenCalledWith('/book/date');
});

it('swaps the places with the cities', async () => {
  const a = { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' };
  const b = { lat: 17, lng: 54, placeName: 'Port', note: '', contactName: '', contactPhone: '' };
  await seed({ originCityId: MUSCAT.id, destinationCityId: SALALAH.id, originPlace: a, destinationPlace: b });
  await render(<Destination />);
  await fireEvent.press(await screen.findByLabelText('Swap pickup and destination'));
  const d = await loadDraft();
  expect(d.originPlace).toEqual(b);
  expect(d.destinationPlace).toEqual(a);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest tests/integration/places-booking.test.tsx`
Expected: FAIL — `pin` / `place-details` modules missing; origin has no search.

- [ ] **Step 4: `PlaceSearch.tsx`**:

```tsx
/**
 * "Search a place" and "Use my current location" — the top of the pickup and
 * drop-off steps. The city list stays underneath, always: every failure here
 * (no signal, search down, permission refused) ends at a city, never at a wall.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableSurface, TextField } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Notice, Skeleton } from '@/components/ui';
import { align, t } from '@/i18n';
import { currentPlace, usePlaceSearch, type PickedPlace } from '@/lib/places';
import { safeText } from '@/lib/safe-text';
import { alpha, color, font, radius, space } from '@/theme/tokens';

export function PlaceSearch({ onPicked }: { onPicked: (p: PickedPlace) => void }) {
  const { query, setQuery, suggestions, status, pick } = usePlaceSearch();
  const [gpsRefused, setGpsRefused] = useState(false);
  const [locating, setLocating] = useState(false);

  async function useCurrent() {
    setLocating(true);
    const here = await currentPlace();
    setLocating(false);
    if (!here) {
      setGpsRefused(true);
      return;
    }
    onPicked(here);
  }

  return (
    <View style={styles.wrap}>
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder={t('places.search.placeholder')}
        accessibilityLabel={t('places.search.placeholder')}
        leading={<Icon name="search" size={18} tint={color.mutedText} />}
        autoCorrect={false}
        returnKeyType="search"
        maxLength={100}
      />

      {!gpsRefused && query.trim().length === 0 && (
        <PressableSurface
          onPress={useCurrent}
          disabled={locating}
          accessibilityLabel={t('places.search.current')}
          style={styles.row}
        >
          <Icon name="dropoff" size={18} tint={color.lightText} />
          <Text style={styles.main}>{locating ? t('places.search.locating') : t('places.search.current')}</Text>
        </PressableSurface>
      )}

      {status === 'loading' && suggestions.length === 0 && (
        <View style={styles.list}>
          <Skeleton height={52} round={radius.row} />
          <Skeleton height={52} round={radius.row} />
        </View>
      )}

      {status === 'failed' && <Notice icon="info">{t('places.search.unavailable')}</Notice>}
      {status === 'ready' && suggestions.length === 0 && <Notice icon="info">{t('places.search.none')}</Notice>}

      {suggestions.length > 0 && (
        <View style={styles.list}>
          {suggestions.map((s) => (
            <PressableSurface
              key={s.placeId}
              onPress={async () => {
                const place = await pick(s);
                if (place) onPicked(place);
              }}
              accessibilityLabel={s.secondary ? `${s.main}, ${s.secondary}` : s.main}
              style={styles.row}
            >
              <View style={styles.text}>
                <Text style={styles.main} numberOfLines={1}>{safeText(s.main)}</Text>
                {!!s.secondary && (
                  <Text style={styles.secondary} numberOfLines={1}>{safeText(s.secondary)}</Text>
                )}
              </View>
            </PressableSurface>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  list: { gap: space.xs },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.row,
    backgroundColor: color.raised,
  },
  text: { flex: 1 },
  main: { ...arabicIfNeeded(font.body), color: color.lightText, textAlign: align.start },
  secondary: { ...arabicIfNeeded(font.caption), color: alpha.onInk.tertiary, textAlign: align.start },
});
```

(If `color.raised` is named differently in `src/theme/tokens.ts`, use the raised-surface token — `#1E2128` — by its real name. `accessibilityLabel` joins two place names Google already localised; it is not composed copy.)

- [ ] **Step 5: `origin.tsx`** — import `PlaceSearch` and `SectionLabel`; above `<Text style={styles.help}>` keep the heading, then replace the help + list block with:

```tsx
        <View style={styles.search}>
          <PlaceSearch
            onPicked={(p) => {
              update({ originPlace: { ...p, note: '', contactName: '', contactPhone: '' } });
              router.push({ pathname: '/book/pin', params: { end: 'pickup' } });
            }}
          />
        </View>

        <View style={styles.list}>
          <SectionLabel>{t('places.search.or')}</SectionLabel>
          <CityList
            cities={cities ?? []}
            selectedId={draft.originCityId}
            // A city chosen by hand replaces any place: a pin in Barka must not
            // travel with a load that now starts in Sohar.
            onSelect={(c) => update({ originCityId: c.id, originPlace: null })}
            excludeId={draft.destinationCityId}
          />
        </View>
```

and add `search: { marginTop: space.md },` to its styles (`book.origin.help` stays unused on this screen only if the no-literals/i18n tests allow unused keys; otherwise keep the help text above the search).

- [ ] **Step 6: `destination.tsx`** — the same `PlaceSearch` block at the top of the sheet (`end: 'drop'`, `destinationPlace`), and every place the destination city changes by hand clears the place:
  - `CityList onSelect` → `update({ destinationCityId: c.id, destinationPlace: null })`
  - country segment → `update({ destinationCountry: c, destinationCityId: null, destinationPlace: null })`
  - recent chip → add `destinationPlace: null`
  - swap → `update({ originCityId: draft.destinationCityId, destinationCityId: draft.originCityId, originPlace: draft.destinationPlace, destinationPlace: draft.originPlace })`

- [ ] **Step 7: `book/pin.tsx`**:

```tsx
/**
 * "Put the pin on the gate" — pickup or drop-off, by `?end=`.
 *
 * The shipper arrived here from a search result or their current location. The
 * map moves under a fixed pin; when it settles, the phone names the spot and the
 * SERVER names the city (`city_near`) — the same rule book_load checks, so what
 * is confirmed here cannot be refused later.
 *
 * Confirm stays disabled until the server has answered, and it stays disabled
 * when both ends land in one city: loads_not_circular forbids that, and saying
 * so here beats failing on the review screen.
 */
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PinAdjustMap } from '@/components/booking/PinAdjustMap';
import { BackButton, PrimaryButton, SecondaryButton, TertiaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Notice, QuestionHeading } from '@/components/ui';
import { align, localized, t } from '@/i18n';
import { useBookingDraft } from '@/lib/booking';
import { cityNear, nameAt } from '@/lib/places';
import { cityIndex, useCities } from '@/lib/queries';
import { safeText, whatsappLink } from '@/lib/safe-text';
import { alpha, color, font, space } from '@/theme/tokens';

const SETTLE_MS = 400;

export default function Pin() {
  const { end } = useLocalSearchParams<{ end: 'pickup' | 'drop' }>();
  const pickup = end !== 'drop';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { draft, update, ready } = useBookingDraft();
  const { data: cities } = useCities();
  const index = cityIndex(cities);

  const place = pickup ? draft.originPlace : draft.destinationPlace;
  const otherCityId = pickup ? draft.destinationCityId : draft.originCityId;

  const [centre, setCentre] = useState<{ lat: number; lng: number } | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [cityId, setCityId] = useState<number | null>(null);
  const [checking, setChecking] = useState(true);

  // Start from the stored place once the draft has loaded.
  useEffect(() => {
    if (ready && place && !centre) {
      setCentre({ lat: place.lat, lng: place.lng });
      setName(place.placeName);
    }
  }, [ready, place, centre]);

  useEffect(() => {
    if (!centre) return;
    let alive = true;
    setChecking(true);
    const timer = setTimeout(async () => {
      const [city, spot] = await Promise.all([cityNear(centre.lat, centre.lng), nameAt(centre.lat, centre.lng)]);
      if (!alive) return;
      setCityId(city);
      if (spot) setName(spot);
      setChecking(false);
    }, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [centre]);

  if (!ready || !place) return null;

  const city = cityId != null ? index.get(cityId) : undefined;
  const sameCity = cityId != null && cityId === otherCityId;
  const unchecked = !checking && cityId == null;

  function confirm() {
    if (!centre || cityId == null || !place) return;
    const next = { ...place, lat: centre.lat, lng: centre.lng, placeName: name };
    update(
      pickup
        ? { originPlace: next, originCityId: cityId }
        : {
            destinationPlace: next,
            destinationCityId: cityId,
            ...(city ? { destinationCountry: city.country as 'OM' | 'AE' | 'SA' } : {}),
          },
    );
    router.push({ pathname: '/book/place-details', params: { end: pickup ? 'pickup' : 'drop' } });
  }

  return (
    <View style={styles.screen}>
      <PinAdjustMap initial={{ lat: place.lat, lng: place.lng }} onSettle={setCentre} />

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <BackButton onPress={() => router.back()} />
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <QuestionHeading ground="ink" size="question">{t('places.pin.q')}</QuestionHeading>
        <Text style={styles.help}>{t('places.pin.help')}</Text>

        <Text style={styles.name} numberOfLines={2}>{name ? safeText(name) : t('places.pin.unnamed')}</Text>
        {city && <Text style={styles.near}>{t('places.pin.near', { city: localized(city) })}</Text>}

        {sameCity && city && (
          <View style={styles.gap}>
            <Notice icon="info">{t('places.pin.sameCity', { city: localized(city) })}</Notice>
            <SecondaryButton
              label={t('whatsapp.action')}
              icon="whatsapp"
              onPress={() => Linking.openURL(whatsappLink()).catch(() => {})}
            />
          </View>
        )}
        {unchecked && (
          <View style={styles.gap}>
            <Notice icon="info">{t('places.pin.noCity')}</Notice>
            <TertiaryButton label={t('places.pin.chooseCity')} onPress={() => router.back()} />
          </View>
        )}

        <View style={styles.gap}>
          <PrimaryButton
            label={pickup ? t('places.pin.confirmPickup') : t('places.pin.confirmDrop')}
            onPress={confirm}
            disabled={checking || cityId == null || sameCity}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  top: { position: 'absolute', top: 0, insetInlineStart: space.lg },
  sheet: {
    position: 'absolute',
    bottom: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    backgroundColor: color.surface,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    borderTopStartRadius: 24,
    borderTopEndRadius: 24,
  },
  help: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.tertiary, textAlign: align.start, marginTop: space.xs },
  name: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start, marginTop: space.md },
  near: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.body, textAlign: align.start, marginTop: 2 },
  gap: { marginTop: space.md, gap: space.sm },
});
```

(Check `TertiaryButton`'s props against `src/components/primitives.tsx` and the `radius` token for sheet corners — use `radius.sheet` if it exists instead of the literal 24.)

- [ ] **Step 8: `book/place-details.tsx`**:

```tsx
/**
 * "Anything the driver should know?" — optional, both ends, by `?end=`.
 *
 * Skip has the same weight as Continue: most shippers will not fill this in, and
 * a screen that makes them feel they should is a screen that loses them.
 * Skip clears what was typed, so an abandoned half-number never travels.
 */
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { SectionLabel } from '@/components/ui';
import { align, t } from '@/i18n';
import { TOTAL_STEPS, isValidPhone, normalizePhone, stepNumber, useBookingDraft } from '@/lib/booking';
import { color, elevation, font, radius, space } from '@/theme/tokens';

export default function PlaceDetails() {
  const { end } = useLocalSearchParams<{ end: 'pickup' | 'drop' }>();
  const pickup = end !== 'drop';
  const router = useRouter();
  const { draft, update, ready } = useBookingDraft();
  const place = pickup ? draft.originPlace : draft.destinationPlace;
  const [touchedPhone, setTouchedPhone] = useState(false);

  if (!ready || !place) return null;

  const next = pickup ? '/book/destination' : '/book/date';
  const set = (patch: Partial<typeof place>) =>
    update(pickup ? { originPlace: { ...place, ...patch } } : { destinationPlace: { ...place, ...patch } });
  const phoneOk = isValidPhone(place.contactPhone);

  return (
    <QuestionShell
      step={stepNumber(pickup ? 'origin' : 'destination')}
      total={TOTAL_STEPS}
      question={t('places.details.q')}
      helper={t('places.details.help')}
      onBack={() => router.back()}
      cta={t('action.continue')}
      ctaDisabled={!phoneOk}
      onCta={() => {
        set({ contactPhone: normalizePhone(place.contactPhone) });
        router.push(next);
      }}
      tertiary={t('places.details.skip')}
      onTertiary={() => {
        set({ note: '', contactName: '', contactPhone: '' });
        router.push(next);
      }}
    >
      <TextInput
        value={place.note}
        onChangeText={(note) => set({ note })}
        placeholder={t('places.details.note')}
        accessibilityLabel={t('places.details.note')}
        placeholderTextColor={color.mutedText}
        style={styles.note}
        multiline
        maxLength={300}
      />

      <View style={styles.label}>
        <SectionLabel ground="cream">
          {pickup ? t('places.details.someonePickup') : t('places.details.someoneDrop')}
        </SectionLabel>
      </View>
      <TextField
        value={place.contactName}
        onChangeText={(contactName) => set({ contactName })}
        placeholder={t('places.details.name')}
        accessibilityLabel={t('places.details.name')}
        maxLength={80}
      />
      <TextField
        value={place.contactPhone}
        onChangeText={(contactPhone) => {
          setTouchedPhone(true);
          set({ contactPhone });
        }}
        placeholder={t('places.details.phone')}
        accessibilityLabel={t('places.details.phone')}
        keyboardType="phone-pad"
        maxLength={24}
        error={touchedPhone && !phoneOk ? t('places.details.badPhone') : null}
      />
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  note: {
    minHeight: 96,
    borderRadius: radius.row,
    backgroundColor: color.creamCard,
    padding: space.lg,
    ...font.body,
    color: color.inkText,
    textAlign: align.start,
    textAlignVertical: 'top',
    ...elevation.inputCream,
  },
  label: { marginTop: space.lg },
});
```

(If `TextField` renders its `error` prop as text, the test's `getByText` finds it; if `QuestionShell`'s tertiary button's accessible label is its label, `getByLabelText('Skip')` finds it — check both against `primitives.tsx`/`shells.tsx` and adjust the test selectors, not the behaviour.)

- [ ] **Step 9: Run**

Run: `npx jest tests/integration/places-booking.test.tsx && npm run verify`
Expected: PASS. Fix any `no-literals` hit by moving the text into `t()`, never by exempting a file.

- [ ] **Step 10: Commit**

```bash
git add src/components/booking/PlaceSearch.tsx src/app/\(app\)/book src/i18n/index.ts tests/integration/places-booking.test.tsx
git commit -m "Booking: search a place or use current location, pin it on the gate, add a note and contact"
```

---

### Task 9: Review and the shipper's load screen show the places

**Files:**
- Modify: `src/app/(app)/book/review.tsx`
- Modify: `src/app/(app)/load/[id].tsx`
- Modify: `src/i18n/index.ts`
- Test: `tests/integration/places-booking.test.tsx` (append), `tests/integration/shipper-screens.test.tsx` (append)

**Interfaces:**
- Consumes: `useLoadPlaces` (Task 6), `toPlacePayload` (Task 6).

- [ ] **Step 1: Strings** — `en`: `'places.review.pickup': 'Pickup: {place}'`, `'places.review.drop': 'Drop-off: {place}'`. `ar` (drafts block): `'places.review.pickup': 'الاستلام: {place}'`, `'places.review.drop': 'التسليم: {place}'`.

- [ ] **Step 2: Failing tests** — append to `places-booking.test.tsx` (the review test needs `useRoutePrice`/`useBookLoad` mocked the way `tests/integration/auto-dispatch-screens.test.tsx` mocks them — copy that setup):

```tsx
it('shows the chosen places on the review, and books with them', async () => {
  await seed({
    originCityId: MUSCAT.id, destinationCityId: SALALAH.id, collectionDate: '2026-10-01', cargoDescription: 'Tiles',
    originPlace: { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: 'Gate 3', contactName: '', contactPhone: '' },
  });
  await render(<Review />);
  expect(await screen.findByText('Pickup: Ruwi')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText(/Book/));
  expect(mockBook).toHaveBeenCalledWith(expect.objectContaining({
    originPlace: expect.objectContaining({ place_name: 'Ruwi', note: 'Gate 3', contact_phone: null }),
    destPlace: null,
  }));
});
```

and to `shipper-screens.test.tsx` (inside the T4 describe; `useLoadPlaces` must be added to the harness's mocked `@/lib/queries` list and defaulted to `ok({ pickup: null, drop: null })` in `setupWorld`):

```tsx
    it('names the shipper\u2019s own pickup and drop-off places', async () => {
      (queries.useLoadPlaces as jest.Mock).mockReturnValue(ok({
        pickup: { lat: 23.6, lng: 58.4, name: 'Ruwi warehouse', note: null, contactName: null, contactPhone: null },
        drop: null,
      }));
      await render(<TrackLoad />);
      expect(screen.getByText('Pickup: Ruwi warehouse')).toBeTruthy();
    });
```

- [ ] **Step 3: Run to verify failure** — `npx jest tests/integration/places-booking.test.tsx tests/integration/shipper-screens.test.tsx` → FAIL (text not found).

- [ ] **Step 4: Implement**
  - `review.tsx`: directly under the route rail, for each end with a place, a `Text` with `t('places.review.pickup', { place: safeText(p.placeName ?? '') })` (drop likewise), and the note on its own line in the caption style the screen already uses. Only render when `placeName` is non-empty.
  - `load/[id].tsx`: `const places = useLoadPlaces(load?.id);` near the other hooks; in the cargo card (the block commented "The cargo itself, under every state"), under the existing rows, render `places.data?.pickup?.name` and `places.data?.drop?.name` with the same two strings. Nothing on the map changes.

- [ ] **Step 5: Run** — `npm run verify` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/book/review.tsx src/app/\(app\)/load/\[id\].tsx src/i18n/index.ts tests
git commit -m "Review and the load screen name the shipper's places"
```

---

### Task 10: The driver sees the place, the note, the contact — and gets directions to the gate

**Files:**
- Create: `src/components/driver/PlaceDetails.tsx`
- Modify: `src/app/(app)/offer/[id].tsx`, `src/app/(app)/trip/[id].tsx`
- Modify: `src/i18n/index.ts`
- Test: `tests/integration/driver-screens.test.tsx` (append)

**Interfaces:**
- Consumes: `placeOf`, `LoadPlace` (Task 6); `directionsLink` (existing, `src/lib/safe-text.ts`).
- Produces: `DriverPlaceDetails({ label, place }: { label: string; place: LoadPlace })`.

- [ ] **Step 1: Strings** — `en`: `'places.call': 'Call {name}'`. `ar` (drafts): `'places.call': 'اتصل بـ{name}'`.

- [ ] **Step 2: Failing tests** — append to the `OnTheJob` describe and add an offer test near the existing D2 tests in `tests/integration/driver-screens.test.tsx`:

```tsx
  it('gives directions to the gate, not the city, when the shipper pinned it', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip({
      pickup_lat: 23.61, pickup_lng: 58.42, pickup_name: 'Ruwi warehouse',
    })));
    await render(<TripDetail />);
    await fireEvent.press(screen.getByLabelText('Directions to Ruwi warehouse'));
    expect(openURL).toHaveBeenCalledWith(
      'https://www.google.com/maps/dir/?api=1&destination=23.610000%2C58.420000&travelmode=driving',
    );
  });

  it('shows the note and calls the person at the gate', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip({
      pickup_lat: 23.61, pickup_lng: 58.42, pickup_name: 'Ruwi warehouse',
      pickup_note: 'Gate 3, ask for Rashid', pickup_contact_name: 'Rashid', pickup_contact_phone: '+968 9000 0000',
    })));
    await render(<TripDetail />);
    expect(screen.getByText('Gate 3, ask for Rashid')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Call Rashid'));
    expect(openURL).toHaveBeenCalledWith('tel:+96890000000');
  });
```

```tsx
  it('shows the exact pickup and its contact in an open offer', async () => {
    (queries.useDriverOffer as jest.Mock).mockReturnValue(ok(offer({
      pickup_lat: 23.61, pickup_lng: 58.42, pickup_name: 'Ruwi warehouse',
      pickup_contact_name: 'Rashid', pickup_contact_phone: '+968 9000 0000',
    })));
    await render(<OfferDetail />);
    expect(screen.getByText('Ruwi warehouse')).toBeTruthy();
    expect(screen.getByLabelText('Call Rashid')).toBeTruthy();
  });
```

(`offer(...)` is the harness's offer fixture; use its real name from `tests/integration/harness.tsx`.)

- [ ] **Step 3: Run to verify failure** — `npx jest tests/integration/driver-screens.test.tsx` → FAIL.

- [ ] **Step 4: `src/components/driver/PlaceDetails.tsx`**:

```tsx
/**
 * One end of a load, as the driver needs it at the gate: where, what to look
 * for, and who to call. Everything the shipper typed is sanitised on the way
 * out — the DB rejects bidi overrides too, both layers on purpose.
 *
 * The phone is dialled with spaces removed; it is shown as a name, not a number,
 * because the Call button is what a driver uses in a cab.
 */
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableSurface } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { align, t } from '@/i18n';
import type { LoadPlace } from '@/lib/queries';
import { oneLine, safeText } from '@/lib/safe-text';
import { alpha, color, font, space } from '@/theme/tokens';

export function DriverPlaceDetails({ label, place }: { label: string; place: LoadPlace }) {
  const phone = place.contactPhone?.replace(/\s+/g, '') ?? null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {!!place.name && <Text style={styles.name}>{oneLine(safeText(place.name))}</Text>}
      {!!place.note && <Text style={styles.note}>{safeText(place.note)}</Text>}
      {!!phone && (
        <View style={styles.contact}>
          <Text style={styles.contactName} numberOfLines={1}>
            {safeText(place.contactName ?? '')}
          </Text>
          <PressableSurface
            onPress={() => Linking.openURL(`tel:${phone}`).catch(() => {})}
            accessibilityLabel={t('places.call', { name: safeText(place.contactName ?? phone) })}
            style={styles.call}
          >
            <Icon name="phone" size={20} tint={color.ink} />
          </PressableSurface>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2, marginTop: space.md },
  label: { ...font.label, color: alpha.onInk.tertiary, textAlign: align.start },
  name: { ...arabicIfNeeded(font.body), color: color.lightText, textAlign: align.start },
  note: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.body, textAlign: align.start },
  contact: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  contactName: { ...arabicIfNeeded(font.bodySmall), color: color.lightText, flex: 1, textAlign: align.start },
  call: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: color.lightText,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

(Match `font.label` and `oneLine`'s existence against `src/theme/tokens.ts` and `src/lib/safe-text.ts`; D7's existing `styles.call` is the reference for the circle.)

- [ ] **Step 5: `offer/[id].tsx`** — after the `RouteRail` line:

```tsx
              {pickupPlace && <DriverPlaceDetails label={t('book.dest.pickup')} place={pickupPlace} />}
              {dropPlace && <DriverPlaceDetails label={t('book.dest.deliver')} place={dropPlace} />}
```

with, near the other derived values, `const pickupPlace = offer ? placeOf(offer as unknown as Record<string, unknown>, 'pickup') : null;` and the same for `'drop'` (use the screen's actual variable name for the offer row).

- [ ] **Step 6: `trip/[id].tsx`** — the same two blocks after the cargo block (not when `done`: a finished job shows the place names only, which `driver_trip` already guarantees by nulling the contact). Replace the directions derivation:

```tsx
  // The pinned gate when the shipper gave one, else the city (0041).
  const pickupPlace = placeOf(trip as unknown as Record<string, unknown>, 'pickup');
  const dropPlace = placeOf(trip as unknown as Record<string, unknown>, 'drop');
  const nextPlace = done ? null : collected ? dropPlace : pickupPlace;
  const nextStop = done ? undefined : collected ? dest : origin;
  const target = nextPlace ?? nextStop;
  const directions = target ? directionsLink(target.lat, target.lng) : null;
  const directionsName = nextPlace?.name ?? (nextStop ? localized(nextStop) : '');
```

and the button label becomes `t('drv.trip.directionsTo', { city: safeText(directionsName) })`.

- [ ] **Step 7: Run** — `npm run verify` → PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/driver/PlaceDetails.tsx src/app/\(app\)/offer src/app/\(app\)/trip src/i18n/index.ts tests
git commit -m "Drivers see the pinned place, note and contact; directions go to the gate"
```

---

### Task 11: Docs, counts, device check, full verification

**Files:**
- Modify: `OPEN_ISSUES.md`, `CLAUDE.md`, `tests/README.md`, `docs/superpowers/specs/2026-09-28-shipper-places-design.md`

- [ ] **Step 1: Arabic draft count** — count the `ar` keys added in Tasks 8–10 (`git diff main -- src/i18n/index.ts | grep -c "^+  'places\."` on the Arabic side), add to 224, and update the number in `CLAUDE.md` (#4) and both places in `OPEN_ISSUES.md` (the heading and the "Drafted — N of them" line, naming "places, 2026-09-28").

- [ ] **Step 2: `OPEN_ISSUES.md`** — replace the "Driver directions go to the city centre" entry with:

```markdown
- **Shipper places are built (0041) and have never run on a real phone.** Before
  shippers get them (all before the 1.1.0 build): Google Cloud project + billing
  with a ~$20 budget alert and a daily quota on Places API (New); two keys —
  Places API (New) only, and Maps SDK for Android only restricted to the package
  + signing SHA-1; `npx supabase secrets set GOOGLE_PLACES_KEY=…` and
  `npx supabase functions deploy places`; EAS env var `GOOGLE_MAPS_ANDROID_KEY`
  (preview + production); `npx supabase db push` (0039–0041). Known gaps: iOS
  shows Apple Maps; a city-only load still routes the driver to the city centre;
  a move inside one city cannot be booked (`loads_not_circular`), and the pin
  screen says so; the ops console does not show places yet (`ops_load_places`
  exists).

  Device check (preview build 1.1.0, one Android phone):
  1. Book → search "Lulu Barka" → suggestions in under a second → pick → the map
     opens on it; drag → the name and "Near Barka" update.
  2. Confirm → details → type a phone on the Arabic keyboard → Continue → review
     shows "Pickup: …".
  3. "Use my current location" → allow → the pin opens where you stand; deny on a
     fresh install → the row disappears, the city list works.
  4. Airplane mode on the search step → the notice appears; pick a city; book.
  5. As a driver offered that load: the place, note and Call show; pass → reopen
     the offer → gone. Accept another → D7 "Directions to <place>" opens Google
     Maps at the gate.
```

- [ ] **Step 3: `tests/README.md`** — under "What these do not cover" add: **Google itself.** The `places` function is tested with a fake `fetch`; real suggestions, the Maps SDK key, and the phone geocoder are covered only by the device check in `OPEN_ISSUES.md` (Shipper places).

- [ ] **Step 4: Spec** — in §3 of the spec, replace the draft-key sentence with: "The draft key stays `truckkoo.booking.draft.v1`: `loadDraft()` spreads a stored draft over `EMPTY_DRAFT`, so the new `null` fields need no migration." and replace the four screen file names with `book/pin.tsx` and `book/place-details.tsx`, parameterised by `?end=pickup|drop`.

- [ ] **Step 5: Full verification**

```bash
npm run verify && npm run test:db && node scripts/check-migrations.mjs local && npm run preview:rtl > /dev/null
```

Expected: all green; `✓ 41 migrations (local)`.

- [ ] **Step 6: Commit**

```bash
git add OPEN_ISSUES.md CLAUDE.md tests/README.md docs/superpowers/specs/2026-09-28-shipper-places-design.md
git commit -m "Shipper places: founder steps, device check, draft count"
```

- [ ] **Step 7: Hand to the founder** (do not run): the six steps in spec §10, then the device check.
