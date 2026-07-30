# Truckkoo redesign — P1 · Map

**Date:** 2026-07-30
**Status:** awaiting approval
**Depends on:** P0 (complete — `33c81bd..8296e62` on `redesign/p0-foundations`)
**Source:** `App redesign with map interface.zip` → `design_handoff_truckkoo_redesign/`

---

## 1. What P1 is for

The map is the shipper's home surface and the spine of ten of the 32 screens
(S1, S3, S4, S10, T1–T4, D2, D7). Nothing in P3–P6 can be built without it.

P1 builds the map and the reference data it needs. **It builds no screen** — the
same discipline as P0. The deliverable is a component you can point at two cities
and get the design's picture back.

---

## 2. Decisions taken

The first two reverse or refine decisions made before P0, so they are recorded
with the reasoning rather than just the outcome.

| # | Decision | Why |
|---|---|---|
| M1 | **No tile source. The region is bundled vector geometry.** | MapLibre was chosen earlier on the stated grounds of "no API key, no per-view billing" — which is true of the *library* but not of map *data*. MapLibre renders tiles; tiles come from a provider, a bill, or a self-hosted extract. Bundling the geometry instead costs a few hundred KB once and then nothing: no key, no quota, no third party seeing driver traffic, and **it works in a dead zone** — which for a truck between Ibri and Buraimi is not a hypothetical. |
| M2 | **No MapLibre. `react-native-svg` + `d3-geo`.** | With tiles gone, MapLibre's remaining value is pan/pinch and camera — and **the handoff never shows the user panning or pinching.** Every screen is a fixed framing (domestic bbox or regional bbox); T4/D7's "zoom" is a hardcoded 1.2× scale. `react-native-svg` is already installed and runs in Expo Go; `d3-geo` is pure JS and is the same projection pipeline that produced the handoff's own geometry. Accepted cost: a future pannable road map would be a rewrite, not a config change. |
| M3 | **One projection, and everything derives from it.** | Pins, corridor endpoints, the truck marker and the coastlines must all come from the same `projection(lng, lat) → [x, y]`. The handoff ships pre-baked SVG path strings for a 390×470 frame; using those *and* projecting pins separately would require reproducing the original fit exactly, and any drift puts a pin in the sea beside its own coastline. So the outlines are projected at runtime from GeoJSON by the same function as the pins. |
| M4 | **City coordinates are new reference data.** | `CLAUDE.md` says reference data comes from the website — but the website has no coordinates (`~/truckkoo/js/main.js` populates names only). The handoff supplies 13; the remaining 33 come from a public gazetteer, each row carrying its source in a comment, and get spot-checked on a rendered map before P3 relies on them. |
| M5 | **Geometry is extracted at build time, not runtime.** | A script turns Natural Earth 1:50m into a small simplified GeoJSON fixture committed under `src/map/`. `world-atlas` and `topojson-client` stay dev-only; the app ships neither. |

---

## 3. Scope

### 3.1 Reference data — migration `0020`

`public.cities` gains `lat` and `lng`.

- `double precision`, **not** `numeric`. These are coordinates, not money — there
  is no exactness requirement and no decimal-place trap. (Money stays integer
  baisa; that rule is about `price_baisa`, not geography.)
- **Nullable, then backfilled, then constrained.** A `not null` on a column
  being backfilled in the same migration fails on the first existing row.
- Bounds checks, because an unbounded coordinate column is how a pin ends up in
  the Atlantic: `lat between 16 and 27`, `lng between 51 and 61`. That box is
  Oman plus the GCC neighbours the product serves, and it is deliberately tight
  enough to reject a transposed lat/lng pair.
- **No grant change.** `cities` carries a table-level `grant select to
  authenticated` (0001 line 467), which extends to columns added later. Verified,
  not assumed.
- Every row's coordinate carries a source comment: `-- handoff` for the 13, or
  the gazetteer for the rest.

`supabase/tests/` gains an assertion that no city is NULL and every coordinate is
inside its country's box.

### 3.2 Build-time geometry

`scripts/build-geo.mjs` → `src/map/geometry.json`.

- Source: **Natural Earth 1:50m** via `world-atlas@2` (`countries-50m.json`),
  converted with `topojson-client` — the same source the handoff used, so the
  outlines match the mockups.
