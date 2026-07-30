# Truckkoo Redesign P1 · Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the map surface and its reference data — bundled vector geometry, one projection, corridor, pins, truck marker, scrims — so P3–P6 can assemble screens on top of it.

**Architecture:** No tiles and no native map library. Natural Earth 1:50m outlines are extracted at build time into a committed GeoJSON fixture, projected at runtime by a single `d3-geo` Mercator fitted to one of two fixed framings, and drawn with `react-native-svg`. Pins, corridor endpoints, the truck marker and the coastlines all come from that same projection, so nothing can drift relative to anything else.

**Tech Stack:** React Native 0.86 / Expo 57, TypeScript, `react-native-svg` (already installed), `d3-geo`; `world-atlas` + `topojson-client` as dev-only build inputs. Supabase Postgres for the coordinate columns.

## Global Constraints

Every task's requirements implicitly include this section.

- Package manager **npm**. Expo managed workflow; **never eject**.
- **RTL is structural.** Logical properties only — `marginStart`, `paddingEnd`, `insetInlineStart/End`. **Never `left`/`right`.** React Native does not flip `textAlign: 'left'`; use `align.start` from `@/i18n`.
  **Exception, and it is important:** SVG geometry is *not* laid out by the RTL engine. A projected x-coordinate is a position on a map, not a reading direction — the Gulf does not mirror in Arabic. SVG `x`/`cx`/`transform` are geometry and stay as they are. Only *chrome* around the map (labels in flow, buttons, sheets) obeys direction.
- **All user-facing strings go through `t()`.** City names come from the database (`name_en`/`name_ar` via `localized()`), never hardcoded.
- **Arabic numerals:** any number rendered on the map (distances, counts) goes through `localizeDigits`/`formatNumber`.
- **Every type token names a `fontFamily`; none sets `fontWeight`.** A bare weight on a custom family is a silent no-op.
- **One accent.** `#F1551F` is the pinned primary action **or** the live state, never both on one screen.
- **Never fabricate proof** — no invented trip counts, ratings, or "N trucks nearby" figures in fixtures or harnesses.
- **Money is integer baisa** (`src/lib/money.ts`). Coordinates are **not** money: `double precision` is correct for them.
- **Migrations are append-only.** `0020` is the next number; never edit an applied migration.
- **Deny by default on any new DB surface.** `cities` already carries a table-level `grant select to authenticated` (0001:467) which extends to new columns — verified, so `0020` adds **no** grant.
- `npm run verify` must pass at the end of every task. `npm run test:db` must pass for the tasks that touch SQL (needs `npx supabase start`).

**Handoff values used verbatim:**

| Thing | Value |
|---|---|
| Domestic framing bbox | `[56.2, 22.7]` → `[59.6, 24.8]` |
| Regional framing bbox | `[51.6, 16.3]` → `[60.3, 26.6]` |
| Sea / background | `#0B0C0F` (`color.ink`) |
| Oman landmass | `#1A1E24` |
| Oman coastline | `rgba(255,255,255,.06)`, 1px |
| Neighbour landmass | `#14171A` |
| Neighbour border | `rgba(247,245,242,.17)`, 0.9px |
| Country label | `700 10.5px`, letter-spacing `.22em`, `rgba(247,245,242,.4)` |
| City label (major) | `600 12px`, `rgba(247,245,242,.85)` |
| City label (minor) | `500 11px`, `rgba(247,245,242,.32)` |
| Corridor casing | `rgba(241,85,31,.22)`, 11px, round cap |
| Corridor stroke | `#F1551F`, 3.6px |
| Corridor, uncommitted | `stroke-dasharray: 7 7`, `rgba(241,85,31,.45)`, 2.6px |
| Truck marker | 13px `#F1551F` disc, `#0B0C0F` 2.5px outline, `rgba(241,85,31,.16)` 19px halo |
| Search rings (T1) | r=118 `rgba(241,85,31,.07)`, r=82 `.12`, r=48 fill `.07` + stroke `.2`, all 1.5px |

---

## File Structure

**Created:**
- `scripts/build-geo.mjs` — build-time Natural Earth extract. Dev-only, committed, rerunnable.
- `src/map/geometry.json` — the generated fixture (Oman + neighbours).
- `src/map/framing.ts` — the two bboxes and `projectionFor()`.
- `src/map/MapCanvas.tsx` — base layers + projection context.
- `src/map/Corridor.tsx` — the origin→destination line.
- `src/map/CityPin.tsx` — the four pin states.
- `src/map/TruckMarker.tsx` — the vehicle marker.
- `src/map/Scrim.tsx` — the three gradient scrims.
- `src/map/index.ts` — the module's public surface.
- `supabase/migrations/0020_city_coordinates.sql`
- `tests/unit/framing.test.ts`
- `tests/unit/city-coordinates.test.ts`
- `tests/components/map.test.tsx`

**Modified:**
- `src/theme/tokens.ts` — a `map` colour group
- `src/lib/queries.ts` — cities query returns the new columns
- `supabase/tests/tenant_isolation.sql` — coordinate assertions
- `package.json` — deps + a `build:geo` script
- `OPEN_ISSUES.md`

---

## Task 1: Dependencies and the geometry fixture

**Files:**
- Create: `scripts/build-geo.mjs`, `src/map/geometry.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing
- Produces: `src/map/geometry.json`, shaped `{ oman: Feature<MultiPolygon>, neighbours: FeatureCollection }` in WGS84 lng/lat. Task 3 and Task 4 read it.

- [ ] **Step 1: Install**

```bash
npm install d3-geo
npm install --save-dev @types/d3-geo world-atlas topojson-client
```

`world-atlas` and `topojson-client` are **dev** dependencies — the app ships neither; they only feed the build script.

- [ ] **Step 2: Write `scripts/build-geo.mjs`**

```js
/**
 * Build the map's geometry fixture.
 *
 * Natural Earth 1:50m, the same source the design handoff used, so the outlines
 * match the mockups. Run at build time and committed, not fetched at runtime:
 * the audience is on mobile data in a truck cab, and a map that needs the network
 * to draw a coastline is a map that is blank exactly when it is needed.
 *
 *   npm run build:geo
 *
 * Oman is emitted separately from its neighbours so the two can be styled
 * independently. Neighbours carry a visible border stroke — without one they read
 * as sea.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { feature } from 'topojson-client';

const OUT = resolve('src/map/geometry.json');

/**
 * The neighbours that appear inside the regional framing. Saudi Arabia is
 * included whole even though only its east shows — clipping a polygon to a bbox
 * correctly is more code than shipping the extra coordinates costs after
 * rounding.
 */
const NEIGHBOURS = new Set([
  'United Arab Emirates',
  'Saudi Arabia',
  'Yemen',
  'Qatar',
  'Bahrain',
  'Kuwait',
  'Iran',
]);

/** ~100 m at this latitude. Far finer than a 390px-wide frame can show. */
const PRECISION = 3;

