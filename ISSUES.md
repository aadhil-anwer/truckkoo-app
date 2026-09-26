# Design audit — the build against the handoff (2026-09-26)

What the app does today, compared with `App redesign with map interface.zip`
(`design_handoff_truckkoo_redesign/README.md`, 32 screens). Checked by running
the app in a 390×844 browser against a local database seeded with a load in
every state, screenshotting each screen, and reading the code where a screen
could not show it. Screens are named by their handoff IDs (S1, T4, D7…).

**Caveat:** a browser is not a phone. Fonts and SVG render slightly differently,
so anything marked *(web)* needs confirming on Android. Everything else is in the
code and will be the same on a phone.

`OPEN_ISSUES.md` stays the long-running list; this file is the audit. Move an
item there once it is decided rather than fixed.

---

## 1. The map "doesn't come up"

Framing and the sheet overlap (the two biggest causes) are fixed: every map
screen now frames its route with `framingFor` and fits above its sheet with
`useMapBand`. Seen working in a browser on the offer detail (Nizwa → Salalah).
The route-sized box for short trips like Muscat → Sur is unit-tested but was not
seen rendered — Metro's file watcher was serving a stale bundle. Check on a phone.

### 1.3 What is drawn is nearly invisible on a phone — HIGH

The colours are the handoff's exactly: Oman `#1A1E24` on a `#0B0C0F` sea is
about **1.2:1**. The handoff also draws **roads** (major `rgba(255,255,255,.085)`
3.4px, minor 2.2px) and **city labels** on the map. The build has neither:
`geometry.json` contains no roads, and no screen passes a label to `CityPin`
except the booking destination screen. What is left is a near-black shape on
black. At arm's length, outdoors, that reads as "no map".

**Fix:** add labels for the route's cities and a few anchors (Muscat, Sohar,
Nizwa, Sur, Salalah, Dubai). Add major roads to `scripts/build-geo.mjs`. Test a
lighter land tone on a real phone; the handoff offers "Deep" (`#131B26` land,
blue-tinted coast) as a sanctioned alternative.

### 1.4 The shipper's tracking says "No position yet" when there is one — HIGH

T4 for an in-transit trip shows "No position yet". Called directly as that
shipper, `trip_position()` returns the fix (lat 22.69, lng 58.53, `eta_source
'fix'`). So the database is right and the screen loses it somewhere between
`useTripPosition(trip?.id)` and the `fix` check in `load/[id].tsx` (~line 604).
Not yet debugged. "Estimated arrival" then renders with no value beside it.

---

## 2. Cities show as "—"

### 2.1 The city list comes from the network; the handoff says bundle it — HIGH

Handoff, Data fetching: *"City list: static fixture, bundled. Never make the
user wait on a network call to pick a city."* The build fetches `cities` from
Supabase once per session (`useCities`, `staleTime: Infinity`). Until it
arrives, every route renders "—" (reproduced: a fresh load of Offers shows
dashes for about a second). If that one request fails, it never retries, and the
dashes stay until the app is killed. That is what the device showed.

Every map pin also depends on this, so a failed city fetch also means an empty
map.

**Fix:** bundle the 46 cities (names and coordinates) as a generated fixture, the
way `geometry.json` is, and keep the table as the server's copy. The ids must
match: generate the fixture from the database, and test that they agree.

---

## 3. Driver screens

