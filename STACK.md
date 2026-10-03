# Truckkoo — Technical Stack & Build Plan

Decision record. Confirmed 2026-07-25. Companion to `PRODUCT.md` (product truth)
and `DESIGN.md` (visual authority).

**Context that governs every choice below:** solo developer, no prior app
development experience, MVP speed is the priority, and the end users have
near-zero tech skills. Truckkoo is an **Oman-based** trucking operator (Muscat)
running cargo across Oman and into 5 GCC countries.

**Reusable assets already exist in `~/truckkoo`** — the live bilingual website.
Its 46-city list, 5-type truck taxonomy, Arabic copy, logo files, and validated
quote form are all lift-and-reuse. Check there before building anything from
scratch.

That context is why this document is deliberately smaller than the product
deserves. The ambitious version — PostGIS route-overlap matching, background
location tracking, a routing API, an ops console — is real and correct, and it is
all in Phase 3. Building it in Phase 1 is the most likely way this project never
ships.

---

## 0. The build order that matters most

**Build the shipper side first, and be the algorithm yourself.**

A shipper posting a load, no match existing, and you arranging a truck by
WhatsApp *is already a working business*. It needs no drivers on the platform, no
matching engine, and no supply-side chicken-and-egg problem solved. You learn
what the algorithm should actually score by doing the job by hand for a few
weeks.

Then add driver-posted legs, then automatic matching against them. In that order.
Matching built before you have legs to match is code you cannot test and cannot
validate.

## 1. MVP stack

Single Expo app. No monorepo — one folder, `app/` for routes, `lib/` for
everything else. Add structure when the pain is real, not in anticipation of it.

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Expo (React Native)**, managed workflow | Never eject. Config plugins cover everything you need |
| Routing | **expo-router** | File-based — folder structure *is* the navigation |
| Styling | **Typed tokens + `StyleSheet`** — `src/theme/tokens.ts` | See the note below; this deviates from the original Nativewind pick |
| Backend | **Supabase** | Postgres, Auth, Storage, Row Level Security. Free tier is plenty for MVP |
| Auth | **Google + Apple + email** | See §3 |
| Server state | **TanStack Query** | Learn this properly — it removes most of the state management you'd otherwise write |
| Forms | **react-hook-form** + **zod** | |
| Photos | **expo-image-picker** → Supabase Storage | Proof of delivery |
| Errors | **Sentry** | Ten minutes to set up, saves you blind debugging |
| Builds | **EAS Build** | |

**Not in the MVP, on purpose:**

| Deferred | Why |
|---|---|
| Maps, Places, geocoding | City dropdowns instead — see §4 |
| PostGIS | Not needed until matching is proximity-based rather than city-based |
| Routing / detour API | Phase 3. Also a billing account you don't need yet |
| Background location | The single hardest thing in the whole product, and it gates store review. Phase 3. **P6 ships foreground-only reporting; the table, the RLS posture and `trip_position()` are already what background tracking needs, so it is a client change** |
| Arabic strings | Structure is RTL-safe from day one; translation waits — see §5 |
| Phone / SMS OTP | Sender-ID registration with Gulf regulators takes weeks |
| ~~Push notifications~~ | Built 2026-10-04 (0046, app 1.2.0): Expo push, sent by database triggers through pg_net |
| Payments | Permanently out of scope. Settlement is offline |
| Component library | DESIGN.md's hairline-border, weight-900 identity fights every stock library's defaults |
| Monorepo, admin app, E2E tests | Supabase Studio is your admin panel. Test by hand |
| Redux, Zustand | TanStack Query plus component state covers the MVP entirely |

### Styling: an open decision, flagged not settled

Scaffolded on **Expo SDK 57 / RN 0.86 / React 19.2**. At scaffold time
`nativewind@latest` was 4.2.6 — well behind that SDK — with v5 only on a preview
tag. Styling therefore went to a typed tokens module plus `StyleSheet`: zero
config risk, and a silently-broken Tailwind/Metro pipeline is precisely the
failure a first-time app developer cannot debug.

**That reasoning is now weaker.** Expo ships an official `expo-tailwind-setup`
skill covering Tailwind v4 with `react-native-css` and NativeWind v5 — evidence
of a supported path on current SDKs that the npm `latest` tag did not show.

`src/theme/tokens.ts` is what the code uses today and is perfectly viable. But
**read that skill and decide deliberately before building screens.** Either
approach is fine; a codebase using both is not. The tokens file is authored so its
values map cleanly onto a Tailwind theme if we move.

## 2. Data model sketch

Enough to start; expect to change it.

