# Truckkoo redesign — P6 · Live GPS

**Date:** 2026-07-31
**Status:** awaiting approval
**Depends on:** P0, P1, P4, P5 (all complete)
**Screens:** T4 and D7 — no new screens

---

## 1. What P6 is for

T4 draws a truck on a map today, and that truck is a lie of omission. Its
position is `elapsed time ÷ corridor hours`, clamped away from both ends so it
never quite arrives and never quite fails to leave. It moves whether or not the
driver does.

P6 replaces it with a position the driver's phone actually reported, and — where
there is no such position — with nothing at all pretending to be one.

The second half of that sentence is the harder half, and it is most of the work.

---

## 2. The thing that shapes this phase

**Stale is the normal state, not the exception.**

Muscat→Salalah is about eleven hours. P6 reports position only while the driver
has D7 open (§3, F1), so for most of that run there is no new fix. Any design
that treats a fresh position as the default case and staleness as an error state
will spend most of its life in the error state.

Two industries have already answered this, differently:

- **Ride-hail and delivery** (Uber, DoorDash) run continuous background location,
  map-match the fix to the road network, and animate between points that are
  seconds apart. When signal drops they keep the marker and let the surrounding
  UI degrade. Their trips are 5–30 minutes, so stale is genuinely rare.
- **Freight telematics** (project44, FourKites, Samsara) take position from
  hardware in the truck and show the shipper a **timestamped last-known
  position** — "Last position report 14:32". Stale readings are routine and
  displayed as such, because in freight an auditable trail matters more than a
  smooth animation.

**Truckkoo is the second one**, and P6 follows it: the marker sits where the
truck was genuinely last seen, however long ago, and the age is on screen beside
it, always.

Note what both industries agree on, because it is the rule this phase enforces:
**no marker that is not derived from a real fix.** Interpolating between two
fixes ten seconds apart is smoothing. Interpolating from a departure time across
an eleven-hour run is a different thing wearing the same clothes, and it is what
ships today.

---

## 3. Decisions taken

| # | Decision | Why |
|---|---|---|
| F1 | **Foreground pings only.** Position is reported while D7 is open and the trip is `in_transit`. No background mode, no foreground service, no licensed library. | `STACK.md` calls background location "the single hardest thing in the whole product" and gates it on an App Store justification and a Play Console demo video. It is a Phase-3 item and this phase does not enter it. Everything server-side — the table, the RLS posture, the read RPC, the staleness rules — is identical to what background tracking would need, so adopting it later is a client change and **not a migration**. |
| F2 | **Last known position, always stamped.** The marker persists at the last real fix at any age; the age renders beside it; past 30 minutes the marker is dimmed. | §2. Removing the marker on an eleven-hour haul leaves the shipper an empty corridor for hours, which reads as a broken app rather than as honesty. The timestamp is what carries the honesty, and it is the freight-industry norm. |
| F3 | **`progressOf` and `interpolate` are deleted.** No fix means no marker — for a trip that has never reported, not a guessed one. | The estimate stops existing rather than quietly standing in for a fix. A fallback marker would be F2's dimming with none of its truth: the shipper cannot tell an old real position from an invented current one, and the timestamp would be a lie about a computation. |
| F4 | **The full trail is stored, purged at 30 days by an ops sweep.** | A trail supports delivery disputes, detour verification, and eventually real road distances to replace the great-circle estimate (`OPEN_ISSUES` 29). `pg_cron` is not enabled on this project (`OPEN_ISSUES` 27), so the sweep is a dispatcher action like the expired-offer sweep beside it. |
| F5 | **No client ever reads the trail.** `trip_position()` returns the **latest fix only**. The trail is reachable only through ops functions. | The difference between "where is my truck" and "where has this driver been for a month" is the difference between a logistics feature and a movement record. The first is the product; the second is what the schema must not hand to a shipper. |
| F6 | **Tracking is trip-scoped in the database, not only in the UI.** `report_position` verifies `trips.driver_id = auth.uid()` **and** `status = 'in_transit'` internally, and stores nothing otherwise. | `STACK.md`: "Tracking must visibly stop when a trip ends." A client that stops sending is a promise; a function that refuses to store is a guarantee. It also means a compromised or stale client cannot accumulate position on a finished job. |
| F7 | **No toggle. The driver is told, on D7, while it is happening.** | The OS "while using the app" prompt is the real consent gate and the driver revokes it in Settings like any other app. A switch gives the shipper a truck that can vanish for reasons they cannot see, and gives a near-zero-tech driver a way to break the feature by accident with no way to notice. |
| F8 | **The ETA is recomputed from the last real fix, in SQL.** Remaining road distance from that fix to the destination, over `road_factor_pct` and a new `avg_speed_kph` setting. With no fix it falls back to the corridor estimate, **also in SQL**, and says which it is. | The current ETA is fed by the same elapsed-time guess F3 deletes. Leaving it would put a real position beside an arrival time that ignores it — a truck visibly ahead of or behind its own ETA. Computing both in SQL keeps one implementation, as with price and detour; a client-side fallback would be the second one. No routing API: that is Phase 3 and a billing account. |
| F9 | **`report_position` returns `false` rather than raising when the trip is no longer live.** | The delivery transition and the last queued ping race by seconds. A driver should not see an error at the gate because their own delivery landed first. Authentication and out-of-range coordinates still raise. |