| Screen | Problem | Handoff says |
|---|---|---|
| D1 home | The orange bloom is a hard-edged brown disc (React Native has no radial gradient) and looks like a stain | Soft radial falloff, 520×420 |
| D1, D2, Offers | Chips have no visible edge: chip background = card background | Chips are 32px on a contrasting fill |
| Offers tab | Every offer is a full-height card, so two offers fill the screen | Compressed 20px-radius rows (40px numeral tile, one line of detail) after the first |
| Offers tab | Heading is a small "OFFERS" label | "Offered to you" 700 21px + subtitle |
| Offers tab | Chips report as tappable (`cursor: pointer`) but do nothing | Labels, not buttons |
| Offers | No live countdown near expiry, and no "expired" state on the card | Countdown under ~15 min; an expired card collapses or is marked; never a dead accept button |
| Tab bar | The Offers badge covers the bell instead of sitting at its corner *(web)* | `top: -2px; right: 20px` |
| D7 on the job | "YOU EARN" and then "You keep" directly under it: the money is labelled twice | One label |
| D7 | Hierarchy inverted: payout is the big serif, destination is small | `DROP AT` / "Barka" 40px serif; `YOU EARN` 24px bold |
| D7 | Two orange accents: the camera button and "I have delivered it" | One accent per screen |
| D7 | Missing floating pill "Carrying · 34 km to Barka" | Drawn over the map |
| D7 | Missing "Report a problem" | Tertiary action |

## 4. Shipper screens

| Screen | Problem | Handoff says |
|---|---|---|
| S1 home | No city labels on the map; the search block sits over where the pins would be | Active city labels 600 12px, inactive 500 11px |
| S1 home | Chips have no visible edge (as §3) | 32px chips on `#15171C` |
| T4 tracking | Two serif display texts: "Sur" and "NO. DE300000" | One display statement per screen |
| T4 | Title and pills sit on top of the map lines | Map above, sheet below |
| T4 | "Estimated arrival" with no value; "No position yet" (see 1.4) | ETA "11:20 am" in serif, "IN 48 min", progress bar, driver row |
| T2 price | No reasons when declining ("too expensive / no longer needed / …") | One optional tap-through after "No thanks" |

## 5. Sign-in screens (the first thing anyone sees)

P2 replaces these, but until it ships they are the front door:

- "Sign in" and its subtitle sit flush against the left edge; everything else has a 22px margin.
- The "Sign in" button is dark grey. The primary action on an ink screen is `#F1551F`.
- The inputs are white cards: the cream-screen style on an ink screen.

## 6. Missing entirely

- **Push notifications.** The handoff makes them the primary channel: *"push
  notification is the primary channel for `quoted` and `assigned`"*, and driver
  offers are *"push-driven"*. T1's copy promises "no need to keep the app open".
  The build has none: no `expo-notifications`, no tokens, no sender.
- **Motion.** T1's pulsing search rings, the corridor drawing itself in (~420ms),
  the progress bar animating, and slide transitions (forward from the trailing
  edge, inverted in Arabic). The build uses a plain fade and static drawings.
- **N1–N6** (phone sign-in). Deferred; this is P2.

## 8. Different from the handoff on purpose — not bugs

Each was decided and written down; listed so nobody "fixes" them back:

- No tile map, no MapLibre. Bundled geometry, fixed framings, no pan or zoom (P1 spec, M1/M2).
- The truck marker is never interpolated between fixes. A position is only ever a real reported fix (CLAUDE.md, P6).
- The phone keypad is the system one, not the drawn one (P2 spec §5).
- The code will be 6 digits, not 4: Supabase's SMS hook always sends 6.
- The primary button text is 18.66px, not 17px, to pass contrast (CLAUDE.md).
- A route that leaves the northern close-up gets a box of its own (never smaller than the close-up, never larger than the region) rather than only the two named framings (2026-09-26).
- The Routes tab and "add a trip" are hidden (`DECLARED_TRIPS`), with Past trips in their place (2026-09-26).
- Three of the handoff's text colours were raised to pass AA (OPEN_ISSUES.md).

---

## Suggested order

1. **Bundle the cities** (2.1). Removes the dashes and the empty-map-on-failure together.
2. **Map legibility** (1.3): labels first (cheap), then roads, then the land tone, judged on a phone.
3. **The T4 position bug** (1.4).
4. **D7 layout** (§3): it is the screen a driver uses mid-delivery.
5. Chips, bloom, Offers compact rows, badge.
6. Push notifications, as its own spec.
