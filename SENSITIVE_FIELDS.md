# Sensitive fields register

Required by `SECURITY.md` §4. **Every field here is never writable by the user
it belongs to.** Adding such a field to the schema means adding it here in the
same change.

Enforcement is layered:

1. **Column-level Postgres grants** — `authenticated` holds INSERT/UPDATE on an
   explicit column list only. A write to anything below is rejected by the
   database before RLS is even consulted.
2. **RLS** — row ownership, independently.
3. **Application code** — writes are constructed field by field, never spread
   from a request body.

Layer 1 is the one that survives a careless refactor, which is why it exists.

---

## `profiles`

| Field | Why it's locked | Who may change it |
|---|---|---|
| `id` | Identity. Must equal `auth.uid()`. | Nobody — set at signup from the session |
| `role` | **Privilege escalation.** A driver flipping to shipper (or vice versa) crosses a tenant boundary and changes every RLS outcome. | Set once at signup insert; never updatable |
| `created_at` | Audit integrity | Nobody |
| `suspended_at` | **The account kill switch.** A user who can lift their own suspension is not suspended. | Ops only, via `ops_suspend_account` |
| `suspended_by` | Names the dispatcher who made the call. Internal — not readable by the suspended user either, which is why 0017 replaced the table-wide SELECT grant with a column list. | Ops only |
| `suspended_reason` | Shown to the suspended user by `private.require_active`, so a user who could edit it could rewrite the record of their own suspension. | Ops only |

Client may write: `full_name`, `phone`, `language`.
Client may read (own row only): everything above **except `suspended_by`**.

> A column-level `revoke` does **not** cut a hole in a table-level `grant` —
> Postgres keeps honouring the table grant for every column and the revoke
> silently achieves nothing. 0017 therefore revoked `select` on `profiles`
> outright and granted the columns back by name. Every future column on this
> table is now deny-by-default, as INSERT and UPDATE always were.

> `role` is deliberately grantable on **INSERT** only — both roles are
> self-selected at signup. There is no UPDATE grant, so it cannot be changed
> afterwards, and there is no DELETE grant, so the row cannot be recreated with
> a different role.

## `drivers`

| Field | Why it's locked | Who may change it |
|---|---|---|
| `verified_at` | **The trust claim.** The live website states "100% verified drivers". A driver self-verifying makes a public claim false. | Ops only, service-role or admin path |
| `verified_by` | Audit trail for the above | Ops only |
| `notes` | Internal vetting notes — never client-readable | Ops only |

Client may write: nothing. The row is created by ops.

## `trucks`

| Field | Why it's locked | Who may change it |
|---|---|---|
| `verified_at` | Same as above — a fake-verified truck defeats vetting | Ops only |
| `owner_id` | Ownership transfer = theft primitive | Nobody |

Client may write: `truck_type`, `plate`, `capacity_kg` (on own rows).

## `loads`

