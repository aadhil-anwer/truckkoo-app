# P3 · Shipper booking — Implementation Plan

**Goal:** A shipper answers six questions and posts a load, on the redesigned
system, with an honest estimate.

**Architecture:** A persisted draft in AsyncStorage drives a six-step stack under
`src/app/(app)/book/`. Ink steps (S3, S4/S10) put P1's `MapCanvas` behind a
`Sheet`; cream steps (S5–S8) are P0's question pattern. S9 reads a new SQL-only
`estimate_route` RPC and calls the existing `post_load`.

## Global Constraints

- **`truck_type_code` stays NULLABLE.** "Let us choose" posts NULL. Never guess a code.
- **Weight is optional.** Skip posts NULL and must not block.
- **Money is integer baisa**, three decimals, via `src/lib/money.ts`.
- **No payment surfaces.** Showing a price is fine; taking one is not.
- **Never fabricate proof** — no invented counts, ratings or trip histories.
- **A shipper never hits a dead end.** No rate card → the human path, not an error.
- **RTL structural**: logical properties, `align.start`, `t()` for every string,
  `formatNumber`/`localizeDigits` for every numeral. SVG geometry is exempt.
- **Every tap target ≥44.** Body floor 12.5px. One accent per screen.
- **Migrations append-only**; `0021` is next. Definer functions pin
  `search_path = ''` and **fully qualify types**.
- `npm run verify` green each task; `npm run test:db` for SQL tasks.

---

## P3a — the flow

### Task 1 · The draft
`src/lib/booking.ts` — the draft shape, an AsyncStorage-backed hook, and the
`t()`-safe city helpers. Cleared on successful post.
Tests: survives a reload; back-navigation preserves answers; clearing works.

### Task 2 · `estimate_route` (migration 0021)
SQL-only. Reuses `private.compute_price`; band from `private.app_settings`.
Returns `outcome` + nullable prices + `distance_km`.
**Build and test the empty-card path first** — it is today's default.
Tests in `supabase/tests/pricing.sql`: empty card → `no_rate`; NULL truck →
`advise_me`; no new client grant.

### Task 3 · Distance
`src/map/distance.ts` — great-circle from `cities.lat/lng` × a single documented
road factor, formatted "about N km". One source, no call-site arithmetic.
Tests: a known pair is plausible; the factor is applied once.

### Task 4 · S3 pickup city
Map + sheet, searchable 46-city list grouped by governorate, Arabic name beneath
English, tappable pins, selected row treatment, primary restates the choice.

### Task 5 · S4 / S10 destination
Same shell; corridor draws; country segmented control switches framing between
domestic and regional; distance caption; swap button; recent-destination chips
from real history, hidden when empty.

### Task 6 · S5–S8 (cream questions)
Date (named rows, not a grid), cargo (free text + chips), truck size (**"Let us
choose" first and preselected**), weight (**genuinely skippable**).

### Task 7 · S9 review + post
Summary card, estimate card with the graceful no-rate path, pinned footer,
"Change something" returns to review. Calls `post_load`. Clears the draft.

### Task 8 · Entry + docs
Route the existing home's CTA into the flow. Update `OPEN_ISSUES.md` and
`CLAUDE.md`.

---

## P3b — the home

### Task 9 · S2 first run, then S1 live load
Replaces `(tabs)/customer.tsx`. Map top, scrim, greeting, orange search entry,
`ON THE MOVE` section, live load card, repeat-load row.

---

## Self-review

The spec's §6 test table maps onto Tasks 1 (draft), 2 (estimate), 3 (distance),
6 (NULL truck, weight skip), 7 (step counter, review return), 5 (off-frame city).
Nothing in the spec is unplanned. P4 owns everything after posting.
