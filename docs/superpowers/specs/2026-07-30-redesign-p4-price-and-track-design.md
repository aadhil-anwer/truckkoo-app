# Truckkoo redesign — P4 · Price and track

**Date:** 2026-07-30
**Status:** awaiting approval
**Depends on:** P0, P1, P3 (all complete)
**Screens:** T1–T5, plus the state the handoff never drew

---

## 1. What P4 is for

The handoff calls this flow "the core of the redesign", and it is the only one
that did not exist in any form before: a shipper posted a load and then waited
with no feedback while pricing happened over WhatsApp.

P4 brings the wait, the price and the delivery into the app.

**It is also the riskiest phase in the plan**, because it reorders a state
machine that already works. Everything else so far has been additive.

---

## 2. The reorder, and why it is dangerous

`CLAUDE.md` decision D5 (taken before P0) puts shipper acceptance *before*
dispatch, matching T2 → T3. Today it is the reverse:

```
NOW     post_load ─► auto-dispatch offers ─► driver accepts ─► trip, load 'assigned'
                     (shipper approves nothing)

AFTER   post_load ─► matching ─► quoted ─► shipper accepts ─► offers
                                                            ─► driver accepts ─► assigned
```

**What that touches, all of it currently working and tested:**

- `post_load` auto-dispatches tier-1 matches inline today, bounded by
  `private.app_settings`. That call has to move behind acceptance.
- `respond_to_offer` creates the trip and sets `assigned`. Unchanged in shape,
  but it can now only fire on a load that was accepted.
- The ops console (`~/truckkoo-ops`) reads and writes these statuses through
  `ops_queue`, `ops_set_load_status` and friends. It is a **separate deployed
  app** that this repo cannot update in the same commit.
- Three SQL suites assert the current order.

**Because of that last point, P4 splits and the backend lands first**, so the
ops console has a window to catch up before any screen depends on the new order.

---

## 3. Decisions taken

| # | Decision | Why |
|---|---|---|
| C1 | **Two new `load_status` values: `quoted` and `accepted`.** | The four shipper-visible states the handoff names map onto existing values except these two. `quoted` is "a price is waiting for you"; `accepted` is "you said yes, we are finding the truck". |
| C2 | **Adding the enum values is its own migration**, applied before anything uses them. | Postgres cannot use a new enum value in the same transaction that adds it. Two migrations, not one clever one. |
| C3 | **Auto-dispatch moves from `post_load` to `accept_quote`.** | Otherwise offers go out before the shipper has agreed a price, which is the order D5 exists to fix. `private.dispatch_log` and the two caps are unchanged — only the trigger point moves. |
| C4 | **`accept_quote` is idempotent and re-checks ownership.** | It is a committing action reached from a screen with a live countdown; a double tap, a retry on flaky signal and a stale screen must all be safe. Ownership is verified *inside* the definer function against `auth.uid()`, like `match_load`. |
| C5 | **An accepted price is immutable.** | `ops_set_price` must refuse a load the shipper has already accepted; re-pricing becomes a *new* quote the shipper decides on again. This was filed as unbuilt in `OPEN_ISSUES.md` at P0 and is now in scope. |
| C6 | **The gap state renders as a T1 variant** — narrated wait, timeline advanced, corridor still **dashed**. | Decided at P0 (§4.8). If no driver takes it inside the offer window the load falls to `finding_truck` and a human resolves it. Never a dead end. |
| C7 | **Ratings are real or absent.** A new `ratings` table, written once per trip by the shipper. | T3 shows "4.9 · 212 trips". With no history the driver card shows the name and vehicle and **no rating at all** — not "0.0", not "New driver ★". Rule #5. |
| C8 | **Trip counts come from delivered trips**, counted server-side. | Same rule. A driver with two trips shows "2 trips", not a rounded flourish. |
| C9 | **T4's truck position is not live in P4.** | P6 owns GPS. T4 renders the corridor, the ETA and the progress from trip state and `collected_at`; the marker sits at an interpolated point and the copy does not claim a live fix. |

---

## 4. Backend

| Migration | Adds |
|---|---|
| `0022` | the two enum values, alone |
| `0023` | `accept_quote`, the dispatch move, `ops_set_price` guard, `ratings` + `rate_trip`, driver-summary read |

Every definer function pins `search_path = ''` and **fully qualifies types** —
`public.load_status`, not `load_status`. That unqualified cast is what killed
`advance_trip` silently for months.

`ratings` denies by default: revoke, force RLS, then grant back per column with a
reason. A shipper may insert one rating for their own delivered trip and may not
update it. `supabase/tests/tenant_isolation.sql` gains it, per the standing rule
that every new owned table goes in that file.

**No client may set a status.** Transitions stay in RPCs.

---

## 5. Screens

| Screen | State | Notes |
|---|---|---|
| T1 | `posted` / `finding_truck` | search rings, **dashed** corridor, narrated timeline. Not a spinner. |
| T1b | `accepted` | same shell, timeline advanced, corridor still dashed |
| T2 | `quoted` | the price is the screen. "Accept N OMR" carries the amount in the label. |
| T3 | `assigned` | a named person, their vehicle, call and message |
| T4 | `in_transit` | ETA, progress, payment due |
| T5 | `delivered` | **the only green in the product**, receipt, rating |

`color.delivered` appears on T5 and nowhere else. A second use means that screen
is wrong.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| **The ops console is a separate deployment and will see new statuses it does not know.** | Backend lands first (§2). The new values are additive — nothing existing is renamed or removed — so an un-updated console keeps working, it just cannot yet act on `quoted`/`accepted`. Documented in the migration and in `OPEN_ISSUES.md`. |
| Auto-dispatch moving could strand loads mid-flight | It fails *open into the human path* today and must keep doing so. Loads already `posted` when 0023 lands have no quote to accept — they must not become unreachable. The migration states what happens to in-flight rows. |
| `accept_quote` double-fires | C4: idempotent, ownership re-checked inside. |
| No ratings and no trips exist, so T3/T5 render empty | C7/C8: absent, not zeroed. Tested with an empty history first, as with the estimate in P3. |
| Reordering breaks the three SQL suites | Expected. They encode the *old* order and must be updated deliberately, not deleted to reach green. |

---

## 7. Definition of done

1. `npm run verify` and `npm run test:db` green.
2. A load can go `posted → quoted → accepted → assigned → in_transit → delivered`
   in SQL, asserted end to end.
3. `ops_set_price` refuses an accepted load.
4. A driver with no history shows no rating and no trip count — no zeros.
5. `~/truckkoo-ops` still functions against the new schema, or the gap is written
   down with what it needs.
6. `OPEN_ISSUES.md` and `SENSITIVE_FIELDS.md` updated.
