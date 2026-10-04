# Truckkoo: speed, smoothness, and recovery audit

Audited 4 October 2026. Base commit `0eb2b6d`, branch `redesign-p2-interim-auth`, including the existing uncommitted booking/query changes. This is a problem-and-fix list; application code and dependency versions were not changed.

**The first priority is making failures recoverable.** Faster animations will not solve a screen waiting forever for storage, a profile request, or a geocoder. After those paths are bounded, reduce unnecessary requests, mounted rows, and shipped assets.

The review covered startup/auth, all route families, the shared data layer, booking persistence, location/push, media delivery, maps/primitives, dependency and build configuration, relevant current SQL function definitions, tests, and CI. The source tree has 103 files and 47 migrations. This is not a claim that every possible runtime path or native dependency has been exercised.

**Evidence labels:** confirmed = directly present in source or reproduced locally; measured = observed in an actual export/tool run; risk = plausible from the implementation, with device/load measurement still required. A source-confirmed failure path is not automatically a reproduced phone crash.

**Priorities:** P0 = account isolation; P1 = can block a task or misrepresent its state; P2 = efficiency/scaling/release reliability; P3 = lower-impact cleanup. Items below include both defects and validation gaps, not 36 observed crashes.

**Fix pass on 4 October 2026 (after this audit):** The working tree now isolates the query cache and booking draft by account, discards the old unowned draft key, rejects stale auth/profile responses, and shows retry on session/profile failure (items 2–4 and part of 23). Font failure, font timeout, keystore timeout, and a render exception now release the splash to recovery UI (item 1). Booking review handles missing answers and failed cities; every booking step shows a loading surface with a Home exit instead of returning `null` (item 5). Logout now bounds cleanup and global revocation, retains a push token if server-side revocation is uncertain, and shows a retryable error rather than pretending it succeeded (item 17). Face-specific font imports cut the exported Android font count from 28 to 11 and raw exported assets from 5,024,798 to 2,586,006 bytes, a 2,438,792-byte raw asset reduction (item 14). This does not establish an APK download saving or prove smoothness on a release phone. Other findings below remain open unless stated here.

**What was verified**

| Check | Result | What it does not prove |
|---|---|---|
| `npm run verify` | Typecheck/lint passed; 54 suites, 759 tests passed | Native startup, frame times, battery, or offline completion |
| `npm run test:db` | All seven local SQL suites passed | Production migration state or production query latency |
| Migration numbering | 47 migrations passed local check | Append-only comparison against a remote base or deployment |
| Android production JS export | Passed; 2,281 modules; Hermes bundle 5,051,556 bytes | A complete APK/native build or device startup |
| Exported assets | 5,024,798 raw bytes; 28 font files | Compressed install/download size or decoded memory |
| Brand font assets | 27 bundled; 10 referenced by `FONT_ASSETS`; 2,438,792 raw bytes in unused faces | That all 27 are loaded into native font memory |
| Dependency tree | `npm ls --depth=0` passed | That all versions are currently recommended |
| Live Expo compatibility check | 28 packages flagged | That each outdated package causes a known bug |
| Live `npm audit` | 57 affected entries: 54 high, 3 moderate; five underlying advisories across four packages | 57 independent vulnerabilities in the shipped phone app |
| Cache reproduction | Account B received A's fresh `['loads','mine']` cache; zero network calls | An end-to-end account-switch test on the phone |
| Retry reproduction | One query produced 12 mocked HTTP attempts on repeated 503s | All errors taking this path; delays were removed for the experiment |
| Connected Android | Android 16/API 36; installed Truckkoo 1.1.0, non-debuggable; source is 1.2.0 | Performance of this source: the app was not running and no frame/memory sample existed |

The initial sandboxed test run failed because a framing test launches a shell. Re-running with normal local process access passed. Lint reported two existing duplicate-import warnings in `leg/route.tsx`; Jest warned that a worker failed to exit gracefully. Teardown needs investigation. The offline Expo check passed against its bundled map, but the subsequent online check found the 28 differences below. The online result is the relevant one. [Machine-readable evidence summary](/home/zorothepirate/truckkoo-app/docs/audits/2026-10-04-performance-evidence.json).

**Startup, navigation, and account safety**

1. **P1 · A failed font load can hold the splash forever. Confirmed.**
   - **Problem:** [root layout](/home/zorothepirate/truckkoo-app/src/app/_layout.tsx:94) reads only the success value from `useFonts`, then returns `null` until it is true. Font rejection has no exit. A non-settling language-store read also prevents startup. The root error boundary does not explicitly release a splash retained by `preventAutoHideAsync`.
   - **Fix:** Handle font success, error, and a bounded startup deadline. Render a minimal usable fallback/recovery surface, release the splash after that surface is laid out, and report the reason. Ensure a pre-readiness render exception also exposes its recovery screen. Bound language storage reads and ignore late completion after fallback so language cannot silently flip later.
   - **Verify:** Reject font loading; never resolve font loading; never resolve SecureStore; throw during startup. Each case must reach visible, actionable UI without killing the app. Preserve first-launch Arabic direction handling.