```
cities          seed from the website's CITIES array — 46 rows, bilingual
                name_en, name_ar, country, corridor
truck_types     seed — 5 rows, exactly the website's taxonomy (§2a)
profiles        id → auth.users, role (shipper|driver), name, phone, language
drivers         profile_id, verified_at, verified_by   ← the vetting gate
trucks          owner_id, truck_type, capacity_kg, plate, verified_at
legs            driver_id, truck_id, origin_city, dest_city,
                depart_from, depart_to, is_empty, status
loads           shipper_id, origin_city, dest_city, pickup_from, pickup_to,
                weight_kg, truck_type_needed (nullable!), goods_description,
                status
trips           load_id, driver_id, truck_id, status
trip_events     trip_id, type, occurred_at, note, photo_url
```

**Load status is the spine of the product:**
`posted → matched → assigned → in_transit → delivered → closed`
plus **`finding_truck`** — the no-match concierge path where you step in.

**`drivers.verified_at` is not optional.** PRODUCT.md makes vetting a hard
requirement: the live website publicly claims "100% verified drivers", so an
unverified driver accepting a load makes a public claim false. Enforce it in an
RLS policy and a DB constraint, not in the client — `verified_at IS NOT NULL` is
a precondition on inserting into `trips`.

**`loads.truck_type_needed` must be nullable.** The website's "Not sure — advise
me" is the default choice and the most important affordance in the product
(PRODUCT.md). A NOT NULL column here would quietly delete it.

### 2a. Seed data already exists — do not retype it

- **Cities:** `~/truckkoo/js/main.js`, the `CITIES` array — 46 `[en, ar]` pairs
  already grouped by corridor (Muscat governorate, Batinah coast, Interior &
  Dhahirah, Sharqiyah, Wusta & Dhofar, Musandam, UAE, Saudi). Script it into a
  migration.
- **Truck types:** the `qfTruck` select in `index.html` plus the truck cards —
  `pickup` 1t, `hiup` 3t (lifting tail), `10t`, `20t`, `40t`, each with English
  and Arabic labels and a one-line description.
- **Arabic copy:** the site is fully bilingual across five pages. Phase 2's
  translation work is mostly *lifting*, not commissioning.

### 2c. Pricing — corridor bands (built 2026-07-26, `0010_pricing.sql`)

Rates are keyed on **(origin corridor, dest corridor, truck type)**, using the 8
corridors `cities.corridor` already carries from the website. That is ~320
authorable cells.

Chosen over per-km because per-km needs 1,035 city-pair road distances: real ones
need a routing API (§8, Phase 3) and invented ones are worse than none, since a
wrong distance is an invisibly wrong price. Directional on purpose — backhaul is
the whole economic argument, so Muscat→Salalah and Salalah→Muscat must be able to
differ.

```
price = max(min_fare, base + per_tonne × ceil(weight_kg / 1000))
```

Four things worth knowing before touching it:

- **The rate card ships empty**, in `private`, with no client grant. Until it is
  loaded every load routes to `finding_truck` and ops prices it — which is §0's
  "be the algorithm yourself", and it means the empty state is the concierge
  product, not an outage.
- **As of 0018 an appointed dispatcher can read and edit it** through
  `ops_rate_cards` / `ops_upsert_rate_card` / `ops_delete_rate_card`, from the ops
  console at `~/truckkoo-ops`. This is a deliberate widening of where the crown
  jewel can be read, and it was agreed to explicitly rather than inherited. It
  replaces "ring whoever has the database password" at 6am. The table still has
  no client grant: every path runs through `require_ops()`, writes still fire the
  0010 `rate_card_audit` trigger, and now also land in `private.ops_audit` with
  the dispatcher's name and their reason — which is mandatory.
- **The formula is SQL only.** No `src/lib/pricing.ts`, ever: two implementations
  disagree eventually, and a client-side one ships the moat in the app bundle.
  Unchanged by 0018 — no rate data reaches the shipper/driver bundle, and
  `ops_preview_price` calls `private.compute_price` rather than reimplementing it.
- **A null price is a normal outcome.** `advise_me`, `no_rate`, `over_capacity`
  all mean "a human is pricing this". "Not sure — advise me" stays unpriceable on
  purpose — guessing a truck type to produce a number quotes a truck nobody asked
  for.
- **Quotes are immutable, bound, and expire in 48h**, and a trigger on `loads`
  drops the price if anything it was bound to changes.
- **The price comes before the commitment** (0011). `quote_route()` prices
  parameters without creating a load, so post-load ends on a review step rather
  than the shipper posting blind and asking afterwards. Both it and `quote_load`
  delegate to `private.price_for()`, so the estimate and the issued quote cannot
  drift. An estimate writes no `quotes` row — a row is a commitment, and exploring
  a form is not one.

