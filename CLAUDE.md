# Truckkoo app — working rules

Read `PRODUCT.md`, `SECURITY.md`, `STACK.md`, and `DESIGN.md` before changing
anything. This file is the short version: the decisions that are easy to undo by
accident and expensive to get back.

## Context in one paragraph

Truckkoo is an **Oman-based trucking operator** (Muscat) moving cargo across Oman
and into 5 GCC countries. It runs its own fleet — *"no brokers"* — and the app
adds contracted owner-drivers who declare their planned and empty legs so loads
can be matched to trips already happening. Two roles share one binary: shippers
and drivers. **The users have near-zero tech skills.** A live bilingual website
exists at `~/truckkoo` and is the source of truth for company facts, copy,
cities, and truck types.

## Non-negotiables

1. **`loads.truck_type_code` stays NULLABLE.** NULL means *"Not sure — advise
   me"*, which the website offers as the default and which is the single most
   important affordance for a low-tech audience. A NOT NULL constraint here
   silently deletes it.
2. **Money is integer baisa.** OMR has **three** decimal places (1000 baisa = 1
   rial) and almost every library assumes two. Use `src/lib/money.ts`. Never
   float, never `numeric`, never `toFixed(2)`.
3. **No payment surfaces.** Settlement is offline, permanently. No card entry,
   wallet, or checkout — not even disabled or "coming soon". Showing a *price* is
   fine and expected; taking one is not.
3b. **The pricing formula lives only in SQL** (`private.compute_price`). Never
   write `src/lib/pricing.ts` — two implementations of a price disagree
   eventually, and a client-side one ships the rate card's shape in the app
   bundle. The rate card itself is in `private`, ungranted, and **empty**: rates
   are loaded by hand, never invented in a migration. `npm run seed:rates` loads a
   fake card for development — it lives outside `migrations/` on purpose, so it
   cannot reach production. See `STACK.md` §2c.
   **0018 exception, agreed explicitly:** an appointed dispatcher can read and
   edit the card through `require_ops()` RPCs from the ops console. The table
   still has no client grant, the formula is still SQL-only, and no rate data
   reaches the shipper/driver bundle. Every edit needs a reason and lands in
   both `rate_card_audit` and `ops_audit`.
4. **RTL is structural, not a phase-2 task.** Logical properties only
   (`marginStart`, `paddingEnd`, `start`/`end`). Never `left`/`right`. All
   user-facing strings go through `t()` in `src/i18n`. For text alignment use
   `align.start` / `align.end` from `src/i18n`, which name a **physical** edge
   and are constants. **React Native mirrors `textAlign` itself under RTL** — on
   Android in `TextAttributeProps.kt`, on iOS in `RCTTextAttributes.mm` — so a
   direction-aware value double-flips and lands on the wrong edge. This file said
   the opposite until 2026-08-02 and every Arabic label was misaligned because of
   it; the correction is in `OPEN_ISSUES.md` with the measurements.
   **Never compose a sentence from fragments at a call site.** `t()` takes typed
   placeholders — `t('drv.offer.detour', { km })` — so each language owns its own
   word order, and units live *inside* the string: `${n} km` renders a Latin "km"
   in Arabic copy. `tests/unit/no-literals.test.ts` enforces both, plus the
   arrow and alignment rules; its only exemptions are `src/map` and `legacy.tsx`,
   and adding a third to silence a hit is the failure it exists to prevent.
   The Arabic dictionary is complete as of P7, but **211 of its strings are
   unproofed drafts** in a marked block — see `OPEN_ISSUES.md`.
5. **Never fabricate proof.** No testimonials, customer names, ratings, trip
   counts, fleet size, founding year, or certifications. The website
   deliberately claims none of these. Public claims we *must* stay consistent
   with: "100% verified drivers", "6 GCC countries", "1–40 ton", "7 days a week",
   "replies in minutes", "no brokers, no delays".
6. **A shipper never hits a dead end.** No match means `finding_truck` —
   *"we are finding you a truck"* — and a human resolves it. Never "no results".
