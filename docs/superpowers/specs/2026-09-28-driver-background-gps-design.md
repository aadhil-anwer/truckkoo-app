# Driver background GPS — offers to the nearest driver

**Date:** 2026-09-28
**Status:** awaiting approval
**Part A of three.** B (shipper pickup/drop pins with Google place search) and C
(Google Maps rendering) get their own specs, in that order.

---

## 1. Why

Dispatch (0036–0038) offers each load to the *nearest* online drivers, but
"nearest" is measured from a **town**, and the town is only updated when a driver
flips the online switch. Since 0038 every driver is online by default, so nobody
flips it: towns go stale, and a new driver has none at all and is reached only by
the widest wave.

The goal: when a load is dispatched, each online driver's position is **a real
GPS point, at most ~15 minutes old**, and the load goes to whoever is actually
closest.

## 2. Decisions (the founder's, 2026-09-28)

| Question | Decision |
|---|---|
| Store exact coordinates? | **Yes.** Reverses the 0036 rule "a town, never a coordinate". |
| When does the phone report? | **In the background**, at low frequency — the concern is battery and data, not the principle. |
| What is kept? | **The latest point only.** One row per driver, overwritten. No trail. |
| Tracking while switched off? | **No.** Off stops tracking; the database stores nothing from an offline driver. |
| Library | **`expo-location` + `expo-task-manager`.** Alternatives in §9. |

"Only when a new ride comes" was considered and set aside: a server cannot ask a
phone for its position on demand without silent push, which does not exist yet,
is throttled or dropped by Android battery savers and iOS, and would make every
wave wait on replies. Low-frequency tracking gives the same freshness at the
moment of dispatch for a similar battery cost (§9).

## 3. Cadence

| State | Update when | Accuracy |
|---|---|---|
| Online, no trip | every **15 min** or **2 km** moved, whichever first | Balanced (network + GPS) |
| On a trip `in_transit` | every **2 min** or **500 m** | Balanced |
| Offline, or signed out | **nothing** — task stopped | — |

A point is **fresh** for **45 minutes** (one missed update of slack) —
`dispatch_location_fresh_minutes`, a setting, not a constant.

## 4. Server

### 4.1 Columns

On `public.driver_availability`:

