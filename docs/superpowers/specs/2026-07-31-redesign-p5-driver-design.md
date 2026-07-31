# Truckkoo redesign — P5 · Driver

**Date:** 2026-07-31
**Status:** awaiting approval
**Depends on:** P0, P1, P3, P4 (all complete)
**Screens:** D1–D7

---

## 1. What P5 is for

The old driver home opened on *"No trip right now"* — an empty state sitting
exactly where the product's value should be. The handoff calls this flow **money
first**, and that is the whole change: a driver opens the app and the first thing
they read is a number they could earn today.

The refusal is preserved and is not negotiable. **There is no browsable load
board.** A driver sees offers addressed to them, on routes they declared. A board
would hand every shipper's cargo to anyone who signs up as a driver.

---

## 2. The thing that shapes this phase

P5 introduces a **margin**: the shipper pays 96, the driver keeps 78, and the
driver owes Truckkoo the difference.

**The per-load margin is visible to the driver, necessarily, and that is correct.**
They collect 96 in cash at the gate and keep 78; both numbers have to be on their
screen or they cannot do the job. Anyone can subtract. An earlier draft of this
spec tried to hide `price_baisa` from drivers *and* show them what to collect —
those are the same number, and the contradiction is recorded here rather than
quietly dropped, because it is the kind of thing that survives into code as a
guard everyone believes in and nothing enforces.

**What is genuinely worth protecting is the rate card, not the margin.** The
margin on one load is one data point. The ability to price *any corridor at any
weight* is the pricing model — crown jewel #1 (`SECURITY.md` §1) — and a driver
has that today: `quote_route` and `estimate_route` are granted to `authenticated`,
and a driver's own offer card carries every argument they take. A driver could
enumerate the card corridor by corridor. That is the hole this phase closes.

**Honest limit, stated once so nobody assumes more:** a driver who has carried
several loads knows the commission rate. Nothing here prevents that, nothing
should, and no test in this phase claims otherwise.

---

## 3. Decisions taken

| # | Decision | Why |
|---|---|---|
| E1 | **Driver payout is derived from the shipper's price by a commission rate**, and the rate lives in `private.app_settings` — ungranted, edited only through an audited ops RPC. | Same rule as the rate card: the formula lives in SQL and never ships in a bundle. Deriving rather than storing a payout per offer means it cannot drift from the price it came from. |
| E2 | **Drivers stop reading `public.loads`.** All driver-facing load data comes from `driver_offers()` / `driver_offer(p_offer_id)`. | **Not a margin defence** — see §2. It is where payout, collect, owed, detour and remaining capacity are computed, server-side, next to the price they derive from. It also stops incidental columns reaching a driver as the table grows, which a table-level `grant select` guarantees will happen eventually. Consistent with `candidates_for` being private: a driver's view of a load is a composed answer, not a table. |
| E3 | **`quote_route` and `estimate_route` refuse a caller whose profile role is not `shipper`**, raising `no_data_found` — "not found", never "forbidden". | **The actual security change in this phase.** Both are granted to `authenticated` today, so any driver can price any corridor at any weight and enumerate the rate card — crown jewel #1. Both are already definer functions, so the check is internal and cheap, and a shipper loses nothing. A distinct "forbidden" would confirm the function prices something. |
| E4 | **Every money surface shows all three numbers: collect, keep, owe.** | The driver is handed 96 and keeps 78. Showing 78 beside "cash from the shipper on delivery" — the handoff's literal D1 copy — is misleading at the exact moment money changes hands. **This is a deliberate deviation from the handoff**, the second one in the project after `font.button`. |
| E5 | **Detour is `(origin → pickup → dropoff → dest) − (origin → dest)`** — the true extra distance driven — computed in SQL, reusing 0021's road distance. | One distance implementation, server-side, same as the price. Two implementations of a distance disagree eventually, and this one is shown next to money. |
| E6 | **Detour is informational and does not feed payout.** | Tier matching (`candidates_for`) already decides *whether* a load is offered. Detour tells the driver what accepting costs them. Feeding it into pay would make the payout unexplainable to the person receiving it. |
| E7 | **The earnings week starts on Sunday.** | Oman's weekend is Friday–Saturday. An ISO Monday-start week shows a driver last week's total every Sunday — wrong for every driver in the country, on the screen they check most. |
| E8 | **No remittance ledger.** P5 shows what is owed *per load*, never a running balance. | A balance is an account, and an account is one step from a payment surface. Settlement is offline, permanently. Filed in `OPEN_ISSUES.md` as a known gap rather than half-built. |
| E9 | **`legs.free_kg`, nullable.** | D5 asks "tell us roughly how much" for a part-loaded truck. NULL means "empty" or "did not say" — the same shape as `truck_type_code`, and for the same reason: a low-tech user must be allowed not to answer. |

---

## 4. Backend

