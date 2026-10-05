# Open issues

Things known to be unresolved, unverified, or deferred. Each entry says what it
is, why it is not done, and what "done" would look like — so none of them
survives by being forgotten.

Add to this file rather than leaving an uncertainty in a commit message. Delete
an entry only when it is actually closed.

---

## From the Load 24 teardown (2026-10-04)

Load 24 (Nafith) runs two Oman apps: a trucker app and a cargo-owner app. Both
were walked on a phone and the shipper APK was read offline. The screenshots
and notes are in `~/load24-teardown/` (outside the repo). The test account was
deleted afterwards.

Their model is a two-sided load board. Shippers post "deals" or browse trucks,
drivers browse deals, and the two sides bid and phone each other. Their
markets are Oman and Egypt, with locations at governorate level. Each entry
below is something they do that we lack, or a weakness of theirs that we only
beat on paper so far.

### Drivers wait with nothing to do after sign-up

Their drivers upload documents and then find Deals, Offers and Availability
locked behind "Your account is under review", with no time estimate. Our
verification now collects ID front/back, mulkiya, truck photo, plate and maximum
capacity during signup (0050). Driver home has a document/review card, and the
account screen reopens the upload flow. Ops reviews documents before verifying
the truck and driver. The migration enables the verified-driver dispatch gate.

**Remaining:** physical-device upload/retry proof, human review of the copy,
and deployment. No review-time promise has been invented. Blank or blurred
photos require human rejection; automatic image-quality detection is deferred.

### Urdu — complete draft copy, device proof pending, 2026-10-05

The founder chose Urdu. Every English dictionary key now has Urdu draft copy,
with persistence, profile storage, native first-launch RTL, font handling and
an account selector. Placeholder coverage is checked and `preview:rtl` writes
an Urdu proof sheet alongside Arabic.

**Remaining:** native-reader proofreading and a fresh-install device check.
City/truck proper names use English until an approved Urdu reference source exists.

### "No commission" is their headline, and we say nothing

Their first screen for drivers is "No commission – earn more!". Their own Terms
say fees "are subject to change". Our bid fee is meant to be 0 at launch
(`ops_set_bid_fee(0, …)`), but no screen or page says so.

**Done when:** the fee rule is written in the app and on the website. It must
not be a slogan that can be taken back, and it must match the configured fee.

### Shipment problem reports — implemented, deployment pending

They have Report abuse on a truck (`TRUCK_ALREADY_REPORTED` guards repeats). We
now have participant-scoped reports from load/trip screens (0052), with a guarded,
audited ops queue in `~/truckkoo-ops`. Unassigned loads cancel immediately;
assigned/in-transit cancellation requests go to dispatch without abandoning cargo.

**Remaining:** clean database-suite validation and physical-device/ops workflow
proof. Case resolution records what dispatch did; any trip/load state change uses
the existing guarded ops action on the linked load.

### WhatsApp OTP — dormant integration and screens

The signed Supabase Auth hook, client transport and phone/code screens are
implemented behind `WHATSAPP_AUTH = false`. Meta's number, credentials and
approved authentication template are not available. Email/OAuth remains active.
Account linking, the approved template shape and real delivery/device tests remain
activation gates; see `docs/whatsapp-otp-activation.md`.

### Validation of 0050–0053

Mobile typecheck/lint pass, with two existing duplicate-import warnings. All 814 mobile
assertions pass across 60 suites; Jest still retains an unidentified handle, including under
`--detectOpenHandles`, so the final test command uses `--forceExit`. Ops typecheck,
lint and 73 tests pass using Vitest's runner config loader with caching disabled.
Arabic/Urdu proof generation and migration numbering pass. The final focused,
rollback-only SQL suite passes verification, storage isolation, signup, reports,
cancellation and bidding ops guards. Bidding visibility stays out of ops by the
founder's decision; fixed-price actions are rejected server-side for bid loads.

The full database command stops in the existing tenant test: `match_load` expects
one matching leg but finds three in the shared demo database. That instance also
contains newer staff-security changes from another checkout. No production
deployment or device proof has occurred. Local schema was applied manually;
migration history remains at 0049. Validate every suite on a clean isolated
instance before deploying; do not reset the shared database or fake its history.

### Our edges over them exist in code but not in what we say