function roundRing(ring) {
  const out = [];
  for (const [lng, lat] of ring) {
    const p = [Number(lng.toFixed(PRECISION)), Number(lat.toFixed(PRECISION))];
    // Rounding collapses neighbouring points onto each other; dropping the
    // duplicates is most of the size win.
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  // A ring needs to close, and rounding can open it.
  if (out.length > 2) {
    const [f, l] = [out[0], out[out.length - 1]];
    if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0], f[1]]);
  }
  return out;
}

function simplifyGeometry(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  const kept = [];
  for (const poly of polys) {
    const rings = poly.map(roundRing).filter((r) => r.length >= 4);
    // Drop islands too small to see. The first ring is the outer boundary.
    if (rings.length && rings[0].length >= 6) kept.push(rings);
  }
  return { type: 'MultiPolygon', coordinates: kept };
}

const topoPath = resolve('node_modules/world-atlas/countries-50m.json');
const topo = JSON.parse(readFileSync(topoPath, 'utf8'));
const all = feature(topo, topo.objects.countries);

const omanFeature = all.features.find((f) => f.properties.name === 'Oman');
if (!omanFeature) throw new Error('Oman not found in countries-50m — check world-atlas version');

const neighbourFeatures = all.features.filter((f) => NEIGHBOURS.has(f.properties.name));
const missing = [...NEIGHBOURS].filter(
  (n) => !neighbourFeatures.some((f) => f.properties.name === n),
);
if (missing.length) throw new Error(`neighbours not found: ${missing.join(', ')}`);

const out = {
  // Provenance in the artefact itself, so nobody has to guess where a blob
  // of coordinates came from.
  source: 'Natural Earth 1:50m via world-atlas@2 countries-50m.json',
  generatedBy: 'scripts/build-geo.mjs',
  precision: PRECISION,
  oman: {
    type: 'Feature',
    properties: { name: 'Oman' },
    geometry: simplifyGeometry(omanFeature.geometry),
  },
  neighbours: {
    type: 'FeatureCollection',
    features: neighbourFeatures.map((f) => ({
      type: 'Feature',
      properties: { name: f.properties.name },
      geometry: simplifyGeometry(f.geometry),
    })),
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));

const kb = (JSON.stringify(out).length / 1024).toFixed(0);
console.log(`wrote ${OUT} — ${kb} KB`);
if (kb > 250) {
  console.warn(`WARNING: ${kb} KB is larger than intended. Raise PRECISION rounding or drop a neighbour.`);
}
```

- [ ] **Step 3: Add the script to `package.json`**

```json
    "build:geo": "node scripts/build-geo.mjs",
```

- [ ] **Step 4: Run it and check the size**

Run: `npm run build:geo`
Expected: writes `src/map/geometry.json` and prints a size. **If it exceeds 250 KB, stop and reduce it** — drop `Iran` and `Kuwait` first (they are barely visible in the regional framing) before touching precision.

Sanity-check the output is real geometry, not empty:

```bash
node -e "const g=require('./src/map/geometry.json');console.log('oman rings',g.oman.geometry.coordinates.length,'neighbours',g.neighbours.features.length)"
```
Expected: at least 1 Oman ring and 7 neighbour features.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/build-geo.mjs src/map/geometry.json
git commit -m "Extract the map's geometry at build time

Natural Earth 1:50m, the same source the handoff used, so the outlines match
the mockups. Committed rather than fetched: a map that needs the network to
draw a coastline is blank exactly when a driver needs it.

Oman is emitted separately from its neighbours so the two can be styled
apart — without a border stroke the neighbours read as sea."
```

---

## Task 2: City coordinates — migration `0020`

**Files:**
- Create: `supabase/migrations/0020_city_coordinates.sql`, `tests/unit/city-coordinates.test.ts`
- Modify: `supabase/tests/tenant_isolation.sql`, `src/lib/queries.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `public.cities.lat`, `public.cities.lng` (`double precision`, NOT NULL after backfill). The cities query in `src/lib/queries.ts` returns them.

**Context:** the website has no coordinates — `~/truckkoo/js/main.js` populates names only — so these are **new reference data**. 13 come from the handoff verbatim; 33 come from a public gazetteer and need an eyeball on a rendered map before P3 builds the city picker on them. A coordinate can pass every check here and still be the wrong town.

- [ ] **Step 1: Write the migration**

Note the ordering: add nullable → backfill → constrain. A `not null` on a column being backfilled in the same statement fails on the first existing row.

```sql
-- 0020_city_coordinates.sql
--
-- Coordinates for the 46 reference cities, so the map can place a pin.
--
-- PROVENANCE. CLAUDE.md says reference data comes from the website — that rule
-- cannot apply here, because the website has no coordinates at all
-- (`~/truckkoo/js/main.js` populates names only). So:
--   * 13 cities are the design handoff's own values, marked `-- handoff`.
--   * 33 are from public gazetteer data (GeoNames / Natural Earth populated
--     places), marked `-- gazetteer`.
-- The gazetteer rows have NOT been confirmed by anyone who knows Oman. A
-- coordinate can sit inside the country and still be the wrong town, which no
-- constraint here can catch. See OPEN_ISSUES.md.
--
-- `double precision`, not `numeric`: these are positions, not money. The
-- three-decimal rule in CLAUDE.md is about `price_baisa` and does not apply.
--
-- No grant statement. `public.cities` carries a table-level
-- `grant select ... to authenticated` (0001), which extends to columns added
-- later. Verified against 0001 line 467 rather than assumed.

alter table public.cities add column lat double precision;
alter table public.cities add column lng double precision;

