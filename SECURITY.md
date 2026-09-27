# Truckkoo — Security Policy

Binding for all work in this repository. When a task conflicts with this
document, the conflict is raised (§16), not resolved by the task.

Companions: `PRODUCT.md` (product truth), `STACK.md` (technical plan),
`SENSITIVE_FIELDS.md` (the never-client-writable register), `DESIGN.md`.

## 0. Principles

1. **Deny by default.** Every table, route, bucket, and function starts closed.
   Access is granted explicitly, per role, per operation, with a written reason.
2. **The client is hostile.** Every value from a browser, phone, or third-party
   webhook is attacker-controlled. This includes hidden fields, IDs, prices,
   roles, timestamps, and anything you personally put there five minutes ago.
3. **Authorization is server-side and per-object.** Hiding a button is not
   authorization. Filtering a list is not authorization. Every write and every
   single-object read re-checks ownership at the data layer.
4. **Never invent security.** No hand-rolled crypto, tokens, session handling,
   password hashing, or signature schemes. Use the platform's primitives.
5. **Fail closed and loud.** On an unexpected condition, deny the action and
   log it. Never fall through to a permissive default.

## 1. Threat model

| Actor | Capability | What they want |
|---|---|---|
| Anonymous visitor | Public pages, any API they call | Scrape the rate card, scrape driver phone numbers, enumerate listings |
| Registered shipper | Authenticated, own role | See other shippers' loads, tamper with a quoted price, bind a cheap quote to an expensive trip |
| Registered driver | Authenticated, owns trucks/legs | Edit a competitor's leg, delete a rival's truck, inflate route distances to fake a bigger discount, self-promote to admin or verified |
| Competitor | Unlimited anonymous requests | Full rate-card extraction, market intelligence, load/leg scraping |
| Compromised ops account | Admin | Blast radius — assume it happens, log everything admin does |

**Crown jewels, in order:**

1. Pricing logic and rate card — the business's actual moat.
2. Shipper and driver phone numbers + cargo details — PII, directly sellable to
   competitors.
3. Ownership integrity of legs and loads — a driver editing another's leg
   destroys trust permanently.

**Truckkoo-specific note:** driver-declared legs are supply intelligence. A
competitor who can read the leg table knows where every Truckkoo truck will be
and when. Legs are never readable across tenants, and never by shippers.

## 2. Authentication

- Use Supabase's managed auth. Never store or compare credentials ourselves.
- **Phone OTP is a money-loss vector.** SMS pumping / toll fraud is real.
  Rate-limit OTP per phone number AND per IP AND globally. Cap verification
  attempts per code. Expire codes in ≤5 minutes. Single use.
  *(Phase 2 — phone login is not in the MVP. This clause activates with it.)*
- Session tokens: on native, the refresh token lives in the OS keychain via
  `expo-secure-store`, never `AsyncStorage`, never a URL. On web (if ever),
  httpOnly + Secure + SameSite=Lax minimum.
- No "remember me" beyond a bounded refresh token with server-side revocation.
- Log out must invalidate server-side, not only clear local storage.
- **Never trust a client-supplied user ID.** The acting user is always
  `auth.uid()` from the verified session. No override parameter, ever.

## 3. Authorization — IDOR

**The rule:** fetch scoped to the actor. Never fetch then check.

```
FORBIDDEN:
  leg = db.get(legs, id)
  if leg.driver_id != session.user_id: throw 403

REQUIRED:
  leg = db.get(legs, id, where: driver_id == session.user_id)
  if leg is null: throw 404
```

The forbidden form leaks existence, invites TOCTOU, and becomes a vulnerability
the moment someone deletes the second line.

- **Return 404, not 403,** for objects the actor may not access. 403 confirms
  existence and enables enumeration.
- **Primary keys are UUIDv4** on every owned entity: `profiles`, `trucks`,
  `legs`, `loads`, `offers`, `trips`, `trip_events`.
  **Documented exception:** `cities` and `truck_types` use sequential integers.
  They are public reference data with no owner and no PII — the app ships the
  entire list to every client by design, so enumeration reveals nothing. No
  other table may take this exception.