| Field | Why it's locked | Who may change it |
|---|---|---|
| `price_baisa` | **Crown jewel #1.** Client-supplied prices are display data, never authority (`SECURITY.md` §5). | Server pricing path only |
| `currency` | Paired with the above; a currency swap is a 1000× price change given OMR's three decimals | Server only |
| `status` | Business state machine (`SECURITY.md` §8). Self-setting `assigned` binds a truck without dispatch. | RPC transitions only |
| `accepted_at` | **The fact `status` cannot carry** (0026). `matched` is reachable both before acceptance (a dispatcher offering by hand) and after it (auto-dispatch inside `accept_quote`), so a status check cannot tell a commitment from an intention. This is what makes an accepted price immutable to `ops_set_price`. | `accept_quote()` only |
| `shipper_id` | Ownership | Fixed at insert to `auth.uid()` |
| `priced_truck_type` | **The truck the price is for** (0036). "Let us choose" leaves `truck_type_code` NULL (non-negotiable #1) and this records which truck the server priced it as — smallest that carries the weight. A client that could write it would re-point the price at a cheaper truck. Readable by the shipper, so the screen can name it. | `private.issue_quote()` only |
| `created_at` | Audit integrity | Nobody |

Client may write on INSERT: `origin_city`, `dest_city`, `pickup_from`,
`pickup_to`, `weight_kg`, `truck_type_code`, `goods_description`.
Client may write on UPDATE: **nothing.** Edits and cancellation go through RPCs.

## `legs`

| Field | Why it's locked | Who may change it |
|---|---|---|
| `status` | State machine. Self-setting `matched` corrupts matching. | RPC transitions only |
| `driver_id` | Ownership | Fixed at insert to `auth.uid()` |
| `created_at` | Audit integrity | Nobody |

Client may write: `truck_id`, `origin_city`, `dest_city`, `depart_from`,
`depart_to`, `is_empty`, `free_kg` (on own rows).

`free_kg` (0029) is **not** sensitive and is recorded here so this file stays a
complete list rather than a list of exceptions. It is supply information the
driver volunteers about their own truck, it never leaves driver-owned rows, and
it is bounded by `legs_free_kg_sane` (1–60,000 kg) like every other number a
client can send. NULL means "empty, or did not say" — `post_leg` drops it
entirely when `is_empty`, because two answers to one question disagree
eventually.

## `offers`

Client may write: **nothing.** Offers are created by the matching path and
resolved through `respond_to_offer()`. All columns locked.

| Field | Why it's locked |
|---|---|
| `load_id`, `driver_id`, `leg_id` | Forging an offer to yourself grants read access to another shipper's cargo details |
| `status` | State machine |
| `source` | **Not readable either.** `'ops'` or `'auto'` (0014). A driver who can see it learns that nobody reviewed their load before it was sent; a shipper who can see it learns the shape of the fan-out. Neither is theirs to know, and neither changes what they can do. |

`source` is also the reason `offers` no longer carries a table-level `SELECT`
grant. It was narrowed to an explicit column list in 0012, because a table-level
grant means the *next* column added is exposed by default — the failure
`SECURITY.md` §10 exists to prevent. Adding a column here means extending that
grant on purpose, or deliberately leaving it server-side.

## `trips`

Client may write: **nothing.** Trips are created by `accept_offer()`.

| Field | Why it's locked |
|---|---|
| `load_id`, `driver_id`, `truck_id`, `leg_id` | Binding a truck to a load is a dispatch decision, not a client write |
| `status` | State machine — advanced via `advance_trip()` |

## `trip_events`

| Field | Why it's locked | Who may change it |
|---|---|---|
| `created_by` | Attribution. Must equal `auth.uid()`. | Trigger-set from session |
| `occurred_at` | **Backdating a delivery is fraud.** | Server default `now()` |

Client may write: `trip_id`, `type`, `note`, `photo_path` — insert only, no
update or delete grant, because a proof-of-delivery trail that can be edited is
not a trail.

## `public.trip_positions` — where the truck is

| Field | Why it's locked | Who may change it |
|---|---|---|
| every column | A driver's location is personal data under Oman's PDPL, and the accumulated rows are a movement history. | `report_position()` only |

Client may write: **nothing.** Client may *read*: **nothing.** The table has **no
grant of any kind** to `anon` or `authenticated`; RLS is enabled and forced with
no policies, so a grant added by accident later still fails closed.

- `report_position()` stores a fix only when `trips.driver_id = auth.uid()` **and**
  `trips.status = 'in_transit'`. Tracking that stops when a trip ends is a promise
  if the client does it and a fact if the function does. It returns `false`
  rather than raising for a finished trip — the delivery and the last queued ping
  race by seconds.
- `trip_position()` returns **the latest fix only**, to the trip's driver, the
  load's shipper, or ops. **No client ever reads the trail.** The difference
  between "where is my truck" and "where has this driver been for a month" is
  that `limit 1`, and it is the reason the read is a function rather than a
  policy.
- `ops_sweep_positions()` deletes past a retention window, requires
  `private.require_ops()`, and lands in `private.ops_audit` with the row count
  and the reason. `ops_position_health()` reports the oldest surviving point so a
  forgotten sweep is visible.

Coordinates are bounded twice — in the RPC and again by `trip_positions_in_region`
— like every other client-supplied number (`SECURITY.md` §6).

## `public.driver_availability` — online, and which town (0036)

| Field | Why it's locked | Who may change it |
|---|---|---|
| `available` | **Decides who is offered cargo.** A client write could keep a driver "online" forever, or switch a rival off. | `set_available()`, the trip trigger (a job takes a driver offline; delivering puts them back online at the destination), the 12 h expiry job |
| `city_id` | **Ranks drivers by distance.** A driver who could write their own town could put themselves first in line for every load from anywhere. Snapped server-side from one GPS reading, or taken from the last delivery. | Same as above |
| `source` | Records how the town was learned (`gps`/`delivery`/`manual`) | Same as above |
| `driver_id`, `updated_at` | Ownership; the 12 h expiry reads `updated_at` | Server only |
| `lat`, `lng`, `accuracy_m` | **Where a driver is, to the metre.** Ranks who is offered cargo; also where someone lives. No client grant at all — not even the driver's own row. Overwritten, never kept as a trail; erased on switch-off and at delivery. | `report_location()` (online only), `set_available()`, the trip trigger |
| `located_at` | When the phone took the fix (clamped to server time). Client may read its own. | Same as above |

Client may write: **nothing.** Client may read: **its own row only** (RLS,
column grant), and never a coordinate. Since 0039 the latest GPS point is
stored (founder's decision, 2026-09-28, reversing 0036's "a town, never a
coordinate"). No client role can read it; asserted in
`supabase/tests/dispatch.sql` §8 and `tenant_isolation.sql`.

## `public.quotes`

Client may write: **nothing.** Quotes are issued by `quote_load()` and
`ops_set_price()` only. There is no INSERT, UPDATE, or DELETE grant, and a
`before update or delete` trigger refuses the edit as well — because a definer
function runs as owner and is not subject to grants at all, so the grant alone
would not stop a future RPC from quietly amending a price.

| Field | Why it's locked | Who may change it |
|---|---|---|
| `price_baisa` | **Crown jewel #1.** The server always recomputes; a client price is display data (`SECURITY.md` §5). | `quote_load()` / `ops_set_price()` |
| `outcome` | Distinguishes a real price from the three no-price cases. Forging `quoted` fabricates a price out of nothing. | Server only |
| `expires_at` | §5 requires expiry enforced server-side. A client that could push it out holds a price forever. | Server default, 48h |
| every binding column | `origin_city`, `dest_city`, `truck_type_code`, `weight_kg`, `pickup_from`, `pickup_to`. Editing one redeems a Muscat→Seeb price for Muscat→Salalah — the exact attack §5 names. | Nobody |
| `shipper_id`, `load_id` | Ownership | Fixed at issue |

Client may **read** its own rows, by explicit column grant — with one exception:

| Withheld from SELECT | Why |
|---|---|
| `rate_card_id` | Provenance. A shipper collecting quotes across routes and seeing which shared a card learns the band structure of the rate card, which is the moat. |

`loads.price_baisa` gains a second defence in the same change: a
`before update` trigger on `loads` nulls the price if any binding column moves,
so a price can never outlive the thing it priced.

## `public.ratings`

Client may write: **nothing**, and client may read: **nothing.** The table has no
grant to `anon` or `authenticated` at all. A rating is written by `rate_trip()`
and read only in aggregate through `driver_summary()`.

| Field | Why it's locked | Who may change it |
|---|---|---|
| `stars` | A driver who could write this rates themselves; a shipper who could update one holds a driver's score hostage after the fact. Insert-once — a rating that can be revised is a note. | `rate_trip()`, once per trip |
| `driver_id` | Denormalised from the trip. Client-supplied, it would let anyone attach a score to any driver. | Derived inside `rate_trip()` |
| `shipper_id` | Ownership | `auth.uid()` inside the definer |
| `trip_id` | Primary key, and the thing `rate_trip()` checks the caller owns and has had delivered. | Fixed at insert |

**No per-driver read grant, deliberately.** Individual scores are supply
intelligence of the same kind as a driver's legs — a shipper who could read the
`ratings` table would be reading every driver's performance. `driver_summary()`
returns a count and an average, refuses a driver the caller has no trip with, and
returns **NULL rather than 0** when nobody has rated them, so the screen shows
nothing rather than inventing a score.

## `private.rate_cards` — the rate card itself

| Field | Why it's locked | Who may change it |
|---|---|---|
| every column | **Crown jewel #1 — the business's actual moat** (`SECURITY.md` §1). A driver who can edit a rate manufactures a discount; a competitor who can read one has the pricing model. | Nobody, through any API |

Client may write: **nothing.** Client may *read*: **nothing.** Like
`private.ops_users`, the table has no grant to `anon` or `authenticated`, lives in
`private` where PostgREST cannot reach it, and is populated **by hand**. There is
deliberately no write RPC and no admin UI.

`private.compute_price()` — the formula — is likewise revoked from every client
role. A caller who could pass their own rate values would brute-force the card by
finding which inputs reproduce a real quote.

Every mutation is logged to `private.rate_card_audit` with actor and before/after
row, as §5 requires. That table is equally ungranted.

**There is no `src/lib/pricing.ts`, and there must not be.** Two implementations
of a price will eventually disagree, and the disagreement surfaces as money; a
client-side formula would also ship the shape of the card in the app bundle,
which §9 says is public forever. `tests/security/schema-invariants.test.ts` fails
the build if one appears.

## `private.app_settings` — the commission rate

| Field | Why it's locked | Who may change it |
|---|---|---|
| `commission_pct` (0028) | **It decides what a driver is paid.** The share Truckkoo keeps of a load's price, and the input to `private.payout_for()`. A driver who could edit it pays themselves the margin; anyone who could read it arbitrarily learns the take rate. | `public.ops_set_commission()` only |

Client may write: **nothing.** Client may *read*: **nothing** — the table has no
grant to `anon` or `authenticated` and lives in `private`. `commission_pct()` and
`payout_for()` are revoked from every client role; a driver sees the *result* on
their own offer, which is deliberate (P5 spec §2: they collect the price in cash,
so the per-load margin cannot be a secret from them), but never the rate itself
and never a rate applied to somebody else's load.

`ops_set_commission` bounds the value at 0–40 percent — anything higher is a
slipped decimal, not a policy — demands a reason, and writes both to
`private.ops_audit`. Same rule as a rate band, for the same reason.

## Reference tables — `cities`, `truck_types`

Client may write: **nothing.** SELECT only. These are configuration lifted from
the website; a driver who can add a city or edit a truck's capacity can defeat
capacity filtering in matching.

## `private.ops_users` — the dispatcher allow-list

| Field | Why it's locked | Who may change it |
|---|---|---|
| `profile_id` | **Membership is the whole authorization boundary for dispatch.** | Nobody, through any API |
| `note`, `added_at` | Same table, same reasoning | Nobody |

Client may write: **nothing.** Client may *read*: **nothing.** The table has no
grant to `anon` or `authenticated` and lives in `private`, which PostgREST does
not expose. Its only reader is `private.is_ops()`, which runs as owner.

**Ops membership is deliberately not a `profiles.role` value.** `role` carries an
INSERT grant — that is how signup records shipper vs driver — and a column-level
grant cannot restrict *which value* is inserted. An `'ops'` role would therefore
be self-assignable at signup, which is a direct path into every shipper's cargo
and every driver's declared routes.

Dispatchers are added by hand:

```sql
insert into private.ops_users (profile_id, note) values ('<uuid>', 'founder');
```

There is intentionally no UI and no API path for this.

### Dispatch functions read across tenants

`ops_queue()`, `ops_candidates()`, `ops_send_offer()` and
`ops_mark_finding_truck()` see other people's data by design. They are the one
place in the product that does. Each opens with `private.require_ops()`, which
raises `no_data_found` — "not found", never "forbidden", since a 403 confirms the
endpoint is worth attacking. No table policy was loosened to build them, so a bug
in an ops screen cannot widen what any other client sees.

`create_offer()` remains revoked from `anon` and `authenticated`.
`ops_send_offer()` is the only way to reach it.

---

## Not yet existing, but pre-registered

- `distances.*` — a driver editing these manufactures a fake discount. Not built:
  MVP pricing bands by corridor rather than by distance, so there is no distance
  table. It arrives with Phase 3's PostGIS proximity matching (`STACK.md` §8), and
  is admin-write-only from its first migration.

*(`rate_cards.*` and `quotes.*` landed in `0010_pricing.sql` — see above.)*

### `load_places` (0041)

| Column | Client write | Why |
|---|---|---|
| every column | **none** | Written only by `book_load`, which derives the city from the point. |
| `contact_name`, `contact_phone` | none | A third party's personal data (the person at the gate). Readable by the owning shipper; by a driver only through `driver_offers()` while pending and `driver_trip()` until delivery; by ops through `ops_load_places`. |
| `lat`, `lng` | none | The shipper's premises. Same readers as above. |
