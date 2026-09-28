# Shipper places — search, current location, a pin on the gate

**Date:** 2026-09-28
**Status:** awaiting review
**Part B of three** (A: driver background GPS, done; C: Google Maps rendering —
superseded for now by §6's single-screen exception and D7's Directions button).

---

## 1. Why

A load stores two cities. Everything past the city — which warehouse, which
gate, who opens it — happens on the phone, between strangers, in the last few
kilometres. D7's "Directions to Sohar" (2026-09-28) takes the driver to the city
centre and no further.

The shipper should be able to say *where*, the way Uber and Careem ask: search a
place, or "use my current location", then drag the map until the pin sits on the
gate, then (optionally) leave a note and a contact for whoever is there.

**Success:** a driver who accepts a load can drive to the gate with Google Maps
and call the person standing at it, without first calling the shipper. And a
shipper who knows only a city still books exactly as today.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| P1 | **The city stays on every load; the place is added beside it.** The server derives the city from the point (`private.nearest_city`). | Pricing (`private.compute_price`), dispatch (`private.next_wave`) and the rate card are per city/corridor. Changing none of them keeps this feature from touching money or matching. |
| P2 | **Places live in a new table, `public.load_places`, not on `loads`.** | `loads` has a table-level `select` grant and a policy letting a driver read any load they ever had an offer for (`driver_has_offer`). A contact phone on `loads` would stay readable after a pass or a lapse. A separate table with no driver grant is deny-by-default. |
| P3 | **A driver sees the exact point, note and contact in the offer — only while it is pending.** | **Founder's call, 2026-09-28**, chosen over "only after accepting" knowing that every offered driver (three per wave, several waves) sees them. The safeguard within that choice: after a pass or a lapse they are gone from that driver's reads. |
| P4 | **Search goes through a Supabase Edge Function; the Places key never ships in the app.** | Google's app restrictions on Places web-service calls rest on spoofable headers, so a key in the bundle is an open billing tap. The function authenticates the user and rate-limits per shipper. |
| P5 | **The function holds no service-role key.** It calls `public.use_places_quota()` *as the user*. | CLAUDE.md: a new service-role call site needs a stop-and-ask. It isn't needed: the user's own JWT reaches the existing rate limiter. |
| P6 | **One screen uses a real map: `react-native-maps`, Google on Android, Apple Maps on iOS.** Exactly one file may import it. | The pin-adjust step needs streets and panning; the drawn map is ~1 px/km. Everything else keeps `src/map`. iOS is untested on devices, and Apple Maps needs no key or extra pod. |
| P7 | **Place names for GPS and the dragged pin come from the phone's geocoder** (`expo-location`), not Google Geocoding. | Free and keyless; falls back to "Near <city>". |
| P8 | **Everything is optional; the city list stays.** | CLAUDE.md #6 — a shipper never hits a dead end. Search down, permission refused, no signal: the city list still books. |
| P9 | **All of this ships in the 1.1.0 build.** | `react-native-maps` is native. 1.1.0 is not built yet, so no second bump. `eas build` waits for this. |

## 3. What the shipper sees

The six questions stay six; the step counter does not advance on sub-screens.

**Step 1 — "Where is the cargo now?"** (`book/origin.tsx`, rebuilt)
- Search field: *"Search a place, area or company"*. Suggestions after 3
  characters and a 300 ms pause, in the app language.
- *"Use my current location"* — asks foreground permission once. Refused or
  failed: the row disappears; nothing else changes.
- *"I don't know the exact place — choose a city"* — today's city list and map,
  unchanged in behaviour. Picking a city clears any place and goes straight to
  step 2, as now.

**1b — "Put the pin on the gate"** (`book/origin-pin.tsx`, new)
- Full-screen map, pin fixed at the centre; the shipper drags the map.
- Under it: the place name (phone geocoder, on map idle, throttled) and
  *"Near Barka"* (server, `city_near`).
- *Confirm pickup* stores `{lat, lng, placeName}` and the derived city in the
  draft.