-- ── Oman ────────────────────────────────────────────────────────────────────
update public.cities set lng = 58.408, lat = 23.588 where name_en = 'Muscat';            -- handoff
update public.cities set lng = 58.563, lat = 23.617 where name_en = 'Muttrah';           -- gazetteer
update public.cities set lng = 58.180, lat = 23.670 where name_en = 'Seeb';              -- handoff
update public.cities set lng = 58.383, lat = 23.586 where name_en = 'Bawshar';           -- gazetteer
update public.cities set lng = 58.541, lat = 23.514 where name_en = 'Al Amerat';         -- gazetteer
update public.cities set lng = 58.905, lat = 23.258 where name_en = 'Qurayyat';          -- gazetteer
update public.cities set lng = 57.890, lat = 23.706 where name_en = 'Barka';             -- handoff
update public.cities set lng = 57.617, lat = 23.786 where name_en = 'Al Musanaah';       -- gazetteer
update public.cities set lng = 57.442, lat = 23.849 where name_en = 'Suwaiq';            -- gazetteer
update public.cities set lng = 57.093, lat = 23.977 where name_en = 'Al Khaburah';       -- gazetteer
update public.cities set lng = 56.888, lat = 24.172 where name_en = 'Saham';             -- gazetteer
update public.cities set lng = 56.709, lat = 24.347 where name_en = 'Sohar';             -- handoff
update public.cities set lng = 56.560, lat = 24.531 where name_en = 'Liwa';              -- gazetteer
update public.cities set lng = 56.470, lat = 24.746 where name_en = 'Shinas';            -- gazetteer
update public.cities set lng = 57.424, lat = 23.391 where name_en = 'Rustaq';            -- handoff
update public.cities set lng = 57.533, lat = 22.933 where name_en = 'Nizwa';             -- handoff
update public.cities set lng = 57.300, lat = 22.965 where name_en = 'Bahla';             -- gazetteer
update public.cities set lng = 57.983, lat = 23.305 where name_en = 'Samail';            -- gazetteer
update public.cities set lng = 58.128, lat = 23.406 where name_en = 'Bidbid';            -- gazetteer
update public.cities set lng = 57.766, lat = 22.933 where name_en = 'Izki';              -- gazetteer
update public.cities set lng = 57.528, lat = 22.379 where name_en = 'Adam';              -- gazetteer
update public.cities set lng = 56.516, lat = 23.226 where name_en = 'Ibri';              -- handoff
update public.cities set lng = 55.793, lat = 24.251 where name_en = 'Buraimi';           -- handoff
update public.cities set lng = 59.529, lat = 22.567 where name_en = 'Sur';               -- handoff
update public.cities set lng = 58.533, lat = 22.690 where name_en = 'Ibra';              -- gazetteer
update public.cities set lng = 58.083, lat = 22.583 where name_en = 'Sinaw';             -- gazetteer
update public.cities set lng = 58.128, lat = 22.573 where name_en = 'Al Mudhaibi';       -- gazetteer
update public.cities set lng = 59.203, lat = 22.163 where name_en = 'Al Kamil Wal Wafi'; -- gazetteer
update public.cities set lng = 56.283, lat = 19.958 where name_en = 'Haima';             -- gazetteer
update public.cities set lng = 57.700, lat = 19.665 where name_en = 'Duqm';              -- handoff
update public.cities set lng = 54.024, lat = 17.664 where name_en = 'Thumrait';          -- gazetteer
update public.cities set lng = 54.092, lat = 17.020 where name_en = 'Salalah';           -- handoff
update public.cities set lng = 54.402, lat = 17.037 where name_en = 'Taqah';             -- gazetteer
update public.cities set lng = 54.691, lat = 16.992 where name_en = 'Mirbat';            -- gazetteer
update public.cities set lng = 56.246, lat = 26.179 where name_en = 'Khasab';            -- handoff

-- ── U.A.E. ──────────────────────────────────────────────────────────────────
update public.cities set lng = 55.271, lat = 25.205 where name_en = 'Dubai';             -- handoff
update public.cities set lng = 55.027, lat = 25.011 where name_en = 'Jebel Ali';         -- gazetteer
update public.cities set lng = 54.366, lat = 24.453 where name_en = 'Abu Dhabi';         -- gazetteer
update public.cities set lng = 55.392, lat = 25.346 where name_en = 'Sharjah';           -- gazetteer
update public.cities set lng = 55.436, lat = 25.412 where name_en = 'Ajman';             -- gazetteer
update public.cities set lng = 55.760, lat = 24.208 where name_en = 'Al Ain';            -- gazetteer
update public.cities set lng = 55.943, lat = 25.789 where name_en = 'Ras Al Khaimah';    -- gazetteer
update public.cities set lng = 56.336, lat = 25.128 where name_en = 'Fujairah';          -- gazetteer

-- ── Saudi Arabia ────────────────────────────────────────────────────────────
-- NOTE: these three sit OUTSIDE the handoff's regional map framing
-- ([51.6,16.3]-[60.3,26.6]). Riyadh and Jeddah are far outside it. They are
-- reachable through the searchable city list, which is the complete index — the
-- map is an orientation aid, not the only way to choose a city. A shipper is
-- never blocked, per CLAUDE.md #6.
update public.cities set lng = 46.716, lat = 24.633 where name_en = 'Riyadh';            -- gazetteer
update public.cities set lng = 50.103, lat = 26.434 where name_en = 'Dammam';            -- gazetteer
update public.cities set lng = 39.197, lat = 21.486 where name_en = 'Jeddah';            -- gazetteer

-- ── constrain, only once every row is filled ────────────────────────────────
-- Fails loudly if a city was added between 0002 and here without a coordinate,
-- which is exactly the failure we want: a NULL coordinate is a pin at (0,0),
-- in the Atlantic off Ghana.
alter table public.cities alter column lat set not null;
alter table public.cities alter column lng set not null;

-- Bounds are the operating region, wide enough for Jeddah on the Red Sea
-- (39.2E) and tight enough that a TRANSPOSED lat/lng pair fails — a swapped
-- Muscat would present lat 58.4 and be rejected. That transposition is the most
-- likely error in a table of hand-entered coordinates.
alter table public.cities
  add constraint cities_lat_in_region check (lat between 16 and 27),
  add constraint cities_lng_in_region check (lng between 38 and 61);
```

- [ ] **Step 2: Apply and verify**

```bash
npx supabase migration up   # or: npx supabase db reset
docker exec -i supabase_db_truckkoo-app psql -U postgres -d postgres -c \
  "select count(*) as cities, count(lat) as with_lat, min(lat), max(lat), min(lng), max(lng) from public.cities;"
```
Expected: `cities` = `with_lat` = 46, and the min/max inside the bounds.

- [ ] **Step 3: Add the SQL assertions**

Append to `supabase/tests/tenant_isolation.sql`, in the reference-data section:

```sql
-- ── city coordinates (0020) ─────────────────────────────────────────────────
-- A NULL coordinate is a pin at (0,0) — in the Atlantic. A transposed pair is
-- a pin in Kazakhstan. Both are cheap to assert and expensive to notice by eye.
do $$
declare n int;
begin
  select count(*) into n from public.cities where lat is null or lng is null;
  if n > 0 then raise exception 'cities missing coordinates: %', n; end if;

  select count(*) into n from public.cities
   where lat not between 16 and 27 or lng not between 38 and 61;
  if n > 0 then raise exception 'cities outside the operating region: %', n; end if;

  -- Oman's own cities sit in a tighter box than the GCC as a whole. This is the
  -- assertion that would catch an Omani city given a Saudi coordinate.
  select count(*) into n from public.cities
   where country = 'OM' and (lng not between 51.9 and 60.0 or lat not between 16.6 and 26.5);
  if n > 0 then raise exception 'OM cities outside Oman: %', n; end if;
end $$;
```

- [ ] **Step 4: Mirror it as a unit test on the client fixture**

Create `tests/unit/city-coordinates.test.ts`. This guards the *client's* view — the query must actually select the columns, or the map silently gets `undefined` and every pin lands top-left.

```ts
/**
 * The client's view of city coordinates.
 *
 * The SQL test guards the data. This guards the query: if `lat`/`lng` drop out
 * of the select list, every pin quietly projects from `undefined` and lands in
 * the same corner, which looks like a projection bug for an afternoon.
 */
import { CITY_COLUMNS } from '@/lib/queries';