7. **Reference data comes from the website.** 46 cities and 5 truck types are
   lifted from `~/truckkoo/js/main.js` and `index.html`. Regenerate; do not
   retype, especially the Arabic.

## Security — read `SECURITY.md`, but at minimum

- **Deny by default.** New table → revoke from `anon, authenticated`, enable +
  force RLS, then grant back per column with a reason.
- **Column-level grants are the mass-assignment defence.** `role`, `status`,
  `price_baisa`, `verified_at`, `created_at`, and every `id` carry no client
  write grant. See `SENSITIVE_FIELDS.md` — adding such a field means updating
  that file in the same change.
- **Every `security definer` function pins `search_path = ''`** and fully
  qualifies identifiers. An unpinned search path in a definer function is a
  privilege-escalation primitive.
- **Definer functions re-check ownership internally.** `match_load()` is the
  worked example: it takes a `load_id` and verifies `shipper_id = auth.uid()`
  inside. Without that it is an IDOR into driver identities.
- **Fetch scoped to the actor**, never fetch-then-check. Return "not found", not
  "forbidden" — 403 confirms existence.
- **Drivers read composed answers, not tables.** `driver_offers()`,
  `driver_offer()`, `driver_trip()`, `driver_trips()` and `driver_earnings()`
  (0030, 0031, 0033) each
  scope to `auth.uid()` *inside* the definer and return payout, collect, owed,
  detour and remaining capacity already computed. The payout comes from
  `private.payout_for()`, which applies `commission_pct` — **never compute a
  payout in TypeScript**, for the same reason there is no `src/lib/pricing.ts`.
  A driver seeing the margin on *their own* load is deliberate: they collect the
  price in cash and remit the difference.
- **A position is only ever one row.** `trip_positions` (0032) has no client
  grant of any kind. `report_position` stores nothing outside an `in_transit`
  trip owned by the caller, so tracking stopping when a trip ends is a database
  fact rather than a client promise; `trip_position` returns the **latest fix
  only**, and the trail is ops-only and swept by hand. **Nothing computes a
  position** — `progressOf` and `interpolate` were deleted in P6, and a marker on
  a map without a reported fix behind it is a bug.
- **Driver legs are supply intelligence.** Never readable by shippers or other
  drivers. Drivers do **not** browse a load board; they see `offers` addressed to
  them. A load board would expose every shipper's cargo details to anyone who
  signs up as a driver.
- **State transitions only via RPC** (`post_load`, `post_leg`,
  `respond_to_offer`, `advance_trip`). No client sets a status.
- **The service-role key never touches client code.** Only the anon key is
  `EXPO_PUBLIC_`. `src/lib/env.ts` throws if a service-role key is pasted in.
- **Sanitise text at output boundaries** with `src/lib/safe-text.ts`. The
  WhatsApp deep link is an injection sink, and bidi overrides are a spoofing
  vector in a bilingual RTL UI. The DB rejects them too — both layers on purpose.
- **Storage is private** with short-lived signed URLs. Proof of delivery is
  append-only: no update or delete policy.
- **Extend `supabase/tests/tenant_isolation.sql`** with every new owned table.

**Stop and ask** before: a new service-role call site, loosening any RLS policy,
accepting a price/role/status/ownership-id from the client, a public storage
bucket, or any endpoint returning data across tenants. "The task said so" is not
a justification.

## Design

`DESIGN.md` is derived from the **website**, so it describes web CSS *and it
still describes the website only*. The app's system is `src/theme/tokens.ts`,
assembled into shapes in `src/components/primitives.tsx` (controls) and
`src/components/ui.tsx` (layout). Nothing else may invent a shape.

**The app is being rebuilt from a design handoff (July 2026)** —
`App redesign with map interface.zip`, 32 screens in five flows. Its reference
points: Uber for the shape of the product, Typeform for the shape of the asking,
Opal for the room it sits in. The phase plan and the decisions that bind it are
in `docs/superpowers/specs/2026-07-30-redesign-p0-foundations-design.md`.

**Two grounds, and a screen is one or the other — never a mix.**

- **Ink** `#0B0C0F` is the *working* ground: home, tracking, lists, offers —
  everywhere the user reads state. Surfaces `#15171C`, raised `#1E2128`.