---

## 4. Backend

One migration, `0032_trip_positions.sql`.

### `public.trip_positions`

| Column | Type | Note |
|---|---|---|
| `id` | uuid pk | |
| `trip_id` | uuid not null → `trips` on delete cascade | |
| `driver_id` | uuid not null → `profiles` | denormalised so the sweep and the retention delete never join |
| `lat`, `lng` | `numeric(9,6)` | bounded to a generous GCC box — lat 12–33, lng 34–60 |
| `accuracy_m` | numeric | null when the device does not say |
| `seen_at` | timestamptz not null | **when the phone saw it**, not when the row landed |
| `created_at` | timestamptz not null default now() | |

Indexed on `(trip_id, seen_at desc)` — every read is "the newest row for this
trip" — and on `(driver_id, seen_at)` for the sweep.

**No client grant of any kind.** RLS enabled and forced, with no policies,
because nothing reaches the table directly. Deny by default, per `SECURITY.md`.
Coordinates are bounded at the table as well as in the RPC: a client-supplied
number gets bounded twice, like every other one (`SECURITY.md` §6).

### Functions

All `security definer`, `search_path = ''`, fully qualified identifiers **and
types** — `public.trip_status`, never bare.

| Function | Who may call it | Does |
|---|---|---|
| `report_position(p_trip_id, p_lat, p_lng, p_accuracy_m) → boolean` | `authenticated` | Re-checks `driver_id = auth.uid()` and `status = 'in_transit'` inside (F6). Rate-limited at 240/hour via `private.check_rate_limit`. Returns `false` when the trip is not live (F9). |
| `trip_position(p_trip_id) → table` | `authenticated` | The **latest fix only**, plus `eta_at`, `remaining_km` and `eta_source`. Returns rows to the trip's driver, the shipper who owns the load, and ops. Anyone else gets **no row** — not found, never forbidden. |

`trip_position` returns **one row for any trip the caller may see, whether or not
a fix exists**. With no fix, `lat`/`lng`/`seen_at` are null and `eta_source` is
`'corridor'` — the arrival time derived from the pickup event and the full
corridor duration, which is the estimate T4 shows today. With a fix,
`eta_source` is `'fix'`.

That shape is deliberate: it keeps **both** ETAs in SQL, so the client never
holds a second arrival-time implementation for the fallback case, and it lets T4
decide what to draw from one field rather than by re-deriving "do we have a
position" from three nullable ones.
| `ops_sweep_positions(p_days, p_reason)` | ops | `private.require_ops()` first; deletes points older than `p_days`; logs to `private.ops_audit` with the row count. |
| `ops_position_health()` | ops | Age of the oldest stored point and the total row count, so the console can show that nobody has swept. |

`private.point_km(p_lat, p_lng, p_city_id)` computes remaining distance, reusing
0024's haversine and the `road_factor_pct` setting rather than restating either.

`avg_speed_kph` joins `private.app_settings` at 65, ops-tunable without a
migration — the same pattern as `road_factor_pct`, and for the same reason: it
will be wrong until there is real trip data to tune it against.

### Why the ETA is a timestamp and not a distance

`trip_position` returns `eta_at` computed server-side. The client does no
arithmetic on it. `src/map/distance.ts` and `private.route_km` already hold the
same road factor in two places and agree today at 1.20 — a second consumer doing
its own ETA arithmetic is how that stops being true.

