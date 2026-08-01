# Truckkoo redesign — P7 · Shared + Arabic

**Date:** 2026-08-01
**Status:** approved, ready for planning
**Depends on:** P0, P1 (complete). P3–P6 supply the screens this phase audits.
**Screens:** X1, X2. X3 and X4 are acceptance criteria, not construction.

---

## 1. What P7 is for

Two shared screens the other phases left on the old vocabulary, and the first
time anyone reads the app in Arabic.

The phase table in the P0 spec (§3) says "X1–X4, full RTL mirror audit, no
backend". That is accurate about the backend and misleading about the screens:
the handoff's X3 and X4 are not new screens. X3 is described as "a **full
mirror** of S1, not a translation overlay" and X4 as a "mirror of S5". Both were
built in P3. What P7 owes them is that they render as the handoff describes —
which makes them a definition of done, not a build.

So P7 builds **X1** and **X2**, and spends the rest of itself on Arabic.

## 2. The thing that shapes this phase

`OPEN_ISSUES` 30 says the Arabic risk is word order in composed copy. That is
true and it is not the biggest thing. Counting the dictionary:

```
en keys 378   ar keys 171   missing 207
```

**Fifty-five percent of the app has no Arabic at all.** Not obscure strings —
`tab.home`, `tab.loads`, `tab.account`, `loads.title`, every `status.*`, every
`account.*`, the whole price flow, the whole trip flow, every `common.*`. `t()`
falls back to English visibly on purpose, so an Arabic user today gets Arabic
question screens sitting inside English chrome, with English status pills.

This is not a regression. The dictionary header says so plainly — *"Partial on
purpose — phase 2 completes it"* — and P7 **is** phase 2. But it means the
sentence in `NEXT.md`, "the strings are in both languages", is wrong, and the
phase has to be planned around translation rather than around mirroring.

**Every Arabic string is written or proofed by a human who reads Arabic.**
`CLAUDE.md` #7 makes this a rule for reference data and the dictionary header
extends it to copy: the existing Arabic was lifted verbatim from the live
bilingual site, not machine-translated. P7 does not get to relax that because
the volume went up. §7 says how.

## 3. Decisions taken

| # | Decision | Rationale |
|---|---|---|
| **P7-1** | **P7 owns X1, X2 and the audit.** The four auth screens and `post-load.tsx` stay on `components/legacy`. | Their replacements are N1–N6, and P2 is deferred. Restyling screens P2 deletes is work thrown away. Consequence: `legacy.tsx` cannot be deleted in this phase. |
| **P7-2** | **`t()` gains typed interpolation.** `t('drv.offer.detour', { km })`. | The four-fragment detour line is correct English and merely plausible Arabic. A placeholder puts word order inside the string, where the translator can move it. |
| **P7-3** | **Units move inside the string.** `km`, `kg` and `OMR` stop being template literals outside `t()`. | `${formatNumber(km)} km` renders Latin "km" in Arabic copy. Six sites do this today. |
| **P7-4** | **Language is choosable and persisted**, with `forceRTL` at bootstrap and an `expo-updates` reload on change. | Nothing calls `forceRTL` today and no preference is stored, so Arabic is reachable only by changing the phone's OS language. X2's chevron has to lead somewhere. |
| **P7-5** | **The audit is a forced-RTL test suite plus a copy proof-sheet.** No web preview route. | Mirroring is mechanically checkable and belongs in tests. Copy is not, and needs an Arabic reader. RN Web's RTL is not RN native's RTL, so a web route can pass a bug the phone fails — worse than not looking. |
| **P7-6** | **P7 narrows issues 30 and 35; it does not close them.** | Neither closes without a device. Saying otherwise in `OPEN_ISSUES` would be the more expensive error. |

## 4. Backend

None. No migration, no RPC, no policy change. `npm run test:db` is unchanged and
is run only to confirm that.

## 5. Screens

### X1 · Loads list

Ink. Replaces `(tabs)/loads.tsx` and **retires `src/components/load-card.tsx`**,
which `OPEN_ISSUES` records as transitional and explicitly assigned here.

- Title "Your loads".
- A **segmented control with counts in the labels** — `Moving (2)` / `Finished
  (1)`. Track `#1E2128`, 5px padding, two `flex: 1` segments 42px tall; the
  active segment is a `#F7F5F2` fill with `#16171A` label. The count goes
  through `formatNumber`, so it is Arabic-Indic in Arabic.
- Each load is a card carrying: a **status pill** (`ON THE ROAD` accented,
  `WAITING FOR A PRICE` neutral), a timestamp or ETA, a `RouteRail` with the two
  cities, and — when `price_baisa` is set — the price, vertically centred.