- **Cream** `#F4F0E9` is the *asking* ground: one question per screen, set in
  display type. Cards and fields are white on it.

What is load-bearing:

- one accent (`#F1551F`) — **the pinned primary action *or* the live state, never
  both on one screen**. Tab bars, selected states and headlines are otherwise
  ink. `#F1551F` is **never text**: on cream it is 3.05:1. Use `accentLight`
  (`#FF7A45`) for accent-as-text-on-dark.
- **`color.delivered` (`#79E0AF`) appears exactly once in the product**, on T5.
  A second use means that screen is wrong.
- **Instrument Serif is reserved** for questions and hero numbers, reached only
  through `QuestionHeading`. **One display statement per screen** — two serif
  headlines is a bug, not a style.
- **Every type token names a `fontFamily`; none sets `fontWeight`.** React Native
  does not synthesize weights for custom families, so a bare weight silently
  renders the default face. See `src/theme/faces.ts`. This shipped broken.
- Arabic goes through `arabicize` / `arabicIfNeeded`: one weight step lighter,
  looser leading, and **`letterSpacing` stripped** — Arabic is cursive and Latin
  tracking breaks the joins.
- **depth from soft shadow and filled surfaces.** Hairlines only divide rows
  *inside* a surface. On a phone a 1px rule at arm's length is invisible and
  gives a tappable area no bounds.
- one icon set, reached only through `src/components/icon.tsx`, which names
  *things* (`pickup`, `truck`, `pay`) rather than glyphs and mirrors directional
  icons under RTL. Hand-authored SVG at stroke 1.9–2.1 with round caps — a glyph
  font bakes stroke weight in, and stroke weight is what makes a set a set.
- **selection is signalled three ways at once** — border, fill, and a filled
  radio. That is deliberate redundancy for reading one-handed in direct sun
  through a windscreen. Reducing it to one indicator is a legibility regression;
  `tests/components/select.test.tsx` will say so.
- **skeletons, never spinners**, and any wait over ~3s is *narrated* with a
  `Timeline` carrying real information — not a spinner with a caption.

**`font.button` stays ≥18.66px bold.** Not taste. White on `#F1551F` is 3.47:1,
so the label only clears AA by qualifying as large text, whose bold threshold is
18.66px. The handoff specifies 17px, which fails outright; **this is the one
deliberate deviation from its type scale.** `tests/unit/contrast.test.ts`
computes every ratio from the tokens — change a colour or a size and it tells you
what you did. It also flattens `rgba` over its ground, which is how it caught
that the handoff's own text ramp was sub-AA in three places (see `OPEN_ISSUES.md`).

**The map is `src/map/`, and nothing outside it computes a projection or draws a
coastline.** There are no tiles and no native map library: the region is bundled
Natural Earth geometry (`scripts/build-geo.mjs` → `src/map/geometry.json`),
projected by one `d3-geo` Mercator fitted to one of two fixed framings, drawn with
`react-native-svg`. The user cannot pan or zoom — the handoff never shows it, and
every screen picks a framing. Children take the projection from **context**, so a
pin and its coastline cannot disagree.

Two map distinctions carry meaning: **dashed corridor = uncommitted, solid =
committed**, and **origin is a ring, destination is a filled square** (matching
`RouteRail`). `tests/components/map.test.tsx` guards both.

**SVG coordinates are the one place logical properties do NOT apply.** A projected
x is a position on the peninsula, not a reading direction — the Gulf does not move
to the other side of the screen in Arabic. Only the chrome around a map flips.

City coordinates live in `cities.lat/lng` (0020). They are the one piece of
reference data **not** derived from the website, which has none. `npm run
check:pins` asserts none is in the sea; `npm run preview:map` renders them for the
only check that matters, which is whether a pin is in the right town.

**`src/components/legacy.tsx` is transitional and shrinking.** P0 replaced the
design system but built none of the 32 screens, so the old vocabulary lives there
on new tokens until each phase lands. `grep -rl "components/legacy" src/app` is
the list of screens still awaiting their phase; when it is empty, delete the file.
**Nothing new may import from it.** Since the P2 interim (2026-09-26) that list is
`post-load.tsx` alone — still reached by "Send this route again" on the shipper
home and T5. Move that onto the booking flow and the file can go.

