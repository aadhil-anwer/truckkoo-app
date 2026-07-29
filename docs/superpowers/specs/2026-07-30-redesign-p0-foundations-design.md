# Truckkoo redesign — P0 · Foundations

**Date:** 2026-07-30
**Status:** approved, ready for planning
**Source:** `App redesign with map interface.zip` → `design_handoff_truckkoo_redesign/`

---

## 1. Context

A design handoff produced by Claude Design specifies a full redesign of the
Truckkoo app: 32 screens across five flows, at pixel fidelity, with final
colours, type, spacing, radii, shadows and copy.

The handoff is a *design gallery* — static HTML in phone frames. It is not
runnable code and nothing is copied from it verbatim. What transfers is the
specification: every colour, type spec, spacing value, corner radius, copy
string and layout relationship. What does not transfer: inline styles, the phone
frame chrome, the `.dc.html` format, and the hand-drawn SVG maps.

The redesign is larger than a restyle. Four items in it are new product rather
than new appearance:

| Handoff requires | Current state | Gap |
|---|---|---|
| Phone + 4-digit OTP sign-in | email + password | SMS provider, new auth path |
| Real map, tappable city pins | no map; `cities` has no lat/lng | map layer, migration, 46 coordinates |
| Live truck position and ETA | `trips` carries status only | position table, driver GPS reporting |
| Shipper accepts price, then driver assigned | driver accepts offer, creating the trip | state-machine reorder, `accept_quote` RPC |

This document specifies **P0 only**. The full decomposition is recorded in §3 so
later phases inherit the decisions made here.

---

## 2. Decisions taken

These were decided explicitly and bind every later phase.

| # | Decision | Rationale |
|---|---|---|
| D1 | **Real SMS OTP.** An SMS provider will be configured in Supabase Auth. | The handoff's premise is "nothing to remember, nothing to lose" for an audience with near-zero tech skills. Faking it behind email OTP keeps the friction it exists to remove. |
| D2 | **MapLibre GL** as the map layer. | No API key, no per-view billing, and a fully custom dark style — which is exactly what the handoff's token table specifies. Requires a dev build; `expo-dev-client` is already present. |
| D3 | **Real GPS tracking** in P6. | The handoff promises a live truck and an honest ETA. |
| D4 | **Real sources for every claimed number.** Ratings, trip counts and candidate-truck counts get real backing. | `CLAUDE.md` non-negotiable #5 forbids fabricated proof. The design uses `4.9 · 212 trips`, `the last 40 trips here`, `Four trucks are heading to Barka`. These become computed, not invented. |
| D5 | **Shipper accepts the price, then dispatch happens.** `post_load → matching → quoted → accepted → assigned`. The state the handoff does not draw is resolved in §4.8 as a T1 variant. | Literal match to T2 → T3. |
| D6 | **Primary button label stays ≥18.66px bold**, deviating ~2px from the handoff's `700 17px`. | White on `#F1551F` is 3.47:1. WCAG AA needs 4.5:1 for normal text and drops to 3:1 only at 18.66px bold. This exact bug shipped once; `tests/unit/contrast.test.ts` exists to catch it. This is the **only** deviation from the handoff's type scale. |
| D7 | **The ops screens are deleted from this repo.** Dispatch is web-only, at `~/truckkoo-ops`. | Removes the requirement to keep two design systems alive. Accepted consequence: nobody can dispatch from the mobile app. No server-side change — the web console calls the same guarded RPCs. |
| D8 | **Icons move from `MaterialCommunityIcons` to hand-authored SVG.** | The handoff names stroke weight (1.9–2.1) and round caps as the properties that carry consistency. A glyph font cannot vary stroke weight. `icon.tsx` keeps its semantic-name contract and RTL mirroring; only rendering changes. Adds `react-native-svg`. |
| D9 | **One spec per phase**, built and reviewed in order. | Each phase is independently verifiable. |

---

## 3. Phase decomposition

P0 and P1 are prerequisites for everything after them.

| Phase | Ships | Backend |
|---|---|---|
| **P0 · Foundations** | tokens, fonts, primitives, icons, numerals, ops deletion | none |
| P1 · Map | MapLibre + dark style, tappable pins, corridor, scrims | `cities` gains lat/lng |
| P2 · Getting in | N1–N6 | SMS provider, phone identity |
| P3 · Shipper booking | S1–S10 | estimate RPC |
| P4 · Price & track | T1–T5 | `accept_quote`, state reorder, ratings |
| P5 · Driver | D1–D7 | driver payout, detour distance |
| P6 · Live GPS | real truck position on T4/D7 | `trip_positions`, background location |
| P7 · Shared + Arabic | X1–X4, full RTL mirror audit | none |

---

## 4. P0 scope

