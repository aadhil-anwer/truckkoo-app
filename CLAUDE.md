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
4. **RTL is structural, not a phase-2 task.** Logical properties only
   (`marginStart`, `paddingEnd`, `start`/`end`). Never `left`/`right`. All
   user-facing strings go through `t()` in `src/i18n`. React Native does **not**
   flip `textAlign: 'left'` under RTL — use `align.start` from `src/i18n`.
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

`DESIGN.md` is derived from the **website**, so it describes web CSS. Native
tokens live in `src/theme/tokens.ts`. The four load-bearing decisions:

- one orange accent (`#f1551f`), everything else black and white
- weight-900 tight headlines
- **hairline 1px borders instead of shadows** — depth comes from borders
- light and dark surfaces each carry their own card/border/muted triple; never
  reuse a light-mode border on dark, and never `#f1551f` as text on dark (use
  `#ff7a4d`)

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
The two ops screens in this repo still work and are still tested — do not break
them while building the console.

Matching itself lives in `private.candidates_for`, which returns three tiers —
empty leg, part-loaded leg, corridor history — and **does not check ownership**.
It is private and ungranted precisely for that reason: it is the load board with
the guard removed. Its callers do the checking. Never grant it.

`post_load` auto-dispatches tier-1 matches with no human in the loop, bounded by
settings in `private.app_settings` (`auto_dispatch_enabled` and two caps). It
fails *open into the human path* — a broken matcher must never lose a shipper's
load — which is a deliberate exception to "fail closed and loud", logged in
`private.dispatch_log`.

## Verify before you claim anything works

```
npm run verify    # typecheck + lint + 268 tests
npm run test:db   # 157 SQL assertions (isolation + pricing) — needs `npx supabase start`
```

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
- Env changes need `npx expo start -c` — Expo inlines `EXPO_PUBLIC_*` at build
  time.
- Migrations are append-only files in `supabase/migrations/`. Never edit an
  applied one.