Load 24 tracks only by request: the shipper sends a tracking request (even by
typing any trucker's phone number) and the driver must accept it. Their shipper
app shows drivers' full names, prices and a Call button to anyone, without
logging in. Support is Sun–Thu 9–6. They price nothing until drivers bid.
Ours:
- tracking is on for every in-transit trip (0032);
- drivers are invisible to shippers until assigned;
- support is "7 days a week";
- the price is instant, but only once the rate card is loaded (issue 13).

**Done when:** onboarding, the website and the driver pitch say these four
things in plain words, and the rate card makes the instant price real.

### Their mistakes, written down so we don't repeat them

- **A 60-minute resend wait on the sign-up code**, with no "change number". When
  WhatsApp codes land, keep the resend under a minute and offer an edit link.
- **Blank document photos accepted.** Five solid-black images passed as a
  licence, a mulkiya and a truck photo. Any upload we add needs a blank/blur check.
- **Permissions asked before any value is shown.** Notifications came on first
  launch, location immediately after sign-up, both with generic wording. Theirs
  is good in one place: nearby deals are blurred behind "Allow Location".
- **Guests see an empty screen.** Neither of our apps has a guest view yet. If
  we add one, it must show something real, such as a route price, never "come
  back later".

---

## Automatic dispatch (0036, 2026-09-27)

Uber/Porter-style dispatch replaced the dispatcher as the first step: instant
price for "let us choose" + weight, book = accept (`book_load`), drivers'
Available switch, and time-based waves (3 at a time, 5 min, 150 → 400 → 1,500 km)
before a person is alerted. Proven by `supabase/tests/dispatch.sql` (56
assertions), the other three suites (updated), concurrency runs against two
live sessions, and `tests/integration/auto-dispatch-screens.test.tsx`.

**Production status must be checked — `require_verified_driver` was OFF.** Left off on the
founder's call (2026-09-27) so the app could be shared before drivers were
vetted. While off, unverified drivers are offered loads — which contradicts the
website's "100% verified drivers". Migration 0050 now enables the flag. Before
applying it, review the real driver/truck records in the ops console;
(`nearby_drivers` and `accept_offer` both honour it; dispatch.sql tests both ways).

**When 0036 reaches production:**
- **Nobody is "available" on day one.** The switch is new, so until drivers flip
  it, only drivers with a declared empty leg are matched; everything else
  searches for 15 minutes and then alerts a dispatcher. Tell drivers.
- **Rates for the resolved truck.** "Let us choose" + 8 t is priced as a 10 t;
  a corridor with no 10 t row returns `no_rate` and goes to a person, as before.

**Fixed in 0037 (2026-09-28), found on production:** `quote_route` and
`estimate_route` were `stable` but write a rate-limit row, so PostgREST ran them
read-only and every price lookup failed — every booking went to a person. A
driver coming online after the 15-minute search now gets the load
(`system_rescue_stranded`, every minute; off via `dispatch_rescue_enabled`), and
a driver who missed an offer is re-asked after switching on again. The driver
card re-reads the switch every minute, so the 12-hour auto-off is visible.

**Still open:**

- **The production rate card is empty (2026-09-28).** Every booking returns
  `no_rate` and goes to a person; automatic dispatch cannot start until a
  dispatcher enters real rates in the ops console. Not a code fix — rates are
  never invented in a migration.
- **A priced load waits on the shipper** — who is now told by push (0046,
  "Your price is ready") once 1.2.0 is installed. No WhatsApp message.
- **Drivers are online by default (0038, founder's call 2026-09-28).** Every
  driver starts on and the 12-hour auto-off is disabled; switching off still
  works. Cost: offers reach drivers not looking at the app and lapse, and since
  nobody toggles, a missed offer is not re-asked (0037's re-ask needs a toggle).
  Reverse with `drivers_online_by_default = false`. Revisit once push lands.
- **Driver background GPS is built (0039, app 1.1.0) and has never run on a
  real phone** (`docs/superpowers/specs/2026-09-28-driver-background-gps-design.md`).
  Before drivers get it: `npx supabase db push` (0039, 0040); a 1.1.0 preview build
  (a native change — `eas update` cannot deliver it, and a 1.0.0 build must not
  receive 1.1.0 JS); the Google Play background-location declaration with a video
  of the disclosure screen; the device check below. Known gaps: iOS permission
  text is English-only; no battery-optimisation exemption prompt, so Xiaomi/Samsung/Oppo may
  kill the task (ranking then falls back to the town after 45 min). Better
  options were set aside for now — Transistorsoft background-geolocation, on-demand
  location via silent push, Google road-distance APIs — the spec's §9 says when
  each is worth revisiting.

  Device check (preview build 1.1.0, one Android phone, ~1 hour driving):
  1. Fresh install → driver → Go available → disclosure appears → Continue →
     "While using" → Settings → "Allow all the time".
  2. Notification "You are available" is in the status bar.
  3. Lock the phone, drive 5 km. In SQL: `select located_at, city_id from
     public.driver_availability where driver_id = '<id>'` — updated within
     ~15 min / 2 km.
  4. Go offline → notification gone; drive 3 km; `located_at` and `lat` are null.
  5. Take a demo load, start the trip → with the driver's app closed, the
     shipper's T4 "Seen … s ago" resets at least every ~30 s (0040). On the
     driver's D7, "Directions to <city>" opens Google Maps turn-by-turn.
  6. Reboot the phone, open the app once → notification returns.
  7. Sign out → notification gone.
- **Shipper places are built (0041) and have never run on a real phone.** Before
  shippers get them (all before the 1.1.0 build): Google Cloud project + billing
  with a ~$20 budget alert and a daily quota on Places API (New); two keys —
  Places API (New) only, and Maps SDK for Android only restricted to the package
  + signing SHA-1; `npx supabase secrets set GOOGLE_PLACES_KEY=…` and
  `npx supabase functions deploy places`; EAS env var `GOOGLE_MAPS_ANDROID_KEY`
  (preview + production); `npx supabase db push` (0038–0044; 0044 is the tripwires migration from main, renumbered). Known gaps: iOS
  shows Apple Maps; a city-only load still routes the driver to the city centre; a pin more than 100 km from every city on our list (Qatar, Kuwait, deep desert) has no city and must be booked by city (0042);
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
- **Push notifications are built (0046, app 1.2.0) and have never reached a
  phone.** See *Push notifications* below for what has to happen first.
- **Ops console not updated (Phase F).** It shows new `dispatch_log` modes
  (`nearby`, `mixed`) and the `exhausted` ending raw, and still has the stale
  "In phase 2 you will be able to send one" copy.
- **A double tap can book twice — FIXED IN SOURCE 2026-10-04 (0047), not yet in
  production.** `book_load` and `post_bid_load` take an optional request id; the
  review screen makes one per visit and sends it on every tap, so a retry after a
  timeout gets the first load back (dispatch.sql §12, bidding.sql §15). Order
  matters: `npx supabase db push` **before** the JS ships — the new parameter
  does not exist on 0046's functions, so the app would fail every booking. A
  binary without the change sends no id and books as before. Still open: leaving
  the review screen and coming back makes a new id, so a timeout followed by
  Back → Book again can still post twice.
- **The shipper is not told when a price changed under them.** `book_load` posts
  unaccepted and the load screen shows the new price to accept, but says nothing
  about it having moved.

## Push notifications (0046, app 1.2.0, 2026-10-04)

Founder's call: a driver hears about a new job and getting it; a shipper hears
about a price arriving (a bid, prices closing, or a dispatcher's price), a
driver assigned, pick-up and delivery. Asked right after sign-up, and once more
if a permission that was on is switched off. Database triggers send through
Expo's push service via pg_net — no service-role key, no Edge Function.
Proven by `supabase/tests/push.sql` (22 assertions, bodies checked in both
languages) and `tests/unit/push.test.ts` / `tests/integration/push-screens.test.tsx`.

**Before it reaches anyone — all founder steps:**
1. Firebase project → add the Android app `com.truckkoo.app` → download
   `google-services.json` → `eas env:create --type file --name
   GOOGLE_SERVICES_JSON` (preview + production).
2. Firebase → Project settings → Service accounts → generate a key, then
   `eas credentials` → Android → *FCM V1 service account key* → upload it.
3. iOS: `eas credentials` creates the APNs key on the first iOS build.
4. `npx supabase db push` (0045, 0046).
5. **A new build, 1.2.0** — `expo-notifications` is native, so `eas update`
   cannot deliver it, and 1.1.0 phones must not receive 1.2.0 JS (the
   `runtimeVersion` policy already prevents that).

**Device check (preview 1.2.0, one Android phone):**
1. Fresh install, sign up → "Get a buzz…?" appears → Turn on → Android's dialog.
2. As a shipper, book; as a driver on a second phone, see "New job" with the app
   closed; tap it → the bid screen opens.
3. Send a price → the shipper's phone buzzes "New price"; tap → the load.
4. Accept → driver "You got the job"; pick up, deliver → shipper buzzes twice.
5. Turn notifications off in Settings, reopen → the question appears once;
   Turn on → Settings opens.
6. Sign out → no further buzzes on that phone.

**Open:**
- **Dead tokens are never pruned.** Expo reports `DeviceNotRegistered` in its
  response (in `net._http_response`); nothing reads it yet. Harmless at this
  volume; a sweep belongs in a `system_*` job.
- **Message copy is in SQL**, not `t()` — the server composes it. The Arabic
  there is drafted, like the unproofed block, and needs the same reader.
- **No quiet hours, no per-kind opt-out.** One switch: on or off.

## Driver bidding (0045, 2026-10-04)

Drivers name the price; the shipper chooses, or sets a limit and lets the
server take the cheapest price within it. `docs/bidding-v1-design.md` is the
decision record. Proven by `supabase/tests/bidding.sql` (60 assertions) and
`tests/integration/bidding-screens.test.tsx`; the client's RPC parameters and
returned columns were checked against the local database. Behind
`BIDDING` in `src/lib/features.ts` — on.

**Before it reaches shippers:**
- `npx supabase db push` (0045), then set the fee from the console:
  `ops_set_bid_fee(0, 'launch: no commission for six months')`. Until a fee is
  set, posting refuses with "bid fee is not configured" and the booking review
  says "We could not post that".
- An `eas update` is enough — no native change. Publish only after the
  migration and the fee are live.
- **Nobody has walked it.** Not on a phone, not on web: post → invitation →
  price → accept, end to end, is the device check.

**Open:**
- **Push lands with 0046 / app 1.2.0.** Until that build is installed,
  invitations and prices appear only while the app is open (both poll every
  15 s).
- **The limit can be set only while booking.** `set_bid_target` exists and is
  tested; the load screen has no control for it yet.
- **Dispatcher actions are not bid-aware** (`ops_send_offer`, `ops_set_price`).
  Harmless while no dispatcher acts.
- **Ops console** shows bid loads with raw statuses and knows nothing of bids.
- The question screens for an amount show a `1 / 1` step counter on the
  driver's price screen — a one-question flow in the shared shell.

## Sentry (2026-09-26)

`src/lib/monitoring.ts`, initialised first in `_layout.tsx`; render crashes
reach it through `AppErrorBoundary`, which expo-router would otherwise swallow.
Off in development (`enabled: !__DEV__`), so it is **only proven by a preview
or production build** — nothing has been sent to it yet.

Deliberately narrower than Sentry's quick-start, for SECURITY.md's "PII never
enters logs": `sendDefaultPii: false`, no session replay, no feedback widget
(English-only UI outside `t()`), console breadcrumbs dropped, phone-number-shaped
digit runs scrubbed from exception text. Names and cargo text in an error
message are **not** detectable by pattern and would still get through.

Open:

- **Source maps do not upload yet.** The Expo plugin needs `SENTRY_ORG`,
  `SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN` as EAS secrets; without them release
  stack traces stay minified.
- **Turn on "Prevent Storing of IP Addresses"** in the Sentry project settings.
  `sendDefaultPii: false` stops the SDK sending it; Sentry still infers it at
  ingestion unless told not to.
- **0035's `report_client_error` now overlaps.** It was built with client
  wiring left undone; Sentry covers the same job plus native crashes and
  symbolicated traces. Decide whether 0035 stays (data stays in our own
  database) or its client half is dropped — do not wire both.
- **Oman's PDPL (Royal Decree 6/2022)** likely treats device-identifying error
  reports as personal data leaving the country. Not legal advice — have the
  privacy policy name Sentry as a processor before launch, and check with
  someone who knows the law.

## Detection and scheduled jobs (2026-09-26)

What landed: `.github/workflows/ci.yml` runs `verify`, the three SQL suites on a
Postgres-only local stack, and `scripts/check-migrations.mjs` (numbering, and no
applied migration edited) on every push and PR. Migration 0034 enables pg_cron
and pg_net and schedules the offer sweep (5 min), position retention (daily),
a stuck-load alarm (5 min) and a watcher that alerts on failed cron runs
(15 min). `.github/workflows/drift.yml` compares the repo's migrations with
production daily. All verified locally, including the jobs firing under the
real scheduler; none of it has run on GitHub or production yet.

### 0034 is not in production, and the alarm has nowhere to send

Until 0034 is pushed, the sweeps are still buttons. After it is, alerts are
recorded in `private.ops_alerts` but **sent nowhere** until a webhook is set:

```sql
insert into private.app_settings (key, value)
values ('alert_webhook_url', '"https://hooks.slack.com/…"'::jsonb)
on conflict (key) do update set value = excluded.value;
```

The body is `{"text": …}` (Slack, Google Chat, and most chat webhooks). WhatsApp
needs a provider in between. Threshold: `stuck_alert_minutes` (default 30).

**Done when:** 0034 is applied, a webhook is set, and a deliberately stale test
load has produced a message on a dispatcher's phone.

### Drift and CI need repository setup

`drift.yml` warns and passes until the `SUPABASE_DB_URL` secret exists (Session
pooler string — the direct host is IPv6-only). Branch protection on `main`
should require the three `ci` jobs, or CI reports failures nobody is blocked by.

### The scheduled path audits as the nil UUID

`ops_audit.actor_id` is NOT NULL and `log_ops` reads `auth.uid()`, which cron
does not have, so `private.log_system` writes `00000000-…`. The console's
`ops_audit_log()` shows those rows with no actor name. Only sweeps that changed
something are logged; "did the job run" lives in `cron.job_run_details`, pruned
to 14 days by `watch-cron`.

### Still not detected: production crashes, and whole-flow breakage

The two largest remaining gaps. No crash reporting exists in release builds —
`AppErrorBoundary` logs only under `__DEV__` (needs a Sentry DSN). No canary
walks post → offer → accept → deliver against production (needs test accounts
and a decision on how the dispatch step is performed, because `create_offer` is
revoked from every client role and a new privileged path is a stop-and-ask).

---

## Driver surface after the first demo (2026-09-26)

### Declared trips are hidden, not removed

`src/lib/features.ts` → `DECLARED_TRIPS = false`. The driver's third tab is Past
trips; the Routes tab, the leg flow (`src/app/(app)/leg/*`) and home's "Add a trip
you are making" are unreachable from the UI, and the home and Offers empty states
no longer ask for legs. Everything behind the flag is still built and tested —
the flag-on copy is exercised with `jest.replaceProperty`.

**Hidden is not disabled:** `post_leg` still accepts a leg from a direct API call,
and `private.candidates_for` still matches on legs. Harmless — a leg only feeds
matching — but it is not a lock. The replacement (location + availability toggle)
has no spec yet; it needs one, and a security review, because an idle driver's
position is a new class of data the rules currently forbid storing.

**Done when:** the location-matching spec decides whether legs return, stay
hidden, or are deleted with their migration history left intact.

### Migration 0033 is not in production yet

`driver_trips()` and the month columns on `driver_earnings()`. An APK with Past
trips against a database without 0033 shows the history's retry state, not a
crash. Push with `npx supabase db push` before handing out a build. The daily
`drift.yml` check fails while this (or any migration) is unapplied.

### The city list never retries after one failure — FIXED IN SOURCE 2026-10-04

Now: `useCities`/`useTruckTypes` refetch on foreground (`focusManager`), on
pull-to-refresh on every tab and the load screen, and every 30 s while failed
(`RETRY_WHILE_FAILED`, `tests/unit/reference-queries.test.tsx`). Still open: a
screen shows "—" rather than a skeleton until the list arrives. Unverified on a
device. The original report:

`useCities` is `staleTime: Infinity`. If its one fetch fails — bad signal, or a
database that was missing `lat`/`lng` as production was on 2026-09-26 — every
route in the app renders "—" until the process is killed. Seen on a device:
offers with dashes for both cities, fixed by a force-stop.

**Done when:** an errored city list refetches on focus/foreground and on
pull-to-refresh, and a screen shows a skeleton rather than "—" while it has none.

### One unreproduced jest failure

One `npm run verify` on 2026-09-26 reported 2 failed tests; it was not captured,
and four full runs straight after passed 541/541. Recorded rather than dismissed:
this suite has had a time-of-day flake before (the midnight bug below).

---

## Found on a device (2026-08-02)

The first run of this app on an Android device, ever. Three findings, and the
third invalidates a rule the whole codebase is built on.

### `align.start` is backwards — React Native already flips `textAlign` under RTL — FIXED IN SOURCE 2026-09-26, device re-check pending

`align` is now the constant `{ start: 'left', end: 'right' }`, the tests assert
that, and `CLAUDE.md` is corrected. The one remaining "done when" clause is the
device run: an Arabic label measured on the right-hand edge.

`CLAUDE.md` says "React Native does **not** flip `textAlign: 'left'` under RTL —
use `align.start`". **That is false on both platforms**, and `align.start` is
therefore inverted everywhere it is used.

```kotlin
// react-native/ReactAndroid/.../views/text/TextAttributeProps.kt
"left"  -> if (isRTL) Gravity.RIGHT else Gravity.LEFT
"right" -> if (isRTL) Gravity.LEFT  else Gravity.RIGHT
```
```objc
// react-native/Libraries/Text/RCTTextAttributes.mm
if (_layoutDirection == UIUserInterfaceLayoutDirectionRightToLeft) {
  if (alignment == NSTextAlignmentRight)     alignment = NSTextAlignmentLeft;
  else if (alignment == NSTextAlignmentLeft) alignment = NSTextAlignmentRight;
}
```

`align.start` returns `'right'` under RTL, RN flips that to LEFT, and the text
lands on the wrong edge.

**Measured on the sign-in screen, Arabic, second launch** (native RTL confirmed
active):

| Element | LTR | RTL | |
|---|---|---|---|
| brand `تركو`, positioned by flex | x 62–109 | x 973–1020 | flipped correctly |
| field label `البريد الإلكتروني`, `textAlign: align.start` | x 61–256 | x 61–256 | **did not move** |

**The fix is the identity.** `start` is `'left'` and `end` is `'right'`, with no
`isRTL` read, because RN does the flipping. Better still for the `start` case:
omit `textAlign` entirely and let the default (`auto`, i.e. natural) follow the
paragraph direction.

**This is not a small change.** 26 files use `align.*`, `tests/unit/i18n.test.ts`
asserts the current inverted behaviour as if it were correct, and
`tests/unit/no-literals.test.ts` bans the literal `'left'` that is in fact the
right answer. All three, plus the `CLAUDE.md` rule, move together.

**Done when:** `align` is the identity, the tests assert the new rule, `CLAUDE.md`
is corrected, and a device run shows a label on the correct edge in Arabic.

### A secondary, real problem: direction values freeze at import

`const styles = StyleSheet.create({ x: { textAlign: align.start } })` at module
scope captures whatever the getter returned at import time. Proved in jest: the
getter stays live, the stylesheet does not. `arabicIfNeeded` freezes the same way,
so an Arabic font step can be missed too.

`ui.tsx` and `primitives.tsx` avoid it by calling `StyleSheet.flatten([...])`
inside render; 26 screen and component files do not. Fixing the entry above makes
the values constant, which makes the freeze harmless — but the pattern is a trap
for the next direction-dependent value someone adds.

### Every heading on the five legacy screens is invisible — RESOLVED 2026-09-26

`legacy.tsx` now uses `color.lightText` / `alpha.onInk.body` on ink, and
`contrast.test.ts` reads its source and fails on `color.inkText` in any style
block that does not name a light fill.

`legacy.tsx` sets `title` and `pageTitle` to `color.inkText` (`#16171A`) — the
near-black for the **cream** ground — and those screens render on ink
(`#0B0C0F`). Roughly 1.1:1. "Sign in" and "Create your account" cannot be read,
in either language, and they are the first screens a new user sees.

`tests/unit/contrast.test.ts` computes every ratio from the tokens but never sees
`legacy.tsx`, which is how this shipped. The same file uses `color.inkText` for
body, section, list and route text on ink.

**Done when:** the legacy styles use `color.lightText` / `alpha.onInk.*`, and the
contrast test covers `legacy.tsx` rather than tokens alone.

### A phone already set to Arabic reads Arabic in a left-to-right layout, once — FIXED ON ANDROID IN SOURCE 2026-09-26, device check pending

**Root cause, deeper than first written:** React Native's Android RTL detection
(`I18nUtil.isDevicePreferredLanguageRTL`) reads `Locale.getAvailableLocales()[0]`,
the first locale the phone *supports*, not the one chosen, so it is effectively
always LTR. The persisted `forceRTL` flag is the only route to RTL, and JS can
only write it after React has read it.

**Android:** `plugins/with-first-launch-direction.js` seeds `forceRTL(true)` in
`MainApplication.onCreate`, before React loads, once per install, when the
phone's language is `ar` (matching `initLanguage`'s fallback, not "any RTL
language"). **Everywhere else:** `restartPending()` records a boot-time mismatch
and the root layout shows `app.direction.reopen` in a strip above every screen.
That covers iOS launch 1 and a phone whose language changed after install.

**iOS is not fixed natively.** Adding `ar` to CFBundleLocalizations would make
launch 1 correct, but then choosing English on an Arabic iPhone cannot un-flip
without `allowRTL(false)` paired into `setLanguage`. That needs an iPhone to
verify.

**Done when:** a fresh install on an Arabic Android phone opens right-to-left
on launch 1 with no notice, and an iPhone has been looked at.

Original entry:

`forceRTL` applies on the *next* launch. Launch 1 on an Arabic device is Arabic
text in an LTR layout with nothing explaining it; launch 2 is correct. Both
confirmed on the emulator.

X2's "reopen the app" notice only fires after an in-app change, so this path is
silent. It is the cost of dropping `expo-updates`, and it is worse than that
decision assumed: it hits users who never touch the language switch.

**Done when:** the first run in a mismatched direction says something, or the
relaunch happens by itself.

---

## P7 · Shared + Arabic (2026-08-01)

Specced in `docs/superpowers/specs/2026-08-01-redesign-p7-shared-arabic-design.md`.
X1 and X2 shipped, `t()` gained typed placeholders, the Arabic dictionary was
completed, and the audit tooling was built. No backend change — `npm run test:db`
was run against a fresh `db reset` to confirm it.

### 320 Arabic strings have never been read by someone who reads Arabic

The dictionary went from 173 of 387 keys to all 387. They are not all of one
kind, and the difference matters:

- **Harvested.** Lifted verbatim from the live bilingual site (`~/truckkoo`) or
  from the handoff's X3/X4, which specify finished Arabic for a whole home
  screen and a whole question screen.
- **Assembled.** Where a P7 key merged older fragments, the Arabic is those same
  words in Arabic order — no new vocabulary.
- **Drafted — 320 of them**, counted from the block itself on 2026-10-04 (the running total kept here had drifted to 254 against a real 289 before bidding; 191 at P7, plus 6 map labels and 14 dispatch strings, 2026-09-27, 11 driver-location strings, 2026-09-28, and `pos.secondsAgo` for live T4 and `drv.trip.directionsTo` for D7, 2026-09-28, and 30 `places.*` strings for shipper places, 2026-09-28, and 44 bidding strings, 2026-10-04, less 23 that left with `post-load.tsx`, and 10 for push notifications; `drv.avail.why` was also rewritten). Not from either source. They sit in one delimited
  `UNPROOFED DRAFTS` block at the end of the `ar` dictionary in
  `src/i18n/index.ts`, kept together so a reviewer reads one section rather than
  searching 387 lines.

P7's claim is that every string exists, every placeholder survives translation,
and no numeral is Latin. **It is not a claim that the Arabic is right.**

`npm run preview:rtl` writes `.superpowers/rtl-proof.md` — every string, grouped
by screen, each row marked harvested or draft — which exists so this review is
possible without running the app.

**Done when:** a native Arabic reader has been through the proof-sheet and the
`UNPROOFED DRAFTS` block has been emptied into the body of the dictionary.

### Changing language needs the user to reopen the app

`src/lib/language.ts` is the only caller of `I18nManager.forceRTL`, which takes
effect on the *next* launch. Nothing relaunches the app, so X2 shows
`account.language.hint` — "restart the app after changing this" — and that is the
design rather than a fallback.

`expo-updates` was added in P7 to call `reloadAsync()` and then removed. It
failed the EAS **Configure expo-updates** build phase, and making it pass means
enabling EAS Update: an OTA check at every launch, plus a release channel to
manage, bought to save one tap for an audience on patchy signal in a truck cab.
The trade was not worth it. If it is ever revisited, `needsReload` is still the
function that decides.

Nearly shipped worse: the edit that moved the direction decision into
`loadLanguage()` deleted `I18nManager.allowRTL(true)` with it, and `forceRTL` is
ignored on a build that has not allowed RTL — the switch would have done nothing
at all. Lint caught it as an unused import.

**Done when:** someone changes the language on a real Android phone, reopens it,
and the app comes back mirrored in the other language.

### `profiles.language` was written by nothing — RESOLVED 2026-08-01

The column has existed since 0001 with an UPDATE grant and a
`check (language in ('en','ar'))`, and nothing had ever written it, so every row
claimed its owner reads English.

`setLanguage` now records it, best effort, before the relaunch. Two sources of
truth on purpose, with different jobs: SecureStore settles the direction at BOOT,
because that has to happen before a session exists — the auth screens need a
direction too — and the column is what anything server-side reads.

The write is allowed to fail silently. This audience is on patchy signal, the
local preference is already stored by then, and reporting a failed language
change because the network was down would be a worse lie than a stale column.

No migration: the grant was already there.

### X2 has no truck row, because `profiles` has no truck

The handoff's X2 draws `Truck / 10-ton`. `profiles` holds `id`, `role`,
`full_name`, `phone`, `language` and nothing else, so the value would have to be
invented — and an account screen is exactly where a plausible invented fact goes
unchallenged (CLAUDE.md #5). The row does not exist rather than showing a
placeholder.

A driver's truck does exist in `trucks`, reachable per-trip via `useTripTruck`.
There is no "my truck" read, and adding one is a backend change.

**Done when:** a `driver_truck()` read exists, or the handoff's row is formally
dropped from the design.

### X1 issues one position RPC per in-transit load

Each moving card calls `useTripPosition` for itself, at the 60s interval that
hook already polls at. For a shipper with three trucks moving that is three
requests a minute; the screen was drawn for that scale.

The alternative was an ETA computed on the client from elapsed time, which P6
deleted on purpose — `progressOf` and `interpolate` are gone and a card is just
as capable of inventing a position as a map marker is.

**Done when:** it becomes a problem, at which point the fix is a batched
`trip_positions_for(load_ids[])` rather than a client-side estimate.

### `legacy.tsx` survives, for one screen — RESOLVED 2026-10-04

"Send this route again" now fills a fresh booking draft from the old load and
opens the booking flow on the date (`draftFromLoad`, `startDraft`).
`post-load.tsx`, `picker.tsx` and `legacy.tsx` are deleted, with 41 strings only
they used, and `usePostLoad` / `useQuoteRoute`, which lost their only caller.
`post_load` stays on the server for installed builds.

### P2 runs on email until WhatsApp codes land — INTERIM 2026-09-26

The auth screens were never redesigned, because P2 was parked; on a device they
looked nothing like the handoff. N1, N4, N4b, N5 and N6 are now built as drawn.
N2/N3 ask for an email and a password in the same cream one-question shape, since
the codes need Meta's side (verified business, Cloud API number, approved
template, permanent token) and that is not ready.

What differs from the handoff, on purpose, until then:

- **N1 has two paths** ("Get started" / "I already have an account"). A code does
  not care whether an account is new; an email and password do, and guessing
  would make a second account for anyone who mistypes their address.
- **The number is asked after the name, and is skippable** — as it always was. It
  becomes the real N2 (first, required) when codes land. Omani mobiles only; the
  six GCC prefixes arrive with the codes, where they are enforced.
- **N1's two decorative pins are not drawn**: `cities` is not readable signed
  out, and coordinates are not invented in a screen.
- **No plate question.** Never drawn, always optional; dispatch adds it.
- **Questions step down to 32px below 360pt wide** (every cream question, not
  just auth). The handoff says not to scale its 42px; at 320pt that wrapped every
  question to three lines and pushed N4's second choice under the fold.

Also fixed on the way: `TertiaryButton` was ink-only, so on cream it rendered .5
white on #F4F0E9 — S8's "Skip — I do not know the weight" and S5's "Show more
days" were real paths nobody could see. It takes a `ground` now.

**Unverified:** none of this has been run on a device, and no sign-up has been
completed against the hosted project — only rendered on web.

**Done when:** WhatsApp codes ship and N1 goes back to one primary.

### `npm run verify` exhausted memory — RESOLVED 2026-08-01

Diagnosed rather than worked around. Jest defaults to one worker per core minus
one, and each `jest-expo` worker carries a whole React Native transform. That is
a bet on cores and RAM rising together: the machine this was found on has 16
cores and 7GB, so the default spawned 15 workers and the run died with exit 137
instead of a test failure.

Not machine-specific, then — any high-core, low-memory box does this.
`jest.config.js` pins `maxWorkers: 4`, and `npm run verify` completes in under
ten seconds.

---

## The redesign (2026-07-30)

Specced in `docs/superpowers/specs/2026-07-30-redesign-p0-foundations-design.md`
as eight phases. The design handoff is **design-only** — where it left a product
question open, the answer was decided here and is listed below so it can be
argued with later.

### The flow order changed: the shipper now accepts the price before we dispatch

The handoff shows the shipper accepting a price (T2) and then meeting an assigned
driver (T3). The build did the reverse — a driver accepted an offer and that
created the trip, and the shipper approved nothing. The handoff's order is now
the real order: `posted → matching → quoted → accepted → assigned`.

This is a genuine product change, not a restyle. It means a shipper can commit to
a price before any truck has committed to the job.

**Watch for:** the rate of loads that reach `accepted` and then fall back to
`finding_truck`. If it is not near zero, accepting a price before a driver exists
is the wrong order and the reservation model (dispatch first, shipper confirms an
already-reserved driver) is the fix.

### The gap between "price accepted" and "driver assigned" has no design

A consequence of the above. The gallery has no screen for it, so it was decided
without the designer: it renders as a T1 variant — narrated wait, timeline
advanced one step, corridor still **dashed** because no truck has committed. It
goes solid at T3. Both of those follow rules the handoff states elsewhere, so it
should read as designed rather than invented, but nobody has seen it.

If no driver accepts inside the offer window the load falls to `finding_truck`
and a human resolves it — never a dead end (`CLAUDE.md` #6).

**Done when:** a designer has looked at the state, or it has survived real use.

### The ops console is caught up in source, but has not been deployed

`~/truckkoo-ops` has now been run against the reordered schema and updated:
`LoadStatus` and the status filter carry `quoted` and `accepted`,
`nextLoadStatuses` mirrors 0027, and the stamp map no longer renders an
`accepted` load as `done` (see below). 72 tests, build clean.

**It has not been deployed**, and it is a separate Cloudflare deployment this
repo cannot push. Until it is, the live console is running the old bundle
against the new database — which is survivable (the new statuses are additive
and `ops_queue` already returns them) but means a dispatcher sees loads they
cannot filter for and cannot move.

**Done when:** `~/truckkoo-ops` is built and deployed, and a dispatcher has
moved a real load out of `quoted`.

**Not a problem, checked:** `writeError` already shows domain messages as-is, so
0026's `price already accepted by the shipper` reaches a dispatcher as a
sentence. Only `errorMessage`, used for failed *reads*, rewrites codes.

### The tracking screen dropped "Get a price", and nothing replaces the button

The old `load/[id]` carried a secondary "Get a price" that called `quote_load`.
In the P4 order a price is not something the shipper asks for — it arrives, and
T1 is the wait while it does. So the button is gone from the screen.

`quote_load` itself is untouched and still granted; `post_load` and the ops
console are its callers now. The exposure this closes is small, but the thing to
watch is the opposite failure: a load that never gets priced now has **no
shipper-facing way to nudge it**, only the WhatsApp backstop pinned to T1.

**Done when:** either the auto-pricing path is reliable enough that the absence
never shows, or T1 grows an explicit "still waiting?" affordance after some
interval. Not before there is real data on which it is.

### T4 draws a truck at a position nobody measured

The marker on `in_transit` sits at a point interpolated between the two cities
from the collection time and the road duration — a straight line at a constant
speed, on a corridor that is neither. The copy is written to never claim
otherwise ("arriving", never "the truck is here"), and the progress bar and the
marker share one number so they cannot contradict each other on screen.

It is still a guess drawn as a fact, and a shipper who watches it against a phone
call from their driver will notice.

**Done when:** P6 lands GPS. Until then, resist adding any copy to T4 that would
read as a live fix.

### P0 shipped a design system nobody has seen on a phone

Tokens, fonts, primitives, icons and numerals are in and tested, but P0
deliberately built none of the 32 designed screens. Every existing screen was
carried over mechanically to the nearest new token, so the app currently looks
**transitional**: right colours and type, old layouts. `src/components/legacy.tsx`
held the old vocabulary on new tokens until each phase replaced its screens; the
last one went on 2026-10-04 and the file with it.

**Done when:** every screen has been seen on a phone — the transition itself is
complete.

### Three of the handoff's text colours were sub-AA, and the ramp had to change

The contrast test now flattens `rgba` over its ground before measuring, which is
how these surfaced. Measured over `#F4F0E9`, the handoff's cream text ramp is:

| Handoff | Measured | Now |
|---|---|---|
| `rgba(22,23,26,.6)` body | 4.48:1 | `.72` |
| `rgba(22,23,26,.5)` tertiary | 3.29:1 | **deleted** — use `color.mutedText` |
| `rgba(22,23,26,.45)` label | 2.95:1 | `.61` |

Raising all three to pass collapses them onto ~`.61`, because ink-on-cream runs
out of headroom there — so cream has **two** text levels, not three, and the third
role uses the handoff's own solid `#6C6A63` (4.77:1). On ink, `.45` and `.42`
measured 4.26:1 and 3.84:1 and were raised to `.47`.

**Visible consequence:** helper text on question screens reads slightly darker
than the mockups. That is the cost of the AA commitment, applied consistently.

**Done when:** the designer has seen it and either accepts it or supplies a
palette that clears AA at the intended lightness.

### The handoff specifies no error colour, so one was invented

Every form in the product validates something and auth has to be able to say "that
code is wrong", but the handoff's palette has no red at all. Added `danger`
(`#C0341C`, 4.9:1 on cream) and `dangerLight` (`#FF8A80`, 8.6:1 on ink) — two
tones for the same reason the accent has two, and deliberately pinker than
`accentLight` so an error never reads as the action in sunlight.

**Done when:** the designer confirms the hues, or replaces them.

### The primary button deviates from the handoff by ~2px

The handoff specifies `700 17px` on `#F1551F`. That is 3.47:1 and fails WCAG AA,
which drops to 3:1 only at 18.66px bold. The label stays at or above that
threshold instead. This is the only deviation from the handoff's type scale, and
it is deliberate. `tests/unit/contrast.test.ts` computes it from the tokens.

### Icons carry three known compromises

- **`pickup`, `pay` and `goods` all resolve to the same `box` shape.** A screen
  showing pickup and payment together renders two identical icons, which
  undermines the point of a semantic icon map. Needs distinct art.
- **`whatsapp` reuses the generic message bubble** rather than the WhatsApp mark.
  Acceptable — no brand mandate — but worth revisiting.
- **Nothing has been seen rendered.** Geometry was verified by tracing
  coordinates inside the 24-unit viewBox, not by looking at it.

**Done when:** the set has been seen at 20px on a device, and `pickup`/`pay` are
visually distinct.

### The three font families have not been measured on a real device

Archivo, Instrument Serif and IBM Plex Sans Arabic are bundled rather than
fetched, which is right for the audience and costs app size. Nobody has measured
the increase, and nobody has seen Instrument Serif render at 76px on a cheap
Android screen — the T2 price is the largest type in the product and the least
tested.

**Done when:** the bundle delta is measured and both display faces have been seen
on target hardware.

### Smaller things P0 left, each real but not blocking

- **`SelectRow`'s ink-ground radio ring is untested.** The ring was hardcoded to a
  cream value that is nearly invisible on ink; that is fixed, but every test stays
  green if it reverts. Assert it when a screen first uses `ground="ink"`.
- **`accessibilityRole="radio"` has no `radiogroup` parent**, so a selected option
  is announced without its set. Belongs to a P7 accessibility pass.
- **The i18n key-parity test only samples a curated list**, and the `ar` table is
  `Partial<Record<StringKey, …>>` — so a *missing* Arabic string is not caught.
  Bilingual RTL is a project non-negotiable, so this guard is weaker than it
  looks. P7.
- **`Notice`'s decorative icon is not hidden from the accessibility tree.**
- **`arabicize` clears `letterSpacing` by setting it to `undefined`** rather than
  deleting the key. Verified equivalent in React Native's style flattening — and
  in fact stronger, since it clears an earlier value — but it depends on
  `arabicIfNeeded(...)` staying first in any `StyleSheet.flatten([...])` array.

### 33 of the 46 city coordinates are gazetteer data, unconfirmed by anyone local

`0020` gives every city a lat/lng. Thirteen are the design handoff's own values;
the other 33 are public gazetteer data, marked `-- gazetteer` in the migration.

Three layers guard them, and it is worth being precise about what each cannot do:

| Guard | Catches | Misses |
|---|---|---|
| `0020` constraints | NULL, out-of-region, transposed lat/lng | a wrong town inside the box |
| `supabase/tests/tenant_isolation.sql` | the above, plus two cities on one point | the same |
| `npm run check:pins` | a coordinate in the sea (12 km tolerance) | a wrong town on land |

So a coordinate can pass everything and still be the wrong town. `npm run
preview:map` renders both framings with every pin labelled, to
`.superpowers/map-*.svg`, which is the only way to check that.

Reviewed once on 2026-07-30 and the geography reads correctly — the Batinah
sequence, Buraimi against Al Ain, Khasab on Musandam, Sur on the east cape,
Salalah/Taqah/Mirbat along the Dhofar coast. **That review was not done by
someone who lives in Oman**, which is what this entry is still open for.

**Done when:** someone who knows the country has looked at the preview and
confirmed the 33, and any correction has landed as a NEW migration — `0020` is
applied and migrations are append-only.

### Riyadh and Jeddah cannot be pins, by geography

They sit outside the handoff's regional framing entirely (Jeddah is on the Red
Sea, 39.2E, against a framing that starts at 51.6E). Dammam is inside it.

They stay reachable through the searchable city list, which is the complete
index — the map is an orientation aid, not the only way to choose a city, so no
shipper is blocked (`CLAUDE.md` #6). But **a shipper picking Jeddah will see the
map show nothing move**, and P3 needs to handle that rather than leaving a dead
map beside a live selection.

**Done when:** P3's city picker does something sensible when the chosen city is
off-frame.

### The map has not been seen on a device

Projection, layers, corridor and pins are unit-tested, and `npm run preview:map`
renders them — but only as an SVG on a desktop. SVG with 46 pins plus country
geometry is the first real vector work in this product, and the target is a cheap
Android phone.

**Done when:** a real map screen has been opened on target hardware and scrolls
without dropping frames.

### RESOLVED — the "intermittent" jest failure was a midnight bug

Recorded during P0 and P1 as a flake that passed on rerun. It was not
intermittent: `tests/unit/format.test.ts` built a deadline of `now + 1 hour` and
asserted the formatter shows no weekday "because it is today". For the last hour
of every day that deadline is **tomorrow**, the formatter correctly adds a
weekday, and the test fails. Wrong for one hour in twenty-four, which is exactly
often enough to look random.

Found at 23:29 while running P3's suite. Both affected tests now freeze the clock
to midday. **If a single red appears again, do not assume flakiness — that
assumption cost several reruns here.**

### P3 shipped, with three approximations worth naming

**The road distance is a factor, not a route.** `src/map/distance.ts` is a
great-circle distance times 1.35, and every screen that shows it says "about".
Straight-line Muscat→Barka is 55 km against ~80 km by road, so a bare figure
would be visibly wrong to someone who drives it weekly. The factor was derived
from three real corridors and is a single constant — when a routing source
arrives, that file is the only thing that changes.

**The estimate is usually absent.** The rate card ships empty, so
`estimate_route` returns `no_rate` on essentially every call, and S9 says a
person will price it. That is the designed path, not a bug — but it means
**nobody has seen the priced version of that card outside a test.**

**"From the last 40 trips here" was cut** from S9's copy. There have been no
trips, and rule #5 forbids inventing them. If a corridor's real completed-trip
count is ever worth showing, it can be computed then.

### The booking flow has not been walked by a person

Eight screens, a persisted draft, and a real `post_load` call — all of it
compiles, exports and is unit-tested, and none of it has been opened. The most
likely failures are the ones tests cannot see: the sheet covering the map on a
short screen, the keyboard covering the weight field, the city list scrolling
inside a fixed sheet.

**Done when:** someone completes S3→S9 on a device and a load appears.

### The loads tab still uses the pre-redesign card — RESOLVED 2026-08-01

Closed by P7. X1 rebuilt `(tabs)/loads.tsx` on the new system and
`src/components/load-card.tsx` is deleted.

### The road factor is one number doing a job that needs two

`private.route_km` is a great-circle distance times `road_factor_pct` (default
135). Measured against real road distances:

| Route | Estimated | Real | Error | Implied factor |
|---|---|---|---|---|
| Muscat→Barka | 73 km | ~80 km | −8% | 1.47 |
| Muscat→Sohar | 259 km | ~230 km | +13% | 1.20 |
| Muscat→Salalah | 1158 km | ~1030 km | +12% | 1.20 |

Short trips run on local roads and need a *higher* factor; long trips run on
highway and need a lower one. A single constant cannot serve both, so it
**over-charges long routes by roughly 12%** — and long routes are where the
per-km term dominates the price.

It is a setting (`private.app_settings.road_factor_pct`), so it can be tuned from
the console without a migration. **Tune it toward the trips that carry the most
money before real rates go live.**

**Done when:** either a real routing/distance source replaces the factor, or the
value is set deliberately by someone looking at the corridor mix.

### The client and the server each compute a road distance — NARROWED 2026-08-01

`src/map/distance.ts` (display) and `private.route_km` (pricing) implement the
same arithmetic in two languages. Pricing cannot use the client's number — a
client-supplied multiplier on a price is a client-supplied price — so the
duplication is deliberate. The risk is drift.

**They agree today.** Both are 1.2; this entry used to say 1.35, which stopped
being true at `0025_road_factor_120.sql`.
`tests/security/schema-invariants.test.ts` now reads the last value any migration
assigns to `road_factor_pct` and asserts the client constant matches, so
migration-time drift fails in CI instead of showing a shipper one distance and
charging from another.

**What that does not cover:** `road_factor_pct` is a runtime setting on purpose
(0025 says so — it is meant to be retuned from the ops console once there is real
trip data). A retune there moves the server and no static test can see it.

**Done when:** `quote_route` and `quote_load` return the km they priced from, and
S4 and the review screen display that instead of deriving one. That is a
migration, so it did not happen here.

### Loading the dev rate card breaks `npm run test:db`

`npm run seed:rates` writes 320 fake cards and 640 audit rows. `ops_console.sql`
asserts exact counts on both, so the suite fails until
`npm run seed:rates:clear` runs — and the audit table needs truncating too,
because clearing the cards does not remove their history.

**Done when:** the SQL suites assert relative counts, or seed into a separate
database. Until then: clear before testing.

### The ops screens were deleted from this repo

Dispatch is web-only now, at `~/truckkoo-ops`. `masthead.tsx` and
`consignment.tsx` went with them — they had no other caller. No migration, grant
or RPC changed, so the web console does not notice.

**Consequence:** nobody can dispatch from a phone. If that turns out to matter,
it is a rebuild against the new design system, not a revert.

---

## The interface rewire (2026-07-28)

The shipper and driver surfaces were rebuilt onto Uber's structural skeleton —
bottom tab bar, one big entry point, stepped flows, pinned CTA, icons, shadows —
keeping the Truckkoo palette. `DESIGN.md` now carries a divergence note; the app's
system is `src/theme/tokens.ts`. What is not settled:

### It has been seen on a browser, not on a phone

Every screen was driven and screenshotted at 390×844 in headless Chromium against
a local Supabase, signed in as a real shipper and a real driver. That is more than
this app has ever had — but it is `react-native-web`, not iOS or Android. Shadows,
the tab bar's safe-area inset, `insetInlineEnd` on the offers badge, and the
camera sheet on `trip/[id]` are exactly the things web renders differently or not
at all.

**Done when:** both journeys have been walked on a real Android device, which is
the target hardware. This does not close the older "nothing has been seen running
on a real device" entry below — it narrows it.

### The load detail screen is the only way to reach a live load's price

Home and the loads tab now show a card; "Get a price", the `finding_truck`
backstop and the driver's contact all moved behind a tap into `load/[id]`. That is
the right hierarchy, but it is one more tap than before for the single action a
waiting shipper most wants.

**Watch for:** if shippers stop asking for prices after this ships, the tap is the
reason and the ask belongs back on the card.

### RTL has not been looked at since the rewire — SUPERSEDED 2026-08-01

The premise is gone: the Arabic dictionary is no longer partial, and P7 added
`tests/components/rtl.test.tsx` and `tests/unit/no-literals.test.ts` to enforce
the mechanical rules this entry was worrying about.

What it was actually asking for — that someone *render* a screen right-to-left —
is unchanged and now lives with the P7 entries at the top of this file, alongside
issues 30 and 35. The three components named here (`RouteLine`, the tab badge,
the `ListRow` chevron) are still the ones to look at first.

### The horizontal "waybill book" was deleted

`src/components/waybill-book.tsx` and its 20-odd tests are gone, replaced by the
tab bar. It was a considered piece of work and the reason it went is not that it
was bad: it was an invented navigation shape, and this audience has no prior for a
horizontal pager. Recorded here so the deletion is a decision rather than a gap.

---

## The ops console (0015–0018)

Added 2026-07-27. Migrations `0015`–`0018` and a separate web app at
`~/truckkoo-ops`. What is not settled:

### The console has never run against the production project

Every screen and every RPC has been exercised against a **local** Supabase — over
HTTP as a signed-in dispatcher, not only through tests. None of it has touched
the real project, and no dispatcher has been appointed there.

**Done when:** the console is deployed, a real dispatcher account is in
`private.ops_users` on production, and one load has been moved through it end to
end. See `truckkoo-ops/DEPLOY.md`.

### Ops can mark a delivery with no proof photo

`ops_set_trip_status(..., 'delivered', ...)` does not require a photo, while the
driver's `advance_trip` still does. This is deliberate — the case is a driver
ringing in from somewhere with no signal, and refusing would either lose the
delivery record or push dispatch back to a raw UPDATE. The trip event records
that there was no proof, so it is findable and countable.

**Watch for:** if this becomes the normal path rather than the exception, the
proof-of-delivery guarantee is worth less than it looks. Nothing counts it yet.

### The rate card is now reachable from a browser

A deliberate widening, recorded in `STACK.md` §2c and `CLAUDE.md` 3b rather than
inherited. The table still has no client grant and the formula is still SQL-only,
but an appointed dispatcher can now read the card from a web page, which was
previously true only at a psql prompt.

**Watch for:** this is the thing to reverse first if a dispatcher account is ever
compromised. Revoking execute on the three `ops_*_rate_card` functions closes it
without touching anything else.

### `ops_audit` has no retention policy

It grows without bound and nothing prunes it. That is the correct default for an
audit log, but it is a decision nobody has made explicitly.

**Done when:** either a retention period is chosen and implemented, or a note
here says it is deliberately permanent.

---

## Auth — needs a live Supabase project to verify

These came out of building the password-reset flow (2026-07-26). None can be
settled from the codebase alone.

### 1. Redirect URLs — RESOLVED 2026-07-26

Closed by `npx supabase config push`. The allow-list now lives in
`supabase/config.toml` under `auth.additional_redirect_urls`, so it is version
controlled rather than a dashboard setting nobody remembers changing. Remote
reports `Auth config is up to date`.

**Do not run `supabase config push` from a fresh `config.toml`.** It pushes the
whole `[auth]` block, and the CLI defaults are weaker than the project's: the
first push here silently set the email rate limit to 1 second (from 1 minute),
dropped the email OTP to 6 characters (from 8), and turned TOTP MFA off. Those
were corrected in a second push. Always read the printed diff.

<details><summary>Original issue</summary>

Project: `sbwjfjphumqhdmmanimb`. `src/lib/auth.ts` sends three app-scheme URLs:

- `truckkoo://reset` — password reset
- `truckkoo://confirm` — signup email confirmation
- `truckkoo://` — OAuth return

If a URL is not in Supabase → Auth → URL Configuration → Redirect URLs, Supabase
**silently falls back to the Site URL**. The link then lands on the marketing
website, which has no reset form and no confirm handler. The user hits the exact
dead end the feature exists to remove, and nothing errors anywhere.

Email confirmation is **on** for this project, which is what makes
`truckkoo://confirm` load-bearing rather than optional: without it a new user
signs up, gets no session, and cannot reach the role and truck steps.

**Done when:** all three are listed in the dashboard, and a real confirmation
email and a real reset email have each been tapped on a device and landed on the
in-app screen.

</details>

The remaining half is still open: **no confirmation or reset email has been
tapped on a real device.** The allow-list is right; the round trip is unproven.

### 2. `flowType: 'pkce'` has never run against a live project — HIGH

`src/lib/supabase.ts` now pins PKCE. This fixed a real defect — the OAuth path
in `signInWithProvider` reads `?code=` and calls `exchangeCodeForSession`, which
only exists under PKCE, while supabase-js defaults to implicit — but the fix was
reasoned, not observed. The whole Google/Apple sign-in path is unexercised.

**Updated 2026-07-30.** Two corrections to the assumption above, and one real fix.

- **Google does not need a dev build.** It is a browser flow
  (`WebBrowser.openAuthSessionAsync`), which works in Expo Go. The `exp://`
  redirect just has to be allow-listed alongside `truckkoo://`.
- **Apple on iOS is now native**, via `expo-apple-authentication` and
  `signInWithIdToken`. It was a browser flow, which Apple rejects at review once
  another social login is offered. `expo-apple-authentication` is bundled in
  Expo Go, so this does not need a dev build either. The button is now hidden on
  Android, where Apple does not require it.
- `exchangeReturnedUrl` now handles a fragment response as well as `?code=`. PKCE
  should always give the code, but if a dashboard setting or provider puts the
  flow on the implicit path, the previous code returned "something went wrong"
  and looked exactly like a dead button.

**Still unproven:** no provider sign-in has completed end to end, because the
consoles are not configured yet. `AUTH_SETUP.md` is the checklist.

**Done when:** Google completes on Android, and Apple completes on a real iOS
device or EAS build.

### 2b. PKCE email links only work on the device that asked for them — MEDIUM

Both the confirmation and reset links carry a PKCE `code`, and exchanging it
needs the code *verifier*, which supabase-js stored in SecureStore on the device
that initiated the flow. A user who signs up on their phone and then opens the
email on a laptop, or on a second phone, will get "that link has expired" while
holding a link that is in fact fresh.

This is inherent to PKCE, not a bug in the implementation, and it is the correct
trade for a public client. But the error copy currently blames expiry, which
will be wrong some of the time and unhelpful every time.

**Done when:** the failure copy names the real cause ("open this link on the
phone you signed up with"), or the flow falls back to a token-based verify for
the cross-device case.

### 3. Custom URL schemes are claimable by other apps on Android — MEDIUM

`truckkoo://` can be registered by any other app on the device. PKCE limits the
damage: an intercepted code is useless without the verifier held in this app's
process. The proper fix is App Links (Android) and Universal Links (iOS), which
are domain-verified and cannot be hijacked.

**Done when:** `assetlinks.json` and `apple-app-site-association` are served
from the truckkoo domain and the redirect URIs are `https://` rather than
`truckkoo://`.

### 4. A password reset does not end other sessions — MEDIUM

After `completePasswordReset`, sessions on other devices keep working. Whether
Supabase revokes them depends on project config that is not visible from here. A
reset usually implies the old password may be compromised, in which case the old
sessions should die with it.

**Done when:** the intended behaviour is decided explicitly, and either the
project setting is confirmed or `signOutEverywhere()`-equivalent revocation runs
as part of the reset.

### 5. Password minimum — RESOLVED 2026-07-26

Was 6 server-side against a UI promising 8, i.e. a client-side-only check.
`auth.minimum_password_length` is now 8 in `config.toml` and pushed.

### 5b. Email confirmation is TEMPORARILY DISABLED — must re-enable before launch — HIGH

Turned off on 2026-07-26 to unblock testing: with it on, web signup
(`expo start --web`) bounced to the marketing site because the emailed link's
redirect was not reaching an in-app screen. With confirmation off, signup returns
a session immediately — no email, no redirect — so the flow can be exercised.

`enable_confirmations = false` in `config.toml` (auth.email) and pushed to
`sbwjfjphumqhdmmanimb`. It is flagged in the file at the setting itself.

This weakens the product: "email verification" is a promise, and while it is off
**any account created earlier but never confirmed can now sign in** — the gate is
down for everyone, not just new signups.

**Before launch, all three:**

1. Set `enable_confirmations = true` in `config.toml`, then `npx supabase config
   push` (read the diff).
2. Clear test users: Dashboard → Authentication → Users. Otherwise unconfirmed
   test accounts remain valid logins.
3. **Keep** the web redirect URLs added under `auth.additional_redirect_urls`
   (`http://localhost:8081[/**]`, `http://127.0.0.1:8081[/**]`). They are
   dev-only and harmless, and confirmation-on immediately needs them again for
   web signup and reset to land in-app.

**Done when:** confirmation is back on, test users are cleared, and a real
confirmation email has been tapped and landed on the in-app confirm screen
(closes the still-open half of issue 1).

---

## UI — unverified on a device

### 9. The horizontal pager has never run in Arabic (RTL) — HIGH

`src/components/waybill-book.tsx` pages sheets with a horizontal `FlatList`.
Horizontal scrolling is the one place React Native's RTL support is genuinely
inconsistent between iOS and Android, and between versions.

Two deliberate choices reduce the exposure but do not close it: the current page
index comes from `onViewableItemsChanged` (item indices, which do not move under
RTL) rather than from `contentOffset` arithmetic, and the content padding uses
`paddingStart` / `paddingEnd` rather than left/right. What is unverified is
whether `scrollToIndex` with `viewOffset` lands correctly when the scroll origin
is the right edge, and whether the sheets are laid out in reading order at all.

**Done when:** both home screens have been paged through on an RTL device or
simulator, in both directions, with the tab strip tracking correctly.

### 10. Neither home screen has been seen rendered — MEDIUM

They typecheck, lint, and bundle, but the app cannot boot without a live
Supabase project, and both screens sit behind the auth gate. Layout maths that
compiles is not layout maths that is right: sheet width, the 12pt next-sheet
peek, the final sheet's snap position, and the tab strip's overflow at small
widths are all unconfirmed. First run on a device should start here.

---

## Development environment

### 23. Expo Go cannot run this project — use a development build — HIGH

Reported 2026-07-27: every phone shows *"project is incompatible with this
version of Expo Go"*. The installed Expo Go supports **SDK 54**; this project is
**SDK 57** (RN 0.86, React 19.2.3). Expo Go supports exactly one SDK at a time.

`npx expo-doctor` passes 19/20 — the only failure is `@types/jest`, dev-only. The
project is not broken; the client is mismatched.

An Expo Go client **does** exist for SDK 57 (`57.0.2`), so the fastest unblock on
Android is updating or sideloading it from
`https://expo.dev/go?sdkVersion=57&platform=android`. On iOS you cannot sideload,
so if the App Store's Expo Go is on 54 that route is closed there.

**The real answer is a development build**, which STACK.md §3 already required
"from roughly day two" and called "the most common thing that derails first-time
app developers" — which is exactly what happened. `eas.json` did not exist and now
does, with `development` / `preview` / `production` profiles.

```
npx eas-cli login
npx eas-cli build --profile development --platform android   # APK, free tier
```

**Do not downgrade to SDK 54 to satisfy Expo Go.** It would move RN 0.86 → 0.81.5
and React 19.2.3 → 19.1.0, touch every `expo-*` dependency, and buy only Expo Go —
which has to be abandoned anyway for native Google/Apple sign-in.

**Before the build runs:** `EXPO_PUBLIC_SUPABASE_ANON_KEY` must be set as an EAS
environment variable. It is deliberately not in `eas.json` — that file is
committed, and while the anon key is public by design, the repo's convention
(SECURITY.md §9) is that only `.env.example` carries key names.

**Largely closed 2026-07-27.** An EAS development build
(`@aanwarsadaths-team/truckkoo`, build `5400cf94`) was installed on an Android
emulator and the app runs. That was the first time any screen in this project had
been seen rendered, which also closes the bulk of issue 10.

Still open: it has run on an **emulator**, not a real phone. The constraints that
actually matter — sunlight, one-handed use in a cab, a cheap device on bad signal
— are untested, and the emulator is x86_64, so RTL layout and the Arabic font
stack should be re-checked on hardware before either is trusted.

**Done when:** the build has run on a real Android phone.

### 11. `web.output` was `static` — RESOLVED 2026-07-26

`app.json` had `web.output: "static"`, which turns on expo-router's server
rendering. Every full page request re-bundled `entry.js` and server-rendered it,
leaking each time: the dev server died with `FATAL ERROR: Ineffective
mark-compacts near heap limit` after a handful of requests. Not memory
contention — the whole Supabase stack uses ~486 MiB.

Raising `--max-old-space-size` does **not** fix this. It only moves the ceiling;
the leak walked straight through 3584 MB too.

Now `web.output: "single"` — a client-rendered SPA, which is the correct setting
for an app that ships native and only uses web as a preview surface. Zero
re-bundles across 30 route loads, RSS flat at 248 MiB on the default heap.

If web ever becomes a real product surface with SEO needs, revisit — but then
the leak needs a proper fix rather than a bigger heap.

---

## Data quality

### 12. `legs.truck_id` is never populated — LOW

`post_leg()` accepts `p_truck_id` and validates that the driver owns it, but the
parameter defaults to NULL and no client passes it: `post-leg.tsx` never asks
which truck, because a driver registers exactly one at signup.

This surfaced when `trip_truck()` (0008) became the first reader of
`trips.truck_id` and returned nothing — every trip had been created with a NULL
truck since the beginning, silently. `0009` fixes the symptom by falling back to
the driver's sole truck when the leg names none, and declines to guess when they
own several rather than stamping a delivery with a plate we picked.

The underlying data is still thin: a leg does not record which truck will run it.
That only becomes wrong once a driver owns more than one truck, at which point
`post-leg.tsx` should ask.

Partly mitigated 2026-07-27: `private.candidates_for` (0012) resolves the truck
per candidate with a lateral that prefers `legs.truck_id` when set and otherwise
picks the driver's **smallest truck that still fits**, so a multi-truck driver
now yields one candidate row rather than one per truck, and dispatch sees a
plausible truck either way. The leg still does not record the choice.

**Done when:** either a driver can own multiple trucks and the leg records which
one, or `post_leg`'s unused parameter is removed so the schema stops implying a
capability that does not exist.

---

## Pricing

Added 2026-07-26 with `0010_pricing.sql`.

### 13. The rate card is empty, so every price is currently manual — HIGH

`private.rate_cards` ships with **zero rows**, deliberately: rates are real
commercial information and inventing them in a migration would put fabricated
numbers in front of customers in Omani rial. Until bands are loaded, `quote_load`
returns `no_rate` for every priceable load, the load moves to `finding_truck`, and
a dispatcher prices it by hand with `ops_set_price`.

This is a working product — it is the concierge flow the app already promised —
but it is not the automated one. Nothing is broken; nothing is automatic either.

Loading a band needs three numbers per corridor pair per truck type
(`base_baisa`, `per_tonne_baisa`, `min_fare_baisa`) from someone who prices Omani
freight. The insert template is at the foot of `0010_pricing.sql`. **Amounts are
baisa: 120 rial is `120000`.** 320 rows — every ordered corridor pair × 5 truck
types — covers all 2,070 city pairs.

**For development there is a fake card:** `npm run seed:rates` loads 320 invented
rows so the app shows prices; `npm run seed:rates:clear` removes them. It lives in
`supabase/seed_dev_rates.sql`, **outside `migrations/`** so `supabase db push`
cannot carry it to production, and it refuses to run without an explicit opt-in
flag. Those numbers are generated by a distance-tier formula and are not real
prices. Their existence does not close this issue.

**Done when:** the corridors Truckkoo actually runs have rates loaded, and a
shipper on a common route gets a price without a dispatcher touching it.

### 14. The corridor band is coarse, and Muscat→Sohar proves it — MEDIUM

A band prices every city pair inside it identically. Muscat→Sohar and
Muscat→Shinas are both "Muscat governorate → Batinah coast", but Shinas is roughly
twice as far. With one rate for the band, one of those trips is underpriced and
the other overpriced, and the underpriced one is the trip Truckkoo loses money on.

Accepted for now: it is the cost of not having a distance table, and hand-priced
loads (issue 13) sidestep it entirely while they are the norm. It gets worse
exactly as automation gets better, so it needs an answer before the card is
fully loaded.

**Done when:** either the bands are subdivided where the spread is worst, or
`distances` lands (`SENSITIVE_FIELDS.md`, Phase 3) and pricing moves to per-km.

### 15. No pricing screen has been seen rendered — MEDIUM

Same root cause as issue 10, and the same remedy. `PriceBlock` in `customer.tsx`
and the dispatcher's price field in `ops/[id].tsx` are covered by tests and
typecheck, but no one has watched a price render. Two specific things to look at
on first run:

- **The three-decimal amount at `font.title`.** "150.000 OMR" is wider than any
  other value on the sheet. Check it does not wrap or collide with the stamp.
- **The dispatcher's `decimal-pad` keyboard on Android.** If it hides the decimal
  separator, `parseMoney` rejects everything typed and the field looks broken.

### 16. Nothing re-quotes a load automatically — RESOLVED 2026-07-27

Decided: `post_load` now prices the load itself, via `private.issue_quote`
(0014) — the shared tail extracted from `quote_load` so there is still exactly
one place a route becomes a price.

The consequence flagged here is real and accepted: while the rate card is empty,
essentially every new load goes straight to `finding_truck`. That is the honest
outcome, because a human genuinely is pricing it, and `cust.finding.explain`
already says so in the shipper's own words. The decision the shipper used to make
by tapping "Get a price" is gone, which is one fewer decision on a screen — the
direction PRODUCT.md asks for.

`quote_load` still exists and is unchanged for the shipper who wants a fresh
price after the binding guard nulls one.

### 17. `ops_set_price` has no confirmation step — LOW

The server bounds the amount (>0, ≤ 1,000,000 OMR) and `parseMoney` rejects
malformed input, so the reachable mistakes are wrong-but-plausible amounts —
`12000` typed for 12 rial when it means 12,000 rial being the obvious one. A
dispatcher sees the parsed value only after sending.

Every price is recorded as an immutable quote, so a wrong one is auditable and
correctable by issuing another; it is not silently lost. But the shipper may have
seen it first.

**Done when:** the button confirms the parsed amount in words before sending, or
a dispatcher can void a price they just issued.

---

## Design critique — 2026-07-26

Full report: `.impeccable/critique/2026-07-26T18-53-03Z__src-app-app-driver-tsx.md`.
Scored **22/40** on Nielsen heuristics, Operate mode, both home screens.

### 19. Fixed in this pass

- **The driver could not see what a load paid.** `price_baisa` was fetched by
  `useVisibleLoads` and never rendered. Now on the offer sheet above Accept, with
  `driver.pay.pending` when no rate is set. This is the supply-side launch risk
  PRODUCT.md names, so it was the highest-value fix available.
- **A delivered load stopped being reachable.** `LIVE` excludes `delivered` and
  the record row had no `onPress`, so proof of delivery, the driver, the plate,
  and the price all vanished when the truck arrived. New
  `src/app/(app)/load/[id].tsx` renders a **completed consignment note** —
  reference, route, carrier, plate, verified stamp, dated milestones, photo,
  amount. Settlement is offline, so that record is the artefact the business
  actually needs.
- **The primary button failed WCAG AA at 3.47:1.** `font.button` is now 19/900.
  See issue 20 — the reason it shipped is worth reading.

### 20. DESIGN.md stated the contrast rule backwards — RESOLVED 2026-07-26

DESIGN.md §1 said *"`#f1551f` fails contrast as text on black. Use `#ff7a4d` on
dark backgrounds."* **Measured, that is inverted:**

| Pairing | Ratio | Verdict |
|---|---|---|
| orange on `#ffffff` | **3.47:1** | **fails** AA |
| orange on `--asphalt` `#0b0b0b` | 5.68:1 | passes |
| orange on `--asphalt-2` `#161616` | 5.22:1 | passes |

The documented hazard pointed at the safe direction, so nobody checked the
dangerous one — and the primary button shipped white-on-orange at 3.47:1, the
label on every Accept, Confirm delivery, and Post your first load.

Darkening does not fix it (`orangeDeep` on white is 4.41:1). The fix is crossing
WCAG's large-text threshold, where the bar drops to 3:1 — but that threshold is
**18.66px** for bold, so 18px still fails. `font.button` is 19/900 and the 0.34px
margin is the entire fix.

DESIGN.md is corrected, and `tests/unit/contrast.test.ts` now computes every
pairing from the tokens so guidance cannot drift from arithmetic again.

`color.orangeOnDark` is still preferred on dark surfaces — on legibility, not
contrast. It is also currently consumed nowhere in `src/`.

### 21. Critique findings NOT fixed — still open

- **P1 — "Message your driver" opens WhatsApp to Truckkoo.** `WHATSAPP_NUMBER` is
  hardcoded to Truckkoo's own line; the button is gated on `driver.phone` and then
  discards it. Either dial the driver or relabel. **Done when:** the label
  describes what the button does.
- **P1 — the driver's whole home fails if any of four queries fails.**
  `driver.tsx:79` ORs `trips`/`offers`/`loads`/`legs`. A routes-list timeout hides
  "Mark delivered" from a driver at a dock on one bar. `error.offline` exists and
  is referenced nowhere. **Done when:** gating is per-section.
- **P2 — decline is orange, adjacent to accept, unconfirmed.** `driver.tsx:211`
  says "never a second orange"; `primitives.tsx:169` paints it orange. It gets
  `disabled` but not `loading`, so a driver cannot tell which button they hit.
- **The single-orange rule is broken on every screen state** — up to five
  simultaneous. `hasPrimary` arbitrates buttons only; the masthead wordmark, route
  arrow, active tab rule, and count badge are outside its scope.
- **Arabic letter-spacing is never reset.** DESIGN.md §2 requires `0`; the token
  set tracks unconditionally. Tracking Arabic breaks cursive joining — legibility
  damage that lands the moment Arabic ships.
- **`reference()` hardcodes `NO.` and `formatWeight` hardcodes `kg`**, bypassing
  `t()` on a bilingual surface.
- **The swipe is undiscoverable.** 12px of white peek on white is the only
  affordance for the primary navigation.
- **Nothing persists the current sheet** across backgrounding — a driver returns
  to sheet 1 mid-decision, against `expires_at`.
- **Screen-level spinners and error blanks announce nothing**, and
  `announceForAccessibility` is used nowhere, so the two live regions are
  Android-only.
- **The tab `Pressable` has no `minWidth` or `hitSlop`** — the one interactive host
  whose 44pt minimum is not guaranteed by its style chain.

### 22. `trip_counterpart` excludes `closed`, `trip_truck` includes it — LOW

On a completed note for a `closed` load the truck would render and the driver's
name would not. Latent only: **nothing transitions anything to `closed` today**,
verified across all migrations. It becomes real the moment a close path is built.

**Done when:** either the two functions agree on terminal states, or closing is
implemented and this is decided deliberately — noting that a shipper arguably
should keep the carrier's *name* on the record while losing their *phone*.

## Signup

### 18. Driver signup had no truck picker — RESOLVED 2026-07-26

Step 3 of driver signup rendered the heading, the help text, the plate field, and
the validation message *"Please choose your truck size"* — with **no truck sizes
to choose from**. An unsatisfiable form at the last step of creating an account.
No driver could sign up.

Three correct decisions combined into a defect:

1. `cities` and `truck_types` are granted to `authenticated` only. `anon` gets
   `permission denied` — deliberate, since a driver who can edit
   `truck_types.capacity_kg` defeats capacity filtering in matching.
2. Both hooks set `staleTime: Infinity`, because reference data does not change
   during a session.
3. `sign-up.tsx` mounts at step 1, *before* any session exists.

So `useTruckTypes()` fired as `anon`, failed, and — because the observer belongs to
a component that stays mounted across all three steps — never refetched once the
session appeared at step 2. By step 3 the cached answer was still the failure, and
`(truckTypes ?? []).map(...)` rendered nothing.

Fixed in two places, deliberately both:

- **Root cause:** `useCities` and `useTruckTypes` now gate on `enabled: !!session`.
  Signup was the only pre-auth consumer — every other caller lives under
  `src/app/(app)/`, behind the auth gate — so the blast radius was this one screen.
- **Defence:** the truck step now renders explicit loading, empty, and retry
  states. A driver on bad signal reaches the empty case regardless of the fix, and
  "design for the cab, not the desk" means bad signal is the normal case, not the
  edge one.

Pinned by `tests/unit/reference-queries.test.tsx`, verified to fail without the
fix (4 of 6 assertions).

**The lesson is the same one `trips.truck_id` taught** (see the note in
`CLAUDE.md`): the failure was silent in both directions. The query failed and
nothing surfaced it; the list was empty and the screen rendered zero options
rather than saying so. Neither layer said anything was wrong.

**Still worth doing:** no test renders `sign-up.tsx` itself. The hook is pinned,
the screen is not — see 8c.

---

## Deferred by decision

### 6. Driver verification — implemented locally, validation pending

Migration 0050 and the signup/upload/ops review surfaces implement this flow.
Verification lives on `drivers.verified_at`; all four documents and a reviewed
truck with plate/capacity are required for new verification. Existing verified
records are grandfathered. See the Load 24 entries above for remaining validation
and deployment gates.

### 7. Arabic copy is partial — HALF CLOSED 2026-08-01

The dictionary is complete: all 387 English keys have an Arabic value as of P7,
and `tests/unit/i18n.test.ts` asserts it, so this cannot silently regress. The
auth, reset, date and picker keys this entry named are among them.

**The other half of the original "done when" stands**, and it is the harder
half: proofed by a native speaker, and walked end to end on an Arabic device.
211 of the strings are unproofed drafts. See the P7 entries at the top of this
file — that is where this is tracked now.

### 8. Client test suite — RESOLVED 2026-07-26

268 tests across 12 suites (unit, component, integration, security), plus the 157
SQL assertions in `supabase/tests/tenant_isolation.sql`. See `tests/README.md`.

It found a real bug on its first run: `parseMoney('12,,5')` returned 125000 baisa
because separators were stripped before validation, so a typo became a price.
Fixed in `src/lib/money.ts` with a named regression test.

### 8b. Coverage thresholds are unverified — LOW

`jest.config.js` sets floors (55% global; 95% on `money.ts` and `safe-text.ts`).
`npm test` passes, but `npm run test:coverage` has never been run, so the
thresholds may not actually be met — which would fail that command and any CI
step using it.

**Done when:** `npm run test:coverage` passes, or the floors are adjusted down to
the real numbers with a note. Never adjust them down to silence a regression.

### 8c. Untested surfaces

Not covered by the suite, and worth knowing before trusting it:

- `post-leg`, `trip/[id]`, and all four auth screens have no tests.
  Issue 18 was a driver-blocking bug in `sign-up.tsx` that no test could have
  caught; the hook underneath it is pinned now, the screen still is not.

  **Attempted 2026-09-26, abandoned rather than shipped broken.** A full
  `sign-up.tsx` walkthrough (account → role → details, both roles) hit a
  reproducible RNTL/Jest fault: the first test in the file to
  `fireEvent.press` the screen's `PrimaryButton` ("Next"/"Create account")
  leaves something in a bad state — "You seem to have overlapping act()
  calls" — and every render in every test *after* that one comes back empty
  (`toJSON()` is `null`, `queryAllByRole` finds nothing), even a bare
  `render(<SignUp />)` with no interaction at all. Isolated by bisection:
  - Renders with no interaction: fine, repeatably.
  - `fireEvent.changeText`: fine.
  - Pressing a raw `Pressable` (`Choice`, no animation): fine.
  - Pressing `PrimaryButton` specifically (`usePressScale`'s
    `Animated.timing(..., { useNativeDriver: true })` on press-in/out): breaks
    every subsequent render in the file, unconditionally.
  - Mocking `Animated.timing` to a synchronous no-op did **not** fix it.
  - Waiting up to 500ms (`await act(async () => { await sleep(500) })`) after
    the press did **not** fix it — ruling out "just needs more time to
    flush."
  - Explicit `unmount()` before the test ends did **not** fix it either.

  So the state corruption is not a timing race, it looks structural, and it
  reproduces with `PrimaryButton` (shared by every screen in the app) inside
  *this* screen's tree specifically — the same component is pressed
  hundreds of times across `shipper-screens.test.tsx` /
  `driver-screens.test.tsx` with no such failure, so whatever combination
  triggers it is not simply "press a PrimaryButton in a test." Recorded
  rather than worked around with a same-file-single-test rule, which would
  quietly cap this screen at one interactive test forever.

  **Done when:** someone with more Jest/RNTL-internals time than this pass
  had finds the actual interaction (candidates: `KeyboardAvoidingView`
  combined with `Animated`'s JS-driven fallback under Jest's fake native
  module, or something about `Screen`'s `SafeAreaView` nesting specific to
  this screen), or reproduces it minimally enough to file upstream.
- `completeEmailConfirmation` / `completePasswordReset` — the two flows that have
  never been exercised at all. Needs Mailpit or a device.
- RTL *layout*. `align` and `directionArrow` are tested; whether the horizontal
  pager lays out correctly in Arabic is not, and cannot be without a device.
- Storage policies are asserted statically against the SQL, not exercised.

---

## Automated dispatch

Added 2026-07-27 with `0012_tiered_candidates.sql`, `0013_offer_lifecycle.sql`
and `0014_auto_dispatch.sql`.

### 24. An unprivileged shipper can now cause cargo reads by drivers — MEDIUM

`post_load` auto-dispatches, and an offer grants its driver read access to the
load via `private.driver_has_offer`. So posting a load automatically widens who
can read that shipper's goods description, weight and route — up to
`auto_dispatch_max_offers` drivers — with no human reviewing it first. That is
the largest automated widening of cargo visibility in the schema, and it is
triggered by the least privileged actor in the system.

It is **not** a load board: each driver still sees only the offer addressed to
them, nothing enumerates loads, and `create_offer` remains revoked from every
client role. The controls are tier-1-only matching, zero window grace, the
fan-out cap, the per-driver pending cap, and the kill switch — all settings in
`private.app_settings`, all changeable without a migration.

Accepted deliberately: the alternative is that a shipper waits for a dispatcher
to open a screen before a truck already going that way hears about their load,
which is the delay the product exists to remove.

**Watch for:** any widening of `auto_dispatch_max_offers`, and any change that
lets tier 2 or tier 3 auto-dispatch. Both convert a bounded exposure into an
open one.

### 25. The per-driver offer cap is a guess — LOW

`auto_dispatch_max_pending_per_driver` defaults to 3. It is the only thing
stopping a shipper posting their hourly allowance of 20 loads on a corridor they
know one driver runs and burying that driver in offers.

Three is not derived from anything. It should be tuned once there is real volume,
and the useful signal is `private.dispatch_log`: a rising count of candidates
with a flat `offers_sent` means the cap is biting.

**Done when:** the number is set from observed behaviour rather than assumption.

### 26. `auto_dispatch_requires_price` ships false — MEDIUM

Auto-offers reach drivers before anyone has priced the load, so they show
`driver.pay.pending` — "Truckkoo will confirm the rate with you before pickup."
PRODUCT.md names driver-side pay visibility as the supply-side launch risk, and
this is exactly that risk on an automated path.

It ships false on purpose: `private.rate_cards` is empty (issue 13), so with the
gate on, auto-dispatch would fire zero times and the feature would ship dark with
no way to tell working from broken.

**Done when:** real rates are loaded and the gate is flipped, before real drivers
are on the platform:

```sql
update private.app_settings set value = 'true'::jsonb
 where key = 'auto_dispatch_requires_price';
```

### 27. Expired offers are swept by hand — LOW

Offers expire lazily: nothing moves a `pending` offer to `expired` except the
owning driver answering it, which for an offer they are ignoring never happens.
`ops_sweep_expired_offers()` reclaims those loads, and there is a button for it
on the dispatch queue — but nothing runs it on a schedule, because `pg_cron` is
not enabled on this project.

The decline path works around the gap (it ignores timed-out siblings when
deciding whether a load is stuck), so no load is *stranded*. But a load whose
offers all quietly timed out sits under "Offer out" until a dispatcher presses
the button.

**Done when:** `pg_cron` runs the sweep, or the dispatcher's routine formally
includes it.

---

## P5 · the driver (2026-07-31)

### 28. There is no remittance ledger — MEDIUM

The driver collects the shipper's price **in cash** at the gate and owes Truckkoo
the difference. D1, D2 and D7 all say what that difference is, per load, which is
the whole of what P5 does about it: nothing records that a remittance happened,
so a driver who collects and never remits is invisible to the app.

This was named in the spec (E8) and left undone deliberately. Collecting money is
an operations problem, and a screen that implied the app was tracking a debt it
cannot see would be worse than a screen that says nothing.

**Done when:** either a ledger exists (`driver_balances`, credited on delivery,
debited by an ops-recorded remittance, visible to the driver) or the settlement
model changes so the driver is never holding Truckkoo's money.

### 29. The detour is great-circle × the road factor, between city centres — LOW

`private.detour_km` (0029) costs the whole loop — leg origin → pickup → dropoff →
leg destination, minus the direct leg — which is the honest shape. The inputs are
not: each hop is `private.route_km`, which is a great-circle distance between two
city *centres* scaled by `road_factor_pct`. Oman's roads are neither straight nor
centred.

The copy says "about" everywhere the number appears, which is the mitigation, not
a fix. A driver who knows the road will notice.

**Done when:** a real distance matrix (or Phase 3's PostGIS work, `STACK.md` §8)
replaces `route_km`. Both the detour and the price improve at once, because they
share it.

### 30. D1–D7 have not been seen on a device, or in Arabic — MEDIUM

The whole driver surface is verified by tests only. Two specific risks that tests
cannot reach:

- **Arabic, RTL — NARROWED BY P7, NOT CLOSED.** The detour line named here was
  the worked example, and it is fixed: `drv.offer.detour` is one interpolated
  key per language now, so the Arabic places both the number and the unit
  itself. The strings that "exist in both languages" actually did not — 214 of
  387 keys had no Arabic at all, including every tab label and every status
  pill; P7 completed the dictionary, and 211 of those strings are still
  unproofed drafts (see the P7 section at the top of this file).
  `tests/components/rtl.test.tsx` now asserts the mechanical rules and
  `tests/unit/no-literals.test.ts` guards the lexical ones.

  **What is still open is the original claim: nobody has LOOKED at a driver
  screen in Arabic.** React Native applies RTL natively — flipping
  `flexDirection`, `marginStart` and the view tree — and the test renderer
  reproduces none of it, so a green suite says nothing about layout on a phone.
- **The 64px delivery button and the photo step**, which is the only part of the
  product that touches the camera and a private bucket at the same time.

**Done when:** a driver account is driven end to end on a real Android phone, in
both languages.

### 31. `driver_earnings` counts a trip from its delivery event — LOW

The week's total buckets on `max(trip_events.occurred_at) where type =
'delivered'`, falling back to `trips.created_at` when there is no such event. The
fallback exists because a trip can reach `closed` through an ops path that writes
no delivery event, and dropping those would understate a driver's week.

It means a trip closed without an event is dated by when it *started*. For a
long-haul closed weeks later, that is the wrong week.

**Done when:** every terminal transition writes a `trip_events` row, at which
point the fallback can be deleted rather than merely documented.

---

## P6 · live GPS (2026-07-31)

### 32. The app is backgrounded for most of a long haul, so few fixes arrive — MEDIUM

Foreground-only reporting was chosen deliberately (spec F1): background location
needs an App Store background-mode justification, an Android foreground service
with a Play Console demo video, and a licensed library, and `STACK.md` calls it
the single hardest thing in the product. The cost is that a driver's phone is in
their pocket for most of an eleven-hour Muscat→Salalah run, so the shipper sees a
correctly-stamped old position rather than a moving one.

That is honest and it is also thin. The thing to watch is shippers phoning to ask
where the truck is — which is the question T4 was supposed to answer.

**Done when:** either background tracking ships — a **client** change, because
`trip_positions`, the RLS posture and `trip_position()` are already what it needs
— or the calls stop.

### 33. Nothing runs the position sweep — MEDIUM

`ops_sweep_positions()` is a dispatcher action, because `pg_cron` is not enabled
on this project. This is the same shape as issue 27, which records the expired-
offer sweep going stale for exactly that reason.

`ops_position_health()` was added so a forgotten sweep is a number on the console
rather than an invisible pile of driver movement. That makes it **visible**; it
does not make it **happen**.

**Done when:** `pg_cron` runs it, or the dispatcher's routine formally includes it
and the console surfaces the oldest-point age where somebody looks daily.

### 34. `avg_speed_kph` is a guess — LOW

65 km/h across every corridor, ignoring terrain, border crossings, rest stops and
the difference between the Batinah highway and the Salalah run. It is a setting
in `private.app_settings` rather than a constant, so retuning it needs no
migration — but nothing has tuned it, and the ETA on T4 is only as good as it is.

**Done when:** there is enough delivered-trip history to fit a speed per corridor,
at which point it should stop being one number.

### 35. `expo-location` has never run on a device — MEDIUM

`tests/unit/position-reporter.test.tsx` mocks the module. It proves the wiring —
foreground permission only, the watcher starts on a live trip and is torn down
when the trip ends, a fix reaches the RPC — and it proves none of: that a fix
actually arrives on a cheap Android phone, that the 60s/500m interval behaves in
a moving vehicle, or what the battery cost is over eleven hours.

This compounds with issue 30: **no driver screen has been seen on a device at
all** — in either language. P7 narrowed the Arabic half of 30 to a layout
question, and a layout question can only be settled here.

**Done when:** a driver account is driven end to end on a real Android phone,
including a trip that reports positions and one that is denied permission.