**Purpose:** every later phase renders on top of this. Nothing user-visible
ships except the ops deletion. The payoff is that P1–P7 become assembly rather
than invention.

**Explicitly out of scope:** any screen from the 32. P0 builds the vocabulary,
not sentences.

**In scope but easy to underestimate:** rewriting the tokens breaks every
existing call site that names an old token (`color.paper`, `doc.rule`,
`stamp.*`, the old `font.*` keys). P0 must carry those call sites over to the
nearest new token so the app still compiles and runs. This is mechanical, not
design work — the screens are *expected* to look transitional until their phase
lands. The goal is a green `npm run verify`, not a finished appearance.

### 4.1 Type

Three families, all bundled with the app — never fetched at runtime. The
audience is on mobile data and a missing display face breaks every question
screen.

| Family | Weights | Role |
|---|---|---|
| Instrument Serif | 400 | Questions and hero numbers **only** |
| Archivo | 400/500/600/700/800 | Everything else, Latin |
| IBM Plex Sans Arabic | 400/500/600/700 | All Arabic |

Archivo is already installed. Instrument Serif and IBM Plex Sans Arabic are
added. **`@expo-google-fonts/almarai` is removed** — Plex Arabic replaces it.

Instrument Serif is reserved. A screen may carry **one** display statement; two
serif headlines on one screen is a bug, not a style choice.

The Arabic adjustment is encoded rather than left to discipline: Arabic sits one
weight step lighter than its Latin equivalent (600 where Latin is 700) and needs
looser leading (1.35 headings / 1.7 body versus 1.06 / 1.55). This lives in a
single `arabicize(style)` helper so no call site has to remember it.

### 4.2 Tokens

`src/theme/tokens.ts` is rewritten, not extended.

Two grounds:

- **Ink** `#0B0C0F` — the working ground. Home, tracking, offers, lists.
- **Cream** `#F4F0E9` — the asking ground. Question screens.

Carried across verbatim from the handoff: the colour table, both text alpha
ramps, the hairline ramp, the spacing scale, the radius scale, the shadow table,
and the three map scrims.

Rules that survive from the current system and stay encoded:

- **One accent.** `#F1551F` is the pinned primary action **or** the live state,
  never both on one screen.
- `#FF7A45` is accent-as-text-on-dark. `#F1551F` is never text on dark.
- `#79E0AF` (delivered) appears **once** in the entire product, on T5.
- Logical properties only — `marginStart`, `paddingEnd`, `start`/`end`. Never
  `left`/`right`.

`doc.*` and `stamp.*` are deleted with the ops screens.

### 4.3 Primitives

`primitives.tsx` and `ui.tsx` are rebuilt around what the 32 screens repeat.

| Primitive | Notes |
|---|---|
| `Sheet` | grab handle, 30px radius (32px on tracking screens) |
| `Card` | ink and cream variants |
| `RouteRail` | ring → line → filled square. **Origin and destination are visually distinct and that distinction is load-bearing.** |
| `StatusPill` | accent and neutral |
| `Chip` | selected / unselected, ink and cream |
| `SelectRow` / `SelectCard` | **signals selection three ways at once** — border, fill, filled radio. Deliberate redundancy for bright-sunlight legibility in a truck cab. Must not be reduced to one indicator. |
| `ProgressBar` | fill originates at the **leading** edge, so it flips under RTL |
| `BackButton` | chevron direction flips under RTL |
| `QuestionHeading` | Instrument Serif |
| `SectionLabel` | uppercase, tracked |
| `FloatingTabBar` | pill, absolutely positioned, badge support |
| `Timeline` | complete / active / future states |
| `Skeleton` | skeletons, never spinners, for list and card loads |

Press and disabled states are built from the handoff's written description,
since the gallery is static:

- Primary press: scale 0.98, brightness 0.94, over 90ms; release over 140ms.
- Row/card press: lighten ~4% on ink, darken ~3% on cream.
- Disabled primary: ink `rgba(247,245,242,.1)` / label `rgba(247,245,242,.35)`;
  cream `rgba(22,23,26,.1)` / label `rgba(22,23,26,.35)`.
- Focus: 2px `#F1551F` outline, offset 2px.

Every tap target ≥44×44. The 40px back circle and 44px call circle reach it
with padding and must not shrink.

### 4.4 Icons

`src/components/icon.tsx` expands to the handoff's ~20-icon inventory, rendered
as `react-native-svg` at stroke 1.9–2.1 with round caps and joins.

The file keeps its existing contract, which is the reason it exists: screens
name a **thing** (`pickup`, `truck`, `pay`), not a glyph, and directional icons
mirror under RTL here, once, rather than at ~30 call sites.