2. **P1 · Session bootstrap has no reliable failure state. Confirmed.**
   - **Problem:** [SessionProvider](/home/zorothepirate/truckkoo-app/src/lib/session.tsx:54) does not catch bootstrap rejection and ignores the profile query's `error`. A rejected bootstrap can leave `loading=true`; a profile network failure becomes `profile=null`, which the Gate interprets as “needs signup.” [Password submit](/home/zorothepirate/truckkoo-app/src/app/(auth)/password.tsx:45) likewise assumes auth helpers resolve and stays busy on unexpected rejection.
   - **Fix:** Model initializing, signed-out, loading-profile, ready, genuinely missing-profile, and recoverable-error separately. Only successful “no row” may enter onboarding. Give startup a deadline, retry action, and a short explanation; use `try/catch/finally` around screen-level async work.
   - **Verify:** Expired session with no signal, rejected storage, profile 503, profile permission error, and a real new account. Returning users must never enter role selection merely because a read failed.

3. **P1 · Auth callbacks do network work and race bootstrap/account changes. Confirmed structure; race outcomes need regression tests.**
   - **Problem:** [auth listener](/home/zorothepirate/truckkoo-app/src/lib/session.tsx:81) awaits a profile read on every event. `getSession()` plus the initial event can duplicate that work. Older profile responses can write after sign-out or a newer sign-in; cancellation protects only parts of bootstrap. Token refresh also re-fetches profile and republishes context unnecessarily.
   - **Fix:** Keep the SDK callback synchronous: capture session state and let an effect/query keyed by user ID load the profile. Abort superseded requests, ignore stale generations, and atomically pair a profile with its owner. Avoid refetching unchanged profile data merely because a token rotated.
   - **Verify:** Resolve A's delayed profile after B signs in; resolve after sign-out/unmount; refresh tokens during a slow profile read. No stale profile may reappear.
   - **Version nuance:** Installed auth-js already fixes several historical reentry deadlocks. Its own source still deprecates async callbacks because nested refresh can deadlock. This audit does **not** assert that every profile request deadlocks in this installed version.

4. **P0 · Account-independent query keys retain another account's data. Confirmed and locally reproduced.**
   - **Problem:** [query keys](/home/zorothepirate/truckkoo-app/src/lib/queries.ts:197) such as `['loads','mine']`, `['trips','mine']`, and `['driver','past']` omit the user. The [root QueryClient](/home/zorothepirate/truckkoo-app/src/app/_layout.tsx:63) survives logout, and [signOut](/home/zorothepirate/truckkoo-app/src/lib/auth.ts:326) does not clear it. Within `staleTime`, the next account can receive the previous cached answer without consulting RLS. Older cached data can also flash while revalidating.
   - **Fix:** Scope every private query key to the account, gate it on a valid session/role, and cancel/remove private queries on identity changes. Prevent late old-account responses from repopulating the cache. Clear account-scoped drafts too. Public/reference caches may remain if their contract permits it.
   - **Verify:** A → logout → B inside 30 seconds, with both fresh and stale caches and delayed in-flight reads. Assert that B never sees A's data. This is a local cache exposure, not a claim of a database RLS bypass.

5. **P1 · Booking review has a literal blank-screen path. Confirmed.**
   - **Problem:** [review](/home/zorothepirate/truckkoo-app/src/app/(app)/book/review.tsx:95) returns `null` if the draft is not ready or either city cannot be resolved. A deep link, absent/corrupt draft, failed cities query, or removed city can leave nothing to press. Several other booking steps also return `null` while draft storage is pending.
   - **Fix:** Separate draft loading, invalid/missing answers, reference-data loading, and fetch failure. Show a shell/skeleton while loading, retry on fetch failure, and route to the first missing answer after a successful draft read. Put a visible Back/Home path on each recovery surface.
   - **Verify:** Cold deep link to review, empty draft, invalid city IDs, storage that never resolves, and failed cities fetch. No case may settle on an empty screen.

6. **P1 · A network failure can masquerade as a missing load/trip. Confirmed.**
   - **Problem:** [load detail](/home/zorothepirate/truckkoo-app/src/app/(app)/load/[id].tsx:219) treats missing cities like a missing load; it only gates on the loads request. [trip detail](/home/zorothepirate/truckkoo-app/src/app/(app)/trip/[id].tsx:171) sends failed reads into a generic missing state with Back but no fetch retry.
   - **Fix:** Distinguish pending, error, and successful empty data for each required query. Keep already-rendered data during background errors with an honest stale/reconnecting indicator. Preserve identical not-found treatment for genuinely absent and unauthorized records.
   - **Verify:** Make cities slower than loads, fail only one dependency, then restore signal without leaving the screen. Recovery should not require restarting the app.

7. **P1 · Opening one load downloads/searches whole lists; old records can disappear. Confirmed.**
   - **Problem:** [detail lookup](/home/zorothepirate/truckkoo-app/src/app/(app)/load/[id].tsx:134) uses `useMyLoads()` and `useMyTrips()` then `.find()`. Those requests have no pagination. Local PostgREST configuration caps responses at 1,000 rows. A valid older load can be absent from the fetched page, and a detail screen unnecessarily pays for a large history download. Driver history separately has a hard SQL `LIMIT 200` with no “older” path.
   - **Fix:** Add actor-scoped single-load/single-trip reads, cursor pagination for ledgers, and a small active-work query for home. Fetch an exact load under existing RLS or an existing-style ownership-checked RPC; do not broaden access.
   - **Verify:** Accounts with more than 1,000 loads and more than 200 finished driver trips; open the oldest record directly. Check payload size and SQL plans as well as rendering.