- **Ownership is enforced in the database** (RLS), not only in app code.
  Application checks are the second layer, never the only one.
- Every relationship traversal re-checks. A shipper viewing their trip does not
  thereby gain access to the driver's other legs.
- List endpoints filter by actor in the query. Never fetch-all-then-filter.

## 4. Mass assignment and privilege escalation

**Never pass a request body into a database write.** Construct the write field
by field from validated values.

```
FORBIDDEN:  db.update(profiles, id, {...body})
FORBIDDEN:  db.update(profiles, id, pick(body, allowed))  // drifts silently
REQUIRED:   db.update(profiles, id, { full_name: input.full_name })
```

In this project the database enforces it too: `authenticated` holds
**column-level** UPDATE/INSERT grants, so a write to `role`, `status`, or
`price_baisa` is rejected by Postgres even if RLS would allow the row.

Never writable by the user they belong to: `role`, `verified_at`, `verified_by`,
`created_at`, any `id`, any price field, any business status field. See
`SENSITIVE_FIELDS.md` — adding such a field means adding it there in the same
change.

## 5. The pricing engine — trust boundary

**Built in `0010_pricing.sql`.** The *shape* is decided — corridor-band rates,
`origin_corridor × dest_corridor × truck_type` — and every rule below is
implemented and asserted in `supabase/tests/pricing.sql`. The **numbers are
not**: `private.rate_cards` ships empty, because a rate card is real commercial
information that cannot be invented in a migration. Until bands are loaded by
hand, every load takes the `finding_truck` path and a dispatcher prices it with
`ops_set_price()` — which is the order `STACK.md` §0 argues for.

Three notes on how the rules below landed:

- **The formula lives only in the database**, as `private.compute_price`. There is
  no TypeScript twin: two implementations of a price eventually disagree, and a
  client-side formula would ship the shape of the rate card in the app bundle,
  which §9 says is public forever. This is why the "pure and unit-tested"
  requirement is discharged in SQL rather than in jest.
- **`immutable` does the enforcing.** Postgres rejects a clock read or a table
  read inside an immutable function, so "no network, no clock, no env reads" is a
  property of the function rather than a promise about it.
- **A NULL price is a product state, not a failure.** Three outcomes produce one —
  `advise_me`, `no_rate`, `over_capacity` — and all three route the load to a
  human. Keeping "Not sure — advise me" unpriceable is deliberate: guessing a
  truck type to produce a number would quote a shipper for a truck they never
  asked for.

The rules, all now enforced:

- **The server always recomputes the price.** A client-supplied price is display
  data, never authority. On mismatch: reject and log as suspected tampering.
- **Quotes are immutable and bound** to exact origin, destination, truck type,
  weight, and date. A booking referencing a quote re-verifies every one. A quote
  for Muscat→Seeb must never be redeemable for Muscat→Salalah.
- **Quotes expire** — default 48h, enforced server-side.
- **Rate cards and distance tables are admin-write-only.** A driver who can edit
  distances can manufacture a fake discount. Privileged configuration, not app
  data. Log every mutation with actor and before/after values.
- **The pricing function is pure and unit-tested.** No network, no clock read
  inside it (pass the date in), no env reads. Tests must cover: minimum-fare
  floor, over-capacity rejection, missing distance, missing rate card, rounding,
  and negative/zero/absurd weight.
- **Money is integer baisa** (1 OMR = 1000 baisa) in all internal computation.
  Floats only at the display layer. Assert `total > 0` before persisting. See
  `src/lib/money.ts` — OMR is a *three*-decimal currency and most libraries
  assume two.
- **Rate-limit the quote path.** Without it a competitor sweeps every route pair
  and extracts the whole rate card in an afternoon. Business risk, not theory.

**Already enforced:** `loads.price_baisa` carries no client INSERT or UPDATE
grant. A shipper cannot set or alter a price at any point. `public.quotes` goes
further — no client write grant of any kind, plus a trigger that refuses an edit
even from the table owner, because a definer function runs as owner and grants
would not stop it.