describe('the cities query', () => {
  it('selects the coordinates the map needs', () => {
    expect(CITY_COLUMNS).toContain('lat');
    expect(CITY_COLUMNS).toContain('lng');
  });

  it('still selects both names, so the list can localise', () => {
    expect(CITY_COLUMNS).toContain('name_en');
    expect(CITY_COLUMNS).toContain('name_ar');
  });
});
```

- [ ] **Step 5: Update the query**

In `src/lib/queries.ts`, find the cities query and hoist its column list to an exported constant so the test above can see it:

```ts
/** Exported so `tests/unit/city-coordinates.test.ts` can assert the map's columns survive. */
export const CITY_COLUMNS = 'id, name_en, name_ar, country, corridor, sort, lat, lng';
```

Use `CITY_COLUMNS` in the `.select(...)` call, and add `lat: number; lng: number` to the city row type.

- [ ] **Step 6: Verify**

Run: `npm run verify` → PASS
Run: `npm run test:db` → PASS

- [ ] **Step 7: Commit**

```bash
git add supabase src/lib/queries.ts tests/unit/city-coordinates.test.ts
git commit -m "Give the 46 cities coordinates

The website has none — it populates city names only — so unlike the rest of
the reference data these could not be regenerated from it. 13 are the
handoff's own values; 33 are gazetteer data and are marked as such, because
nobody who knows Oman has confirmed them yet.

Nullable, backfilled, then constrained: a not-null on a column being
backfilled in the same migration fails on the first existing row.

The bounds are wide enough for Jeddah on the Red Sea and tight enough that a
transposed lat/lng fails — a swapped Muscat would present lat 58.4. That
transposition is the likeliest error in a table of hand-entered coordinates,
and a NULL is a pin at (0,0) in the Atlantic.

No grant statement: cities carries a table-level select grant that extends
to new columns, verified against 0001 rather than assumed."
```

---

## Task 3: The projection

The single most load-bearing piece. Everything visual derives from it.

**Files:**
- Create: `src/map/framing.ts`, `tests/unit/framing.test.ts`

**Interfaces:**
- Consumes: `d3-geo`
- Produces:
  - `type Framing = 'domestic' | 'regional'`
  - `BBOX: Record<Framing, [[number, number], [number, number]]>`
  - `projectionFor(framing: Framing, width: number, height: number): GeoProjection`
  - `project(p: GeoProjection, lng: number, lat: number): { x: number; y: number }`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * The projection.
 *
 * Everything visible on the map derives from this one function — pins, corridor
 * endpoints, the truck marker, the coastlines. If two of those used different
 * projections, a pin would sit in the sea beside its own coastline and the bug
 * would look like bad geometry rather than bad wiring.
 */
import { BBOX, project, projectionFor } from '@/map/framing';

const MUSCAT = { lng: 58.408, lat: 23.588 };
const BARKA = { lng: 57.89, lat: 23.706 };
const SALALAH = { lng: 54.092, lat: 17.02 };

describe('projectionFor', () => {
  it('places a domestic city inside the domestic viewport', () => {
    const p = projectionFor('domestic', 390, 470);
    const { x, y } = project(p, MUSCAT.lng, MUSCAT.lat);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(390);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(470);
  });

  it('is deterministic — the same input always lands on the same pixel', () => {
    const a = project(projectionFor('domestic', 390, 470), MUSCAT.lng, MUSCAT.lat);
    const b = project(projectionFor('domestic', 390, 470), MUSCAT.lng, MUSCAT.lat);
    expect(a).toEqual(b);
  });

  it('puts west of Muscat to the left of Muscat, in both framings', () => {
    // Barka is west of Muscat. If this inverts, the projection is mirrored and
    // every corridor on every screen points the wrong way.
    for (const f of ['domestic', 'regional'] as const) {
      const p = projectionFor(f, 390, 470);
      expect(project(p, BARKA.lng, BARKA.lat).x).toBeLessThan(
        project(p, MUSCAT.lng, MUSCAT.lat).x,
      );
    }
  });

  it('puts north of Muscat above Muscat — screen y grows downward', () => {
    const p = projectionFor('regional', 390, 470);
    // Khasab (26.18) is far north of Salalah (17.02).
    expect(project(p, 56.246, 26.179).y).toBeLessThan(
      project(p, SALALAH.lng, SALALAH.lat).y,
    );
  });

  it('only the regional framing contains Salalah', () => {
    // Salalah is ~1000km south of the domestic box. It must fall outside it —
    // if the domestic framing silently contains the whole country, the "map
    // pulls back for cross-border" behaviour in S10 has nothing to pull back
    // from.
    const dom = project(projectionFor('domestic', 390, 470), SALALAH.lng, SALALAH.lat);
    expect(dom.y).toBeGreaterThan(470);

    const reg = project(projectionFor('regional', 390, 470), SALALAH.lng, SALALAH.lat);
    expect(reg.y).toBeGreaterThanOrEqual(0);
    expect(reg.y).toBeLessThanOrEqual(470);
  });

  it('scales with the viewport rather than assuming 390x470', () => {
    const small = project(projectionFor('domestic', 390, 470), MUSCAT.lng, MUSCAT.lat);
    const big = project(projectionFor('domestic', 780, 940), MUSCAT.lng, MUSCAT.lat);
    // Doubling the frame doubles the position, within rounding.
    expect(big.x).toBeCloseTo(small.x * 2, 0);
    expect(big.y).toBeCloseTo(small.y * 2, 0);
  });

  it('exposes both framings with the handoff bboxes', () => {
    expect(BBOX.domestic).toEqual([[56.2, 22.7], [59.6, 24.8]]);
    expect(BBOX.regional).toEqual([[51.6, 16.3], [60.3, 26.6]]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/framing.test.ts`
Expected: FAIL — cannot resolve `@/map/framing`.

- [ ] **Step 3: Implement**

```ts
/**
 * Map framings and the one projection.
 *
 * There are exactly two framings, both from the design handoff, and the user
 * cannot pan or zoom between them — every screen picks one. Mercator, fitted to
 * the frame, because that is what generated the handoff's own outlines and any
 * other projection would put the coastlines somewhere else.
 *
 * EVERYTHING derives from `projectionFor`: pins, corridor endpoints, the truck
 * marker and the country outlines. Two projections in one picture means a pin in
 * the sea beside its own coastline, and it reads as broken geometry rather than
 * as the wiring mistake it is.
 */

import { geoMercator, type GeoProjection } from 'd3-geo';

export type Framing = 'domestic' | 'regional';

/**
 * Bounding boxes, verbatim from the handoff.
 *
 * `domestic` is the northern Oman corridor — Muscat / Batinah / Dhakhiliyah,
 * where most trips happen. `regional` pulls back to the whole operating region
 * once a destination leaves the country (S10).
 */
export const BBOX: Record<Framing, [[number, number], [number, number]]> = {
  domestic: [
    [56.2, 22.7],
    [59.6, 24.8],
  ],
  regional: [
    [51.6, 16.3],
    [60.3, 26.6],
  ],
};

function bboxPolygon([[w, s], [e, n]]: [[number, number], [number, number]]) {
  return {
    type: 'Polygon' as const,
    coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
  };
}

/**
 * A Mercator fitted so the framing's bbox exactly fills `width` x `height`.
 *
 * `fitSize` rather than `fitExtent`: the design's maps are full-bleed and bleed
 * off every edge, so there is no padding to reserve.
 */
export function projectionFor(framing: Framing, width: number, height: number): GeoProjection {
  return geoMercator().fitSize([width, height], bboxPolygon(BBOX[framing]));
}

/**
 * Project a coordinate to screen space.
 *
 * Wrapped rather than calling the projection directly, because d3 returns
 * `[x, y] | null` and every call site would otherwise repeat the same
 * null-check. A null here means the point is unprojectable, which for lng/lat
 * inside our bounds cannot happen — so it is a programming error, not a case to
 * handle quietly.
 */
export function project(
  p: GeoProjection,
  lng: number,
  lat: number,
): { x: number; y: number } {
  const out = p([lng, lat]);
  if (!out) throw new Error(`unprojectable coordinate: ${lng},${lat}`);
  return { x: out[0], y: out[1] };
}
```

