# Product

<!-- impeccable:product-schema 1 -->

Truckkoo mobile app. Companion to `STACK.md` (technical plan) and `DESIGN.md`
(visual authority, extracted from the live website).

**Source of truth for company facts:** the live website at `~/truckkoo`
(`index.html`, `services.html`, `about.html`, `industries.html`, `contact.html`,
and its own `PRODUCT.md`). Facts below are drawn from it. Where the app and the
website could contradict each other, that is called out explicitly.

## Platform

adaptive

Recorded as `adaptive` because Truckkoo ships natively on **both iOS and
Android**. It is not adaptive in the design-language sense: the confirmed
decision is **one Truckkoo look on both platforms** — brand-led, identical visual
language, with native *affordances* respected (safe areas, back gesture, keyboard
behavior, permission sheets). Do not derive HIG-vs-Material visual splits from
this field; derive only each OS's affordance obligations.

## The Company

**Truckkoo is an Oman-based trucking and logistics operator**, headquartered in
Muscat, connecting Oman to the wider GCC. It is not a broker or freight
forwarder — the website's central trust claim is *"We run the fleet ourselves. No
brokers passing your cargo down the line."*

- **Coverage:** all of Oman, plus 5 GCC countries — UAE, Saudi Arabia, Qatar,
  Kuwait, Bahrain. Stated publicly as "6 GCC countries".
- **Services (8):** local trucking within Oman · GCC cross-border road freight ·
  door-to-door logistics · customs clearance (import, export, GCC transit) · FTL
  · LTL · industrial & project/heavy cargo · warehousing & distribution.
- **Load range:** 1–40 tons, "a single pallet to 40-ton trailers".
- **Industries served:** construction & infrastructure, oil & gas, manufacturing,
  retail & FMCG, automotive, healthcare & pharma, e-commerce.
- **Operating hours:** 7 days a week, including public holidays.
- **Contact:** WhatsApp & phone `+968 7517 2824` · `hello@truckkoo.com` ·
  Instagram `@truckkoo` · Muscat, Sultanate of Oman.
- **Tagline:** *Driven. Delivered. Trusted.* Positioning line: *Connecting Oman
  to the GCC.*

## Users

**MVP is businesses only. Households are Phase 2.**

- **Businesses (MVP)** — traders, contractors, manufacturers, retailers, project
  teams. Need local distribution, cross-border freight, customs clearance,
  project cargo, or warehousing. They want to know the operator is capable and
  reachable.
- **Households (Phase 2)** — moving homes, furniture, or single items within Oman,
  or shipping personal effects across the GCC. Often Arabic-first. Want a price
  and reassurance fast.
- **Contracted owner-drivers (MVP, supply side)** — vetted drivers who post their
  planned and empty legs, receive matched load offers, accept work, and report
  trip progress. Used one-handed, in a cab, mid-route, in bright sun, on patchy
  signal.

**The website advertises home moves; the MVP app does not cover them.** This
breaks no promise: households continue through the WhatsApp path exactly as they
do today. Do not add app entry points implying household self-service until
Phase 2.

**All audiences have near-zero tech skills.** This is confirmed and it is the
strongest design constraint in this document — stronger than the brand, stronger
than the feature list. One decision per screen; pickers and large tap targets
instead of free text; status legible at a glance in plain words with no jargon or
progress metaphors; errors that say what to do next rather than what went wrong;
no flow assuming the user has done anything like this in an app before. A screen
a competent phone user could figure out is not good enough here.

## Product Purpose

Move cargo from request to delivered without the phone-call-and-haggle loop that
normally sits in the middle, and fill the empty legs Truckkoo's contracted trucks
are already running.

Today the website converts visitors into WhatsApp conversations, and a human
quotes and dispatches. The app moves the repeat, structured part of that work into
software — while keeping the human backstop that made it trustworthy.

Success: a business books without needing to call anyone, and a driver completes a
trip's status trail without being called either.