**Still open:** per-IP rate limiting (§11). The quote path is authenticated-only
for exactly that reason — an anonymous quote endpoint is how a competitor sweeps
every route pair and extracts the card in an afternoon. Do not add one before §11
is closed, however much the website's public quote form suggests it.

**`quote_route()` (0011) is now the cheapest sweep surface, deliberately.** It
prices parameters rather than a load, so the shipper sees the price *before*
committing — and so the implicit throttle of `post_load` (20/hour) no longer
stands in front of the card. It is therefore shipper-only, authenticated-only, and
rate-limited at 30/hour. That is a real reduction in the cost of extraction,
accepted because a price a customer cannot see before committing is not a product.
It is the reason there is still no anonymous quote path, and it is the first thing
to re-examine if rate-card extraction ever looks like it is happening.

**One implementation, not two.** `quote_route` and `quote_load` both delegate to
`private.price_for()`. Duplicating the outcome rules would recreate, one layer up,
exactly the divergence this section forbids for the formula: two implementations
of a price disagree eventually, and the disagreement surfaces as a number a
customer was shown.

### 5a. Automatic dispatch and "book = accept" (0036)

- **"Let us choose" is priced**, for the smallest truck whose capacity carries
  the weight (`private.resolve_truck_type`). Reversed from 0010 at the founder's
  request; the screen names the truck. No weight → still `advise_me`.
- **`book_load` compares, never stores, `p_seen_price_baisa`.** The load is
  accepted and dispatched only when the server's price equals the one the
  shipper saw. A mismatch does **not raise**: raising would roll back the load
  *and the rate-limit counter*, and the RPC would become an unlimited yes/no
  oracle for binary-searching the rate card. Instead the load is posted and
  priced but not accepted, and every probe spends one of `post_load`'s 20/hour.
- **Candidates are private.** `private.nearby_drivers` and `private.dispatch_wave`
  read every driver's availability and are ungranted, like `candidates_for`.
  A wave offers a load to at most `auto_dispatch_max_offers` drivers who are
  online, verified when `require_verified_driver` is on (**off until launch** — see
  OPEN_ISSUES), fitting, not
  suspended and not already on a job — nearest first, radius widening over time.
- **Lock order.** A decline holds its offer row; an accept holds the load and
  wants the sibling offers. `private.next_wave` therefore takes the load lock
  `SKIP LOCKED` and backs off rather than waiting, and the every-minute job
  retries. Exercised with concurrent sessions (accept vs decline, three accepts
  at once): no deadlock, exactly one trip.

## 6. Input validation

- Every entry point — RPC, Edge Function, webhook, background job — begins with
  a schema parse of the **entire** input. Only the parsed object is used
  downstream; the raw input is never referenced again.
- Schemas use allowlists: enums for truck types, statuses, roles, cities. Never
  free text where an enum will do.
- Validate on the server even when the same Zod schema runs on the client.
  Client validation is UX, not a control.
- Bound everything: string max lengths, numeric min/max, array lengths, date
  ranges (no pickup dates in 2074), file sizes.
- **Reject unknown keys** rather than stripping silently — silent stripping
  hides attacks. Use `z.object({...}).strict()`.

## 7. Injection

- **Parameterized queries only.** No concatenation into SQL, including column
  names, table names, `ORDER BY`, and `LIMIT`. Dynamic sort maps through a
  hardcoded allowlist.
- **Privileged database functions pin their search path.** Every
  `security definer` function sets `search_path = ''` and fully qualifies every
  identifier. An unpinned search path in a definer function is a
  privilege-escalation primitive.
- **Output encoding:** never render user content as raw HTML. No
  `dangerouslySetInnerHTML`. If rich text is ever needed, raise it as a design
  decision first.