- [ ] **Step 4: Run to GREEN**

Run: `npx jest tests/unit/framing.test.ts`
Expected: PASS, 7/7.

If the "only the regional framing contains Salalah" test fails, the bboxes are wrong — re-read them from the Global Constraints table. Do **not** relax that assertion: it is what proves the two framings are actually different pictures.

- [ ] **Step 5: Commit**

```bash
git add src/map/framing.ts tests/unit/framing.test.ts
git commit -m "Fit one Mercator per framing, and derive everything from it

Two framings, both from the handoff, and the user cannot pan between them —
every screen picks one. Pins, corridor, truck marker and coastlines all come
from this function, because two projections in one picture puts a pin in the
sea beside its own coastline and reads as broken geometry rather than as
crossed wiring.

The tests assert direction as well as bounds: west must land left and north
must land up. A mirrored projection would otherwise point every corridor in
the product the wrong way and still pass a bounds check."
```

---

## Task 4: The base canvas

**Files:**
- Create: `src/map/MapCanvas.tsx`, `src/map/index.ts`
- Modify: `src/theme/tokens.ts` (a `map` colour group)
- Create: `tests/components/map.test.tsx`

**Interfaces:**
- Consumes: `framing.ts`, `geometry.json`, `color`/`font` from tokens
- Produces:
  - `MapCanvas({ framing, width, height, children })` — renders sea, neighbour land, Oman land, borders, and then `children` in projected space
  - `useProjection()` — context hook so children project without being handed the projection
  - `src/map/index.ts` re-exporting the module's surface

- [ ] **Step 1: Add the map colours to the tokens**

In `src/theme/tokens.ts`, after `scrim`:

```ts
/**
 * Map layers.
 *
 * The map's only jobs are country/city orientation and carrying the corridor.
 * Everything else is suppressed — no POIs, no terrain, no water labels. These
 * live here rather than inline in `src/map/` so the map cannot drift away from
 * the rest of the palette.
 */
export const map = {
  /** Water and background. The same ink as the working ground. */
  sea: color.ink,
  omanLand: '#1A1E24',
  omanCoast: 'rgba(255,255,255,.06)',
  /** A shade under Oman, so "here" reads as distinct from "next door". */
  neighbourLand: '#14171A',
  /** Without a visible border, neighbouring land reads as sea. */
  neighbourBorder: 'rgba(247,245,242,.17)',
  countryLabel: 'rgba(247,245,242,.4)',
  cityLabelMajor: 'rgba(247,245,242,.85)',
  cityLabelMinor: 'rgba(247,245,242,.32)',
} as const;
```

- [ ] **Step 2: Write `src/map/MapCanvas.tsx`**

```tsx
/**
 * The map's base.
 *
 * Sea, neighbouring land, Oman, and the strokes that separate them — then
 * whatever the screen puts on top, in projected space.
 *
 * RTL NOTE: this file uses SVG `x`/`y` and `d` path data, which the RTL layout
 * engine does not touch, and must not. A projected x is a position on the
 * Arabian peninsula, not a reading direction — the Gulf does not move to the
 * other side of the screen in Arabic. Only the chrome *around* the map obeys
 * direction.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import Svg, { G, Path, Rect } from 'react-native-svg';
import { geoPath } from 'd3-geo';

import geometry from './geometry.json';
import { projectionFor, type Framing } from './framing';
import { map } from '@/theme/tokens';

const ProjectionContext = createContext<ReturnType<typeof projectionFor> | null>(null);

/**
 * The projection the enclosing `MapCanvas` is using.
 *
 * Children take it from context rather than as a prop so a screen cannot hand a
 * pin one projection and the canvas another.
 */
export function useProjection() {
  const p = useContext(ProjectionContext);
  if (!p) throw new Error('useProjection must be used inside a MapCanvas');
  return p;
}

export function MapCanvas({
  framing,
  width,
  height,
  children,
}: {
  framing: Framing;
  width: number;
  height: number;
  children?: ReactNode;
}) {
  const projection = useMemo(
    () => projectionFor(framing, width, height),
    [framing, width, height],
  );

  const { omanPath, neighbourPaths } = useMemo(() => {
    const toPath = geoPath(projection);
    return {
      omanPath: toPath(geometry.oman as never) ?? '',
      neighbourPaths: (geometry.neighbours.features as never[])
        .map((f) => toPath(f))
        .filter((d): d is string => !!d),
    };
  }, [projection]);

  return (
    <ProjectionContext.Provider value={projection}>
      <Svg width={width} height={height}>
        {/* The sea is a fill, not the absence of one — the map is often
            composited over a screen with a different background. */}
        <Rect x={0} y={0} width={width} height={height} fill={map.sea} />

        <G testID="map-neighbours">
          {neighbourPaths.map((d, i) => (
            <Path
              key={i}
              d={d}
              fill={map.neighbourLand}
              stroke={map.neighbourBorder}
              strokeWidth={0.9}
            />
          ))}
        </G>

        <Path
          testID="map-oman"
          d={omanPath}
          fill={map.omanLand}
          stroke={map.omanCoast}
          strokeWidth={1}
        />

        {children}
      </Svg>
    </ProjectionContext.Provider>
  );
}
```

- [ ] **Step 3: Write `src/map/index.ts`**

```ts
/**
 * The map module's public surface.
 *
 * Nothing outside `src/map/` computes a projection or draws a coastline. Screens
 * import from here.
 */
export { MapCanvas, useProjection } from './MapCanvas';
export { BBOX, project, projectionFor, type Framing } from './framing';
```

- [ ] **Step 4: Write the test**