- The finished half stays a list of rows rather than cards. That distinction is
  already in the current screen's own reasoning and it is right: a moving load is
  a journey being followed, a finished one is a record being scanned.

New in `ui.tsx`: `Segmented`. Everything else is `Card`, `RouteRail`,
`StatusPill`, `Screen`.

The ETA shown on a moving card comes from the trip's `eta_at`, the same field T4
reads. Nothing computes one. A load with no reported position shows its status
and no ETA — the same rule as T4's missing marker.

### X2 · Account

Ink. One component serves both roles; only the role line and the tab bar differ.

- A 64px avatar circle with initials, name, and a role line — "You drive a
  truck" / "You send cargo".
- A `YOUR DETAILS` group as a single 22px-radius card with rows divided by inset
  hairlines (`rgba(255,255,255,.07)`, inset 18px): Mobile, Truck (drivers only),
  Language + chevron.
- A `HELP` group: "Message Truckkoo" / "Replies in minutes · 7 days a week".
- "Sign out" as a full-width secondary at the bottom.

**What it may say is unchanged from the current screen: only what `profiles`
holds.** The handoff's `+968 9123 4567` and `10-ton` are gallery placeholders,
not fields to invent. A shipper has no truck row. No tier, no rating, no
loads-completed, no member-since — an account screen is exactly where a
plausible invented number goes unchallenged.

New in `ui.tsx`: a detail-rows card (`DetailGroup` / `DetailRow`). It is not
`ListRow` — these rows are values, not navigation, and only one of them is
tappable.

### X3 · Arabic home, X4 · Arabic question screen

Not built. Asserted. They are S1 and S5 rendered in Arabic, and the handoff's
description of them is the checklist:

| The handoff says | The assertion |
|---|---|
| Full mirror, `direction: rtl` on the content column | Forced-RTL render of S1 and S5 |
| Numerals are Eastern Arabic-Indic — `٣٠ يوليو`, `٨٠٠٠ كجم` | No Latin digit appears in any rendered Arabic string |
| Headings drop to `600` from `700` | `arabicize` already does this; asserted at the token level |
| The back chevron flips | `icon.tsx` mirrors directional icons; asserted |
| The progress bar fills from the leading (right) edge | `ProgressBar` asserted under forced RTL |
| Arabic leading is 1.35 heading / 1.7 body | `arabicize`; already covered by `arabicize.test.ts`, extended |
| Tab labels `الرئيسية` / `الشحنات` / `حسابي` | Currently **missing** from the dictionary — §2 |

## 6. The i18n changes

### Interpolation

`en` is `as const`, so the placeholder names in a value are available to the type
system. `t('drv.offer.detour', { km })` takes a params object whose keys are
derived from the English string, making a missing or misspelt param a typecheck
failure rather than a `{km}` rendered on screen.

Values are stringified through `formatNumber` at the call site, not inside `t()`
— `t()` stays a lookup and a substitution, with no opinion about numerals. That
keeps it swappable for i18next later, which the dictionary header already names
as the plan for pluralisation.

**A test asserts the placeholder set of every key matches between `en` and `ar`.**
A translated string that drops `{km}` silently loses the number.

### Composition sites

~35 places build a sentence from fragments. Each becomes one key with
placeholders. The unit literals go inside the string (P7-3). Accessibility labels
are included — they are read aloud, in order, and a screen reader hears the same
broken word order a sighted user would read.

`OfferCard`'s detour line is the worked example: four fragments and a bare `km`
become `t('drv.offer.detour', { km })`, one string per language.

### Language selection

1. The choice persists in SecureStore, beside the session.
2. `_layout.tsx` reads it **before first render** and calls
   `I18nManager.forceRTL()` to match, then `initLanguage(stored)`.
3. Changing it on X2 writes the preference and calls `expo-updates`
   `reloadAsync()`.

`expo-updates` is a new dependency, and this is the one piece of P7 with a real
chance of misbehaving on hardware: `forceRTL` takes effect on the *next* launch,
so the reload has to actually happen or the user gets Arabic text in an LTR
layout. If `reloadAsync()` is unavailable — it is a no-op in Expo Go — the screen
falls back to telling the user to reopen the app. That fallback is not the design;
it is what keeps a dev environment from looking broken.

## 7. How 207 strings get translated

This is the phase's largest single body of work and it is not a coding task.

1. **Harvest first.** `~/truckkoo` is bilingual and is the source of truth for
   company facts and copy. Every string it already says in Arabic — the public
   claims, the truck types, the city names, "replies in minutes", "7 days a week"
   — is lifted verbatim, never re-worded.
