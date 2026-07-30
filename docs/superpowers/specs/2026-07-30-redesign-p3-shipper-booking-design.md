# Truckkoo redesign — P3 · Shipper booking

**Date:** 2026-07-30
**Status:** awaiting approval
**Depends on:** P0 (complete), P1 (complete). **Not** P2 — this phase runs on the
existing Google/email session.
**Screens:** S1–S10

---

## 1. What P3 is for

This is the phase where the redesign stops being infrastructure. P0 built a
vocabulary and P1 built a map, and neither changed anything a user can see. P3
turns both into the thing the product is actually for: a shipper says where cargo
is and where it needs to be, and gets a price.

**Ten screens, so it splits in two**, built and reviewed in order:

- **P3a — the flow.** S3–S8 (the six questions), S9 (review), S10 (the
  cross-border variant of S4). Reachable from the *existing* home screen, so it
  is usable before the home is rebuilt.
- **P3b — the home.** S1 (live load) and S2 (first run), replacing
  `(tabs)/customer.tsx`.

Splitting this way means the flow is testable end-to-end before the entry point
changes, and a failure in one does not block the other.

---

## 2. Decisions taken

| # | Decision | Why |
|---|---|---|
| B1 | **"From the last 40 trips here" is cut.** | `CLAUDE.md` non-negotiable #5: never fabricate proof. There have been no trips. The rest of that sentence — "A person confirms the exact number, usually within 10 minutes" — is a real commitment the website already makes, and it stays. If a corridor's real completed-trip count is ever worth showing, it can be computed then. |
| B2 | **`estimate_route` (0021) adds only the RANGE.** | *Corrected while building:* `public.quote_route(origin, dest, truck, weight)` already existed and prices a route without a load, so the spec's "new RPC" was half wrong. What was actually missing is the band — and that had to go in SQL, not the client, because a band is part of how a price is presented and `CLAUDE.md` 3b keeps that out of the bundle. `estimate_route` delegates to `private.price_for`, the same function `quote_route` and `quote_load` use, so there is still exactly one place where a route becomes a price. The band width lives in `private.app_settings`. |
| B3 | **The rate card is empty, so the estimate must degrade gracefully.** | With no rates, `estimate_route` returns an outcome rather than a number, and S9 shows "A person prices this and comes back to you, usually within 10 minutes" in place of the range. A shipper is never blocked and never sees an error (#6). This is the *expected* path today, not an edge case. |
| B4 | **Distance is great-circle × a road factor, labelled "about".** | The handoff shows "78 km · about 1 h 10". We have coordinates but no road network. Straight-line Muscat→Barka is ~55 km against ~80 km by road, so a bare great-circle figure would be visibly wrong to an operator. A documented factor with "about" in front of it is honest; a precise-looking number would not be. The factor lives in one place and is recorded in `OPEN_ISSUES.md` as an approximation to replace with a routing source. |
| B5 | **The booking draft persists across app kills.** | Six answers is a lot to lose. Stored under one key in AsyncStorage, cleared on successful post. |
| B6 | **Recent-destination chips come from the shipper's own past loads**, and the row is hidden when there are none. | Real data or nothing. A first-time shipper sees no row rather than invented suggestions. |
| B7 | **S10 is not a separate screen.** It is S4 with the regional framing and a country control. | The handoff draws them separately because a gallery cannot show state. One screen with two framings is the same picture and one code path. |
| B8 | **Cities outside the map framing stay selectable.** | Riyadh and Jeddah cannot be pins (P1). The searchable list is the complete index; when a chosen city is off-frame the map keeps the last valid framing and the sheet carries the selection. No dead map beside a live choice. |

---

## 3. The flow

Six questions, then review. Back preserves every prior answer.

| Step | Screen | Ground | Answer |
|---|---|---|---|
| 1/6 | S3 | ink + sheet | pickup city |
| 2/6 | S4 / S10 | ink + sheet | destination city (+ country) |
| 3/6 | S5 | cream | collection date |
| 4/6 | S6 | cream | cargo description |
| 5/6 | S7 | cream | truck size — **"Let us choose" is first and preselected** |
| 6/6 | S8 | cream | weight, **genuinely optional** |
| — | S9 | ink | review, estimate, post |

**Two of these carry a non-negotiable.** S7's default is `auto`, which posts
`truck_type_code = NULL` — the "Not sure, advise me" affordance that
`CLAUDE.md` #1 exists to protect. S8's skip is a real path that does not block
pricing. Neither may be quietly tightened into a required field.

S9's "Change something" returns to the relevant step and then comes **back to
review**, rather than walking forward through the remaining questions.

---

## 4. Backend

One migration, `0021`.

```
estimate_route(p_origin_city, p_dest_city, p_truck_type_code, p_weight_kg)
  → (low_baisa, high_baisa, currency, outcome)
```

`distance_km` is **not** returned: it is computed client-side from
`cities.lat/lng` (B4), because it is geometry rather than pricing and putting it
here would mean a round-trip for a number the app already has.

- `security definer`, `search_path = ''`, **types fully qualified** — the
  `advance_trip` lesson: an unqualified `'delivered'::load_status` inside a
  definer function killed the whole delivery flow for months because nothing
  read it.
- Reads the rate card, which stays ungranted. No client grant is added to any
  table.
- Takes no `shipper_id`: it prices a *route*, not a load, and reveals nothing
  about anyone. Granted to `authenticated`.
- The band around the computed price comes from `private.app_settings`, not a
  literal, so it can be tuned without a migration.
- `outcome` mirrors `quotes.outcome`: `estimated` | `advise_me` | `no_rate` |
  `over_capacity`. Only `estimated` carries numbers.

`supabase/tests/pricing.sql` gains assertions that an empty rate card yields
`no_rate` with NULL prices, and that a NULL truck type yields `advise_me` rather
than an error.

---

## 5. Out of scope

The tracking screens (T1–T5) — that is P4. After posting, S9 hands off to the
existing load detail screen, which is transitional until then. Arabic review of
these screens is P7's audit; the strings go through `t()` here as always, but
nobody checks the mirror until then.

---

## 6. Tests

| Test | Protects |
|---|---|
| draft persistence | six answers survive an app kill and a back-navigation |
| `truck_type_code` NULL | "Let us choose" posts NULL, not a guessed code |
| weight skip | S8's skip posts NULL weight and does not block |
| step counter | 6 steps, and "Change something" returns to review |
| `estimate_route` (SQL) | empty card → `no_rate`; NULL truck → `advise_me`; no client grant added |
| distance | a known pair gives a plausible road distance, and it is labelled "about" |
| off-frame city | selecting Jeddah keeps a valid map and a live selection |

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| The estimate is the screen's headline and there is no rate card | B3 — the graceful path is the *default* path today, so it gets built and tested first, not last |
| A road factor is a guess | Labelled "about", documented, single source, recorded in `OPEN_ISSUES.md` |
| Ten screens is a lot of surface for one review | Split into P3a and P3b |
| The flow is reachable but the home is not rebuilt until P3b | Deliberate: the existing home's CTA routes into the new flow |

---

## 8. Definition of done

1. `npm run verify` and `npm run test:db` green.
2. A shipper can complete S3→S9 and post a load, on a device or simulator.
3. "Let us choose" posts NULL, and skipping weight posts NULL.
4. With an empty rate card, S9 shows the human path and no error.
5. `OPEN_ISSUES.md` records the road factor, the cut proof claim, and anything
   deferred.