8. **P1 · Live business state can look frozen despite a working network. Confirmed.**
   - **Problem:** Loads, trips, and the separate offer-badge query do not poll or use realtime. Global focus refetch is disabled. [PushProvider](/home/zorothepirate/truckkoo-app/src/lib/push-provider.tsx:90) navigates on taps but does not invalidate affected queries. A 30-second `staleTime` is not a refresh timer. Position and bids can update while the parent load status remains stale.
   - **Fix:** Define freshness per screen: refresh live load/trip state on resume and push receipt/tap, with bounded visible-screen polling or properly scoped realtime as a safety net. Derive the badge from the same offer source as the list where possible. Reconcile after uncertain mutations.
   - **Verify:** Assign, deliver, cancel, and change bids from another session while the relevant screen remains open and while the app is backgrounded. Push disabled/lost must still recover.

**Network, memory, and rendering**

9. **P1 · Requests have no app-defined deadline, and retries multiply. Confirmed; 12-attempt reproduction.**
   - **Problem:** Query functions do not consume TanStack's cancellation signal, the Supabase client provides no bounded fetch policy, and client Places calls omit the SDK's timeout option. Installed PostgREST retries eligible reads three times; TanStack's `retry:2` repeats that operation three times total. One persistent 503 can therefore produce **12 HTTP attempts**. Without `Retry-After`, nested backoff alone can total about 24 seconds, before network time. RPC POSTs do not share that exact inner retry behavior.
   - **Fix:** Choose one retry owner and a total operation deadline. Distinguish transient failures from auth/validation failures. Forward cancellation to transport, including response-body work, and guard against late completion. Use a separate policy for uploads. A timed-out write has an unknown outcome: reconcile it, do not blindly replay it.
   - **Verify:** Blackhole transport, slow response body, repeated 503, offline, expired auth, cancellation on navigation, and a write that commits before its response is lost. Measure total user-visible waiting, not just per-attempt time.