Inventory: chevron (left/right), plus, check, search, phone, message bubble,
truck, box, layered cube, person, route/waypoints, bell, calendar, clock, info
circle, question circle, pencil, swap arrows, star (filled and outline),
backspace, Google "G".

The Google mark is reproduced exactly — brand requirement. Everything else is
authored to the stroke spec.

### 4.5 Numerals and RTL

Arabic uses **Eastern Arabic-Indic numerals** (٠١٢٣٤٥٦٧٨٩) for dates, weights,
counts, prices and step counters. This extends `src/lib/format.ts` and is
tested — it is exactly the kind of thing that regresses silently.

Money stays integer baisa through `src/lib/money.ts`. OMR has **three** decimal
places. The numeral converter formats a string that `money.ts` produced; it
never does arithmetic.

### 4.6 Deletions

- `src/app/(app)/ops/` (both screens)
- `src/components/masthead.tsx`, `src/components/consignment.tsx` — imported
  only by the ops screens, verified by grep
- `tests/integration/ops-screens.test.tsx`
- `ops.*` keys in `src/i18n`
- ops query functions in `src/lib/queries.ts` that lose their only call site

**No migration, no grant, and no RPC is touched.** `~/truckkoo-ops` calls the
same guarded functions over the network and does not notice.

### 4.7 Tests

| Test | Change |
|---|---|
| `tests/unit/contrast.test.ts` | rewritten to compute ratios across **both** grounds; the current version only knows white |
| `tests/unit/format.test.ts` | extended with Arabic-Indic numeral cases |
| `tests/components/primitives.test.tsx` | rebuilt for the new vocabulary |
| `tests/components/tab-bar.test.tsx` | updated for the floating bar, **keeping** its guard that hidden tabs use `tabBarItemStyle` and never `href: null` |
| new | `RouteRail` renders origin and destination distinguishably |
| new | `ProgressBar` fill originates at the leading edge under both directions |

`npm run verify` must pass. `npm run test:db` is unaffected — P0 touches no SQL.

### 4.8 The state the handoff does not draw

D5 puts shipper acceptance before dispatch, which creates a state with no screen
in the gallery: **the price is accepted, but no driver has said yes yet.** The
handoff is design-only, so this is ours to decide. Decided now, so P4 inherits it
rather than rediscovering it.

**It is a T1 variant, not a new screen.** Two rules in the handoff already
determine its shape:

- Any wait longer than ~3 seconds is narrated with real supply information and a
  timeline — never a spinner.
- A **dashed** corridor means uncommitted; **solid** means committed.

So the state renders as T1's skeleton with the timeline advanced one step and the
corridor still dashed, because no truck has committed. It goes solid at T3, which
is exactly what the handoff's own rule says it should mean.

- **Load status:** `accepted` — a new value between `quoted` and `assigned`.
- **Timeline:** Load received ✓ · Matching a truck ✓ · Your price, approved ✓ ·
  *Truck confirming* (active).
- **Copy** leads with supply, as T1 does — "Three trucks have your job" — rather
  than reporting that the app is busy.
- **Failure path:** if no driver accepts within the offer window, the load falls
  to `finding_truck` and a human resolves it. It never becomes "no truck found".
  `CLAUDE.md` #6: a shipper never hits a dead end.
- **The accepted price is honoured.** A quote the shipper accepted is committed;
  falling back to the human path must not silently re-price it. If the corridor
  genuinely cannot be served at that price, ops issues a new quote and the
  shipper sees T2 again — a decision, not a surprise.

Recorded in `OPEN_ISSUES.md`, because it is a product decision made without the
designer and deserves to be visible rather than buried in a spec.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Deleting ops removes phone-based dispatch | Accepted (D7). Dispatch is web-only at `~/truckkoo-ops`. |
| A dispatcher signing into the mobile app lands on a shipper/driver surface per `profiles.role` | Accepted. `am_i_ops` stays in the schema for the web console. |
| Rewriting tokens breaks every existing screen | Expected. Existing screens are replaced in P1–P7 and are not a compatibility target. They must still typecheck at the end of P0 — see §6. |
| `react-native-svg` needs a dev build | Already required by D2 (MapLibre). |
| Bundling three font families increases app size | Accepted; the handoff is explicit that runtime fetching is worse for this audience. |

---

## 6. Definition of done

1. `npm run verify` passes — typecheck, lint, and the full test suite.
2. Every existing screen still compiles and renders against the new tokens,
   with old token references carried over mechanically (§4). They will look
   transitional and that is expected; they must not be broken.
3. No screen from the 32 has been built. P0 is vocabulary only.
4. `DESIGN.md` and `CLAUDE.md` are updated to describe the new system, including
   the D6 contrast deviation and the removal of the ops surface.
5. `OPEN_ISSUES.md` records what P0 leaves unverified — notably that nothing has
   still been seen running on a real device.