## Positioning

**Vetted trucks Truckkoo stands behind, matched to loads already on their route.**
Two mechanisms:

1. **Best-overlapping empty leg.** Drivers declare where they are going and when
   they are free. Truckkoo matches a load to the truck whose existing — often
   empty — leg it fits with least added detour. Deadhead is the core economic
   waste in freight: the shipper pays less and the driver earns more on a trip
   they were already making, and neither side is funded by a discount Truckkoo
   absorbs. A competitor can copy the marketplace; it cannot copy the declared
   route intent of a fleet that has chosen to share it.
2. **No brokers, 100% verified drivers.** Truckkoo holds the customer
   relationship and the liability end to end. Cargo is never passed down a chain
   of intermediaries.

**Resolution of the fleet-model tension (confirmed):** the app onboards
**contracted owner-drivers who are vetted before they can accept any load**.
Truckkoo remains the operator and the counterparty, so *"no brokers"* and
*"100% verified drivers"* both stay literally true. This makes the vetting gate a
**hard requirement, not a nice-to-have** — see Capabilities.

**The real launch risk sits on the supply side:** the matching engine is worth
nothing until enough drivers habitually declare their legs. Driver-side design
should be judged partly on whether it makes that declaration effortless and
obviously worth doing.

## Operating Context

- **Home market: Oman** (Muscat HQ), with cross-border road freight into the UAE,
  Saudi Arabia, Qatar, Kuwait, and Bahrain. See STACK.md §9 for the regulatory
  obligations this creates.
- **Currency: Omani Rial (OMR), a three-decimal currency** — 1000 baisa to the
  rial. Nearly every money library and formatter assumes two decimals. Treat this
  as a known defect source; see STACK.md §6.
- **Trip lifecycle:** request → auto-match against declared legs → quote → truck
  assigned (dispatcher can override) → in transit (driver milestones) →
  delivered with proof → settled offline.
- **Drivers declare planned legs.** Origin, destination, time window, capacity,
  truck type, and whether the leg is empty. This is the matching engine's input
  and a distinct recurring driver-side habit the app must build.
- **Payment happens outside the app.** Settlement is offline. The app records and
  reflects trip state; it is not a payment processor and must never imply an
  in-app charge, saved card, or wallet.
- **WhatsApp is the incumbent product, not a fallback.** Every website surface
  drives to `wa.me/96875172824`, and the public promise is *"replies in
  minutes, 7 days a week."* The app must not make contact harder than WhatsApp
  already does, and it inherits that responsiveness expectation.
- **Cross-border freight means paperwork.** Customs declarations, invoices,
  certificates, duties, transit documents. Handled by Truckkoo specialists today
  and out of MVP scope, but the data model should not make documents impossible
  to attach later.
- **Driver conditions are hostile to fussy UI:** gloves, sun, one hand, moving
  vehicle, patchy signal, cheap Android hardware.

## Capabilities and Constraints

**Truck taxonomy — exact, from the live site. Reuse verbatim; do not invent tiers.**

| Value | English | Arabic | Use |
|---|---|---|---|
| `pickup` | Small pickup (1 ton) | بيك أب صغير | Small home moves, single items, quick deliveries |
| `hiup` | Hi-up (3 tons) | هاي أب | Furniture, appliances, mid-size cargo — has a lifting tail |
| `10t` | 10-ton truck | شاحنة ١٠ طن | Commercial freight, construction materials |
| `20t` | 20-ton trailer | تريلة ٢٠ طن | Heavy haulage, long-distance |
| `40t` | Trailer — up to 40 tons | تريلة — حتى ٤٠ طن | Industrial and cross-border maximum |
| `""` | **Not sure — advise me** | غير متأكد — انصحوني | **Keep this.** See below |

**"Not sure — advise me" is the most important affordance in the product** and it
already exists on the website. For a zero-tech-skills audience, forcing a truck
choice is the likeliest point of abandonment. It must remain the default, and it
routes to a human.