```tsx
/**
 * The map's base layers.
 *
 * Oman and its neighbours must be separately styled — the handoff is explicit
 * that neighbouring land without a border stroke reads as sea, which turns a map
 * of a region into a map of an island.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MapCanvas } from '@/map';
import { map } from '@/theme/tokens';

describe('MapCanvas', () => {
  it('renders Oman and the neighbours as separate layers', async () => {
    await render(<MapCanvas framing="regional" width={390} height={470} />);
    expect(screen.getByTestId('map-oman')).toBeTruthy();
    expect(screen.getByTestId('map-neighbours')).toBeTruthy();
  });

  it('draws Oman with real path data, not an empty string', async () => {
    // geoPath returns null for empty geometry, and an empty `d` renders nothing
    // at all — which looks like a styling problem rather than a missing fixture.
    await render(<MapCanvas framing="domestic" width={390} height={470} />);
    const d = screen.getByTestId('map-oman').props.d as string;
    expect(typeof d).toBe('string');
    expect(d.length).toBeGreaterThan(100);
  });

  it('gives the neighbours a visible border, or they read as sea', async () => {
    await render(<MapCanvas framing="regional" width={390} height={470} />);
    const group = screen.getByTestId('map-neighbours');
    const first = group.children[0] as { props: Record<string, unknown> };
    expect(first.props.stroke).toBe(map.neighbourBorder);
    expect(Number(first.props.strokeWidth)).toBeGreaterThan(0);
  });

  it('styles Oman and its neighbours differently', async () => {
    await render(<MapCanvas framing="regional" width={390} height={470} />);
    const oman = screen.getByTestId('map-oman').props.fill;
    const group = screen.getByTestId('map-neighbours');
    const neighbour = (group.children[0] as { props: Record<string, unknown> }).props.fill;
    expect(oman).not.toBe(neighbour);
  });
});
```

- [ ] **Step 5: Run**

Run: `npx jest tests/components/map.test.tsx tests/unit/framing.test.ts`
Expected: PASS.

If `react-native-svg` components are not queryable by `testID` in this environment, put the `testID` on the `G`/`Path` as shown and query with `UNSAFE_getByType` only as a last resort — prefer adjusting the query over weakening the assertion.

- [ ] **Step 6: Commit**

```bash
git add src/map src/theme/tokens.ts tests/components/map.test.tsx
git commit -m "Draw the map's base, and hand children the projection by context

Children take the projection from context rather than as a prop, so a screen
cannot hand a pin one projection and the canvas another — the failure that
puts a city in the sea next to its own coastline.

The neighbours get a border stroke because without one they render as sea,
which turns a map of a region into a map of an island. The test asserts the
stroke exists and that the two landmasses are filled differently.

SVG coordinates deliberately do not use logical properties: a projected x is
a position on the peninsula, not a reading direction, and the Gulf does not
move to the other side of the screen in Arabic."
```

---

## Task 5: Corridor, pins, truck, scrim

**Files:**
- Create: `src/map/Corridor.tsx`, `src/map/CityPin.tsx`, `src/map/TruckMarker.tsx`, `src/map/Scrim.tsx`
- Modify: `src/map/index.ts`, `tests/components/map.test.tsx`

**Interfaces:**
- Consumes: `useProjection`, `project`, tokens
- Produces:
  - `Corridor({ from, to, committed })` — `from`/`to` are `{ lng, lat }`
  - `CityPin({ at, state, label?, onPress? })` — `state: 'idle' | 'selected' | 'origin' | 'destination'`
  - `TruckMarker({ at })`
  - `Scrim({ variant, width, height })` — `variant: 'topHeavy' | 'hero' | 'band'`

**The two distinctions that carry meaning** — both get tests, because both are the kind of thing a later refactor tidies away:
- **dashed = uncommitted, solid = committed** (`Corridor`)
- **origin is a ring, destination is a filled square** (`CityPin`) — the same rule `RouteRail` enforces in P0, now on the map

- [ ] **Step 1: Write the failing tests**

Append to `tests/components/map.test.tsx`:

```tsx
import { Corridor, CityPin } from '@/map';
import { color } from '@/theme/tokens';

const MUSCAT = { lng: 58.408, lat: 23.588 };
const BARKA = { lng: 57.89, lat: 23.706 };

/**
 * Dashed means "not yet committed" (T1, still searching) and solid means
 * "committed" (T3 onward). The handoff says this distinction carries meaning, so
 * it is asserted rather than trusted — a refactor that unifies the two styles
 * would silently tell every waiting shipper their truck was booked.
 */
describe('Corridor', () => {
  it('is dashed while uncommitted', async () => {
    await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <Corridor from={MUSCAT} to={BARKA} committed={false} />
      </MapCanvas>,
    );
    expect(screen.getByTestId('corridor-stroke').props.strokeDasharray).toBeTruthy();
  });

  it('is solid once committed', async () => {
    await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <Corridor from={MUSCAT} to={BARKA} committed />
      </MapCanvas>,
    );
    const dash = screen.getByTestId('corridor-stroke').props.strokeDasharray;
    expect(dash == null || dash === '').toBe(true);
  });

  it('draws a casing under the stroke, so the line reads over land', async () => {
    await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <Corridor from={MUSCAT} to={BARKA} committed />
      </MapCanvas>,
    );
    const casing = screen.getByTestId('corridor-casing');
    const stroke = screen.getByTestId('corridor-stroke');
    expect(Number(casing.props.strokeWidth)).toBeGreaterThan(Number(stroke.props.strokeWidth));
  });
});

/**
 * Origin is a ring, destination is a filled square. Identical to the rule
 * RouteRail enforces in the sheet — the map and the sheet must agree, or the
 * user learns one vocabulary and then reads the other.
 */
describe('CityPin', () => {
  it('draws a committed origin as a ring — stroked, unfilled', async () => {
    await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <CityPin at={MUSCAT} state="origin" />
      </MapCanvas>,
    );
    const pin = screen.getByTestId('pin-origin');
    expect(Number(pin.props.strokeWidth)).toBeGreaterThan(0);
    expect(pin.props.fill == null || pin.props.fill === 'none').toBe(true);
  });

  it('draws a committed destination as a filled accent square', async () => {
    await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <CityPin at={BARKA} state="destination" />
      </MapCanvas>,
    );
    const pin = screen.getByTestId('pin-destination');
    expect(pin.props.fill).toBe(color.accent);
    // A Rect, not a Circle — the shape is the distinction.
    expect(pin.props.width).toBeTruthy();
  });

  it('makes an idle pin smaller than a selected one', async () => {
    // Selection has to be visible at a glance in sunlight, at arm's length.
    const idle = await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <CityPin at={MUSCAT} state="idle" />
      </MapCanvas>,
    );
    const r1 = Number(screen.getByTestId('pin-dot').props.r);
    idle.unmount();

    await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <CityPin at={MUSCAT} state="selected" />
      </MapCanvas>,
    );
    expect(Number(screen.getByTestId('pin-selected').props.r)).toBeGreaterThan(r1);
  });

  it('is tappable, and announces the city it selects', async () => {
    const onPress = jest.fn();
    await render(
      <MapCanvas framing="domestic" width={390} height={470}>
        <CityPin at={MUSCAT} state="idle" label="Muscat" onPress={onPress} />
      </MapCanvas>,
    );
    // S3's helper text promises "Tap a city on the map" — so a pin is a control,
    // not decoration, and must reach assistive tech as one.
    await fireEvent.press(screen.getByLabelText('Muscat'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

Add `fireEvent` to the test file's import from `@testing-library/react-native`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/components/map.test.tsx`
Expected: FAIL — `Corridor` / `CityPin` not exported.

- [ ] **Step 3: Implement `Corridor.tsx`**