- Oman is a **separate feature** from the neighbouring landmass so the two can be
  styled independently. Neighbours need a visible border stroke or they read as
  sea.
- Simplified to keep the fixture small; the target is well under 150 KB.
- The script is committed and rerunnable, so the fixture is reproducible rather
  than a mystery blob.

### 3.3 The map itself

New `src/map/` module. Nothing outside it may compute a projection or draw a
coastline.

| File | Responsibility |
|---|---|
| `framing.ts` | The two bounding boxes from the handoff — domestic `[56.2, 22.7]–[59.6, 24.8]`, regional `[51.6, 16.3]–[60.3, 26.6]` — and a `projectionFor(framing, width, height)` returning a fitted `d3.geoMercator`. |
| `MapCanvas.tsx` | The base: sea, Oman land, neighbour land, coastline, neighbour borders, country labels. Takes a framing and a size; renders children in projected space. |
| `Corridor.tsx` | The origin→destination line: casing under stroke, **dashed when uncommitted and solid when committed**, with the draw-in animation. |
| `CityPin.tsx` | Pin states — unselected dot, selected accent pin with halo and label pill, committed origin ring, committed destination square. Tappable. |
| `TruckMarker.tsx` | The disc with outline, halo and glyph, interpolating between position fixes. |
| `Scrim.tsx` | The three gradient scrims, as SVG gradients — no new dependency. |

**The distinctions that carry meaning**, per the handoff, and which get tests
rather than trust: **dashed = uncommitted, solid = committed**; and **origin is a
ring, destination is a filled square** (the same rule `RouteRail` already
enforces in P0, now on the map).

Styling comes from `src/theme/tokens.ts`. The map's colour table in the handoff
(land `#1A1E24`, coastline `rgba(255,255,255,.06)`, neighbour border
`rgba(247,245,242,.17)`, the three label tiers) is added to the tokens as a
`map` group rather than inlined in components.

### 3.4 Out of scope

Every screen. Pan and pinch. Roads. The "Sand" and "Deep" alternate map tones
from the handoff — one ground, and a second is a decision nobody has asked for.

---

## 4. Tests

| Test | What it protects |
|---|---|
| `projection` | A known city projects inside the viewport, and the same lng/lat always lands on the same pixel. Muscat must not drift when the frame resizes. |
| `city coordinates` (SQL + unit) | No NULL, everything inside its country's box. **This is the sea-pin guard** and it catches a transposed lat/lng, which is the single most likely data error here. |
| `Corridor` | Dashed when uncommitted, solid when committed — asserted, because it is meaning, not decoration. |
| `CityPin` | The four states are visually distinct, and origin ≠ destination in shape. |
| `MapCanvas` | Oman and the neighbour landmass render as separately styled layers, and the neighbour border is present — without it they read as sea. |

`npm run verify` must pass. `npm run test:db` gains the coordinate assertions and
must pass with `npx supabase start` running.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| **33 coordinates come from a gazetteer, not the operator.** A wrong one puts a shipper's pin in the wrong town. | Bounds constraint, SQL assertion, per-row source comment, and an explicit spot-check on a rendered map before P3 depends on them. Listed in `OPEN_ISSUES.md` until that happens. |
| Simplified 1:50m outlines will not match a satellite view | Accepted and intended — the handoff's mockups are 1:50m. The map's job is orientation, not survey. |
| No roads, so "78 km · about 1 h 10" cannot be derived from the map | Already true: distance and duration come from the server, not the client. P1 changes nothing here. |
| SVG performance on a cheap Android phone with 46 pins plus geometry | Measure it. The geometry is a handful of paths and the pins are small circles, but this is the first thing in the product that draws real vector work, and the target hardware is the weakest link. |
| Choosing SVG forecloses a pannable road map | Accepted (M2). Revisit only if the product actually needs browsing, which the design does not. |

---

## 6. Definition of done

1. `npm run verify` green; `npm run test:db` green.
2. A dev harness renders the domestic framing with Muscat→Barka committed and the
   regional framing with Muscat→Dubai, both matching the handoff's mockups.
3. All 46 cities have coordinates inside their bounds, each with a source note.
4. No screen from the 32 has been built.
5. `OPEN_ISSUES.md` records the coordinate provenance and that the map has not
   been seen on a device.