| Column | Type | Client grant |
|---|---|---|
| `lat`, `lng` | `double precision` | **none** — not even the driver's own |
| `accuracy_m` | `numeric` | none |
| `located_at` | `timestamptz` (the phone's fix time) | `select` to the driver (own row) — so the app can say "last sent 3 min ago" |

`SENSITIVE_FIELDS.md` gains all four in the same change. `SECURITY.md` records
the reversal of "a town, never a coordinate" as the founder's decision, dated.

### 4.2 `public.report_location(p_lat, p_lng, p_accuracy_m, p_recorded_at)`

Definer, `search_path = ''`, **volatile** (it writes — 0037's lesson), scoped to
`auth.uid()`, driver role, `require_active`, rate-limited **120/hour**.

1. Reject a bad point: half a coordinate, out of range, `p_recorded_at` in the
   future (> now + 2 min for clock skew) or older than 24 h.
2. **Offline → store nothing, return `stored = false`.** This is what makes "no
   tracking while off" a database fact rather than a client promise — the same
   pattern as `report_position` refusing outside an `in_transit` trip.
3. Older than the stored `located_at` → ignore (a late retry never overwrites a
   newer point).
4. Overwrite `lat/lng/accuracy_m/located_at`; snap `city_id` to
   `private.nearest_city` and set `source = 'gps'`.
5. If the caller has an `in_transit` trip, also call the existing
   `report_position` path, so the shipper's tracking works with the driver's app
   closed. `trip_positions` keeps its own rules (latest fix to shippers, trail
   ops-only, swept).

Returns `(stored boolean, city_id bigint)`.

### 4.3 Ranking

`private.nearby_drivers` measures distance as:

- **fresh point with accuracy ≤ 1 km** → `private.point_km(lat, lng, load origin city)`
  (haversine × `road_factor_pct`, already used by `nearest_city`);
- **otherwise** → `private.route_km(city_id, origin)`, exactly as today.

Order: fresh points first, then by distance — a driver we *know* is 40 km away
outranks one whose town says 30 km but who was last seen yesterday. Radius per
wave is unchanged. `system_rescue_stranded` inherits this through
`nearby_drivers`.

When B lands the load origin becomes a point too; `point_km` gains a
point-to-point sibling then, not now.

### 4.4 Switching off

`set_available(false)` also nulls `lat/lng/accuracy_m/located_at` — off means we
stop knowing, not just stop updating. The town stays (as today), because the
next switch-on needs somewhere to rank from before the first fix arrives.

## 5. App

### 5.1 One background task

`src/lib/background-location.ts` — replaces `src/lib/position.ts` as the only
module that imports `expo-location` for reporting. (The driver home's one-shot
fix on switch-on moves here too, so one module owns every location read.)

- Defined once at module scope with `TaskManager.defineTask`, as Expo requires.
- **Starts** when the driver is online and permission allows; **stops** on
  switch-off, sign-out, and role ≠ driver. On app launch it reconciles: if the
  server says online and the task is not running, start it (covers reboot and
  force-stop).
- Switches cadence (§3) when the driver's lead trip enters or leaves
  `in_transit`.
- Sends only the newest point from each batch; never replays a backlog.
- A failed call is dropped silently; the next update retries. It never stops the
  task.

The P6 foreground reporter on D7 is removed — the background task covers it,
and two reporters would double the rate-limit spend. P6's "no background
permission call anywhere" definition of done is **deliberately reversed** here.

### 5.2 Android foreground-service notification

While the task runs Android requires a persistent notification:
**"You're online — sharing your location to find loads near you."** Tapping it
opens the app. Through `t()`, Arabic drafted and marked unproofed.

### 5.3 Permission flow — asking ground (cream), one question

Shown when a driver is online and background permission is not granted, at most
once per app launch:

> **Let Truckkoo see where your truck is, even when the app is closed?**
> We use it to send you loads near you — only while you're online, and we keep
> only your latest location.
> **[Continue]**  ·  Not now

This in-app disclosure precedes the system prompt; it is what Google Play's
background-location policy requires and what its reviewers look for.

1. Continue → foreground permission ("While using the app").
2. Then background. Android 11+ cannot grant it from a dialog — it opens
   Settings; the screen says which option to tap ("Allow all the time").
3. iOS: "Always", via the system's two-step prompt.

### 5.4 Degrading, never blocking

| Granted | Behaviour | Driver home card |
|---|---|---|
| Always | background task | "Sharing location — last sent 4 min ago" |
| While using only | report on app open and every 5 min while in foreground | "Location only while the app is open" · **Turn on** |
| None | ranked by town (last delivery / switch-on) | "Location off — you'll get loads near {town}" · **Turn on** |

Offline drivers see none of these.

## 6. Native change — needs a new build

- Add `expo-task-manager`; `expo-location` config plugin with
  `isAndroidBackgroundLocationEnabled` and `isAndroidForegroundServiceEnabled`,
  and the iOS `NSLocationAlwaysAndWhenInUseUsageDescription` and
  `UIBackgroundModes: location`.
- **Bump `version` in `app.json`** before the build — EAS Update is on with
  `runtimeVersion: appVersion`, and an update calling a native module an
  installed build lacks crashes it on launch.
- `eas update` cannot deliver this; drivers must install the new build.

## 7. Failure cases

| Case | Behaviour |
|---|---|
| No signal (Hajar mountains) | Task keeps the newest point, sends it on reconnect; server rejects anything older than what it has. |
| Rate limit / rejected point | Dropped; next update retries. |
| App killed or battery-restricted by the OEM | Point ages past 45 min → ranking falls back to town. Nobody is offered a load from a stale point as if it were fresh. |
| Signed out | Task stopped before the session is cleared — a shared phone never reports under the wrong account. |
| Fix accuracy worse than 1 km | Town updated; point not used for exact ranking. |
| Switched off | Task stopped; server stores nothing even if a queued call arrives. |

## 8. Testing

**Database** — `dispatch.sql` (new section) and `tenant_isolation.sql`:

- offline → nothing stored; `stored = false`
- in-transit trip → point also reaches `trip_positions`
- only the latest point kept; older-than-stored and future timestamps refused
- fresh accurate point ranks by exact distance; stale or coarse falls back to town
- fresh-first ordering
- switch-off clears the coordinates, keeps the town
- no shipper, other driver, anon — or the driver themselves — can select
  `lat/lng/accuracy_m`
- rate limit holds
- the replaced "no coordinate column exists" assertion becomes "no client role
  holds a grant on a coordinate column"
- 0037's static check covers `report_location` being volatile, automatically

**App** — Jest:

- task starts/stops with the switch, sign-out, role
- launch reconciliation restarts a missing task
- disclosure precedes the system prompt
- each permission state shows its card
- cadence switches on `in_transit`
- `no-literals` passes (all strings through `t()`)

**On a real phone** — never done for this app (`OPEN_ISSUES.md`). A preview
build on an Android phone, driven around for an hour, with the stored point
checked against reality and the notification, switch-off and reboot behaviour
observed. A checklist in the plan; the founder or a driver runs it.

## 9. Alternatives set aside

Recorded so they are not rediscovered from scratch. Also listed in
`OPEN_ISSUES.md`.

- **Transistorsoft `react-native-background-geolocation`.** The industry
  standard: motion-activity detection (GPS sleeps when the truck is parked),
  far better battery, survives OEM task killers better. Paid licence for Android
  release builds; more native surface. **Revisit when** drivers report battery
  drain or positions go stale on Xiaomi/Samsung/Oppo.
- **On-demand location via silent push.** What "only when a new ride comes"
  literally means. Needs push notifications (Phase E), still needs background
  permission, unreliable on Android OEMs and iOS, and makes waves wait.
  **Revisit** only for a specific case the 15-minute cadence cannot serve.
- **`expo-background-task` (periodic).** OS-scheduled, ≥15 min, not reliable.
  Not tracking.
- **Google Distance Matrix / Routes API for road distance.** Real road km instead
  of haversine × 1.35. Billed per element, and a network call per candidate per
  wave. **Revisit when** a wave is seen offering to a driver who is close as the
  crow flies but far by road (a wadi, the Musandam exclave).
- **Battery-optimisation exemption prompt** (Android). Asks the driver to exempt
  Truckkoo from OEM battery savers. Out of this version; a known risk.

## 10. Founder tasks

- Google Play Console: background-location permission declaration, including a
  short video of the §5.3 flow.
- Approve the version bump and the new preview/production builds.
- Tell drivers to install the new build and tap "Allow all the time".

## 11. Out of scope

Shipper pins and place search (B), Google Maps rendering (C), push
notifications (Phase E), road-routing distance (§9).
