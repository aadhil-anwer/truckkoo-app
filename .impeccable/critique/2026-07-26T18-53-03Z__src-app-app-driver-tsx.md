---
target: shipper and driver home screens
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-07-26T18-53-03Z
slug: src-app-app-driver-tsx
---
Method: dual-agent (A: design review, isolated · B: detector + deterministic evidence, isolated)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `driver.tsx:78` ORs four `isPending` flags — one slow query blanks the whole screen. Declining an offer confirms nothing, visually or to a screen reader. |
| 2 | Match System / Real World | 3 | Strong note/stamp vocabulary, but `status.matched` "Truck found" and `status.assigned` "Truck assigned" are two words for states a shipper cannot tell apart, both stamped `active`. |
| 3 | User Control and Freedom | 1 | Decline is irreversible, unconfirmed, undoable, 14px below Accept. `auth.signOut` is a one-tap unguarded target on a driver's home masthead. |
| 4 | Consistency and Standards | 2 | Five simultaneous oranges on the driver offers tab against a stated one-orange rule; `driver.tsx:211` says "never a second orange" while `primitives.tsx:169` paints that exact button orange. |
| 5 | Error Prevention | 1 | Accept and Decline: adjacent, same size, no confirm step, in a moving vehicle, for the most consequential decision a driver makes. |
| 6 | Recognition Rather Than Recall | 2 | Horizontal swipe is the primary navigation. Its entire affordance is 12px of white peek on white paper plus a 12px "SHEET 1 / 3" label — both indicators, neither a control. |
| 7 | Flexibility and Efficiency | 3 | `goToSection` after accept is genuinely good. `LedgerRow` accepts `onPress`; neither home screen passes it, so both lists are terminal. |
| 8 | Aesthetic and Minimalist Design | 3 | Real restraint, but `LoadSheet` stacks 7–9 groups down one sheet, breaking the concept's own "there is no fold". |
| 9 | Error Recovery | 2 | One generic error blank covers four independent query failures. `error.offline` is written and referenced nowhere, so patchy signal — the driver's *normal* condition — reports as a generic fault. |
| 10 | Help and Documentation | 3 | `BlankNote` copy is outstanding. Nothing anywhere teaches the swipe. |
| **Total** | | **22/40** | **Acceptable — significant improvements needed** |

All ten heuristics apply (Operate mode); no `n/a`. Heuristic 4 is scored one below Assessment A's independent 3, because B's simultaneous-orange count and the comment/implementation contradiction are systematic rather than incidental.

## Design Specificity Verdict

**Authored for Truckkoo specifically — top decile. Do not let the fixes below erode it.**

**Assessment A (unanchored):** The vocabulary is the consignment note — `NoteHead`/`NoteBody`/`NoteFoot`/`Rule`/`Stamp`/`LedgerRow` — and `doc.endpoint` (22px/900) exists so two city names read at arm's length in a cab. `reference()` renders `NO. A3F2C1D9` because a driver reads a number down a phone line. `truck.unset` → "We will advise" protects the NULL-truck-type affordance at the render layer. `price.settle` — "Nothing is charged in the app" — is a string that exists only because settlement is offline forever. `hasPrimary` propagating so the pinned footer steps down to `secondary` is the one-orange rule implemented as a data flow rather than a code-review convention.

The lapse is not visual, it is linguistic: `formatWeight` hardcodes `kg` and `reference()` hardcodes `NO.` — English literals bypassing `t()` on a surface whose premise is bilingual parity.

**Deterministic scan:** `detect.mjs` returned **0 findings across all five files** (driver, customer, waybill-book, primitives, consignment), exit 0, confirmed with `--no-config` so it is not suppression. That clean result is itself the finding: the detector's rules are regex patterns aimed at markup, and every real defect below lives in React Native style objects, query gating, or copy. **A clean detector run on this codebase means almost nothing.** Zero shadow escapes (`elevation` never imported), zero hardcoded strings reaching a `Text` child, zero raw `left`/`right` in style objects.

**Visual overlays:** not applicable — Expo/React Native target, no DOM, no dev-server URL to inject into. No overlay was produced and none is claimed.

## Overall Impression

The look was designed; the task was assumed. That is the characteristic failure of a strongly-authored surface, and it is exactly what happened here — a genuinely distinctive document metaphor sitting on top of flows that lose the user's most important information at the moment they need it most.