| Migration | Adds |
|---|---|
| `0028` | commission rate in `private.app_settings`, `private.payout_for()`, the audited ops RPC to change it |
| `0029` | `private.detour_km()`, and `legs.free_kg` |
| `0030` | `driver_offers()`, `driver_offer(p_offer_id)`, `driver_earnings()`, and the E3 role guards |

`driver_offer` takes an **offer** id, not a load id. A driver has no load id to
hold — that is the point of E2, and taking one would re-open the door it closes.

Every definer function pins `search_path = ''` and **fully qualifies types** —
`public.load_status`, not `load_status`. The `$function$` body of any function
reproduced from a live definition ends in a **semicolon**; two migrations shipped
without one and never applied anywhere.

`driver_offers()` re-checks that each offer is addressed to `auth.uid()` inside,
like `match_load` and `accept_quote`. It is the driver's whole view of the
business and it must not become an IDOR into other drivers' work.

---

## 5. Screens

| Screen | Ground | Notes |
|---|---|---|
| D1 | ink, no map | Orange bloom. The offer card *is* the screen: payout leading in Instrument Serif, detour stated up front, `FITS YOUR TRUCK` pill, expiry. Tab badge on Offers. |
| D2 | ink, map + sheet | The detour drawn as a **dashed spur** off the committed corridor, ending in a dot at the pickup. Capacity note: "You keep 2,000 kg free after this." |
| D3 | ink, no map | Empty state that names the consequence, not the state: *"An empty book here means an empty truck."* Primary action adds a route. |
| D4 | ink, map + sheet | Declare a route, 1/2. `LEAVING FROM` / `GOING TO`, suggestion chips from corridors the driver already runs. |
| D5 | cream | Declare a route, 2/2. Two questions, one decision: when do you leave, is the truck empty. |
| D6 | ink, no map | Routes list. `EMPTY` gets the accent pill because it is live and actionable; `PART LOADED` is neutral. |
| D7 | ink, map | On the job. `DROP AT` / `YOU EARN`, shipper contact, and one **64px** primary — "I have delivered it" — sized for a thumb in a truck cab. |

Money hierarchy on every one of these: **what the driver keeps is dominant**;
collect and owe are a supporting line beneath it. Three equal numbers would be
three decisions, and there is one.

All amounts go through `formatMoney` (three decimals, never `toFixed(2)`) and all
numerals through `formatNumber`, which is what renders Arabic-Indic digits. The
driver surface is the more Arabic-leaning of the two roles; D1–D7 are read in
Arabic before anyone reviews them in English.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| **A driver enumerates the rate card** corridor by corridor through the pricing RPCs. | E3. Asserted by impersonating a driver and confirming both `quote_route` and `estimate_route` refuse them, and that a shipper is unaffected. This is the assertion the phase rests on. |
| Someone reads E4 and assumes the margin is secret | §2 says plainly that it is not, and no test claims it is. A guard everyone believes in and nothing enforces is worse than no guard. |
| Moving drivers off `loads` breaks the screens that read it today | Those screens are exactly the ones P5 replaces. `useVisibleLoads` dies with them; nothing else may adopt it. |
| A driver is handed 96, keeps 78, and never remits | Real, and **not solved by this phase** (E8). P5 makes the obligation visible per load. Collecting it is an operations problem, and pretending an app screen fixes it would be worse than naming it. |
| Detour is an estimate drawn as a fact | Same honesty rule as T4. Straight-line distance × 1.20 between city centres, on corridors that are neither straight nor centred. The copy says "about". |
| The commission rate is edited by hand and nobody notices | Every change lands in `ops_audit` with a reason, like every rate-card edit. |
| P5 is the largest screen count so far (7) and the first with its own money formula | Backend lands and is asserted before any screen is built, as in P4. |

---

## 7. Definition of done

1. `npm run verify` and `npm run test:db` green.
2. A driver cannot price an arbitrary corridor: `quote_route` and
   `estimate_route` both refuse them, a shipper is unaffected, and a driver
   still cannot read a load they hold no offer on. Asserted in
   `supabase/tests/tenant_isolation.sql`.
3. A driver with no declared route sees D3, not an error and not an empty list.
4. Payout, collect and owe are consistent with each other and with the shipper's
   T2 to the baisa, asserted in SQL.
5. `driver_earnings()` returns the Sunday-start week (E7), asserted across a
   Saturday/Sunday boundary.
6. `grep -rl "components/legacy" src/app` no longer lists `driver.tsx`,
   `routes.tsx`, `offers.tsx`, `post-leg.tsx` or `trip/[id].tsx`.
7. D1–D7 read correctly in Arabic, RTL, with Arabic-Indic numerals.
8. `OPEN_ISSUES.md` and `SENSITIVE_FIELDS.md` updated — the latter gains the
   commission rate and `legs.free_kg`.