**The existing website quote form is the post-a-load screen, already validated
and bilingual:** pickup from · deliver to · type of goods (free text, e.g.
"furniture, building materials") · truck type (optional). Four fields. Do not
design a more elaborate one for the MVP.

**Locations: a curated city list, not map addresses.** The website ships 46
cities with Arabic names, organised by corridor — Muscat governorate, Batinah
coast, Interior & Dhahirah, Sharqiyah, Wusta & Dhofar, Musandam, then UAE and
Saudi. Reuse it as seed data (`js/main.js`, `CITIES`). The website permits free
text alongside suggestions; the app should prefer a strict picker plus an
explicit escape hatch.

Confirmed in scope for MVP:

- Shipper: post a load, receive a quote, see the assigned truck and driver, follow
  trip status.
- Driver: **declare planned legs**, view matched offers, accept, update trip
  status, submit photo proof of delivery.
- **Driver vetting gate — required.** A driver cannot accept any load until
  verified. This is what keeps the public "100% verified drivers" claim true.
- System: auto-match loads to best-overlapping declared legs, with dispatcher
  override.
- **When nothing matches, Truckkoo arranges a fresh trip.** The load enters a
  "finding you a truck" state and a human resolves it. This is a permanent
  product promise, not an MVP shortcut — a shipper must never hit a dead end.
- Auth: Google, Apple, and email. Role chosen at signup.
- Account deletion in-app (store requirement).

Confirmed out of scope:

- **In-app payment.** No card entry, wallet, or checkout — not even disabled.
- Households (Phase 2), customs document workflows, warehousing, live GPS
  tracking (Phase 3), Arabic copy (Phase 2 — but see below).

**MVP staging decisions** (solo developer, no prior app experience — see
STACK.md): city-to-city pickers, not map addresses; exact-city SQL matching
before route-proximity; driver-tapped milestones instead of background GPS;
English strings first with RTL structural from day one. The shipper side is built
first, because the concierge fallback makes it a working product with zero
drivers signed up.

These are staging decisions, not reversals of the product truth above.

**Arabic and English are both required; RTL is structural from day one, Arabic
copy ships in Phase 2.** Every layout uses logical properties and mirrors
correctly from the first component, and every string goes through a lookup even
while only English exists — that half is cheap now and expensive to retrofit.
Translation and proofing is what waits. Note the website is fully bilingual
already, so **the Arabic copy largely exists** and can be lifted rather than
commissioned. Arabic sets `letter-spacing: 0` (DESIGN.md §2). Fonts committed:
Archivo (Latin), Almarai (Arabic).

Explicitly undecided:

- **What a trip actually costs.** The *mechanism* is built (corridor-band rates,
  `STACK.md` §2c) but the rate card ships empty and every price is currently set
  by a dispatcher. The numbers are a commercial decision, not an engineering one —
  see `OPEN_ISSUES.md` 13. What a shipper *sees* is settled: one price, in rial,
  with three decimals, held for 48 hours, and nothing charged in the app.
- What vetting consists of, and whether it happens in-app or out of band.
- Fleet owners holding multiple drivers and trucks under one account.
- Notification strategy and taxonomy.
- Arabic vs Eastern-Arabic numerals (the site uses Eastern-Arabic in Arabic copy —
  e.g. ٤٠ طن — so match it).
- Country-level regulatory obligations — see STACK.md §9.

## Brand Commitments

- **Name:** Truckkoo. **Tagline:** *Driven. Delivered. Trusted.*
  (قيادة. توصيل. ثقة.)
- **Voice:** confident, plainspoken, operator-grade — a company that actually
  runs trucks, not a middleman. Warm and human, not corporate. Premium and
  credible, not cheap or aggressive. **Specifics beat adjectives**: tonnages,
  city names, "no brokers" outperform "world-class solutions".