**The single biggest opportunity:** a driver currently accepts a load without ever being shown what it pays, and a shipper loses the proof of delivery the instant it arrives. Both are one-file fixes. Both are the peak-and-end of their respective journeys.

## What's Working

1. **One offer per full sheet, with `hasPrimary` driving the footer variant.** A mechanism, not a layout preference — a driver cannot land on an offer as "whichever card I stopped scrolling on", and the pinned action mechanically steps down so Accept is the only orange in view. Enforced by the `BookSheet` type rather than by discipline.
2. **The no-price copy set** (`price.advise_me` / `price.no_rate` / `price.over_capacity`). Three full sentences where every other product ships a dash. `price.over_capacity` turns the user's own mistake into a service. For an audience that reads a blank field as "the app is broken", this is the difference between abandonment and a booking.
3. **Structural RTL in the pager.** Page index from `onViewableItemsChanged` (item indices, which do not move under RTL) instead of `contentOffset` arithmetic, plus `directionArrow()` at every glyph site. Most teams ship `contentOffset / width` and redo it in Phase 2.

## Priority Issues

### [P0] A driver accepts a load without ever being shown what it pays
**Verified:** `grep price "src/app/(app)/driver.tsx"` returns nothing. `useVisibleLoads` selects `price_baisa, currency`, holds them in `loadById`, renders neither. The shipper's sheet renders the same number at `font.title`.
**Why it matters:** PRODUCT.md's entire supply-side thesis is "the driver earns more on a trip they were already making". An owner-driver deciding in a moving cab against a Reply-by deadline is committing a truck against an unknown return. CLAUDE.md is explicit this is permitted — "Showing a *price* is fine and expected; taking one is not." The rational response to an unknown number is to not accept, which is precisely the launch risk PRODUCT.md names.
**Fix:** A price block above Accept, `formatMoney(load.price_baisa, load.currency, getLanguage())` at `font.title`. When null (today's norm, OPEN_ISSUES 13), a plain sentence in the register of `price.no_rate` — never a blank.
**Suggested command:** `/impeccable shape`

### [P0] Proof of delivery, the driver, and the price vanish the moment a load is delivered
**Verified:** `LIVE` (customer.tsx:62) excludes `delivered`/`closed`; the record `LedgerRow` (customer.tsx:140–150) passes no `onPress`. `LoadSheet` — and with it `ProofPhoto`, the driver block, and `PriceBlock` — never renders again. `usePodUrl` is effectively dead code in the shipper app.
**Why it matters:** Proof of delivery is the artefact a business needs *after* the job — to close an invoice, to settle offline (which is how every payment here works), to resolve a dispute. `trip.deliver.explain` promises the driver "This is your proof", and the person it proves anything to cannot see it. Cross-border into 5 GCC countries makes a retrievable delivery record commercial necessity, not nicety.
**Fix:** Pass `onPress` on the record row, route to a read-only load sheet reusing `LoadSheet` verbatim. `LedgerRow` already supports it and is already ≥60pt. Routing change, not redesign.
**Suggested command:** `/impeccable shape`

### [P1] "Message your driver" opens WhatsApp to Truckkoo, gated on a phone number it discards
**Verified:** `safe-text.ts:75` `WHATSAPP_NUMBER = '96875172824'` — Truckkoo's own. `customer.tsx:315–327` gates the button on `!!driver.phone`, then calls `whatsappLink(...)`, which never uses it.
**Why it matters:** A shipper whose 40-ton load is late taps a button that says it reaches the driver, and reaches Truckkoo's general line. For this audience a button whose label misdescribes its behaviour is not an inconsistency — it is the moment the app stops being believable, at the highest-anxiety point in the journey.
**Fix:** Make the label true. Either open `wa.me/<driver.phone>`, or relabel to "Ask Truckkoo about this load" and drop the phone gate — the reference is already in the message body, and that is the operator-grade reading of "no brokers, we hold the relationship".
**Suggested command:** `/impeccable clarify`

### [P1] The primary button fails WCAG AA at 3.47:1 — every primary action, in sunlight
**Verified three ways.** A found it by inspection; B computed it; I recomputed independently. White `#ffffff` on `#f1551f` = **3.47:1**. AA needs 4.5:1 for normal text; the 3:1 large-text exemption begins at 18.66px bold and `font.button` is 16px/800, so it does not qualify. `orangeDeep #d9430f` only reaches **4.41:1**, so darkening alone does not fix it. B found six further orange-on-white failures at the same ratio: `Eyebrow`, `TextButton` default tone, `Button variant="quiet"`, selected `choiceTitle`, `tabCountOn`, and the masthead wordmark.
**Why it matters:** This is the label on *every* primary action — Accept this load, Confirm delivery, Post your first load — read one-handed through a windscreen at midday on a cheap screen. PRODUCT.md commits to WCAG 2.1 AA and then adds sunlight legibility on top.
**Fix:** Raise `font.button` to 18–19px/900, clearing the large-text bar at the existing ratio — better for gloved sunlit reading regardless. Ink on orange measures **5.68:1** and is the alternative if the type size must hold. For `tabCountOn`, drop the orange fill; the underline already carries the active state.
**Suggested command:** `/impeccable audit`

### [P1] The driver's entire home screen fails when any one of four queries fails
**Verified:** `driver.tsx:78–79` — `busy` and `failed` OR across `trips`, `offers`, `loads`, `legs`. `customer.tsx:163` correctly gates on `loads` alone.
**Why it matters:** The screen explicitly designed for "patchy signal, cheap Android, mid-route" has the most fragile loading gate in the app. A driver at a delivery dock on one bar cannot reach "Mark delivered" because a routes list they are not looking at timed out. `error.offline` exists in the dictionary and is referenced nowhere — verified.
**Fix:** Gate on `trips` and `loads` only; let Offers and Routes degrade per-section with their own inline retry. Wire `error.offline` so no-signal reads differently from we-broke.
**Suggested command:** `/impeccable harden`

### [P2] Decline is orange, adjacent to Accept, unconfirmed and irreversible
**Verified:** `driver.tsx:211` comments "Declining is quiet, never a second orange"; `primitives.tsx:169` sets `variant === 'quiet' && { color: color.orange }`. The two buttons sit `space.md` (14px) apart, both 44pt. Decline receives `disabled` but not `loading`, so it dims to 0.45 opacity with no spinner and the sheet disappears — the driver cannot tell which one they hit.
**Why it matters:** Gloved, over a road joint, a thumb slip destroys a day's revenue with no undo and no confirmation.
**Fix:** Ink, not orange, for quiet. Add a confirm step, or reconsider whether explicit decline earns its place at all (see Questions).
**Suggested command:** `/impeccable harden`

## Persona Red Flags

**Jordan (Confused First-Timer, shipper, never booked anything on a phone)**
- The swipe is invisible and it is the primary navigation. A second load creates a second sheet whose only signals are `PEEK = 12` px of white on white and a 12px tab pill. Jordan concludes the app lost the first load.
- "Posted" is a filing verb. Jordan is told "We are finding a truck already heading that way", then sees a grey `pending` stamp reading "Posted". Posted where? The beautiful reassurance copy lives on `finding_truck`, a state Jordan does not see first.
- The price sits behind a grey secondary button while the orange one says "Move something". Jordan taps orange and posts a duplicate load.
- "Truck found" then "Truck assigned" — consecutive near-identical stamps; Jordan cannot tell whether anything changed.

**Casey (Distracted Mobile, one-handed, interrupted, slow connection)**
- `PriceBlock` returns `null` while pending (customer.tsx:388), so the Price section and its `Rule` pop in after the sheet settles — the layout jumps under a mid-tap thumb. *(This one is mine, added this session.)*
- Nested scrollers: every sheet is a vertical `ScrollView` inside a horizontal `FlatList`. A one-handed diagonal arc pages sideways when Casey meant to scroll, and there is no other route to the progress trail.
- `RefreshControl` lives on the vertical scroller inside a horizontally-snapping pager — an ambiguous gesture by construction.
- Nothing persists `current`. Backgrounding on offer 3 of 5 and returning lands on sheet 1, against `expires_at`.

**Rashid (Owner-driver, mid-route — derived from PRODUCT.md: gloves, sun, one hand, moving 40-ton trailer, patchy signal)**
- Decline in orange, 14px under Accept, no confirm, no undo, no loading state.
- `auth.signOut` in the masthead top-right, `hitSlop` 8, exactly under a right thumb reaching for the Routes tab. One tap to a sign-in screen, mid-delivery, on one bar.
- `doc.fieldLabel` is 11px with `letterSpacing: 1.4`. "PICKUP", "WEIGHT", "REPLY BY" — the facts he needs at a glance — are the smallest type on the sheet, in direct sun. The 22px route pair is correctly sized; nothing else is.
- The double-ask: taps "I have collected it", waits on patchy signal, is then asked "Have you collected the load?" To a low-literacy user that reads as *the first tap did not work*.
- No shipper contact anywhere driver-side. `useTripCounterpart` is documented as bidirectional and called only from `customer.tsx`. At a gate that will not open, Rashid has two city names and no way to reach anyone.

## Minor Observations

- `reference()` returns `NO. ...` and `formatWeight` returns `... kg` — both hardcoded English on every sheet, bypassing `t()`. In Arabic, `formatWeight` renders Eastern-Arabic digits followed by Latin "kg". **Verified.**
- Letter-spacing is unconditional across the token set (`doc.fieldLabel` 1.4, `font.eyebrow` 2.6, `tabLabel` 1.6, `stampText` 1.2) with no language branch. DESIGN.md §2: "Arabic resets every `letter-spacing` to `0`." Tracking Arabic breaks cursive joining — legibility damage, not a style nit, and it lands on every stamp the moment Arabic ships.
- `formatWindow` joins dates with an unisolated en dash; in a bidi context that can render the endpoints in the wrong order — the class of bug `directionArrow()` exists to prevent.
- The tab `Pressable` (`waybill-book.tsx:250`) declares `minHeight: 44` but no `minWidth`, no horizontal padding, and no `hitSlop`. Width is intrinsic to a 12px label, so the 44pt minimum is **not guaranteed** — the one interactive host in the surface where it isn't.
- Four uppercase tracked section labels now stack on one shipper sheet (`PRICE`, `YOUR DRIVER`, `PROGRESS`, `PROOF OF DELIVERY`). `tokens.ts` warns in its own words: "it appears once per section — do not staple it onto every card." The `PRICE` one was added this session.
- `color.orangeOnDark` (`#ff7a4d`) is defined and **consumed nowhere in `src/`**. The on-dark accent rule is untested and the token is dead.
- `elevation.card` / `elevation.orangeButton` exported and never imported — correct per DESIGN.md, worth deleting so nothing reaches for them.
- `error.offline`, `cust.record.none.title`, `cust.record.none.explain`, `driver.section.offers`, `driver.section.legs`, `cust.section.active`, `cust.section.past`, `label.offer`, `label.leg` — defined and unreachable. Dead strings make the Phase 2 translation pass more expensive.
- `inkSoft` on `paperDeep` measures **4.93:1 and passes** — I had flagged it as suspect when briefing the detector agent, and I was wrong.
- Screen-level loading spinners (driver.tsx:265, customer.tsx:163) carry no `accessibilityLabel` or live region; error blanks announce nothing; `AccessibilityInfo.announceForAccessibility` appears nowhere, so the two existing live regions are Android-only.

## Questions to Consider

1. **If the driver's decision deserves a full sheet, why is the number that decides it the one thing not on it?** The sheet gives 22px to the route the driver already chose by declaring the leg, and zero to the pay. What would it look like ordered by what the driver *does not already know* — money, then reply-by, then weight, with the route as a confirmation line?
2. **The book's thesis is "there is no fold" — so why is the shipper's live sheet scrolling?** `LoadSheet` runs to seven or nine groups. Either a shipper's load is genuinely several sheets in one section (status · who is carrying it · the trail and the proof), which the book supports for free, or the thesis is aspirational on the shipper side.
3. **What if "Not this one" did not exist?** Offers already expire and the deadline is already shown. If an unwanted load simply lapses, the destructive control disappears, the decision point drops from 7 targets to 6, and dispatch loses only latency — recoverable by shortening the window. What does explicit decline actually earn?
4. **Should proof of delivery be a document rather than a screen?** Settlement is offline; paperwork is this business's native medium. A delivered load already *is* a completed consignment note — reference, route, driver, plate, verified stamp, timestamps, photo. What changes if the shipper's journey ends with "your note is complete" and a shareable artefact instead of a row vanishing into Record? That fixes the P0, fixes the peak-end valley, and is the most on-brand answer available.