```tsx
/**
 * The origin → destination line.
 *
 * DASHED MEANS UNCOMMITTED, SOLID MEANS COMMITTED. That is not styling: while a
 * load is still being matched (T1) the corridor is a proposal, and once a driver
 * has taken it (T3 onward) it is a fact. Unifying the two styles would tell every
 * waiting shipper their truck was booked. `tests/components/map.test.tsx` guards it.
 *
 * A casing under the stroke keeps the line legible where it crosses land — the
 * same trick a road map uses, and the reason the casing is wider than the stroke.
 */

import { G, Path } from 'react-native-svg';

import { project } from './framing';
import { useProjection } from './MapCanvas';
import { color } from '@/theme/tokens';

type Point = { lng: number; lat: number };

export function Corridor({
  from,
  to,
  committed = false,
}: {
  from: Point;
  to: Point;
  committed?: boolean;
}) {
  const projection = useProjection();
  const a = project(projection, from.lng, from.lat);
  const b = project(projection, to.lng, to.lat);

  // A straight line, deliberately. We have no road geometry and inventing a
  // curve would imply a route we do not know.
  const d = `M${a.x},${a.y} L${b.x},${b.y}`;

  return (
    <G>
      <Path
        testID="corridor-casing"
        d={d}
        stroke={committed ? 'rgba(241,85,31,.22)' : 'rgba(241,85,31,.12)'}
        strokeWidth={committed ? 11 : 7}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        testID="corridor-stroke"
        d={d}
        stroke={committed ? color.accent : 'rgba(241,85,31,.45)'}
        strokeWidth={committed ? 3.6 : 2.6}
        strokeLinecap="round"
        strokeDasharray={committed ? undefined : '7 7'}
        fill="none"
      />
    </G>
  );
}
```

- [ ] **Step 4: Implement `CityPin.tsx`**

```tsx
/**
 * A city on the map.
 *
 * Four states, and two of them carry the same meaning the route rail carries in
 * the sheet: ORIGIN IS A RING, DESTINATION IS A FILLED SQUARE. The map and the
 * sheet must agree, or the user learns one vocabulary and then has to read
 * another.
 *
 * A pin is a control, not decoration — S3's helper text promises "tap a city on
 * the map" — so it carries a role and a label.
 */

import { Circle, G, Rect } from 'react-native-svg';

import { project } from './framing';
import { useProjection } from './MapCanvas';
import { color } from '@/theme/tokens';

type Point = { lng: number; lat: number };
export type PinState = 'idle' | 'selected' | 'origin' | 'destination';

export function CityPin({
  at,
  state,
  label,
  onPress,
}: {
  at: Point;
  state: PinState;
  label?: string;
  onPress?: () => void;
}) {
  const projection = useProjection();
  const { x, y } = project(projection, at.lng, at.lat);

  const common = onPress
    ? {
        onPress,
        accessibilityRole: 'button' as const,
        accessibilityLabel: label,
      }
    : { accessibilityLabel: label };

  if (state === 'origin') {
    // A ring: stroked, unfilled. Deliberately no `fill` prop at all rather than
    // fill="none", so the test's "unfilled" assertion cannot be satisfied by a
    // colour that happens to match the sea.
    return (
      <G {...common}>
        <Circle
          testID="pin-origin"
          cx={x}
          cy={y}
          r={8}
          stroke={color.lightText}
          strokeWidth={2.5}
        />
      </G>
    );
  }

  if (state === 'destination') {
    const s = 13;
    return (
      <G {...common}>
        <Rect
          testID="pin-destination"
          x={x - s / 2}
          y={y - s / 2}
          width={s}
          height={s}
          rx={2.5}
          fill={color.accent}
          stroke={color.ink}
          strokeWidth={2.5}
        />
      </G>
    );
  }

  if (state === 'selected') {
    return (
      <G {...common}>
        <Circle cx={x} cy={y} r={12} fill="rgba(241,85,31,.14)" />
        <Circle testID="pin-selected" cx={x} cy={y} r={4.5} fill={color.accent} />
      </G>
    );
  }

  return (
    <G {...common}>
      {/* An unselected city is a 4px dot. Small on purpose — 46 of these must
          not compete with the corridor. The tap target is widened by the
          invisible circle beneath it, because a 4px dot is not tappable. */}
      <Circle cx={x} cy={y} r={14} fill="transparent" />
      <Circle testID="pin-dot" cx={x} cy={y} r={2} fill="rgba(247,245,242,.42)" />
    </G>
  );
}
```

- [ ] **Step 5: Implement `TruckMarker.tsx`**

```tsx
/**
 * The vehicle, in transit (T4, D7).
 *
 * A disc with an ink outline so it stays visible over the corridor it sits on,
 * plus a halo that reads as "live" without animating — animation on a cheap
 * Android phone costs frames that the map already wants.
 *
 * Position interpolation between fixes belongs to the caller: this component
 * draws where it is told. P6 owns the movement.
 */

import { Circle, G } from 'react-native-svg';

import { project } from './framing';
import { useProjection } from './MapCanvas';
import { color } from '@/theme/tokens';

export function TruckMarker({ at }: { at: { lng: number; lat: number } }) {
  const projection = useProjection();
  const { x, y } = project(projection, at.lng, at.lat);
  return (
    <G testID="truck-marker">
      <Circle cx={x} cy={y} r={9.5} fill="rgba(241,85,31,.16)" />
      <Circle cx={x} cy={y} r={6.5} fill={color.accent} stroke={color.ink} strokeWidth={2.5} />
    </G>
  );
}
```

- [ ] **Step 6: Implement `Scrim.tsx`**

```tsx
/**
 * The gradient that keeps type legible over map geometry.
 *
 * An SVG gradient rather than `expo-linear-gradient`: the map is already an
 * `Svg` tree, and adding a native gradient view would mean compositing two
 * different rendering systems for one rectangle.
 *
 * Which variant depends on how much map is showing — see `scrim` in the tokens.
 */

import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { scrim } from '@/theme/tokens';

export function Scrim({
  variant,
  width,
  height,
}: {
  variant: keyof typeof scrim;
  width: number;
  height: number;
}) {
  const { colors, locations } = scrim[variant];
  const id = `scrim-${variant}`;
  return (
    <Svg
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0 }}
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          {colors.map((c, i) => (
            <Stop key={i} offset={locations[i]} stopColor={c} />
          ))}
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}
```

Note `pointerEvents="none"` — a scrim sits over tappable pins and must not eat their taps. That is a functional requirement, not styling.

- [ ] **Step 7: Extend `src/map/index.ts`**

```ts
export { Corridor } from './Corridor';
export { CityPin, type PinState } from './CityPin';
export { TruckMarker } from './TruckMarker';
export { Scrim } from './Scrim';
```

- [ ] **Step 8: Run to GREEN**

Run: `npx jest tests/components/map.test.tsx tests/unit/framing.test.ts`
Expected: PASS.

Then verify the two meaning-carrying assertions actually bite: temporarily make `Corridor` always solid and confirm the dashed test fails; temporarily make `CityPin`'s destination a `Circle` and confirm that test fails. Restore both and record the evidence in the commit message or the report.