### 2b. Money

**OMR is a three-decimal currency** — 1000 baisa to the rial. Almost every money
library, formatter, and payment integration assumes two. Store integer **baisa**,
never floats, and write your own formatter rather than trusting a default
`minimumFractionDigits`. If you later operate in AED/SAR/QAR too, currency and
exponent must live on the row — those are two-decimal.

**Turn on Row Level Security before you write a single screen.** Two roles share
one binary, so the client can never be the security boundary. Retrofitting RLS
onto a working app is miserable; writing policies alongside each table is easy.

## 3. Auth

**Google + Apple + email**, chosen because your users have near-zero tech skills
and one-tap social sign-in means no password to forget.

- **Apple is mandatory, not optional.** App Store Guideline 4.8 requires Sign in
  with Apple if you offer any other third-party sign-in. Both stores also now
  require **in-app account deletion** — build it in Phase 1, it fails review
  otherwise.
- Use the **native** flows — `@react-native-google-signin/google-signin` and
  `expo-apple-authentication` — not a web redirect. Materially better for
  low-tech users.
- **These do not work in Expo Go.** You need a development build
  (`eas build --profile development`) from roughly day two. Do this early and
  deliberately; it is the most common thing that derails first-time app
  developers.
- Email: prefer a **magic link** over a password. Password reset flows are a
  support burden with this audience.
- **Role is chosen at signup** and drives which app shell loads. Store it on
  `profiles` and enforce it in RLS, never only in the UI.

## 4. Matching (MVP version)

**Cities from a dropdown, not addresses on a map.** Oman–GCC freight is quoted
city-to-city, so a picker over the 46 seeded cities removes the maps SDK, Places
autocomplete, geocoding, PostGIS, and Google billing from the MVP in one stroke.
It is also far easier for a low-tech user than dropping a pin.

The website already reached this conclusion independently — its quote form uses a
bilingual `datalist` over exactly this city set. Reuse the decision and the data.
One difference: the site allows free-typed locations; the app should prefer a
strict picker with an explicit escape hatch, because free text cannot be matched
on.

MVP matching is ordinary SQL — a Postgres function or view:

```
match legs to a load where
    origin_city  = load.origin_city
and dest_city    = load.dest_city
and depart window overlaps load pickup window
and truck_type   = load.truck_type_needed
and capacity_kg >= load.weight_kg
order by is_empty desc, date proximity
```

No match → load goes to **`finding_truck`**, you get notified, and you arrange it
by hand. That fallback is a feature, not a stopgap: it means the app is useful on
day one with zero drivers signed up, and every manual match teaches you what to
score later.

Phase 3 replaces the exact-city join with PostGIS proximity and real detour
cost — the two-tier design is in §8. Keep the matching query behind a single
function so swapping it later touches one place.

## 5. Arabic and RTL

Confirmed: **build RTL-safe, ship English first.**

The structural half costs nearly nothing if you do it from the first component,
and is expensive to retrofit:

- Use logical properties everywhere — `ps-`/`pe-`, `ms-`/`me-`, `start`/`end`.
  Never `left`/`right`, never `marginLeft`.
- Every user-facing string goes through a lookup from the start, even with only
  an English file. Hardcoded strings are the actual retrofit cost.
- Seed `cities.name_ar` now while you're seeding the table anyway.

The expensive half — translating and proofing Arabic copy — waits until the app
works. When it lands: `i18next` + `expo-localization`, Almarai for Arabic,
Arabic sets `letter-spacing: 0` (DESIGN.md §2), and Arabic has six CLDR plural
categories, so use `Intl.PluralRules` rather than `n === 1`.

## 6. "Zero tech skills" is a build constraint

This shapes more of the app than the stack does. Recorded in PRODUCT.md, repeated
here because it affects implementation choices:

- One decision per screen. No dense forms.
- Dropdowns and big tap targets over free text wherever possible — it is also why
  city pickers beat address entry.
- Status must be legible at a glance: plain words and a clear visual state, not a
  progress bar or jargon.
- Errors must say what to do next, never what went wrong technically.
- Assume the app gets used one-handed, in sunlight, in a truck cab, on a cheap
  Android phone with a bad connection. **Test on a real low-end Android device
  early** — not just an iPhone simulator.

## 7. Practical things that will bite you

- **Apple Developer Program is $99/year; Google Play Console is $25 once.** You
  need both before you can ship. Enrolment can take days.
- **Store review will ask for demo accounts for *both* roles.** Two-sided apps
  get rejected for reviewers not being able to see the driver side.