10. **P1 · Cold offline use has no durable recovery path. Confirmed limitation.**
    - **Problem:** The QueryClient is memory-only, there is no native connectivity integration, and profile bootstrap requires a server read. Last-known trips/reference data vanish on process death. Retrying without knowing connectivity wastes time; simply enabling a network manager could instead leave existing `isPending` skeletons paused forever unless UI is changed too.
    - **Fix:** Connect native connectivity to query state, expose offline/paused explicitly, and decide what account-scoped data may be persisted with suitable protection and expiry. Start with reference data and explicitly stale trip readouts. Keep authorization and business transitions server-owned; offline data must not authorize acceptance or invent success.
    - **Verify:** Open offline after a prior successful session, force a process restart, switch accounts, reconnect. Show what is known, its age, and what requires a connection. See [TanStack's native integration guidance](https://tanstack.com/query/latest/docs/framework/react/react-native).

11. **P2 · History screens eagerly mount every row. Confirmed.**
    - **Problem:** [past trips](/home/zorothepirate/truckkoo-app/src/app/(app)/(tabs)/past.tsx:72), [loads](/home/zorothepirate/truckkoo-app/src/app/(app)/(tabs)/loads.tsx:131), and routes use `ScrollView` plus `.map()`. Driver history can already mount 200 rich rows. Layout, text shaping, accessibility nodes, and pressables grow with history size.
    - **Fix:** Use `FlatList`/`SectionList` with stable IDs, modest initial batches, and paginated data. Preserve the current visual structure with headers/separators. Use `getItemLayout` only where height is actually fixed; Arabic and large text can change row height. Do not blindly enable clipping: it can introduce missing-content bugs.
    - **Verify:** Scroll realistic 200/1,000-row fixtures on a low-memory release device in English and Arabic, including large text and scrolling back up. Track frame time and peak memory. [React Native documents this eager-rendering cost](https://reactnative.dev/docs/scrollview).

12. **P2 · Hidden screens continue polling. Confirmed scheduling; network/battery cost needs measurement.**
    - **Problem:** Offers and bids poll every 15 seconds, positions every 20 seconds, availability every minute. Screens remain mounted in tab/stack navigation and queries are not screen-focus gated. Native AppState wiring already stops ordinary query interval fetches while the app is backgrounded, but that is different from a hidden screen in a foreground app. Multiple observers can own separate interval schedules even when concurrent fetches are deduplicated.
    - **Fix:** Keep only essential global data such as the driver badge centrally subscribed; focus-gate screen-specific polls and stop them for terminal states. Refresh once when a screen becomes visible. Coalesce event-driven invalidations.
    - **Verify:** Count requests over five minutes on each tab, after visiting detail screens, and in the background. Assert that hidden detail screens add no continuing polling load.

13. **P2 · Role-irrelevant queries run from shared layouts. Confirmed.**
    - **Problem:** [LocationTrackingProvider](/home/zorothepirate/truckkoo-app/src/lib/location-tracking.tsx:55) calls availability/trips hooks before deciding whether the user is a driver. [TabsLayout](/home/zorothepirate/truckkoo-app/src/app/(app)/(tabs)/_layout.tsx:47) reads offers for shippers too. Many query hooks have no session/role `enabled` condition.
    - **Fix:** Make hook enablement explicit and account-aware. Mount driver-only tracking logic as a driver-only child where appropriate. Retain server authorization: an `enabled` flag is an efficiency control, not access control.
    - **Verify:** Record network traffic during shipper startup and sign-out. There should be no driver availability/offers request and no private request before a session exists.

14. **P2 · Font package barrel imports ship 17 unused brand faces. Measured.**
    - **Problem:** [faces.ts](/home/zorothepirate/truckkoo-app/src/theme/faces.ts:15) imports package roots. The actual Android export includes all 18 Archivo faces, all seven Plex Arabic faces, and both Instrument Serif faces. Only 5 + 4 + 1 are used. Unused faces total **2,438,792 raw bytes**, about 48.5% of this export's raw asset bytes. A separate roughly 962 KB Material Symbols font is also present through dependencies and needs independent tracing.
    - **Fix:** Import/require exact font files or supported face-specific subpaths, then compare a fresh export manifest. Keep every currently used Arabic weight. Investigate the router/symbol dependency path separately instead of deleting a transitive asset by hand.
    - **Verify:** The three brand families contribute exactly ten font files after the change, every font family still resolves, and all headings/buttons render correctly. Raw savings are not a promised APK or OTA compression saving.

15. **P2 · Font readiness unnecessarily precedes session bootstrap. Confirmed dependency chain.**
    - **Problem:** [RootLayout](/home/zorothepirate/truckkoo-app/src/app/_layout.tsx:94) mounts SessionProvider only after fonts and language finish. The critical path is fonts/language → session → profile → main data → dependent details. Font work is bundled locally, but it is still asynchronous startup work.
    - **Fix:** Start independent session initialization in parallel while preserving correct RTL before visible content. Consider embedding static fonts with `expo-font` at build time, which makes them immediately available. Preserve explicit family names and Arabic shaping; do not replace them with synthetic weights. Native embedding requires a version bump and new binary.
    - **Verify:** Compare cold-start timing by stage and check first-launch Arabic. Expo documents [native font embedding](https://docs.expo.dev/develop/user-interface/fonts/) as a way to remove asynchronous runtime font loading.

16. **P1 · Push registration blocks unrelated permission progress. Confirmed.**
    - **Problem:** [PushProvider](/home/zorothepirate/truckkoo-app/src/lib/push-provider.tsx:54) awaits network registration before setting `settled`; driver home waits for `settled` before location disclosure. Accepting notifications can therefore stall behind Expo token retrieval or the registration RPC even though the user already answered the permission question.
    - **Fix:** Settle the permission decision immediately, then register in a bounded background task with retry on connectivity recovery. Use account identity, not just a `signedIn` boolean, when deciding which account owns registration.
    - **Verify:** Grant permission while token retrieval never completes; location disclosure and normal navigation must still work. Reassign a shared phone without leaving an old registration active.

17. **P1 · “Best effort” cleanup can block logout. Confirmed.**
    - **Problem:** [signOut](/home/zorothepirate/truckkoo-app/src/lib/auth.ts:326) awaits tracking shutdown and [push unregister](/home/zorothepirate/truckkoo-app/src/lib/push.ts:92) before auth sign-out. Catching rejection does not bound a promise that never resolves. Account UI has no busy/error handling, and the SDK sign-out result is not checked for an error.
    - **Fix:** Bound cleanup and show progress/failure. Centralize identity cleanup and cache cancellation. Preserve the requirement for server-side revocation; do not silently label a failed global logout successful or replace it with a local-only logout. Handle unfinished token cleanup deliberately.
    - **Verify:** Offline logout, stuck unregister, failed revocation, repeated taps, and delayed location completion. The user must get a truthful result and a retry path.

18. **P1 · An optional place label can block confirming the actual location. Confirmed.**
    - **Problem:** [pin resolution](/home/zorothepirate/truckkoo-app/src/app/(app)/book/pin.tsx:71) waits for `Promise.all([cityNear, nameAt])`. A slow phone geocoder prevents using an already-known valid city. [currentPlace](/home/zorothepirate/truckkoo-app/src/lib/places.ts:122) bounds only fresh GPS acquisition; permissions, last-known lookup, and reverse geocoding are outside that timeout.
    - **Fix:** Separate required city validation from optional naming. Permit an unnamed valid coordinate and update the label later if it is still current. Bound each machine-controlled stage, clear timeout handles, ignore superseded answers, and keep the city-only fallback reachable. Do not time out a human still reading an OS permission dialog as if it were a network error.
    - **Verify:** Geocoder hangs but city lookup succeeds; GPS times out; a new drag finishes before the old lookup. Confirm and fallback must remain usable.

19. **P2 · Search debounces requests but does not cancel work already started. Confirmed.**
    - **Problem:** [usePlaceSearch](/home/zorothepirate/truckkoo-app/src/lib/places.ts:37) clears only its timer on cleanup. In-flight requests keep consuming radio/server quota; unmount does not retire the request ticket. Details selection can also complete after the user has left the screen.
    - **Fix:** Use the SDK's supported abort signal and timeout, invalidate the generation on cleanup, and guard navigation from late picks. Keep the existing 300 ms debounce. Separate cancellation from genuine search failure in the UI.
    - **Verify:** Type rapidly on high latency, erase the search, leave mid-request, and choose a city while GPS is pending. Old results must never move the current screen.

20. **P1 · Proof photos are compressed, but not dimension- or memory-bounded. Confirmed.**
    - **Problem:** [camera/upload](/home/zorothepirate/truckkoo-app/src/app/(app)/trip/[id].tsx:102) uses `quality:0.6`, which does not impose a maximum pixel dimension. It previews the camera image and reads the entire encoded file into an ArrayBuffer. Large photos can consume substantial native decode memory plus JS upload memory on a cheap phone.
    - **Fix:** Resize to an agreed evidence-quality maximum dimension, enforce encoded-byte limits before upload, verify actual MIME/format, and display a thumbnail. Use a bounded native-file upload path supported by the selected storage client, avoiding unnecessary duplicate buffers. Handle camera rejection/cancellation visibly.
    - **Verify:** High-resolution photos, low free memory, slow upload, denied camera, and HEIC/JPEG variants. Measure peak memory and image legibility; do not guess that `quality` alone solves it.

21. **P1 · Delivery is a fragile two-step upload/transition operation. Confirmed.**
    - **Problem:** [confirmDelivered](/home/zorothepirate/truckkoo-app/src/app/(app)/trip/[id].tsx:129) generates a new path on every attempt. If upload succeeds but the status request fails, retry uploads again; if status commits but the response is lost, the UI may report failure. The selected photo and operation state live only in component memory.
    - **Fix:** Persist a small account-scoped pending-delivery record with a stable upload path and stage. Reuse a successful upload, reconcile server trip status after uncertain responses, and make retry safe. Keep POD append-only; do not use overwrite as an idempotency substitute. Introduce an offline outbox only with explicit retry/state semantics.
    - **Verify:** Kill between upload and transition, drop the successful transition response, retry twice, and restart. Exactly one logical delivery should result, with no new photo required after a completed upload.

22. **P1 · Booking idempotency currently lasts only for one review-screen mount. Confirmed in existing uncommitted work.**
    - **Problem:** [request ID](/home/zorothepirate/truckkoo-app/src/app/(app)/book/review.tsx:70) is `useState(randomUUID)`. Migration 0047 deduplicates the same account/request pair, but a process kill or leaving/re-entering review creates a different pair. A committed booking whose response was lost can still be duplicated.
    - **Fix:** Persist a booking-attempt ID and a snapshot/fingerprint of its submitted answers. Keep the ID through unknown outcomes; resolve the previous attempt before creating a new one. Intentionally changed booking contents need a defined new-attempt boundary. Verify migration deployment before shipping calls with the extra parameter.
    - **Verify:** Timeout after server commit, restart/reopen review, and retry. Also edit the route after a failed attempt and ensure an old request cannot silently book different answers. Local SQL tests passed; remote application of 0047 was not checked.

23. **P1 · Draft persistence is account-independent and accepts unchecked data. Confirmed.**
    - **Problem:** [booking storage](/home/zorothepirate/truckkoo-app/src/lib/booking.ts:28) uses one global key, merges parsed JSON without a runtime schema, and writes the whole draft on every update. Auth/leg drafts also contain module-level state. Sign-out does not clear these stores. A shared phone can carry another shipper's cargo/contact draft; interrupted or concurrent hydration/writes can restore stale answers.
    - **Fix:** Scope drafts to the account, validate/migrate their schema, clear them on identity change, and protect hydration with a generation. Serialize/coalesce writes; flush at meaningful boundaries without making every keystroke wait for storage. Define data retention for place contacts.
    - **Verify:** A → B switch, invalid persisted types, rapid edits followed by navigation, a kill during save, and a late old hydration after a new draft starts.

24. **P2 · SecureStore chunk replacement has an interruption window. Confirmed structure; frequency unmeasured.**
    - **Problem:** [storage adapter](/home/zorothepirate/truckkoo-app/src/lib/supabase.ts:49) deletes the old session before writing the replacement, then publishes a chunk count last. An interruption can lose an otherwise valid session. Reads/deletes run native calls serially, and chunk-count metadata is not validated or bounded.
    - **Fix:** Keep OS-protected storage. Validate metadata, test interruption at every stage, and use a generation/manifest strategy that preserves the previous complete value until replacement succeeds. Parallelize independent chunk reads only after proving the adapter's ordering and consistency requirements. Prefer maintained platform/SDK-supported mechanisms where available; do not move tokens to plain AsyncStorage for speed.
    - **Verify:** Fault-inject each native call, kill during refresh-token replacement, and test concurrent auth operations. A torn write must fail closed and recover predictably.

25. **P2 · Background-location start/stop operations can overlap. Confirmed asynchronous structure; native race needs reproduction.**
    - **Problem:** [provider](/home/zorothepirate/truckkoo-app/src/lib/location-tracking.tsx:79) launches start/stop calls without serializing them, while [tracking helpers](/home/zorothepirate/truckkoo-app/src/lib/background-location.ts:65) await several native operations before changing module state. Rapid online/offline or role changes can allow an older start to finish after a newer stop. Foreground-only resume refreshes permission state but may not trigger an immediate fix when permission value is unchanged.
    - **Fix:** Serialize lifecycle transitions around the latest desired mode; reconcile again after every native completion. Coalesce overlapping foreground fixes and report once on active resume where policy allows. Preserve the original fix timestamp and accuracy: `reportOnce` currently discards both and substitutes the current time/null accuracy.
    - **Verify:** Rapid toggles, logout while starting, foreground/background cycles, OS restart, denied permission, and battery restrictions. Database refusal of offline reports remains necessary but does not stop a wasted native GPS service.

26. **P2 · UI clocks run when their screen is not visible. Confirmed.**
    - **Problem:** [useTick](/home/zorothepirate/truckkoo-app/src/lib/use-tick.ts:12) uses an interval with no app/screen focus handling. InTransit refreshes once a second even when its age label has advanced into minute-scale values. This is a small subtree, not proof that the whole map re-renders every second.
    - **Fix:** Pause clocks on blur/background, update immediately on resume, and use second/minute cadence appropriate to the visible value. Keep expiry decisions based on absolute timestamps, not accumulated tick counts.
    - **Verify:** Count renders/timer callbacks on a hidden detail screen and after resuming from a long background period. Labels must be correct without catch-up loops.

27. **P2 · Custom map bounds can defeat projection memoization. Risk; profile before changing.**
    - **Problem:** [framingFor](/home/zorothepirate/truckkoo-app/src/map/framing.ts:140) returns a fresh nested array for routes outside the domestic frame; [MapCanvas](/home/zorothepirate/truckkoo-app/src/map/MapCanvas.tsx:54) memoizes by that object's identity. Calls from render can rebuild projection, coast paths, and labels after unrelated state changes. React Compiler may avoid some of this, so count actual recomputations before claiming a bottleneck.
    - **Fix:** Key projection caching on scalar bounds/dimensions or provide a stable frame derived from coordinate scalars. Keep static coastline work independent of changing markers. The bundled geometry is only about 32 KB: replacing the entire map stack is unjustified.
    - **Verify:** Profile domestic and long-distance routes while entering text and while bids/positions update. Compare projection/path-build count and JS frame cost.

28. **P1 · A signed photo URL is not renewed merely because it becomes stale. Confirmed.**
    - **Problem:** [usePodUrl](/home/zorothepirate/truckkoo-app/src/lib/queries.ts:1330) gives the URL 60 seconds of life and sets `staleTime:45000`, with a comment claiming it will re-sign. No interval is set and default focus refresh is off. The decoded image might remain visible, but a later reload/retry can use an expired URL.
    - **Fix:** Renew near expiry only while needed, or renew on focus/image failure with a bounded retry. Keep the storage bucket private and URLs short-lived. Show an actionable image error rather than an empty proof section.
    - **Verify:** Remain on delivery proof for over a minute, background/resume, and force a fresh image request after URL expiry.

**Dependencies, backend work, and release discipline**

29. **P2 · Installed packages lag Expo's current SDK-57 compatibility recommendations. Measured.**
    - **Problem:** The live compatibility check flags 28 packages. Core combinations include RN 0.86.0 versus 0.86.3 and mismatched Jest types. This is maintenance/reliability debt; a version difference alone is not a diagnosed crash cause.
    - **Fix:** Make a coordinated SDK-57 patch-alignment change, keep the lockfile, inspect release notes, run the suites, produce a fresh native preview, and verify critical flows. Do not combine it with an unmeasured major SDK migration. Native changes require a new application/runtime version per this repo's rules.
    - **Verify:** Live Expo check clean, reproducible `npm ci`, Android/iOS native builds, and the device matrix below. See the full version table after the numbered list.

30. **P1 · The dependency advisory tree needs targeted triage. Measured; exploitability varies.**
    - **Problem:** `npm audit` reports five advisory records across `braces`, `decode-uri-component`, `image-size`, and `node-forge`, propagated into 57 package entries. `decode-uri-component` lies under Router's query parsing, making malformed external links especially relevant to the user's “never stuck” concern. The others primarily warrant build/tooling-path analysis; dependency presence alone does not prove runtime exposure.
    - **Fix:** Resolve each advisory through compatible upstream patches or a reviewed narrow override. Trace reachability and test hostile inputs without hanging the main test worker. **Do not run `npm audit fix --force`:** its suggestions include downgrading Expo to 44 and React Native to 0.72, which is not a viable repair for this app.
    - **Verify:** Re-run audit, SDK compatibility, export/native builds, and bounded deep-link parsing tests. Any deferred advisory needs a reason and an owner, not a claim that audit is clean.

31. **P3 · Some direct dependencies are unused; others only look unused. Confirmed inventory; size impact varies.**
    - **Problem:** No app imports were found for `react-hook-form`, `zod`, `expo-image`, or `@expo/vector-icons`. However Router itself depends on `@expo/ui`, `expo-glass-effect`, and `expo-symbols`, and optional navigation peers complicate removing gesture/reanimated packages. Deleting a direct declaration does not necessarily remove the transitive module or native binary cost.
    - **Fix:** Use an import graph, `npm explain`, native autolinking output, and export comparisons. Remove truly unused dependencies; use already-installed `expo-image` if it solves the photo rendering need. Keep Expo/React/native peer versions coherent. Review Sentry's actual runtime configuration and bundle entry points before optimizing its substantial source footprint; replay modules appearing in a source map does not mean replay is enabled.
    - **Verify:** Clean install, native build, and before/after manifests. The 855 MB local `node_modules` directory is **not** the installed phone app size; do not optimize that number as if it were.

32. **P2 · Several SQL hot paths need representative scale profiling. Risk, not measured production slowness.**
    - **Problem:** [driver history/earnings](/home/zorothepirate/truckkoo-app/supabase/migrations/0045_driver_bidding.sql:1148) call helper functions per trip; history sorts by computed delivery time before limiting and earnings walks all delivered trips. [nearby_drivers](/home/zorothepirate/truckkoo-app/supabase/migrations/0039_driver_location.sql:208) evaluates distance, truck selection, pending offers, and active-trip exclusions across eligible supply. [bid tick](/home/zorothepirate/truckkoo-app/supabase/migrations/0045_driver_bidding.sql:910) loops open bid loads every minute. Basic ownership and lookup indexes already exist, so “add indexes everywhere” is not a diagnosis.
    - **Fix:** Run `EXPLAIN (ANALYZE, BUFFERS)` on representative synthetic distributions locally; use read-only production statistics when separately available. Then consider time/status composite or partial indexes, fewer repeated helper lookups, indexed completion timestamps, or bounded job batches. Keep pricing/payout SQL-only and all ownership guards intact.
    - **Verify:** Measure rows examined, buffers, p50/p95 response time, lock waits, and cron duration as data grows. Add only changes supported by plans and repeat tenant-isolation tests. No production plans were captured in this audit.

33. **P2 · Operational history grows, and push enqueue is not delivery confirmation. Confirmed gaps; scale impact unmeasured.**
    - **Problem:** Migrations contain no sweep of `private.rate_events`, `private.dispatch_log`, `private.ops_audit`, or the new `private.push_log`. [push dispatch](/home/zorothepirate/truckkoo-app/supabase/migrations/0046_push_notifications.sql:203) logs a `pg_net` request ID, not an Expo/device delivery result. Old tokens and failed delivery can make “waiting for an offer” look like a frozen app.
    - **Fix:** Define retention separately for throttling records, operational telemetry, and business/security audit evidence. Add bounded audited maintenance where appropriate; do not indiscriminately delete audit history. Process push HTTP responses/tickets/receipts, retire invalid tokens, and alert on failure/lag. Retain polling as a recovery path.
    - **Verify:** Accelerated history growth and sweeps, push provider rejection, invalid token, and scheduled-job failure. A successful enqueue must never be reported as confirmed delivery.

34. **P1 · There is no measured performance acceptance contract. Confirmed validation gap.**
    - **Problem:** Sentry and Expo Observe are present, and home screens mark interactivity, but no evidence here establishes cold-start, jank, memory, or recovery budgets for the current native build. Current marks can record an error outcome as interactive and do not necessarily wait for a useful job/city view.
    - **Fix:** Define useful-ready separately from error-ready, record startup stages and request durations without PII, and track release/runtime plus device class. Keep error monitoring enabled; make caught timeout/fallback outcomes visible as sanitized counters. Set targets and enforce them with actual release measurements.
    - **Verify:** Suggested initial targets below are goals to validate, not claims about current performance. Follow [React Native's release-build measurement guidance](https://reactnative.dev/docs/performance.html).

35. **P1 · Current source and the connected phone are different releases. Measured.**
    - **Problem:** The phone has 1.1.0; `app.json` is 1.2.0. `runtimeVersion` uses `appVersion`, so a 1.2.0 update does not update a 1.1.0 binary. A source-only fix can therefore leave the actual driver unchanged. The installed Android binary has `minSdk=24`; “any phone” already excludes older unsupported OS versions. OEM battery policy and missing map services add further differences.
    - **Fix:** Track build version, update ID/channel, native dependency set, and database migration compatibility together. Test the exact preview artifact before release; verify successful update/rollback and offline launch. Use supported minimum hardware/OS targets, not a universal-phone promise. Validate Maps/services failure with a usable city fallback.
    - **Verify:** Install the matching current binary on representative devices and record its identity with results. No installation, OTA publication, or production deployment was performed during this audit.

36. **P2 · Passing tests do not cover the failures that make the app feel stuck. Confirmed.**
    - **Problem:** Current suites cover extensive business/UI behavior but mock native modules and network. There is no dedicated real SessionProvider/startup recovery suite, no release E2E/soak/performance job in CI, and no fault matrix for hung operations. Worker teardown also warns on a successful full run.
    - **Fix:** Add focused failure-injection tests for items 1–10 and delivery/booking retries, then automate a small release-device journey. Track source-map availability for the tested build; preview explicitly disables Sentry auto-upload. Add bundle/asset budgets and native dependency compatibility checks to CI. Investigate open handles; do not silence the warning as a substitute.
    - **Verify:** Tests must fail against the problematic behavior and pass against the repair. Include startup, sign-in, booking, accepting an offer, delivery photo, sign-out/account switch, and both languages. A passing mocked suite is not evidence of 60 FPS.

**Expo compatibility findings — live check on 4 October 2026**

| Package | Installed | Expo recommendation |
|---|---|---|
| `@expo/ui` | 57.0.7 | ~57.0.21 |
| `expo` | 57.0.8 | ~57.0.26 |
| `expo-apple-authentication` | 57.0.1 | ~57.0.2 |
| `expo-auth-session` | 57.0.5 | ~57.0.13 |
| `expo-crypto` | 57.0.1 | ~57.0.3 |
| `expo-dev-client` | 57.0.9 | ~57.0.19 |
| `expo-device` | 57.0.1 | ~57.0.2 |
| `expo-font` | 57.0.1 | ~57.0.4 |
| `expo-glass-effect` | 57.0.1 | ~57.0.4 |
| `expo-image` | 57.0.1 | ~57.0.5 |
| `expo-image-picker` | 57.0.6 | ~57.0.20 |
| `expo-linking` | 57.0.4 | ~57.0.11 |
| `expo-localization` | 57.0.1 | ~57.0.2 |
| `expo-location` | 57.0.7 | ~57.0.20 |
| `expo-router` | 57.0.8 | ~57.0.24 |
| `expo-secure-store` | 57.0.1 | ~57.0.4 |
| `expo-splash-screen` | 57.0.5 | ~57.0.9 |
| `expo-symbols` | 57.0.1 | ~57.0.3 |
| `expo-system-ui` | 57.0.1 | ~57.0.4 |
| `expo-task-manager` | 57.0.20 | ~57.0.21 |
| `expo-updates` | 57.0.23 | ~57.0.24 |
| `expo-web-browser` | 57.0.2 | ~57.0.3 |
| `react-native` | 0.86.0 | 0.86.3 |
| `react-native-reanimated` | 4.5.0 | 4.5.1 |
| `react-native-worklets` | 0.10.0 | 0.10.1 |
| `@types/jest` | 30.0.0 | 29.5.14 |
| `eslint-config-expo` | 57.0.0 | ~57.0.2 |
| `jest-expo` | 57.0.2 | ~57.0.5 |

**Underlying advisory records**

| Installed package | Advisory | Triage focus |
|---|---|---|
| `braces@3.0.3` | [Nested-pattern stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Build/test glob handling and untrusted patterns |
| `decode-uri-component@0.2.2` | [Malformed percent-encoding denial of service](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | Router/query-string external input; test reachability and bounds |
| `image-size@1.2.1` | [JXL/HEIF parsing loop](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) | Asset/build tooling handling hostile images |
| `image-size@1.2.1` | [ICNS parsing loop](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) | Asset/build tooling handling hostile images |
| `node-forge@1.4.0` | [RSA signature verification flaw](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo signing/tooling path; determine actual affected operation |

**Recommended execution order**

| Pass | Work | Completion criterion |
|---|---|---|
| 1 | Account isolation, startup error states, blank booking/detail screens: 1–7, 23 | No cross-account residue; deterministic retry/back path under injected failures |
| 2 | One request/retry policy and freshness: 8–10, 16–19, 28 | Bounded waits; recovery on restored signal; no optional service blocking a core task |
| 3 | Safe completion of writes and GPS lifecycle: 21–22, 24–25 | Kill/timeout/retry preserves one logical booking/delivery; tracking follows latest intent |
| 4 | Font imports, virtualized/paginated history, polling/role cleanup, photo bounds: 11–15, 20, 26–27 | Smaller export and measured reduction in frames/memory/requests on the same device |
| 5 | Coherent SDK patch alignment and advisory remediation: 29–31 | Clean compatibility check, documented advisory disposition, fresh native build |
| 6 | Backend scale/retention, observability, release/device gate: 32–36 | Representative latency/soak evidence and a repeatable release check |

Establish the measurement harness at the start and rerun it after each pass. The sequence above is dependency ordering, not a reason to postpone measurement until the end. Keep fixes reviewable; avoid one giant framework-and-UI rewrite.

**Suggested acceptance targets — proposed, not yet measured**

| Area | Initial acceptance target |
|---|---|
| Startup | A visible shell/recovery surface within 3 seconds p95 on the agreed low-end release device; useful ready within 5 seconds p95 on controlled working network |
| Navigation | Immediate press feedback; cached ordinary screens usable within 300 ms p95, excluding OS dialogs and explicit network-only work |
| Scrolling | Target 60 FPS; report p95/p99 frame duration and frames over 16.7/33 ms for repeatable history scrolls; do not hide spikes behind average FPS |
| Network failure | Read operations reach success or actionable timeout within a defined total budget, initially 15 seconds; narrative status after about 3 seconds |
| Uploads | Explicit progress/retry and a separately measured upload budget; a slow upload must not make the whole app unresponsive |
| Memory | Stable after repeated navigation/camera cycles; measure a device-specific ceiling and leave OS headroom rather than inventing one universal MB number |
| Background | No screen polling/clock work while backgrounded; location remains only as explicitly authorized by availability/trip policy |
| Correctness | Zero blank/unrecoverable states across the fault matrix; no duplicate logical booking/delivery after retries; no cross-account cache/draft content |

Use at least a low-memory Android device, the actual driver phone, a modern Android device, and a supported older iPhone. Cover Arabic/English, large text, cold/warm start, low free storage, unstable network, offline cold start, expired session, denied permissions, process death, expired offers, and large history. Record thermal state and network conditions so comparisons mean something.

**What should stay**

- SQL-only prices/payouts, integer baisa, nullable truck choice, tenant isolation, private POD storage, and the human dispatch fallback.
- Existing native-driver button animations and native stack navigation. They are not a reason to add another animation library.
- Bundled simplified regional maps with one projection and no invented truck coordinates.
- Shared controls, Arabic shaping, large targets, and the existing React Compiler configuration. Profile before adding memoization everywhere.
- Sentry and Observe, with better coverage and release verification; removing visibility into failures is not a performance fix.

No RLS policy, RPC, service-role call site, database schema, pricing logic, application code, or dependency version was changed by this audit. Performance on the current native build, iOS behavior, production migration state, and production SQL query plans remain unverified.