**1c — "Anything the driver should know?"** (`book/origin-details.tsx`, new)
- Directions note (≤300 chars): *"Gate 3, behind the Shell station"*.
- *Someone else at pickup?* name + phone.
- *Skip* has the same weight as *Continue*.

**Step 2** mirrors it (`destination.tsx`, `destination-pin.tsx`,
`destination-details.tsx`); the contact is the receiver. The country control on
S10 stays for the city list; search is limited to the GCC regardless.

**Review (S9)** shows the place name under each city, and the note/contact when
given.

**Draft** (`src/lib/booking.ts`) gains `origin` / `destination` places:
`{ lat, lng, placeName, note, contactName, contactPhone } | null`. The key
becomes `truckkoo.booking.draft.v2`; a v1 draft is read once and migrated
(places null). Back preserves everything, as now.

**After booking:** T3/T4 show the shipper's own place names. The drawn map stays
at city level (no pin).

## 4. Data and access

### 4.1 `public.load_places` (migration 0041)

```
load_id       uuid  references public.loads on delete cascade
kind          text  check (kind in ('pickup','drop'))
lat, lng      double precision  not null, checked to the served region (12–33 N, 34–60 E)
place_name    text  ≤ 200
note          text  ≤ 300
contact_name  text  ≤ 80
contact_phone text  ≤ 24, digits / + / spaces only
created_at    timestamptz default now()
primary key (load_id, kind)
```

- `revoke all … from anon, authenticated`; RLS enabled **and forced**.
- Grant back: `select` (all columns) to `authenticated`, policy
  `private.owns_load(load_id)` — the shipper reads their own. **No write grant
  to any client role**; no driver policy.
- `private.reject_unsafe_text()`-style trigger over the four text columns
  (bidi overrides rejected in the DB; `safe-text.ts` again at output).
- `SENSITIVE_FIELDS.md`: `contact_phone`/`contact_name` are a third party's
  personal data; no client write path.
- `supabase/tests/tenant_isolation.sql` extended for the new owned table.

### 4.2 Writing: `book_load`

`public.book_load` gains `p_origin_place jsonb default null`,
`p_dest_place jsonb default null` (`{lat, lng, place_name, note, contact_name,
contact_phone}`). Replaced with `drop function` + `create` (a signature change),
grants restated. When a place is given:

- the server computes `private.nearest_city(lat, lng)`; **if it differs from
  `p_origin_city` / `p_dest_city` the call raises** (`check_violation`,
  "city does not match place") — only a client bug can cause it;
- both places are inserted in the same transaction as the load.

Everything else in `book_load` (price check, accept, dispatch) is unchanged.
`post_load` (legacy "Send this route again") is untouched and posts no places.

### 4.3 `public.city_near(lat, lng)`

Returns the city id `private.nearest_city` picks, for "Near Barka". `stable`
(reads only), granted to `authenticated`, range-checked like `report_location`.
One nearest-city rule, server-side.

### 4.4 Reading, for drivers

- `driver_offers()` / `driver_offer()` return `pickup_*` / `drop_*` place
  columns **only when that driver's offer is `pending`**; otherwise null.
- `driver_trip()` returns them for the driver on the trip while
  `assigned`/`in_transit`; after delivery the point, name and note stay and the
  contact is null.
- Return-type changes mean `drop function` + `create` for each, grants restated,
  and the client row types updated in `src/lib/queries.ts`.
- D7's Directions uses the exact point when present, else the city
  (`directionsLink`, unchanged).

### 4.5 Ops

New `public.ops_load_places(p_load_id)`, `require_ops()` first, read-only. The
console in `~/truckkoo-ops` can adopt it later; nothing there changes now.

## 5. Search — the `places` Edge Function