- **The WhatsApp deep link is an injection sink.** Cargo descriptions and names
  flow into a URL query parameter. URL-encode every interpolated value, and
  strip control characters and bidirectional overrides (U+202A–U+202E,
  U+2066–U+2069). In a bilingual Arabic/English UI an RTL override inside a
  company name is a display-spoofing vector. Enforced in
  `src/lib/safe-text.ts` and again by a database trigger, because the client is
  hostile.
- **CSV export**, if ever added: prefix cells beginning with `= + - @ tab CR`.

## 8. State machines

Status fields are never set from user input. Transitions are enforced
server-side in RPCs; no client holds an UPDATE grant on a status column.

```
loads:  posted -> finding_truck | matched | cancelled
        finding_truck -> matched | cancelled
        matched -> assigned | finding_truck | cancelled
        assigned -> in_transit | cancelled
        in_transit -> delivered
        delivered -> closed
offers: pending -> accepted | declined | expired
trips:  assigned -> in_transit -> delivered -> closed
        (any non-terminal -> cancelled)
```

Nothing returns to `posted`. Each transition validates current state, actor
role, and actor ownership. An invalid transition is an error and a log line,
never a silent no-op.

## 9. Secrets and keys

- **Any env var in the client bundle is public forever.** In Expo, anything
  prefixed `EXPO_PUBLIC_` is on a billboard. Only the Supabase URL and the
  **anon** key may carry that prefix.
- The **service-role key bypasses all RLS.** Rules:
  - It never appears in client-reachable code. Not once. Not in `app.json`, not
    in an `EXPO_PUBLIC_` var, not in a comment.
  - Its use is confined to `supabase/functions/` (server-side Edge Functions).
  - Every call site carries a comment explaining why user-scoped access is
    insufficient.
  - A new call site requires flagging it for review.
- No secrets in the repo, comments, test fixtures, seed data, or error messages.
  `.env.example` holds key names and dummy values only.
- Third-party keys scoped to minimum permissions, restricted by referrer/IP
  where supported.

## 10. Data exposure

- **Select explicitly.** No `select('*')` crossing a trust boundary. Adding a
  column must never auto-expose it.
- A driver's view of a load exposes: route, dates, truck type, weight, goods
  description. It must **not** expose the shipper's phone number until a trip is
  assigned.
- A shipper's view of a match exposes: driver display name, truck type, dates.
  It must **not** expose the driver's phone number, other legs, or other loads.
- **PII never enters logs.** No phone numbers, names, or cargo descriptions in
  log output or error messages. Log the row UUID and look it up.
- Client-facing errors are generic. Stack traces and SQL errors stay
  server-side.
- **Storage buckets are private by default** with short-lived, single-purpose
  signed URLs. No public bucket without explicit written approval.
- **The `pod` bucket carries one ops policy, and it is the only place ops holds
  a table-level privilege** (`"ops reads pod"`, migration 0015). Every other
  cross-tenant ops read goes through a definer function; storage cannot, because
  a signed URL is minted by the storage service against `storage.objects` RLS
  and no SQL function can produce one. The alternative was a service-role key in
  the dispatch console, which is worse. The policy is additive, `select` only,
  and scoped to `private.is_ops()`; the two policies from 0004 are untouched.
  Proof of delivery remains append-only — there is still no `update` or `delete`
  policy on `storage.objects` for anyone, ops included. Asserted in
  `supabase/tests/ops_console.sql` §4.

## 11. Rate limiting and abuse

| Action | Limit basis | Where |
|---|---|---|
| OTP request | phone + IP + global | Supabase Auth config (phase 2) |
| OTP verify | per code, attempt-capped | Supabase Auth config (phase 2) |
| Quote calculation | IP (anon), user (authed) | Edge Function + gateway |
| Load creation | per shipper | `public.check_rate_limit` |
| Leg creation | per driver | `public.check_rate_limit` |
| Login | IP + account | Supabase Auth config |

Exceeding a limit returns an error with no detail about the limit's shape.

**Known MVP gap:** Postgres cannot see client IPs. Per-user throttles are
enforced in `check_rate_limit`; per-IP limits require an Edge Function or
gateway and are **not yet implemented**. Anonymous endpoints must not ship
before they are.