---

## 5. Screens

No new screens. Two are changed and one component gains a state.

| Screen | Change |
|---|---|
| **T4** (`load/[id].tsx`, `in_transit`) | Marker at the real fix, dimmed past 30 minutes, with `Seen N ago` beside it. ETA from `eta_at`, labelled an estimate when `eta_source` is `'corridor'`. The progress bar is recomputed from `remaining_km` rather than elapsed time. `progressOf`, `interpolate` and `collectedAt` are deleted — the last of them because its only remaining caller was the fallback ETA, which is now server-side. With no fix: no marker, corridor and timeline only. |
| **D7** (`trip/[id].tsx`) | The sharing line — *"Sharing your position with the shipper · Only while you are carrying this load · Last sent 2 minutes ago"* — present only while `in_transit`, gone after delivery along with the sending. The map shows the driver's own last fix; `midpoint()` is deleted. |
| **`TruckMarker`** | Gains `stale`. Dimmed fill, same geometry. The only design-system change in this phase. |

The age string goes through `t()` and its number through `formatNumber`, like
every other numeral. `color.delivered` remains spent on T5 and appears nowhere
here.

### The reporter

`src/lib/position.ts` exports `useReportPosition(tripId, active)`. It requests
foreground permission, watches at **60 seconds or 500 metres, whichever comes
first**, posts each fix through `report_position`, and tears down on unmount or
when `active` goes false. It is the only thing in the app that touches
`expo-location`, which is the one dependency P6 adds.

A denied permission is not an error state. The driver keeps a working D7 and the
shipper keeps a corridor without a marker — which is exactly what F3 already
renders, so no extra screen exists for it.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| **A shipper reads another shipper's truck.** | `trip_position` is scoped inside the definer to the trip's driver, the load's shipper, or ops. Asserted in `tenant_isolation.sql` from all four actors, including the one who owns a *different* load. |
| **The trail becomes a movement record.** | F5: no client path reads more than one row. The trail is ops-only and swept at 30 days. |
| **Nobody runs the sweep**, exactly as with expired offers. | `ops_position_health()` puts the age of the oldest point on the console, so a forgotten sweep is visible rather than silent. This is a **known, accepted weakness** — see `OPEN_ISSUES` 27 for the same shape failing once already. |
| **A driver reports position for a trip that is not theirs, or one already delivered.** | F6, checked inside the definer, plus the rate limit. Asserted both ways. |
| **Battery.** | Foreground only, 60s/500m, and the watcher exists only while D7 is mounted on a live trip. |
| **Store review.** | Nothing added beyond "while in use". No background modes, no foreground service, no Play Console declaration. This is the main thing F1 buys. |
| **Oman PDPL.** | Purpose stated to the driver at the moment of collection (F7), collection structurally limited to a live trip (F6), no shipper-visible history (F5), bounded retention (F4). The region question in `STACK.md` §9 is unchanged by this phase and remains open. |
| **The honest cost of F1: the app is backgrounded for most of a long haul, so few fixes arrive.** | Accepted, and filed in `OPEN_ISSUES.md`. The shipper sees a correctly-stamped old position. This is the thing to revisit if shippers start phoning to ask where the truck is — and revisiting it is a client change, by F1. |

---

## 7. Definition of done

1. `npm run verify` and `npm run test:db` green.
2. A driver can report a position only for their own `in_transit` trip. A
   delivered trip stores nothing. Another driver and another shipper read
   nothing. Out-of-box coordinates are rejected. All asserted in
   `supabase/tests/tenant_isolation.sql`.
3. `grep -rn "progressOf\|interpolate\|midpoint" src/` returns nothing. No
   position on any screen is computed from elapsed time.
4. T4 renders no truck marker for a trip that has never reported, and renders
   the age beside every marker it does draw.
5. The ETA on T4 comes from `eta_at` and changes when the truck moves, not when
   the clock ticks.
6. D7 shows the sharing line while `in_transit` and does not show it afterwards.
7. `ops_sweep_positions` requires ops, logs to `ops_audit`, and
   `ops_position_health` reports the oldest point.
8. `OPEN_ISSUES.md` records the backgrounded-app gap and the unswept-trail risk.
   `SENSITIVE_FIELDS.md` gains `trip_positions`.