- [ ] **Step 9: Commit**

```bash
git add src/map tests/components/map.test.tsx
git commit -m "Add the corridor, pins, truck marker and scrim

Two distinctions here carry meaning rather than style, and both are asserted
because both are what a tidy-up removes:

Dashed means the corridor is a proposal (T1, still matching) and solid means
a driver has taken it (T3 on). Unifying them would tell every waiting shipper
their truck was booked.

Origin is a ring and destination is a filled square — the same vocabulary
RouteRail uses in the sheet. If the map and the sheet disagree, the user
learns one and then has to read the other.

The corridor is a straight line on purpose: we have no road geometry, and a
curve would imply a route we do not know. The scrim is pointerEvents=none,
because it sits over tappable pins."
```

---

## Task 6: A harness to look at it, and the docs

P1 builds no screen, so without this nobody can see whether any of it is right.

**Files:**
- Create: `src/app/(app)/_map-preview.tsx`
- Modify: `OPEN_ISSUES.md`, `CLAUDE.md`

- [ ] **Step 1: Write the preview screen**

Create `src/app/(app)/_map-preview.tsx` — a developer harness, not a product screen. The leading underscore keeps it out of the tab layouts; it is reached only by typing the route.

It must render, stacked vertically with a label above each:
1. `domestic` framing, Muscat → Barka, `committed` — should match S4's mockup.
2. `regional` framing, Muscat → Dubai, uncommitted — should match S10's.
3. `domestic` with all 46 cities as `idle` pins, to eyeball for pins in the sea.
4. `regional` with a `TruckMarker` partway along Muscat → Barka, plus a `topHeavy` scrim.

Pull the cities from the existing cities query so it exercises the real data path, not a fixture. Label each block with the framing and route so a screenshot is self-describing.

- [ ] **Step 2: Look at it**

```bash
npx expo start -c
```

Open `/_map-preview`. Check, specifically:
- No pin sits in the sea. **This is the check the whole coordinate risk rests on** — a bounds constraint cannot catch a city placed in the wrong town, but your eye can.
- Oman is distinguishable from its neighbours, and the neighbours are distinguishable from the sea.
- The corridor's dashed and solid forms are obviously different at arm's length.
- Origin ring and destination square are tellable apart without looking twice.

Record what you find. If a coordinate is wrong, fix it in a **new** migration — `0020` is applied and migrations are append-only.

- [ ] **Step 3: Update `OPEN_ISSUES.md`**

Under `## The redesign (2026-07-30)`:

```markdown
### 33 of the 46 city coordinates are gazetteer data, unconfirmed by anyone

`0020` gives every city a lat/lng. Thirteen are the design handoff's own values;
the other 33 are from public gazetteer data and are marked `-- gazetteer` in the
migration. The constraints catch a NULL, an out-of-region value and a transposed
pair — **they cannot catch a coordinate that is inside Oman but is the wrong
town.** Nothing has verified those 33 against local knowledge.

Riyadh, Dammam and Jeddah sit outside the handoff's regional map framing
entirely (Jeddah is on the Red Sea). They are reachable through the searchable
city list, which is the complete index; the map is an orientation aid. A shipper
is not blocked.

**Done when:** someone who knows Oman has looked at `/_map-preview` and confirmed
the pins, and any correction has landed as a new migration.

### The map has not been seen on a device

Projection, layers, corridor and pins are unit-tested, and `/_map-preview`
renders them, but only in a simulator or on web. SVG with 46 pins plus country
geometry is the first real vector work in this product, and the target is a cheap
Android phone.

**Done when:** `/_map-preview` has been opened on target hardware and scrolls
without dropping frames.
```

- [ ] **Step 4: Note the module boundary in `CLAUDE.md`**

Add to the Design section:

```markdown
**The map is `src/map/`, and nothing outside it computes a projection or draws a
coastline.** There are no tiles and no native map library: the region is bundled
Natural Earth geometry (`scripts/build-geo.mjs` → `src/map/geometry.json`),
projected by one `d3-geo` Mercator fitted to one of two fixed framings, drawn with
`react-native-svg`. The user cannot pan or zoom — the handoff never shows it, and
every screen picks a framing. Children take the projection from context, so a pin
and its coastline cannot disagree.

Two map distinctions carry meaning: **dashed corridor = uncommitted, solid =
committed**, and **origin is a ring, destination is a filled square** (matching
`RouteRail`). `tests/components/map.test.tsx` guards both.

SVG coordinates are the one place logical properties do **not** apply: a projected
x is a position on the peninsula, not a reading direction.
```

- [ ] **Step 5: Verify and commit**

Run: `npm run verify` → PASS
Run: `npm run test:db` → PASS

```bash
git add -A
git commit -m "Add a map preview harness, and record what it cannot prove

P1 builds no screen, so without a harness nobody can see whether any of this
is right. /_map-preview renders both framings, all 46 pins, the committed and
uncommitted corridor, and the truck marker, using the real cities query.

The pins are the point: a bounds constraint catches a NULL or a transposed
pair, but it cannot catch a coordinate that sits inside Oman and is the wrong
town. Only someone who knows Oman can, and OPEN_ISSUES now says so."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3.1 migration `0020`, bounds, no grant change | 2 |
| §3.2 build-time geometry extract | 1 |
| §3.3 `framing.ts` | 3 |
| §3.3 `MapCanvas`, map tokens | 4 |
| §3.3 `Corridor`, `CityPin`, `TruckMarker`, `Scrim` | 5 |
| §4 all five test groups | 2 (coords), 3 (projection), 4 (canvas), 5 (corridor + pin) |
| §6 harness, docs, OPEN_ISSUES | 6 |

**Corrections made to the spec while planning:**

1. **The spec's bounds constraint was wrong.** It proposed `lng between 51 and 61`, which rejects **Jeddah (39.2°E) and Riyadh (46.7°E)** — both real rows in `0002`. Widened to `38..61`, and a *second*, tighter check added for `country = 'OM'` so the loose global bound does not let an Omani city take a Saudi coordinate.
2. **The spec said 46 cities and did not say the Saudi three fall outside the map framing.** They do. Recorded in the migration and in `OPEN_ISSUES` — they stay reachable through the city list, so no shipper is blocked.
3. The spec listed a `map.test.tsx` assertion for country labels; those are deferred to P3, where a screen actually places them. Not planned here, and not silently dropped.

**Placeholder scan:** no TBDs. Every code step carries real code. Task 6 Step 1 is described rather than fully listed because it is a throwaway harness whose exact composition does not matter — its four required cases are enumerated.

**Type consistency:** `Framing` is defined in Task 3 and consumed in Tasks 4–6. `project(p, lng, lat)` returns `{x, y}` at every call site. `useProjection()` is produced in Task 4 and consumed by all of Task 5. `Point = { lng, lat }` is the shape passed to `Corridor`, `CityPin` and `TruckMarker` alike. `scrim` keys (`topHeavy`/`hero`/`band`) match the P0 token names exactly.