## 12. Transport and headers

Largely applies to Edge Functions and any future web surface; the native app
inherits TLS from the SDK.

- HTTPS only. HSTS on any web surface.
- CSP with no `unsafe-inline` and no wildcard sources.
- `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY` / CSP `frame-ancestors 'none'`.
- CORS: explicit origin allowlist. Never `*` on an authenticated endpoint.
- CSRF protection on all cookie-authenticated state-changing requests.

## 13. Dependencies

- Prefer the platform. Every dependency is attack surface plus supply-chain
  risk.
- Before adding one: state what it does, why it can't be a 20-line function,
  its maintenance status, and its transitive count. Wait for approval.
- Lockfile committed. No `latest`, no floating majors.
- Never install a package whose exact name is unverified — typosquatting is the
  cheapest attack on this project.

## 14. Required security tests

Not optional, not "later." A stage is incomplete without them.

- **Tenant isolation suite** (`supabase/tests/`) — for every owned table
  (`trucks`, `legs`, `loads`, `offers`, `trips`, `trip_events`, `profiles`),
  assert actor A gets zero rows / an error on read, update, and delete of actor
  B's row. Grows with every new owned table.
- **Authorization matrix** — each RPC × each role (anon, shipper, driver),
  asserting expected allow/deny. A new RPC without an entry fails review.
- **Mass-assignment** — attempt to set every field in `SENSITIVE_FIELDS.md`;
  assert rejection. Specifically `profiles.role` → admin-ish values, and
  `drivers.verified_at` → now().
- **Price integrity** — submit a tampered price and a mismatched quote binding;
  assert both rejected. *(Activates with pricing.)*
- **Pricing unit tests** — the §5 edge cases. *(Activates with pricing.)*
- **Dispatch reach** — assert `private.candidates_for` is unreachable by any
  client role, that a driver appears at exactly one tier, and that a driver who
  was not offered a load still cannot read it. *(Added with 0012–0014.)*

### Definer functions and who may call them

`private.*` functions carry no grant at all: they run only as the owner, from
inside a `public` function that has already done its own authorization.

| Function | Schema | Authorization |
|---|---|---|
| `match_load` | public | re-checks `shipper_id = auth.uid()` internally |
| `quote_load`, `quote_route`, `current_quote` | public | actor-scoped fetch; shipper only |
| `post_load`, `post_leg` | public | role check + rate limit |
| `respond_to_offer` | public | offer fetched scoped to `auth.uid()` |
| `advance_trip`, `trip_counterpart`, `trip_truck` | public | trip participant only |
| `ops_queue`, `ops_candidates`, `ops_send_offer`, `ops_mark_finding_truck`, `ops_set_price`, `ops_sweep_expired_offers` | public | `private.require_ops()` first |
| `create_offer` | public | **revoked from every client role** — ops path only |
| `candidates_for` | private | **none — callers must check.** The load board with the guard removed |
| `auto_dispatch`, `issue_quote`, `price_for`, `compute_price`, `corridor_of`, `setting_bool`, `setting_int` | private | none; not client-reachable |

## 15. Definition of done

Do not report a stage complete without a short **Security Note** covering:

1. New tables/columns, and their access policy per role
2. New RPCs/routes, and their authorization check
3. Any new sensitive field, added to `SENSITIVE_FIELDS.md`
4. Any service-role call site introduced, with justification
5. Which §14 tests were extended
6. **Anything you were unsure about** — mandatory, and "nothing" is rarely
   honest

## 16. When to stop and ask

Halt and raise it rather than deciding, if a task would require:

- A new use of the service-role key
- Disabling or loosening an RLS policy
- Rendering user-supplied content as HTML
- Accepting a price, role, ownership ID, or status from the client
- Adding a public storage bucket
- A new third-party dependency touching auth, crypto, or payments
- Any endpoint returning data across tenants

"The task told me to" is not a justification. Raise the conflict.