2. **The handoff supplies more.** X3 and X4 give finished Arabic for the home
   screen and a question screen, including tab labels and the greeting.
3. **What remains is drafted and marked for proofing.** Drafts land in the `ar`
   dictionary under a comment block naming them as unproofed, and
   `OPEN_ISSUES.md` carries the count. They are not presented as finished.
4. **`npm run preview:rtl` is what makes proofing possible** — one file, every
   screen, in reading order, that an Arabic reader can go through end to end
   without running the app.

**P7 does not claim the Arabic is right. It claims every string exists, every
placeholder matches, no numeral is Latin, and the whole of it has been laid out
for a person to read.**

## 8. Verification

### `npm run preview:rtl`

Runs through jest rather than plain node — the screens are React Native
components and need the same renderer the tests use, so `preview:rtl` is a jest
invocation of a single non-test file rather than a standalone script like
`preview:map`. It renders each screen with `getLanguage() === 'ar'` and `isRTL`
true, walks the tree for visible text, and writes `.superpowers/rtl-proof.md` —
screen by screen, in reading order.

Modelled on `preview:map`, and honest in the same way. `preview:map` exists
because only an eye that knows the country can see a pin in the wrong town. This
exists because only a reader of Arabic can see a sentence in the wrong order. It
shows **copy, not layout**, and its header says so.

### `tests/components/rtl.test.tsx`

The regression net. Under forced RTL, for every screen:

- every rendered numeral is Arabic-Indic when the language is `ar`
- directional icons mirror
- `ProgressBar` fills from the leading edge
- no rendered text contains a bare Latin unit (`km`, `kg`) in Arabic

### `tests/unit/i18n.test.ts` (extended)

- every `en` key exists in `ar`
- placeholder sets match per key
- no `en` value contains a unit that should be inside a placeholder-bearing string

### Static

A test that greps `src/` for `left:`/`right:`/`textAlign: 'left'` and hardcoded
`→`/`←` outside `directionArrow()`. Cheap, and it is the rule most likely to be
broken by a future screen written in a hurry.

## 9. Risks

| Risk | Mitigation |
|---|---|
| **Drafted Arabic ships looking finished.** | §7.3: drafts are marked in-file and counted in `OPEN_ISSUES`. The proof-sheet exists so the review is possible rather than theoretical. |
| **The forced-RTL suite proves RTL works.** | It does not, and P7-6 says so. RN's native RTL differs from the test renderer's. Issue 30 stays open, narrowed to "layout on a device". |
| **`forceRTL` needs a relaunch and the relaunch fails.** | §6.3. Fallback screen. Flagged as the piece most likely to misbehave on hardware. |
| **`expo-updates` changes the build.** | It is additive and configured off for OTA. If it turns out to require EAS configuration this phase does not want, P7-4 falls back to the reopen-the-app screen and `OPEN_ISSUES` records the downgrade. |
| **Interpolation touches ~35 files at once.** | Mechanical, and every site is protected by the placeholder typecheck. Done as its own task, before X1 and X2, so the two new screens are written against the final `t()`. |
| **X1's ETA invents a position.** | It reads `eta_at` only, like T4. `progressOf` and `interpolate` were deleted in P6 and stay deleted. |
| **X2 fabricates profile fields.** | §5. Only what `profiles` holds; the handoff's values are gallery placeholders. |

## 10. Definition of done

1. `npm run verify` green. `npm run test:db` green and unchanged.
2. `grep -rl "components/legacy" src/app` returns exactly the four auth screens
   and `post-load.tsx`. `loads.tsx` and `account.tsx` are off it, and
   `src/components/load-card.tsx` is deleted.
3. Every `en` key has an `ar` value. Placeholder sets match per key. Asserted.
4. No screen composes a sentence from fragments outside `t()`, and no `km`, `kg`
   or `OMR` appears as a template literal in `src/app` or `src/components`.
5. Rendering any screen in Arabic produces no Latin digit.
6. A user can change language on X2 and the app comes back in the other
   language, mirrored, on the next launch.
7. `npm run preview:rtl` writes a proof-sheet covering every screen P1–P7
   shipped. **Producing it closes the phase; reading it does not** — the review by
   an Arabic reader is a handover item, tracked in `OPEN_ISSUES` alongside the
   device check, because it cannot be done from inside the repo.
8. `OPEN_ISSUES.md` records: the count of unproofed Arabic drafts; that issues 30
   and 35 are narrowed, not closed; and that `legacy.tsx` survives P7 because P2
   is deferred.