- **Bilingual parity:** every decision must hold in Arabic/RTL as well as in
  English. No move that only works LTR.
- `DESIGN.md` is binding: single orange accent `#f1551f`, weight-900 tight
  headlines, hairline 1px borders instead of shadows, alternating light/dark
  sections with their own color triples.
- WhatsApp green `#1fa855` is reserved for WhatsApp actions on the website. The
  app may reuse it as a success color — DESIGN.md permits this — but decide once,
  not per screen.

**Anti-references** (inherited from the website brief, and they still apply):

- Generic freight-forwarder template — corporate blue, globe icons, handshake
  photos, "global supply chain solutions" boilerplate.
- Loud discount/aggregator look — badge soup, neon, urgency banners, coupons.
- Cold enterprise SaaS — sterile navy dashboards, stat-grid heroes.

## Evidence on Hand

**Real and reusable** — all in `~/truckkoo`:

- Full bilingual copy across five pages, including 8 service descriptions, 7
  industry descriptions, vision/mission, and a 5-question FAQ.
- The 46-city bilingual list (`js/main.js`).
- The 5-type truck taxonomy with bilingual labels and descriptions.
- Logo assets: `logo.jpg`, `logo-mark.png`, `logo-word.png`, plus app icons at
  180/192/512.
- **Only three photographs:** `road-desert.jpg`, `port-containers.jpg`,
  `warehouse.jpg`. Thin for an app — more fleet photography is a real asset gap,
  and DESIGN.md's photo-veil treatment presumes imagery exists.
- Existing legal copy: `privacy.html`, `terms.html`.

**Public claims the app must stay consistent with:** "100% verified drivers" ·
"6 GCC countries" · "1–40 ton range" · "7 days a week" · "replies in minutes" ·
"no brokers, no delays".

**Not on hand — must not be fabricated:** named customers, testimonials, reviews,
ratings, trip volumes, fleet size (notably the website never states a truck
count), founding year, employee count, awards, certifications, or partnership
claims. The website deliberately avoids all of these; the app must too.

## Product Principles

1. **Assume no prior app experience.** Every screen must work for someone who has
   never booked anything on a phone. When simplicity and capability conflict, cut
   capability. This outranks the principles below.
2. **Never let a shipper hit a dead end.** No match means "we are finding you a
   truck", never "no results". A human backstop is part of the product.
3. **Keep the operator promise literally true.** "No brokers" and "100% verified"
   are public claims. Any feature that would make them false is not shippable —
   which is why vetting gates load acceptance.
4. **Vetting and route-fit must be visible.** If a screen could equally belong to
   an open marketplace, it is under-selling what Truckkoo owns. Show the truck and
   the person, and why this truck.
5. **Specifics over adjectives.** Cities, tonnages, dates, names. The brand voice
   is operator-grade, and vague reassurance reads as brokerage.
6. **Bilingual parity, structurally.** RTL and Arabic are constraints on layout
   from the first component, never a translation pass at the end.
7. **Design for the cab, not the desk.** Driver-side targets, contrast, and error
   tolerance are set by one-handed use in a moving vehicle on bad signal.

## Accessibility & Inclusion

- **Target: WCAG 2.1 AA.** Established on the website and inherited here.
- **Low digital literacy is the primary inclusion requirement**, ahead of every
  formal standard. Comprehension by someone who has never used an app like this
  is the bar every screen is measured against.
- **RTL correctness is structural from day one**, even though English ships
  first — Arabic speakers are a core audience, and retrofitting direction is the
  expensive version of this work.
- Carry the website's conventions forward: ≥44px tap targets, visible focus
  treatment, ≥4.5:1 body and placeholder contrast, reduced-motion alternatives,
  semantic landmarks, logical properties throughout (DESIGN.md §6).
- Sunlight legibility, one-handed reach, and cheap-Android performance follow
  from Operating Context.