**Getting in is N1–N6 on email, for now.** The handoff's N2/N3 are a phone
number and a one-time code over WhatsApp; until Meta's side is ready the same
one-question flow asks for an email and a password (`src/lib/auth-draft.ts`,
P2 spec §0b). The password is never put in the shared draft. The Gate owns where
a new session goes — do not navigate from the password screen.

**Navigation is a floating tab bar** (`src/app/(app)/(tabs)/`), role-aware — a
pill at the thumb, not a bar welded to the bottom edge. Tabs are hidden with
`tabBarItemStyle: {display:'none'}`, **not** expo-router's `href: null` shortcut —
expo-router consumes `href` before descriptors are built, so a custom `tabBar`
never sees it and renders every hidden tab. That shipped once.
`tests/components/tab-bar.test.tsx` is what stops it returning.

A tab badge's count belongs **inside the tab's accessible label** ("Offers, 2
new"), never as a loose node — a bare "2" is announced with no referent. The
count goes through `formatNumber`, like every other numeral.

Voice: confident, plainspoken, operator-grade. **Specifics beat adjectives** —
tonnages, city names, and "no brokers" outperform "world-class solutions".

Avoid: generic freight-forwarder template (corporate blue, globe icons,
handshake photos), discount-aggregator loudness (badge soup, urgency banners),
cold enterprise SaaS (navy dashboards, stat-grid heroes).

Every tap target ≥44pt. Target WCAG 2.1 AA. Assume one-handed use, in sunlight,
in a truck cab, on a cheap Android phone with bad signal.

## Three roles, not two

Shippers and drivers share the binary, and **Truckkoo's own dispatcher is a third
surface** (`src/app/(app)/ops/`). Dispatch is what closes the loop: nothing else
can create an offer, because `create_offer` is revoked from every client role.

Ops membership is **not** a `profiles.role` value. `role` carries an INSERT grant,
and a column grant cannot restrict *which* value is inserted — so an `'ops'` role
would be self-assignable at signup. Membership lives in `private.ops_users`, which
has no client grant at all and is populated by hand. See `SENSITIVE_FIELDS.md`.

Dispatch reads across tenants by design. It does so **only** through definer
functions that call `private.require_ops()` first (`ops_queue`, `ops_candidates`,
`ops_send_offer`, `ops_mark_finding_truck`, `ops_set_price`,
`ops_sweep_expired_offers`, and the `ops_*` read layer added in 0015). No table
policy was loosened for ops, so a bug in an ops screen cannot widen what anyone
else sees. Keep it that way.

**The single exception is `"ops reads pod"` on `storage.objects`** (0015), because
a signed URL is minted by the storage service against RLS and no definer function
can produce one — the alternative was a service-role key in a browser. It is
additive, `select` only, and scoped to `private.is_ops()`. See `SECURITY.md` §10.
Every privileged ops **write** from 0016 onward lands in `private.ops_audit`; a
function that mutates without calling `private.log_ops` is an incomplete change.

**The dispatcher console is a separate web app** at `~/truckkoo-ops` (Vite +
React, Cloudflare). It holds the anon key only and calls the same guarded RPCs.
**Dispatch is web-only: the two ops screens were deleted from this repo (2026-07-30)**,
and `masthead.tsx`/`consignment.tsx` went with them. Nothing server-side changed —
`am_i_ops`, `private.ops_users`, `require_ops()` and every `ops_*` RPC are
untouched, and `supabase/tests/ops_console.sql` still passes. Consequence,
accepted: nobody can dispatch from a phone.

Matching itself lives in `private.candidates_for`, which returns three tiers —
empty leg, part-loaded leg, corridor history — and **does not check ownership**.
It is private and ungranted precisely for that reason: it is the load board with
the guard removed. Its callers do the checking. Never grant it.

**Dispatch is automatic (0036), Uber/Porter-style.** `book_load` posts, prices
and — if the server's price is the one the shipper saw — accepts and starts the
search in one call. `private.next_wave` offers the load to the nearest online,
verified, fitting drivers (`driver_availability`, declared legs first), three at
a time for five minutes, the radius widening with time (`dispatch_*` settings);
the every-minute `dispatch-waves` job advances it; after 15 minutes a person is
alerted once. The machine keeps looking after that (0037, `dispatch-rescue`): an
accepted load nobody has taken is offered to any driver who comes online, until
its collection date — unless a dispatcher has taken it in hand. A lapsed offer
is not a "no": a driver who switches on again is re-asked; a decline is final.
**Any function that writes is `volatile`** — PostgREST runs `stable` ones
read-only, so `quote_route` failed for every shipper in production while every
psql test passed; dispatch.sql §10 now checks the whole class statically. `private.loads_machine_guard` stops older paths handing a load the
machine still owns to a person between waves; a dispatcher's own move is never
redirected. It still fails *open into the human path* — logged in
`private.dispatch_log`. `dispatch_log`'s check constraints list every mode: add
one there when you add one in code, or `accept_quote` will swallow the violation
and dispatch nobody (it happened, 2026-09-27).

## Verify before you claim anything works

```
npm run verify    # typecheck + lint + 598 tests
npm run preview:rtl  # every Arabic string, grouped by screen, for a human to read
npm run test:db   # four SQL suites (isolation + pricing + ops + dispatch) — needs `npx supabase start`
node scripts/check-migrations.mjs local   # migration numbering; `diff origin/main` for edits
```

`.github/workflows/ci.yml` runs all of the above on every push and PR, and
`drift.yml` checks daily that production has applied exactly the migrations in
this repo. **Scheduled work is pg_cron (0034), not a button.** A new periodic
job is a `private.system_*` function with no client grant, scheduled in its
migration, audited through `private.log_system`; `watch-cron` alerts when any
job run fails. Never schedule an `ops_*` RPC — `require_ops()` rejects cron.

`tests/README.md` says what the suite does *not* cover. `OPEN_ISSUES.md` is the
live list of what is unverified, deferred, or temporarily weakened — read it
before assuming a feature is finished. Notably: **nothing has been seen running on
a real device**, and email confirmation is currently switched off.

Lessons already paid for:

- A definer function is the first reader of a column often enough that "nothing
  errored" means "nothing looked". `trips.truck_id` was NULL for every trip ever
  created and no test or user noticed until one function selected it.
- **Nothing errored because nothing ran.** `advance_trip` pinned
  `search_path = ''` and then cast to a bare `'delivered'::load_status`, so every
  call by every driver since 0004 raised `type "load_status" does not exist` —
  the whole delivery flow, dead, for months. It surfaced only when 0017's tests
  called it for the first time. **Qualify types too, not just tables:
  `public.load_status`.** `supabase/tests/ops_console.sql` §8 now checks the
  whole class statically, over every definer function, called or not.
- `force row level security` applies to the table owner too, so there is no
  observable "ground truth" view of a table — a test can only ever ask an actor.
  (Corollary: a test asserting on a table while impersonating a dispatcher reads
  nothing, because ops holds no table privilege. Drop to superuser first.)
- A column-level `revoke` does not cut a hole in a table-level `grant`. Revoke
  the table grant and re-grant the columns by name.

## Practical

- Package manager: **npm**. Single app, no monorepo.
- `npx expo start` for dev; native Google/Apple sign-in needs a **development
  build**, not Expo Go.
- Never eject from the managed workflow.
- **EAS Update is on, with `runtimeVersion: { policy: "appVersion" }`.** An
  update reaches every build whose `version` (app.json) matches. **Any native
  change — a new native library, an SDK bump, a config plugin — means bumping
  `version` before the next build**, or `eas update` can ship JS that calls
  native code an installed build does not have, and crash it on launch. JS,
  styles and assets only: `eas update --channel <preview|production>
  --environment <env> --message "..."`. Never publish to `production` without
  the founder's say-so.
- Env changes need `npx expo start -c` — Expo inlines `EXPO_PUBLIC_*` at build
  time.
- Migrations are append-only files in `supabase/migrations/`. Never edit an
  applied one.