- **EAS Update (OTA) cannot ship native modules.** JS changes go over the air;
  adding a native library needs a fresh store build.
- Test on a **real device** well before you think you need to. Simulators lie
  about performance, permissions, keyboards, and safe areas.
- Pin dependency versions against the current Expo SDK when you scaffold. Do not
  trust version numbers from memory, mine included.

## 8. Phase 2 and 3

**Phase 2 — once the MVP has real users:**
**households** (home moves, single items — the website already advertises them,
and they are your least technical users); **Arabic strings**, largely lifted from
the existing bilingual site rather than commissioned; push notifications;
phone/SMS login (start sender-ID registration early — it takes weeks); ratings and
driver reputation; saved routes; a real quote/pricing model.

**Phase 3 — the ambitious version:**

- **PostGIS proximity matching** replacing the exact-city join.
- **Two-tier detour scoring, for cost reasons:** filter candidates in-database
  with PostGIS, then call the **Google Routes API** on only the surviving handful
  to compute true added detour. Never run a routing API across the whole fleet —
  per-request billing will dominate your infrastructure cost.
- **Background location during trips.** Use the licensed
  `react-native-background-geolocation` (transistorsoft, a few hundred USD
  one-time) rather than hand-rolling `expo-location` + `expo-task-manager`;
  continuous all-day tracking is a known multi-month trap. Requires iOS
  `UIBackgroundModes: location` with an App Store justification, and an Android
  foreground service declared in the Play Console with a demo video. Tracking
  must visibly stop when a trip ends.
- **Driver offline outbox** in `expo-sqlite` for milestone updates and photo
  uploads on bad signal.
- **Ops console** — a small Next.js admin, once Supabase Studio genuinely stops
  being enough.
- Maps in the UI, address-level pickup for last-mile.

## 9. Oman & GCC obligations — start early, these have lead times

Not features. Some are legal preconditions on operating, and they take longer
than the code. **Oman is the home jurisdiction** (Muscat HQ), with cross-border
operations into the UAE, Saudi Arabia, Qatar, Kuwait, and Bahrain.

- **Oman's Personal Data Protection Law** (Royal Decree 6/2022) governs your
  users' personal data, and you are collecting location and identity data on
  drivers. **Verify its consent, purpose-limitation, and any localization
  requirements before choosing your Supabase region** — resolving this after you
  have production data means a migration. Check whether a GCC-adjacent region
  (UAE / Bahrain) is available and sufficient.
- **Freight operator licensing and mandated telematics.** Oman's Ministry of
  Transport, Communications and Information Technology licenses commercial road
  transport, and several GCC states mandate vehicle-tracking platform
  integration for freight. **Verify what Truckkoo and its contracted drivers must
  register with and report to** — this may overlap usefully with Phase 3's
  tracking pipeline.
- **Driver vetting has a legal dimension, not just a product one.** You are
  publicly claiming "100% verified drivers" and contracting owner-drivers.
  Confirm what licence, insurance, and permit checks are legally required, and
  keep the records — `drivers.verified_by` exists for this.
- **SMS sender-ID registration** — Oman's TRA for local numbers, plus Saudi CITC
  and UAE TDRA if you send to those countries. Weeks of lead time. Blocks phone
  login testing with real users; begin before Phase 2.
- **Multi-currency:** OMR is three-decimal (§2b); AED, SAR, QAR are two-decimal.
  Store currency and exponent per row if you bill cross-border.
- **Numerals:** the website uses Eastern-Arabic numerals in Arabic copy (٤٠ طن).
  Match it.

I am flagging the first three rather than stating specifics: they are
jurisdiction-dependent, they change, and getting them wrong is expensive. All
three need an answer from someone local before launch.

## 10. Open items

- **Rate card contents.** The pricing mechanism is built (§2c); the numbers are
  not, and cannot be invented here. `OPEN_ISSUES.md` 13 says what is needed and
  where to put it. The corridor bands are also coarse enough that Muscat→Sohar and
  Muscat→Shinas price identically — `OPEN_ISSUES.md` 14.
- What vetting actually consists of, and whether it happens in-app or out of band.
- Fleet owners with multiple drivers/trucks under one account.
- Notification taxonomy.
- **Fleet photography.** The site has only three photos
  (`road-desert`, `port-containers`, `warehouse`). DESIGN.md's photo-veil
  treatment assumes imagery exists, and an app needs more than three. This is an
  asset gap you have to fill — I cannot generate real fleet photos, and stock
  trucks would violate the "show the trucks / real operator" principle.
- Oman PDPL answer (§9) — blocks the Supabase region choice.
- Operator licensing and telematics obligations (§9) — blocks launch.
