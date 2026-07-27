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
| `shipper_id` | Ownership | Fixed at insert to `auth.uid()` |
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
`depart_to`, `is_empty` (on own rows).

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
