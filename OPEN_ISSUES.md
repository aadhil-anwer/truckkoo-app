# Open issues

Things known to be unresolved, unverified, or deferred. Each entry says what it
is, why it is not done, and what "done" would look like — so none of them
survives by being forgotten.

Add to this file rather than leaving an uncertainty in a commit message. Delete
an entry only when it is actually closed.

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

### An accepted price is committed, and nothing yet enforces that

If a load falls back to `finding_truck` after the shipper accepted a price, the
price must not be quietly rewritten — that is the difference between a quote and
a note. The intended behaviour is that ops issues a *new* quote and the shipper
decides again, seeing T2 a second time.

**Not built.** `ops_set_price` can currently move a price on a load in any state.

**Done when:** re-pricing a load the shipper has already accepted either requires
a fresh shipper decision or is refused, and `supabase/tests/` asserts it.

### P0 shipped a design system nobody has seen on a phone

Tokens, fonts, primitives, icons and numerals are in and tested, but P0
deliberately built none of the 32 designed screens. Every existing screen was
carried over mechanically to the nearest new token, so the app currently looks
**transitional**: right colours and type, old layouts. `src/components/legacy.tsx`
holds the old vocabulary on new tokens until each phase replaces its screens.

**Done when:** P1–P7 are built. Nothing to fix here — this entry exists so a
transitional screenshot is not mistaken for a bug, and so
`grep -rl "components/legacy" src/app` is understood as a to-do list.

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

### The jest suite has an intermittent failure nobody has pinned down

A full `npm test` occasionally reports one failure that passes on rerun, in both
parallel and `--runInBand` modes. Seen during P0 Task 12 and again in P1. It has
never been the same test twice and has never reproduced in isolation.

**Watch for:** if it starts landing on the same test, that test has a real race.
Until then, rerun before believing a single red.

### P2 (phone sign-in) is deferred — SMS moved to a later date

Specced in `docs/superpowers/specs/2026-07-30-redesign-p2-getting-in-design.md`
and **not built**. The config change was reverted; the tree carries nothing
half-applied.

The whole phase parks rather than just the SMS screens: N4/N4b/N5 run after a
session exists, and today that session comes from the email screens the spec
deletes. Building the back half would mean keeping email auth or shipping
unreachable screens.

**Consequence for sequencing:** P3 (shipper booking) does not depend on P2 and is
the next buildable phase. Email auth stays in place until P2 resumes.

**Two things left unverified**, and both matter when it resumes:

- **Whether `before_user_created` fires before the SMS is sent.** If it does not,
  the GCC number allowlist is advice rather than enforcement, and the toll-fraud
  exposure is larger than the spec's mitigation implies. Nobody has tested this.
- **`profiles.phone` is still client-writable.** It carries an INSERT grant, so a
  user can put a number they do not own into their own profile — and that is the
  number a dispatcher would ring. It is not exploitable for privilege, but it is
  a data-integrity hole that exists **today**, independent of P2, and it will
  outlive the deferral.

**Done when:** P2 resumes, or — for the second item — sooner, because it is not
actually blocked on SMS.

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

### RTL has not been looked at since the rewire

Every new component uses logical properties and `align.start`, and
`directionArrow()` is used everywhere a route is written as a string — but the
Arabic dictionary is still partial, so no screen has actually been *rendered*
right-to-left. The new pieces with real mirroring risk are the route stalk in
`RouteLine`, the tab badge, and the chevron on every `ListRow`.

**Done when:** the app has been run with `I18nManager.forceRTL(true)` and the
three above have been looked at.

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

**Done when:** Google and Apple sign-in both complete on a development build
(not Expo Go — native provider sign-in needs a dev build).

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

### 6. Driver verification is built but not surfaced

`profiles.verified_at` exists and `private.is_verified_driver()` gates on it,
but there is no verification UI and the gate sits behind a flag. Deferred
deliberately — the MVP proves matching first. Public copy already claims "100%
verified drivers", so this cannot ship to real users unverified without either
the flow or a change to the claim.

### 7. Arabic copy is partial

`src/i18n/index.ts` carries the full English dictionary and a partial Arabic
one; missing keys fall back to English **visibly**, so gaps are findable rather
than silently blank. Arabic added since the website lift — the auth, reset,
date, and picker keys — has no translation yet.

**Done when:** every key in `en` has an `ar` value, proofed by a native speaker,
and the app has been walked end to end with the device set to Arabic (RTL
layout, not just translated strings).

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

- `post-load`, `post-leg`, `trip/[id]`, and all four auth screens have no tests.
  Issue 18 was a driver-blocking bug in `sign-up.tsx` that no test could have
  caught; the hook underneath it is pinned now, the screen still is not.
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