`supabase/functions/places/index.ts`, `verify_jwt` on (Supabase's default).
Thin wrapper; the logic is in `supabase/functions/places/core.ts`, plain
TypeScript with no Deno imports, so Jest tests it.

- `POST {action:'autocomplete', input, sessionToken, language}` → Places API
  (New) `places:autocomplete` with `includedRegionCodes: [OM, AE, SA, QA, KW,
  BH]`, a location bias over Oman, `languageCode` en/ar. Returns
  `[{placeId, main, secondary}]` only.
- `POST {action:'details', placeId, sessionToken, language}` → Place Details
  with `X-Goog-FieldMask: location,formattedAddress` (Essentials tier). Returns
  `{lat, lng, address}`.
- Before calling Google it calls `public.use_places_quota(p_kind)` with the
  caller's JWT (anon key + `Authorization` header forwarded). That function is
  `volatile`, `security definer`, `search_path = ''`, shipper-only, and wraps
  `private.check_rate_limit`: 300 autocomplete / 60 details per hour. Over the
  limit → `{error:'limited'}`.
- 5 s timeout on Google. Any failure → `{error:'unavailable'}`; the app shows
  *"Search isn't working right now — choose a city instead"* with the city list.
- Key: Supabase secret `GOOGLE_PLACES_KEY`, restricted in Google Cloud to the
  Places API (New) only.

Client: `src/lib/places.ts` — session token per search (uuid), debounce, calls
the function through `supabase.functions.invoke`.

## 6. The map exception

- `npx expo install react-native-maps`.
- New `app.config.ts` extends `app.json` and sets
  `android.config.googleMaps.apiKey` from the EAS env var
  `GOOGLE_MAPS_ANDROID_KEY`. The key is restricted in Google Cloud to the
  Android package + signing SHA-1 and to Maps SDK for Android. Not committed.
- `src/components/booking/PinAdjustMap.tsx` is **the only importer** of
  `react-native-maps`; `tests/unit/map-import-guard.test.ts` enforces it.
- `CLAUDE.md` Design section: the drawn map rule gains this one exception, with
  the reason.
- Jest: a global mock of `react-native-maps` in `tests/setup.ts`.

## 7. Driver screens

- **Offer (D5, `offer/[id].tsx`)**: place name under each city in the route,
  the note, and the contact's name with a *Call* button (`tel:`), while pending.
- **Trip (D7, `trip/[id].tsx`)**: the same until delivery; *Directions* to the
  exact point. The label becomes *"Directions to <place name>"* when there is a
  place, else *"Directions to <city>"*.

## 8. Strings

All through `t()` with typed placeholders; Arabic drafts go in the UNPROOFED
block and the count in `CLAUDE.md` / `OPEN_ISSUES.md` is updated.

## 9. Tests

- **SQL** (`dispatch.sql` or a new `places.sql` in `test:db`): a shipper cannot
  read another's places; a driver cannot `select` `load_places` at all; a driver
  reads places through `driver_offer()` while pending and gets null after
  decline / expiry; `driver_trip()` hides the contact after delivery;
  `book_load` refuses a city that does not match the place; `city_near` returns
  Seeb for a point in Seeb; `use_places_quota` limits and refuses a driver; the
  static definer/volatility checks still pass.
- **Jest**: `places/core.ts` (field mask, regions, language, response trimming,
  error mapping); `src/lib/places.ts` (debounce, session token reuse, error →
  fallback); draft v1→v2 migration; the new booking screens (search, current
  location refused, pin confirm, skip, back keeps answers, search failure shows
  the city list); review shows places; offer and trip screens (pending shows,
  Call, Directions to the point); the map import guard.

## 10. Founder tasks (before the 1.1.0 build)

1. Google Cloud project with billing; budget alert (~$20) and a daily quota cap
   on Places API (New).
2. Two keys: **Places API (New)** only (server) and **Maps SDK for Android**
   only, restricted to the app package + SHA-1 (app).
3. `npx supabase secrets set GOOGLE_PLACES_KEY=…`;
   `npx supabase functions deploy places`.
4. EAS environment variable `GOOGLE_MAPS_ANDROID_KEY` for preview and
   production.
5. `npx supabase db push` (0039, 0040, 0041).
6. Then `eas build --profile preview --platform android`, and the device check.

## 11. Out of scope

Recent/saved places; places on "Send this route again"; a pin on the drawn
maps; Google Maps on iOS; road-distance pricing; showing places in the ops
console UI.
