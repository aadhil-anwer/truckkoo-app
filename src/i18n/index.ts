/**
 * Strings and direction.
 *
 * PRODUCT.md: Arabic and English are both required; RTL is structural from day
 * one and Arabic copy ships in phase 2. The expensive half is translating and
 * proofing copy. The cheap half — which must happen NOW because retrofitting it
 * is what actually costs weeks — is:
 *
 *   1. every user-facing string goes through `t()`, never a literal in a screen
 *   2. every layout uses logical properties, never left/right
 *
 * ARABIC IS COMPLETE AS OF P7, and it is not all of one kind. Strings are
 * either lifted verbatim from the live bilingual website (`~/truckkoo`) or from
 * the handoff's X3/X4, assembled from words already here, or DRAFTED — and the
 * drafts sit in one delimited block at the end of the `ar` dictionary, marked
 * UNPROOFED, because none of them has been read by someone who reads Arabic.
 * `npm run preview:rtl` lays every string out for exactly that review.
 *
 * The English fallback stays, and still matters: the next key someone adds will
 * have no Arabic for a while, and it must look unfinished rather than blank.
 *
 * This is deliberately a plain typed dictionary rather than i18next. It is ~40
 * lines of machinery instead of a dependency, and `t()` has the same shape, so
 * swapping to i18next in phase 2 (for pluralisation, which Arabic genuinely
 * needs — six CLDR categories) does not touch call sites.
 */

import { I18nManager } from 'react-native';
import * as Localization from 'expo-localization';
import { urduCore } from './ur';

export type Language = 'en' | 'ar' | 'ur';

/** English is the source of truth: every key must exist here. */
const en = {
  // ── P3 · the booking flow (S3–S9) ────────────────────────────────────────
  'book.origin.q': 'Where is the cargo now?',
  'book.origin.help': 'Tap a city on the map, or search for it.',
  'book.origin.search': 'Search 46 cities',
  'book.origin.cta': 'Pick up here',
  'book.dest.q': 'And where does it need to be?',
  'book.dest.help': 'We find the truck already heading that way.',
  'book.dest.pickup': 'PICK UP',
  'book.dest.deliver': 'DELIVER TO',
  'book.dest.swap': 'Swap pickup and destination',
  'book.dest.recent': 'RECENT DESTINATIONS',
  'book.dest.border': 'Border paperwork is on us. Add one extra day for the crossing.',
  'book.date.q': 'When should we collect it?',
  'book.date.today': 'Today',
  'book.date.tomorrow': 'Tomorrow',
  'book.date.other': 'A different day',
  'book.date.more': 'Show more days',
  'action.continue': 'Continue',
  // ── P4 · the wait, the price, the truck (T1–T5) ──────────────────────────
  'track.looking.pill': 'LOOKING NOW',
  'track.looking.body': 'We are asking the ones with room. You will get a price here — no need to keep the app open.',
  'track.step.received': 'Load received',
  'track.step.matching': 'Matching a truck',
  'track.step.matchingHint': 'Usually under 20 minutes',
  'track.step.price': 'Your price, to approve',
  'track.step.priceDone': 'Your price, approved',
  'track.step.truck': 'Truck confirming',
  'track.accepted.q': 'Finding your truck.',
  'track.accepted.body': 'Your price is agreed. We are putting it in front of the drivers already heading that way.',
  'track.price.label': 'YOUR PRICE',
  'track.price.accept': 'Accept',
  'track.price.pay': 'Pay the driver on delivery',
  'track.price.no': 'No thanks',
  'track.price.ask': 'Ask a question',
  'track.assigned.label': 'COLLECTING',
  'track.assigned.prep': 'Have the cargo ready and someone at the gate. The driver will call before arriving.',
  'track.assigned.call': 'Call the driver',
  'track.transit.arriving': 'ARRIVING',
  'track.transit.toPay': 'To pay on delivery',
  'track.delivered.title': 'Delivered.',
  'track.delivered.ref': 'Reference',
  'track.delivered.paid': 'Paid to driver',
  'track.rate.q': 'How did the driver do?',
  'track.rate.why': 'It decides who gets your next load.',
  'track.rate.thanks': 'Thank you.',
  'track.again': 'Send this route again',
  'track.home': 'Back to home',
  // ── P5 · the driver (D1–D7) ──────────────────────────────────────────────
  // Prefixed by a count. Singular and plural are separate keys because "1 loads
  // want your truck" is the first sentence a new driver reads.
  'drv.home.greeting.one': 'load wants your truck',
  'drv.home.greeting.some': 'loads want your truck',
  'drv.home.greeting.none': 'Nothing offered yet',
  // Home's headline while a load is taken. Offers wait on the Offers tab.
  'drv.home.onJob': 'Your job',
  'drv.home.week': '{amount} this week',
  'drv.money.keep': 'You keep',
  'drv.money.collect': 'Collect from the shipper',
  'drv.money.owe': 'To Truckkoo',
  // The spoken forms. `drv.money.keep` and the two above label the hero layout,
  // where each number sits under its own word; these carry the same facts as
  // sentences, for the row layout and for a screen reader.
  'drv.money.keepAria': 'You keep {amount}',
  'drv.money.split': 'Collect from the shipper {collect} · To Truckkoo {owed}',
  'drv.offer.fits': 'FITS YOUR TRUCK',
  'drv.offer.expires': 'Expires {when}',
  'drv.offer.take': 'Take it — {amount}',
  // The same button before a payout is known. Two keys rather than an empty
  // placeholder, because "Take it — " with nothing after it is worse than either.
  'drv.offer.take.bare': 'Take it',
  'drv.offer.details': 'See details',
  'drv.offer.pass': 'Pass',
  // "about", because a detour is great-circle distance between city centres on
  // roads that are neither straight nor centred. Same honesty rule as T4.
  //
  // One key, not four. The English order — about, number, unit, clause — is
  // correct English and merely plausible Arabic, and composing it at the call
  // site is what made it unfixable without touching a screen (OPEN_ISSUES 30).
  'drv.offer.detour': 'about {km} km extra on your route',
  // The row label on the detail screen, where the sentence above is the value.
  // It exists because `drv.offer.detour` used to be the trailing fragment and
  // was doing double duty as a label; a sentence cannot label itself.
  'drv.offer.detourLabel': 'Detour',
  'drv.offer.freeAfter': '{weight} free after this load',
  'drv.offer.gone': 'That offer has gone',
  'drv.none.title': 'An empty book here means an empty truck.',
  'drv.none.body':
    'We only send loads that sit on a route you have told us about. Add the trips you already drive and they start landing here.',
  'drv.none.add': 'Add a trip you are making',
  // While declared trips are hidden (src/lib/features.ts), the empty state
  // cannot sell them. It says what will happen instead.
  'drv.waiting.title': 'No loads for you yet',
  'drv.waiting.body': 'When a load fits your truck, it shows up here for you to take or pass.',
  // Past trips (0033).
  'drv.past.title': 'Past trips',
  'drv.past.month': 'This month',
  'drv.past.monthTotal': '{amount} · {count} trips',
  'drv.past.monthTotal.one': '{amount} · 1 trip',
  'drv.past.row': '{date} · {goods}',
  'drv.past.aria': '{origin} to {destination}, delivered {date}, {amount}',
  'drv.past.none.title': 'No trips yet',
  'drv.past.none.body': 'Loads you deliver appear here, with what each one paid.',
  'drv.route.q': 'Where are you driving?',
  'drv.route.help': 'We only send you loads that sit on this line.',
  'drv.route.from': 'LEAVING FROM',
  'drv.route.to': 'GOING TO',
  'drv.route.often': 'YOU DRIVE THESE OFTEN',
  'drv.when.q': 'When do you leave?',
  'drv.when.empty.q': 'Is the truck empty?',
  'drv.when.empty': 'Empty — I can take a load',
  'drv.when.empty.hint': 'All of it is free',
  'drv.when.part': 'Part loaded — some space left',
  'drv.when.part.hint': 'Tell us roughly how much',
  'drv.when.add': 'Add this route',
  'drv.routes.title': 'Your routes',
  'drv.routes.sub': 'We match loads to these',
  'drv.routes.empty': 'EMPTY',
  'drv.routes.part': 'PART LOADED',
  'drv.routes.notice':
    'A route with no load on it is a truck running for nothing. Add every trip you know about.',
  'drv.job.carrying': 'Carrying',
  'drv.job.dropAt': 'DROP AT',
  'drv.job.youEarn': 'YOU EARN',
  'drv.job.delivered': 'I have delivered it',
  'drv.job.problem': 'Report a problem',
  'drv.job.call': 'Call the shipper',
  'drv.job.open': 'Open this job',
  // ── P6 · where the truck is ──────────────────────────────────────────────
  'pos.now': 'just now',
  'pos.secondsAgo': '{seconds} s ago',
  'drv.trip.directionsTo': 'Directions to {city}',
  'pos.min': 'min ago',
  'pos.hour': 'h ago',
  'pos.day': 'd ago',
  'pos.none': 'No position yet',
  'pos.estimate': 'Estimated arrival',
  'pos.sharing': 'Sharing your position with the shipper',
  'pos.sharingWhy': 'Only while you are carrying this load.',
  'home.s2.q': 'Your first load starts with two cities.',
  'home.s2.body': 'Tell us where it is now and where it needs to be. A person prices it and comes back to you in minutes.',
  'home.search.title': 'Where is it going?',
  'home.search.hint': 'Pick two cities. We do the rest.',
  'home.onTheMove': 'ON THE MOVE',
  'home.again.title': 'Send this one again',
  'home.greeting': 'Hello',
  'country.OM': 'Oman',
  'country.AE': 'U.A.E.',
  'country.SA': 'Saudi Arabia',
  // Map orientation only — never a destination, so not `country.*`, which the
  // destination picker enumerates.
  'map.country.YE': 'Yemen',
  'map.country.IR': 'Iran',
  'map.sea.gulfOfOman': 'Gulf of Oman',
  'map.sea.arabianSea': 'Arabian Sea',
  'map.sea.arabianGulf': 'Arabian Gulf',
  'map.sea.hormuz': 'Strait of Hormuz',
  'book.cargo.q': 'What are we moving?',
  'book.cargo.help': 'A rough answer is fine. We confirm it with you.',
  'book.cargo.placeholder': 'Say what it is',
  'book.cargo.or': 'OR PICK ONE',
  'book.truck.q': 'How big a truck?',
  'book.truck.help': 'Not sure is a good answer. We do this every day.',
  'book.truck.auto': 'Let us choose for you',
  'book.truck.autoBody': 'We pick the size from what you are sending. Recommended.',
  'book.truck.or': 'OR SAY IT YOURSELF',
  'book.weight.optional': 'OPTIONAL',
  'book.weight.q': 'Roughly how heavy?',
  'book.weight.help': 'Kilograms. Skip it if you are not sure — it does not hold up the price.',
  'book.weight.unit': 'kg',
  'book.weight.cta': 'See the summary',
  'book.weight.skip': 'Skip — I do not know the weight',
  'book.review.title': 'Check this before we start',
  'book.review.collect': 'Collect on',
  'book.review.cargo': 'Cargo',
  'book.review.truck': 'Truck',
  'book.review.weight': 'Weight',
  'book.review.weWillChoose': 'We choose it',
  'book.review.notSaid': 'Not said',
  'book.review.estimateLabel': 'WHAT THIS SHOULD COST',
  'book.review.estimateWhy': 'A person confirms the exact number, usually within 10 minutes.',
  'book.review.noEstimate': 'A person prices this and comes back to you, usually within 10 minutes.',
  'book.review.nothingCharged': 'Nothing is charged now. You pay the driver on delivery.',
  'book.review.change': 'Change something',
  'book.review.incomplete': 'Finish these answers before we look for a truck.',
  'book.review.continue': 'Continue booking',
  'book.review.home': 'Back to home',
  'book.review.cta': 'Find me a truck',
  'book.review.priceLabel': 'YOUR PRICE',
  'book.review.priceWhy': 'This is the price. Book it and we send it to drivers straight away.',
  'book.review.bookFor': 'Book for {price}',
  'book.review.chosenFor': '{truck}, for {weight} kg',
  'book.weight.helpInstant': 'Kilograms. Tell us and you get a price straight away — skip it and a person prices it.',
  'drv.avail.on': 'You are available',
  'drv.avail.off': 'You are offline',
  'drv.avail.near': 'Near {city}',
  'drv.avail.unknown': 'Your town is not known yet',
  'drv.avail.goOn': 'Go available',
  'drv.avail.goOff': 'Go offline',
  'drv.avail.help': 'While you are available, loads near you come straight to this screen.',
  'drv.avail.why': 'Go available to get loads near you. We only use your location while you are available.',
  'loc.ask.q': 'Let Truckkoo see where your truck is, even when the app is closed?',
  'loc.ask.body': 'We use it to send you loads near you — only while you are available, and we keep only your latest location.',
  'loc.ask.android': 'On the next screen, choose “Allow all the time”.',
  'loc.ask.later': 'Not now',
  'loc.card.always': 'Location on · last sent {age}',
  'loc.card.waiting': 'Location on · waiting for the first reading',
  'loc.card.foreground': 'Location only while the app is open',
  'loc.card.none': 'Location off · you get loads near your town',
  'loc.card.turnOn': 'Turn on location',
  'loc.notify.title': 'You are available',
  'loc.notify.body': 'Sharing your location to find loads near you.',
  'drv.offer.minutesLeft': '{minutes} min left',
  'book.hours': 'h',
  'book.minutes': 'min',
  'book.posting': 'Posting your load',
  'book.failed': 'We could not post that. Try again in a moment.',
  'app.name': 'Truckkoo',
  'app.tagline': 'Driven. Delivered. Trusted.',
  'app.positioning': 'Connecting Oman to the GCC.',

  'role.shipper': 'I need to move cargo',
  'role.driver': 'I drive a truck',

  'load.submit': 'Request a quote',

  // ── route rail ────────────────────────────────────────────────────────────
  // The RouteRail's accessibility label. One key rather than a joining word
  // between two names: Arabic does not necessarily put the connective in the
  // same place, and a screen reader reads whatever order it is handed.
  'route.aria': '{origin} to {destination}',

  // ── sentences composed at a call site until P7 ────────────────────────────
  // Each of these replaced a template literal that concatenated fragments. The
  // unit lives inside the string so the translator can move or replace it —
  // `${n} km` renders a Latin "km" in Arabic copy.
  'home.greetingNamed': 'Hello, {name}',
  'home.search.aria': 'Where is it going? Pick two cities. We do the rest.',
  // The same words as `common.error.title` + `common.retry`, which is what this
  // replaced. A refactor is not the place to change what the app says.
  'common.error.aria': 'We could not load that. Try again',
  'book.aboutKm': 'about {km} km',
  'book.origin.ctaNamed': 'Pick up here — {city}',
  'places.search.placeholder': 'Search a place, area or company',
  'places.search.current': 'Use my current location',
  'places.search.locating': 'Finding where you are…',
  'places.search.or': 'OR CHOOSE A CITY',
  'places.search.none': 'No places found. Try another name, or choose a city.',
  'places.search.unavailable': "Search isn't working right now. Choose a city instead.",
  'places.pin.q': 'Put the pin on the gate',
  'places.pin.help': 'Move the map, not the pin.',
  'places.pin.near': 'Near {city}',
  'places.pin.unnamed': 'This spot',
  'places.pin.sameCity': 'Pickup and drop-off are both in {city}. Choose another place, or message us on WhatsApp.',
  'places.pin.noCity': "We couldn't check this spot. Choose a city instead.",
  'places.pin.chooseCity': 'Choose a city instead',
  'places.pin.confirmPickup': 'Confirm pickup',
  'places.pin.confirmDrop': 'Confirm drop-off',
  'places.details.q': 'Anything the driver should know?',
  'places.details.help': 'Optional. It helps the driver find the gate.',
  'places.details.note': 'e.g. Gate 3, behind the Shell station',
  'places.details.someonePickup': 'SOMEONE ELSE AT PICKUP?',
  'places.details.someoneDrop': 'WHO RECEIVES IT?',
  'places.details.name': 'Name',
  'places.details.phone': 'Phone number',
  'places.details.badPhone': 'Check the number: digits only, with + for the country code.',
  'places.details.skip': 'Skip',
  'places.review.pickup': 'Pickup: {place}',
  'places.review.drop': 'Drop-off: {place}',
  'places.call': 'Call {name}',
  'places.askFor': 'Ask for {name}',
  'places.review.contact': 'Ask for {name}: {phone}',
  'places.review.contactPhone': 'Contact: {phone}',
  'book.weight.value': '{weight} kg',
  'track.price.acceptNamed': 'Accept {amount}',
  'track.assigned.takingNamed': '{name} is taking your load.',
  'track.tripsCount': '{count} trips',
  'track.rate.starAria': '{n} stars',
  'pos.seenAgo': 'Seen {age}',
  'pos.lastSentAgo': 'Last sent {age}',
  'label.referenceNamed': 'Reference {ref}',

  'status.posted': 'Posted',
  'status.finding_truck': 'Finding you a truck',
  // The two P4 statuses. `quoted` is a question waiting for the shipper, so it
  // reads as one; `accepted` is the reassurance that their yes was received.
  'status.quoted': 'Price ready',
  'status.accepted': 'Finding your truck',
  'status.matched': 'Truck found',
  'status.assigned': 'Truck assigned',
  'status.in_transit': 'On the road',
  'status.delivered': 'Delivered',
  'status.closed': 'Complete',
  'status.cancelled': 'Cancelled',

  'whatsapp.action': 'WhatsApp us',

  'error.generic': 'Something went wrong. Please try again.',
  'error.offline': 'No connection. We saved this and will send it when you are back online.',

  // ── auth ──────────────────────────────────────────────────────────────────
  "auth.signIn.title": "Sign in",
  "auth.signIn.kicker": "Welcome back",
  "auth.signUp.title": "Create your account",
  "auth.signUp.kicker": "Two minutes, once",
  "auth.email": "Email address",
  "auth.email.placeholder": "you@company.com",
  "auth.password": "Password",
  "auth.password.placeholder": "At least 8 characters",
  "auth.name": "Your name",
  "auth.name.placeholder": "Full name",
  "auth.phone": "Mobile number",
  'auth.otp.phone.q': 'What is your WhatsApp number?',
  'auth.otp.phone.help': 'We send a one-time code over WhatsApp. If you already use email or Google, sign in the same way to keep your account.',
  'auth.otp.send': 'Send WhatsApp code',
  'auth.otp.code.q': 'Enter the code.',
  'auth.otp.code.help': 'Check WhatsApp on {phone}. Your code is private; never share it.',
  'auth.otp.code.label': 'One-time code',
  'auth.otp.verify': 'Confirm code',
  'auth.otp.resend': 'Send a new code',
  'auth.otp.resendWait': 'Send again in {seconds} seconds',
  'auth.otp.change': 'Change number',
  'auth.otp.email': 'Use email instead',
  'auth.otp.sendError': 'Could not send the code. Check your connection and WhatsApp number, then try again.',
  'auth.otp.codeError': 'That code could not be confirmed. Check it or ask for a new one.',
  'auth.otp.sending': 'Requesting your WhatsApp code…',
  'auth.otp.verifying': 'Checking your code…',
  "auth.phone.placeholder": "+968 …",
  "auth.phone.help": "So we can reach you about a load. We do not share it.",
  "auth.submit.signIn": "Sign in",
  "auth.submit.signUp": "Create account",
  "auth.toSignUp": "New to Truckkoo? Create an account",
  "auth.toSignIn": "Already have an account? Sign in",
  "auth.or": "or",
  "auth.google": "Continue with Google",
  "auth.apple": "Continue with Apple",
  "auth.signOut": "Sign out",
  'account.signOut.waiting': 'Signing out…',
  'account.signOut.failed': 'Could not sign out. Check your connection and try again.',
  "auth.checkEmail": "Check your email to confirm your account, then sign in.",

  "auth.role.title": "Which one are you?",
  "auth.role.help": "You pick this once. It cannot be changed later, so take a second.",
  "auth.role.shipper.title": "I have cargo to move",
  "auth.role.shipper.detail": "Say where it goes. We find the truck and come back with a price.",
  "auth.role.driver.title": "I drive a truck",
  "auth.role.driver.detail": "Tell us the trips you already make. We fill the empty space.",

  "auth.truck.title": "Your truck",
  "auth.truck.help": "We match loads to your truck size, so this has to be right.",
  // Shown when the truck-size list could not be loaded. Says what to do, not what
  // failed — and never leaves the step demanding a choice with nothing to choose.
  "auth.truck.unavailable": "We could not load the truck sizes. Check your connection and try again.",
  "auth.truck.plate": "Plate number",
  "auth.truck.plate.placeholder": "Optional",

  // ── P2 · getting in (N1–N6) ──────────────────────────────────────────────
  // INTERIM: N2/N3 ask for an email and a password until WhatsApp codes land.
  "auth.welcome.title": "Tell us where it needs to go.",
  "auth.welcome.body": "We find the truck already heading that way. Oman to the GCC, every day.",
  "auth.welcome.start": "Get started",
  "auth.welcome.signIn": "I already have an account",
  "auth.welcome.legal": "By continuing you agree to our terms. We never share your number.",
  "auth.email.q": "What is your email?",
  "auth.email.help.up": "You sign in with it. We never share it.",
  "auth.email.help.in": "The one you signed up with.",
  "auth.password.q.up": "Choose a password.",
  "auth.password.help.up": "At least 8 characters. Write it down somewhere safe.",
  "auth.password.q.in": "And your password.",
  "auth.password.show": "Show",
  "auth.password.hide": "Hide",
  "auth.password.showA11y": "Show the password",
  "auth.password.hideA11y": "Hide the password",
  "auth.signInInstead": "Sign in instead",
  "error.signUp.failed": "We could not make an account with that email. If you already have one, sign in instead.",
  "auth.role.cta.shipper": "I have cargo to move — continue",
  "auth.role.cta.driver": "I drive a truck — continue",
  "auth.name.q": "What should we call you?",
  "auth.name.help.shipper": "It goes on the paperwork, and it is what the driver will see.",
  "auth.name.help.driver": "It goes on the paperwork, and it is what the shipper will see.",
  "auth.phone.q": "What is your number?",
  "auth.phone.skip": "Skip — add it later",
  "error.phone.oman": "An Omani mobile number is 8 digits and starts with 7 or 9.",
  "auth.truck.q": "What do you drive, {name}?",
  "auth.truck.help.fit": "We only send you loads that fit. This has to be right.",
  "auth.truck.finish": "Finish setting up",
  "auth.done.title": "You are on, {name}.",
  "auth.done.titlePlain": "You are on.",
  "auth.done.body.driver": "Your documents are with our team. Once verified, matching loads can reach you.",
  "auth.done.body.shipper": "Tell us where your cargo is and where it needs to go. A person prices it and comes back to you in minutes.",
  "auth.done.cta.driver": "Add my first trip",
  "auth.done.cta.shipper": "Book my first load",
  "auth.done.later": "Not now",

  // ── errors ────────────────────────────────────────────────────────────────
  "error.email.invalid": "That does not look like an email address.",
  "error.password.short": "Use at least 8 characters.",
  "error.name.required": "Please tell us your name.",
  "error.role.required": "Please choose one.",
  "error.truck.required": "Please choose your truck size.",
  "error.signIn.failed": "That email and password did not match. Try again.",
  "error.oauth.unavailable": "That sign-in method is not switched on yet. Use your email for now.",

  // ── customer home ─────────────────────────────────────────────────────────
  "cust.newLoad": "Move something",
  "cust.empty.title": "Nothing moving yet",
  "cust.empty.explain": "Tell us what needs to go where. We will find a truck already heading that way — or arrange a fresh one.",
  "cust.empty.action": "Post your first load",
  "cust.section.active": "In progress",
  "cust.section.past": "Completed",

  // ── driver home ───────────────────────────────────────────────────────────
  "driver.masthead": "Today",
  "driver.trip.none.title": "No trip right now",
  "driver.trip.none.explain": "Tell us where you are driving next. When a load fits your route, it lands here.",
  "driver.postLeg": "Add a trip you are making",
  "driver.section.offers": "Loads offered to you",
  "driver.offers.none.title": "No offers yet",
  "driver.offers.none.explain": "Add the routes you already drive. We only send you loads that sit on them.",
  "driver.section.legs": "Your upcoming routes",
  // What the trip pays. "Pay" not "price": the shipper is quoted a price, the
  // driver is paid — same number, opposite side of the transaction, and the
  // driver's word for it is the one that belongs on their sheet.
  "driver.pay": "You will be paid",
  // Shown when no rate is set yet, which is every load until the rate card is
  // loaded. Names the next step and who owns it, rather than leaving a blank the
  // driver has to interpret.
  "driver.pay.pending": "Truckkoo will confirm the rate with you before pickup.",
  "driver.accept": "Accept this load",
  "driver.decline": "Not this one",
  // The payoff for the accept race being fixed server-side (0013). A driver who
  // taps Accept a second after someone else did needs to be told what happened —
  // "something went wrong" reads as a broken app and costs a driver's trust in
  // the one screen where they earn.
  "driver.offer.taken": "Another driver took this load.",
  "driver.advance.pickedUp": "I have collected it",
  "driver.advance.delivered": "Mark delivered",

  // ── navigation ────────────────────────────────────────────────────────────
  // Bottom tab labels. One word each, because the label sits under a 24px icon
  // at 11px and a second word wraps or truncates on a narrow phone. "Home" is
  // deliberately the same word for both roles — it is the same idea.
  "tab.home": "Home",
  "tab.loads": "Loads",
  "tab.offers": "Offers",
  "tab.routes": "Routes",
  "tab.past": "Past trips",
  "tab.account": "Account",

  // ── shipper home ──────────────────────────────────────────────────────────
  // The whole screen is one question. Everything else on it is either the answer
  // to a previous asking of that question, or a shortcut to asking it again.
  "home.hello": "Hello",
  "home.entry": "Where to?",
  "home.entry.hint": "Tell us pickup and delivery — we find the truck",
  "home.live": "Moving now",
  "home.again": "Send it again",
  "home.again.hint": "A route you have used before",
  "home.seeAll": "See all",

  // ── the loads tab ─────────────────────────────────────────────────────────
  "loads.title": "Your loads",
  "loads.seg.live": "Moving",
  "loads.seg.past": "Finished",

  // ── the driver's tabs ─────────────────────────────────────────────────────
  "offers.title": "Offered to you",
  "offers.hint": "Only loads that sit on a route you added",
  "routes.title": "Your routes",
  "routes.hint": "We match loads to these",
  "driver.trip.title": "Your trip",
  "driver.trip.next": "Next step",

  // ── account ───────────────────────────────────────────────────────────────
  // The one screen that is genuinely about the person rather than the freight.
  // It states only what the profile row actually holds — no tier, no rating, no
  // member-since. PRODUCT.md forbids inventing any of them.
  "account.title": "Account",
  "account.role.shipper": "You send cargo",
  "account.role.driver": "You drive a truck",
  "account.details": "Your details",
  "account.help": "Get help",
  "account.help.detail": "We reply in minutes, 7 days a week",
  "account.language": "Language",
  "account.language.hint": "Restart the app after changing this",
  // Shown by the root layout when a launch boots in the wrong direction — the
  // flag that fixes it only lands on the next launch. No "restart" jargon.
  "app.direction.reopen": "Close Truckkoo and open it again. The screen will then face the right way.",

  // ── stepped flows ─────────────────────────────────────────────────────────
  // Both posting flows are now a sequence of one-question screens with a pinned
  // action, rather than one long scroll. Each step needs its own title, because
  // the title IS the question.
  "action.back": "Back",

  "driver.routes.title": "Routes you have declared",
  "driver.routes.none.title": "No routes declared",
  "driver.routes.none.explain": "Add where you are driving next. We only offer you loads that already sit on one of your routes — so an empty book here means an empty truck.",
  "driver.offer.sheet": "Load offered to you",
  // Stamp text sits in a pill beside a route, so it has to survive at four or
  // five characters. The long form stays on the post-a-leg question.
  "leg.stamp.empty": "Empty",
  "leg.stamp.part": "Part load",
  "label.replyBy": "Reply by",

  // ── the completed consignment note ─────────────────────────────────────────
  // A finished load is a document, not a dead list row. These strings are the
  // record a business keeps: settlement happens offline, so this is what closes
  // an invoice or settles a dispute.
  // ── the review step, before the load is posted ─────────────────────────────
  // The price used to arrive after the shipper had already committed. Seeing it
  // first is the difference between booking and phoning someone to ask.
  // The three no-price outcomes reuse the price.* sentences, so the wording a
  // shipper sees before posting matches what they see afterwards.

  "note.title": "Consignment note",
  "note.carrier": "Carried by",
  "note.query": "Ask us about this job",
  "note.pod.alt": "Photograph taken at delivery",
  "note.missing.title": "We cannot find that job",
  "note.missing.explain": "It may have been cancelled, or it belongs to another account. Your finished jobs are listed on your home screen.",
  "note.open": "See the full note",

  "cust.record.title": "Finished loads",
  "cust.record.none.title": "Nothing finished yet",
  "cust.record.none.explain": "Delivered and cancelled loads are kept here.",
  "cust.finding.explain": "We are looking for a truck already heading that way. If nothing fits, we arrange a fresh trip — you will not be left without an answer.",

  // ── the price ──────────────────────────────────────────────────────────────
  // The button has always said "Request a quote"; these are the strings that
  // finally answer it.
  //
  // Every no-price case says what happens NEXT, never what failed. PRODUCT.md:
  // "errors that say what to do next rather than what went wrong", for an
  // audience with near-zero tech skills. None of these three is the shipper's
  // fault and none of them is a dead end — a person is pricing it either way, so
  // the copy says so plainly rather than hedging.
  "price.title": "Price",
  "price.action": "Get a price",
  "price.retry": "Ask again",
  // Shown while no quote exists yet. Deliberately not "no price" — the absence is
  // a step not yet taken, not a result.
  "price.none.explain": "Ask us for a price and we will come straight back.",
  // The three server outcomes, in the shipper's language rather than the schema's.
  // Prefixes a formatted date. Not "expires": a held price is a promise Truckkoo
  // is keeping, and "expires" reads as a threat to hurry up.
  "price.heldUntil": "Price held until {when}",
  // Says only what is certainly true: nothing is charged here. Who collects and
  // how is a real commercial fact that no document in this repo states, so this
  // string does not invent one — and PRODUCT.md forbids implying any in-app
  // charge, saved card, or wallet.
  "price.settle": "Nothing is charged in the app. We arrange payment with you directly.",

  // ── the shipper's view of who is carrying it ───────────────────────────────
  // PRODUCT.md Principle #4: show the truck and the person. "Verified" is the
  // public claim ("100% verified drivers") made concrete for the one person
  // relying on it.
  "cust.driver.title": "Your driver",
  "cust.driver.verified": "Verified",
  "cust.driver.call": "Message your driver",
  "cust.progress.title": "Progress",
  "cust.pod.title": "Proof of delivery",
  "label.plate": "Plate",

  // trip_events.type values, per the check constraint on the table.
  "event.picked_up": "Collected",
  "event.en_route": "On the road",
  "event.delivered": "Delivered",
  "event.note": "Note",

  // ── shared labels ─────────────────────────────────────────────────────────
  "label.from": "From",
  "label.to": "To",
  "label.goods": "Goods",
  "label.driver": "Driver",
  "label.dates": "Dates",
  "label.load": "Consignment note",
  "label.trip": "Current trip",
  "label.offer": "Load offer",
  "label.leg": "Your route",
  "common.retry": "Try again",
  "common.loading": "Loading…",
  "common.error.title": "We could not load that",
  "common.error.explain": "Check your connection and try again. Nothing was lost.",

  // The accessible name of a dismiss X, in the picker sheet and on X2's
  // language sheet. It said "Done" until P7, which is what a screen reader
  // announced for a control that commits nothing and discards the sheet.
  "common.close": "Close",
  "common.back": "Back",

  "auth.reset.title": "Set a new password",
  "auth.reset.explain": "Choose a new password. You will be signed in straight after.",
  "auth.reset.password": "New password",
  "auth.reset.submit": "Save new password",
  "auth.reset.invalid": "This link is not valid. Ask for a new one from the sign-in screen.",
  "error.reset.expired": "That link has expired. Ask for a new one from the sign-in screen.",

  "auth.confirm.title": "Confirming your email",
  "auth.confirm.working": "One moment.",
  "auth.confirm.invalid": "This link is not valid. Sign in and we will send a new one.",
  "error.confirm.expired": "That link has expired. Sign in and we will send a new one.",

  "auth.forgot": "Forgot your password?",
  "auth.forgot.needEmail": "Type your email above first, then tap this again.",
  "auth.forgot.sent": "If that email has an account, we have sent a reset link to it. Check your inbox.",


  // ── post a load ───────────────────────────────────────────────────────────
  "post.load.title": "What needs moving?",

  // ── post a leg ────────────────────────────────────────────────────────────
  "post.leg.title": "Where are you driving?",
  "post.leg.submit": "Add this route",
  "post.leg.date": "When do you leave?",
  "post.leg.empty": "Is the truck empty?",
  "post.leg.empty.yes": "Empty — I can take a load",
  "post.leg.empty.no": "Part loaded — some space left",
  "post.leg.help": "We only send you loads that sit on a route you have added.",

  // ── trip ──────────────────────────────────────────────────────────────────
  "trip.title": "Current trip",
  "trip.collect.title": "Have you collected the load?",
  "trip.collect.explain": "Only mark this once the cargo is on your truck.",
  "trip.collect.action": "Yes, it is loaded",
  "trip.deliver.title": "Delivered?",
  "trip.deliver.explain": "Take one photo of the delivered cargo. This is your proof, and it cannot be changed afterwards.",
  "trip.deliver.photo": "Take photo",
  "trip.deliver.retake": "Take a different photo",
  "trip.deliver.action": "Confirm delivery",
  "trip.deliver.needPhoto": "A photo is required before you can mark this delivered.",
  "trip.photo.denied": "We need camera access to take proof of delivery. You can turn it on in Settings.",
  "trip.uploading": "Sending…",

  // ── bidding (0045, 2026-10-04) ────────────────────────────────────────────
  'book.target.optional': 'OPTIONAL',
  'book.target.q': 'What is the most you want to pay?',
  'book.target.help': 'Drivers name their price. If the cheapest is at or under this, we take it for you when bidding ends. Drivers never see this number.',
  'book.target.unit': 'OMR',
  'book.target.cta': 'See the summary',
  'book.target.skip': 'Skip — I will choose from the prices',
  'money.invalid': 'Type an amount like 120 or 120.500.',
  'book.review.bidLabel': 'HOW IT IS PRICED',
  'book.review.bidWhy': 'Drivers heading your way name their price over the next hour. You choose — or we take the cheapest one within your limit.',
  'book.review.target': 'Most you will pay',
  'book.review.noTarget': 'You choose',
  'book.review.bidCta': 'Ask drivers for prices',
  'bid.open.pill': 'TAKING PRICES',
  'bid.open.none': 'Drivers are looking at your load. Their prices will appear here — no need to keep the app open.',
  'bid.closes': 'Prices close {when}',
  'bid.closesIn': 'Prices close in {minutes} min',
  'status.bidding': 'Taking prices',
  'bid.count': 'Prices so far: {count}',
  'bid.choose': 'CHOOSE A PRICE',
  'bid.row.gone': 'No longer available',
  'bid.target': 'Your limit is {amount}. When prices close we take the cheapest at or under it.',
  'bid.target.none': 'No limit set — you choose when prices close.',
  'bid.closeNow': 'Stop taking prices',
  'bid.manage.title': 'YOUR PRICE SETTINGS',
  'bid.manage.limit': 'Change my limit',
  'bid.manage.saveLimit': 'Save limit',
  'bid.manage.clearLimit': 'Remove limit',
  'bid.manage.extend': 'Give drivers 30 more minutes',
  'bid.manage.close': 'Finish collecting prices',
  'bid.manage.closeExplain': 'If a price is within your limit, we may book that driver now. Otherwise you will choose.',
  'bid.manage.closeConfirm': 'Finish now',
  'bid.manage.unavailable': 'That change could not be made. Refresh the load and try again.',
  'bid.gone': 'That price is no longer available. Choose another.',
  'bid.best.label': 'BEST PRICE',
  'bid.best.from': 'From {name}',
  'bid.others': 'OTHER PRICES',
  'drv.bid.pill': 'NAME YOUR PRICE',
  'drv.bid.yours': 'Your price: {amount}',
  'drv.bid.none': 'You have not named a price yet',
  'drv.bid.cta': 'Name your price',
  'drv.bid.change': 'Change your price',
  'drv.bid.others': 'OTHER DRIVERS',
  'drv.bid.othersNone': 'No other prices yet.',
  'drv.bid.row': 'Driver {n}',
  'drv.bid.rowYou': 'You',
  'drv.bid.how': 'The shipper sees every price and chooses. Names are never shown.',
  'drv.bid.gone': 'Prices on this load have closed.',
  'drv.bid.q': 'How much do you want for this trip?',
  'drv.bid.help': 'What you keep, in rial. You can change it until prices close.',
  'drv.bid.lowest': 'Lowest so far: {amount}',
  'drv.bid.submit': 'Send {amount}',
  'drv.bid.submit.bare': 'Send my price',
  'drv.bid.notEligible': 'You cannot send a price right now — check you are online and not on another job.',

  // ── push notifications (0046, 2026-10-04) ─────────────────────────────────
  'push.channel': 'Jobs and deliveries',
  'push.ask.q': 'Get a buzz when something happens?',
  'push.ask.shipper': 'We tell you when a driver names a price, takes your load, picks it up and delivers it. Nothing else.',
  'push.ask.driver': 'We tell you the moment a job comes in, and when you get one. Nothing else.',
  'push.ask.cta': 'Turn on notifications',
  'push.ask.later': 'Not now',
  'push.ask.settings': 'Your phone will open Settings — switch notifications on for Truckkoo there.',
  'push.row': 'Notifications',
  'push.row.on': 'On',
  'push.row.off': 'Off — tap to turn on',
  'auth.capacity.q': 'What is your maximum load in kilograms?',
  'auth.capacity.help': 'Use the truck’s legal load limit. We only send loads that fit.',
  'auth.capacity.placeholder': 'For example, 10000',
  'auth.plate.q': 'What is your truck’s plate number?',
  'auth.plate.help': 'Enter the plate printed on the mulkiya.',
  'auth.plate.placeholder': 'Plate number',
  'auth.verify.id_front': 'Photograph the front of your ID card.',
  'auth.verify.id_back': 'Photograph the back of your ID card.',
  'auth.verify.mulkiya': 'Photograph your vehicle licence (mulkiya).',
  'auth.verify.truck_photo': 'Photograph your truck.',
  'auth.verify.help': 'Keep all four corners visible. Only appointed Truckkoo staff review these private photos.',
  'auth.verify.camera': 'Take photo',
  'auth.verify.gallery': 'Choose from photos',
  'auth.verify.change': 'Choose a different photo',
  'auth.verify.upload': 'Send photo',
  'auth.verify.done': 'Done — wait for review',
  'auth.verify.status.pending': 'Received — waiting for review',
  'auth.verify.status.approved': 'Approved',
  'auth.verify.status.rejected': 'Please send a new photo',
  'auth.verify.format': 'Use a JPG, PNG or WebP photo.',
  'auth.verify.size': 'Choose a photo smaller than 8 MB.',
  'auth.verify.unavailable': 'Could not send or load your photo. Check your connection and try again.',
  'account.verification': 'Driver verification',
  'account.verification.open': 'Check or send documents',
  'drv.verify.finish': 'Finish your documents',
  'drv.verify.pending': 'Checking your papers',
  'drv.verify.open': 'Open driver verification',
  'case.report': 'Report a problem',
  'case.q': 'What happened?',
  'case.help': 'Truckkoo dispatch will read this and contact you. For danger or an emergency, call local emergency services first.',
  'case.kind.delay': 'Delay',
  'case.kind.breakdown': 'Truck breakdown',
  'case.kind.damage': 'Cargo damage',
  'case.kind.other': 'Something else',
  'case.details': 'Tell us what happened',
  'case.cta': 'Send to dispatch',
  'case.error': 'Could not send the report. Check your connection and try again.',
  'case.cancel.action': 'Cancel this load',
  'case.cancel.q': 'Why do you need to cancel?',
  'case.cancel.help': 'Before assignment we cancel it now. If a driver has it, dispatch will handle the request with you.',
  'case.cancel.cta': 'Request cancellation',
  'case.sent': 'Report sent. Dispatch will contact you.',
  'case.cancel.done': 'Load cancelled.',
  'case.cancel.queued': 'Request sent. Dispatch will contact you.',
} as const;

export type StringKey = keyof typeof en;

/**
 * Arabic. Partial on purpose — phase 2 completes it. Values here are the
 * website's own copy.
 */
const ar: Partial<Record<StringKey, string>> = {
  // ── P3 · the booking flow ────────────────────────────────────────────────
  'book.origin.q': 'أين الشحنة الآن؟',
  'book.origin.help': 'اختر مدينة على الخريطة، أو ابحث عنها.',
  'book.origin.search': 'ابحث في ٤٦ مدينة',
  'book.origin.cta': 'الاستلام من هنا',
  'book.dest.q': 'وإلى أين تريد توصيلها؟',
  'book.dest.help': 'نجد لك الشاحنة المتجهة إلى هناك.',
  'book.dest.pickup': 'الاستلام',
  'book.dest.deliver': 'التسليم',
  'book.dest.swap': 'تبديل الاستلام والتسليم',
  'book.dest.recent': 'وجهات سابقة',
  'book.dest.border': 'أوراق الحدود علينا. أضف يوماً إضافياً للعبور.',
  'book.date.q': 'متى نأتي لأخذ الشحنة؟',
  'book.date.today': 'اليوم',
  'book.date.tomorrow': 'غداً',
  'book.date.other': 'يوم آخر',
  'book.date.more': 'عرض أيام أخرى',
  'action.continue': 'متابعة',
  // ── P4 · التتبع ──────────────────────────────────────────────────────────
  'track.looking.pill': 'جاري البحث',
  'track.looking.body': 'نسأل الشاحنات التي لديها مساحة. سيصلك السعر هنا — لا حاجة لإبقاء التطبيق مفتوحاً.',
  'track.step.received': 'تم استلام الشحنة',
  'track.step.matching': 'البحث عن شاحنة',
  'track.step.matchingHint': 'عادةً أقل من ٢٠ دقيقة',
  'track.step.price': 'سعرك، للموافقة',
  'track.step.priceDone': 'تمت الموافقة على السعر',
  'track.step.truck': 'تأكيد الشاحنة',
  'track.accepted.q': 'جاري إيجاد شاحنتك.',
  'track.accepted.body': 'تم الاتفاق على السعر. نعرضها الآن على السائقين المتجهين إلى هناك.',
  'track.price.label': 'سعرك',
  'track.price.accept': 'موافق على',
  'track.price.pay': 'تدفع للسائق عند التسليم',
  'track.price.no': 'لا، شكراً',
  'track.price.ask': 'اسأل سؤالاً',
  'track.assigned.label': 'الاستلام',
  'track.assigned.prep': 'جهّز الشحنة وشخصاً عند البوابة. سيتصل السائق قبل وصوله.',
  'track.assigned.call': 'اتصل بالسائق',
  'track.transit.arriving': 'الوصول إلى',
  'track.transit.toPay': 'للدفع عند التسليم',
  'track.delivered.title': 'تم التسليم.',
  'track.delivered.ref': 'الرقم المرجعي',
  'track.delivered.paid': 'المدفوع للسائق',
  'track.rate.q': 'كيف كان أداء السائق؟',
  'track.rate.why': 'هذا يحدد من يحصل على شحنتك القادمة.',
  'track.rate.thanks': 'شكراً لك.',
  'track.again': 'أرسل هذا المسار مرة أخرى',
  'track.home': 'العودة للرئيسية',
  // ── P5 · the driver (D1–D7) ──────────────────────────────────────────────
  'drv.home.greeting.one': 'شحنة تريد شاحنتك',
  'drv.home.greeting.some': 'شحنات تريد شاحنتك',
  'drv.home.greeting.none': 'لا توجد عروض بعد',
  // Every value in this block is ASSEMBLED from fragments already in this file
  // — `حوالي`, `إضافية على مسارك`, `ينتهي`, `خذها`, `تحتفظ بـ` are the website's
  // own words, moved rather than rewritten, with `كم` for the unit.
  // FLAG FOR PROOFING: assembling is still a translation act.
  'drv.home.week': '{amount} هذا الأسبوع',
  'drv.money.keep': 'تحتفظ بـ',
  'drv.money.collect': 'تحصّلها من الشاحن',
  'drv.money.owe': 'لتراكو',
  'drv.money.keepAria': 'تحتفظ بـ {amount}',
  'drv.money.split': 'تحصّلها من الشاحن {collect} · لتراكو {owed}',
  'drv.offer.fits': 'مناسبة لشاحنتك',
  'drv.offer.expires': 'ينتهي {when}',
  'drv.offer.take': 'خذها — {amount}',
  'drv.offer.take.bare': 'خذها',
  'drv.offer.details': 'التفاصيل',
  'drv.offer.pass': 'تجاوز',
  'drv.offer.detour': 'حوالي {km} كم إضافية على مسارك',
  'drv.offer.freeAfter': '{weight} متبقية بعد هذه الشحنة',
  'drv.offer.gone': 'هذا العرض لم يعد متاحاً',
  'drv.none.title': 'الدفتر الفارغ هنا يعني شاحنة فارغة.',
  'drv.none.body':
    'نرسل لك فقط الشحنات التي تقع على مسار أخبرتنا به. أضف الرحلات التي تقودها أصلاً وستبدأ بالوصول إلى هنا.',
  'drv.none.add': 'أضف رحلة ستقوم بها',
  'drv.route.q': 'إلى أين تقود؟',
  'drv.route.help': 'نرسل لك فقط الشحنات التي تقع على هذا الخط.',
  'drv.route.from': 'الانطلاق من',
  'drv.route.to': 'الوصول إلى',
  'drv.route.often': 'تقود هذه كثيراً',
  'drv.when.q': 'متى تنطلق؟',
  'drv.when.empty.q': 'هل الشاحنة فارغة؟',
  'drv.when.empty': 'فارغة — يمكنني أخذ شحنة',
  'drv.when.empty.hint': 'كلها متاحة',
  'drv.when.part': 'محمّلة جزئياً — تبقى مساحة',
  'drv.when.part.hint': 'أخبرنا تقريباً بالمساحة المتبقية',
  'drv.when.add': 'أضف هذا المسار',
  'drv.routes.title': 'مساراتك',
  'drv.routes.sub': 'نطابق الشحنات مع هذه',
  'drv.routes.empty': 'فارغة',
  'drv.routes.part': 'محمّلة جزئياً',
  'drv.routes.notice': 'مسار بلا شحنة يعني شاحنة تسير بلا مقابل. أضف كل رحلة تعرفها.',
  'drv.job.carrying': 'تحمل',
  'drv.job.dropAt': 'التسليم في',
  'drv.job.youEarn': 'تكسب',
  'drv.job.delivered': 'قمت بالتسليم',
  'drv.job.problem': 'الإبلاغ عن مشكلة',
  'drv.job.call': 'اتصل بالشاحن',
  // ── P6 · where the truck is ──────────────────────────────────────────────
  'pos.now': 'الآن',
  'pos.min': 'دقيقة مضت',
  'pos.hour': 'ساعة مضت',
  'pos.day': 'يوم مضى',
  'pos.none': 'لا يوجد موقع بعد',
  'pos.estimate': 'الوصول المتوقع',
  'pos.sharing': 'تتم مشاركة موقعك مع الشاحن',
  'pos.sharingWhy': 'فقط أثناء نقلك لهذه الشحنة.',
  'status.quoted': 'السعر جاهز',
  'status.accepted': 'جاري إيجاد شاحنتك',
  'home.s2.q': 'أول شحنة تبدأ بمدينتين.',
  'home.s2.body': 'أخبرنا أين هي الآن وإلى أين تحتاج أن تصل. يقوم أحد موظفينا بتسعيرها ويعود إليك خلال دقائق.',
  'home.search.title': 'إلى أين تريد النقل؟',
  'home.search.hint': 'اختر مدينتين ونحن نتولى الباقي.',
  'home.onTheMove': 'قيد التنفيذ',
  'home.again.title': 'أرسل هذه مرة أخرى',
  'home.greeting': 'مرحباً',
  'country.OM': 'عُمان',
  'country.AE': 'الإمارات',
  'country.SA': 'السعودية',
  'book.cargo.q': 'ما الذي ننقله؟',
  'book.cargo.help': 'إجابة تقريبية تكفي. سنؤكدها معك.',
  'book.cargo.placeholder': 'اذكر نوع الشحنة',
  'book.cargo.or': 'أو اختر واحداً',
  'book.truck.q': 'ما حجم الشاحنة؟',
  'book.truck.help': '«لست متأكداً» إجابة جيدة. نحن نقوم بهذا يومياً.',
  'book.truck.auto': 'اتركوا الاختيار لنا',
  'book.truck.autoBody': 'نختار الحجم بناءً على ما ترسله. موصى به.',
  'book.truck.or': 'أو حدد بنفسك',
  'book.weight.optional': 'اختياري',
  'book.weight.q': 'كم يزن تقريباً؟',
  'book.weight.help': 'بالكيلوغرام. تجاوزها إن لم تكن متأكداً — لن تؤخر السعر.',
  'book.weight.unit': 'كجم',
  'book.weight.cta': 'عرض الملخص',
  'book.weight.skip': 'تجاوز — لا أعرف الوزن',
  'book.review.title': 'راجع هذا قبل أن نبدأ',
  'book.review.collect': 'الاستلام في',
  'book.review.cargo': 'الشحنة',
  'book.review.truck': 'الشاحنة',
  'book.review.weight': 'الوزن',
  'book.review.weWillChoose': 'نحن نختارها',
  'book.review.notSaid': 'غير محدد',
  'book.review.estimateLabel': 'التكلفة المتوقعة',
  'book.review.estimateWhy': 'يؤكد أحد موظفينا الرقم النهائي، عادةً خلال ١٠ دقائق.',
  'book.review.noEstimate': 'يقوم أحد موظفينا بتسعيرها ويعود إليك، عادةً خلال ١٠ دقائق.',
  'book.review.nothingCharged': 'لا يوجد خصم الآن. تدفع للسائق عند التسليم.',
  'book.review.change': 'تعديل شيء ما',
  'book.review.cta': 'ابحث لي عن شاحنة',
  'book.hours': 'س',
  'book.minutes': 'د',
  'book.posting': 'جاري نشر شحنتك',
  'book.failed': 'تعذّر النشر. حاول بعد لحظات.',

  'app.name': 'تركو',
  'app.tagline': 'قيادة. توصيل. ثقة.',
  'app.positioning': 'نربط عُمان بدول الخليج.',

  // ASSEMBLED from fragments already in this file — `إلى`, `حوالي`, `كجم`,
  // `مرحباً`, `شوهدت`, `آخر إرسال`, `رحلة` — moved rather than rewritten.
  // FLAG FOR PROOFING: assembling is still a translation act.
  'route.aria': '{origin} إلى {destination}',
  'home.greetingNamed': 'مرحباً، {name}',
  'book.aboutKm': 'حوالي {km} كم',
  'book.weight.value': '{weight} كجم',
  'track.tripsCount': '{count} رحلة',
  'pos.seenAgo': 'شوهدت {age}',
  'pos.lastSentAgo': 'آخر إرسال {age}',

  'whatsapp.action': 'واتساب',


  "auth.signIn.title": "تسجيل الدخول",
  "auth.email": "البريد الإلكتروني",
  "auth.password": "كلمة المرور",
  "auth.name": "الاسم",
  "auth.phone": "رقم الهاتف",
  'auth.otp.phone.q': 'ما رقمك على واتساب؟',
  'auth.otp.phone.help': 'نرسل رمزاً لمرة واحدة عبر واتساب. إذا كنت تستخدم البريد أو جوجل، ادخل بالطريقة نفسها للاحتفاظ بحسابك.',
  'auth.otp.send': 'أرسل رمز واتساب',
  'auth.otp.code.q': 'أدخل الرمز.',
  'auth.otp.code.help': 'افتح واتساب على {phone}. الرمز خاص؛ لا تشاركه مع أحد.',
  'auth.otp.code.label': 'رمز لمرة واحدة',
  'auth.otp.verify': 'أكد الرمز',
  'auth.otp.resend': 'أرسل رمزاً جديداً',
  'auth.otp.resendWait': 'أرسل مجدداً بعد {seconds} ثانية',
  'auth.otp.change': 'غيّر الرقم',
  'auth.otp.email': 'استخدم البريد بدلاً من ذلك',
  'auth.otp.sendError': 'تعذّر إرسال الرمز. تحقق من الاتصال ورقم واتساب وحاول مجدداً.',
  'auth.otp.codeError': 'تعذّر تأكيد الرمز. تحقّق منه أو اطلب رمزاً جديداً.',
  'auth.otp.sending': 'نطلب رمز واتساب…',
  'auth.otp.verifying': 'نتحقق من الرمز…',
  "auth.signOut": "تسجيل الخروج",
  "label.from": "من",
  "label.to": "إلى",
  "label.goods": "نوع البضاعة",
  "action.back": "رجوع",
  // Driver-facing, and it appears at the worst possible moment.
  "driver.offer.taken": "سائق آخر أخذ هذه الحمولة.",

  /* ─── HARVESTED · P7 ──────────────────────────────────────────────────────
   * Lifted from the live bilingual site (`~/truckkoo`) or from the handoff's
   * X3 and X4, which specify finished Arabic for a whole home screen and a
   * whole question screen. Verbatim, or assembled from words already above.
   * ──────────────────────────────────────────────────────────────────────── */

  // Tab labels, greeting and states — all quoted directly in the handoff's X3.
  'tab.home': 'الرئيسية',
  'tab.loads': 'الشحنات',
  'tab.account': 'حسابي',
  'home.hello': 'مرحباً',
  'home.live': 'قيد التنفيذ',
  'home.seeAll': 'عرض الكل',
  'status.finding_truck': 'جاري البحث عن شاحنة',
  'cust.section.active': 'قيد التنفيذ',
  // X4's date blocks and its continue button.
  // The site's own public commitments. These are claims the company already
  // makes in Arabic, so they are not ours to reword (CLAUDE.md #5).
  'account.help.detail': 'نرد خلال دقائق · طوال أيام الأسبوع',
  'cust.driver.verified': 'موثّق',
  // Assembled from words already in this file.
  'loads.title': 'شحناتك',
  'account.title': 'حسابي',
  'account.language': 'اللغة',
  'account.details': 'بياناتك',
  'account.help': 'المساعدة',
  'account.role.shipper': 'أنت ترسل بضائع',
  'account.role.driver': 'أنت تقود شاحنة',
  'label.driver': 'السائق',
  'label.dates': 'التواريخ',
  'label.plate': 'رقم اللوحة',
  'common.back': 'رجوع',
  'common.close': 'إغلاق',
  'common.retry': 'حاول مرة أخرى',
  'common.loading': 'جارٍ التحميل…',
  'price.title': 'السعر',
  'event.delivered': 'تم التسليم',
  'status.delivered': 'تم التسليم',
  'trip.title': 'الرحلة الحالية',
  'label.trip': 'الرحلة الحالية',

  /* ─── UNPROOFED DRAFTS · P7 ───────────────────────────────────────────────
   * NOT lifted from the website and NOT assembled from existing fragments.
   *
   * EVERY STRING BELOW NEEDS A NATIVE ARABIC READER BEFORE LAUNCH. They exist
   * so that no screen falls back to English mid-sentence and so the proof-sheet
   * has something to review; they do not constitute a claim that the Arabic is
   * right. `npm run preview:rtl` lays them out for that review, and the count is
   * tracked in OPEN_ISSUES.
   *
   * Kept in one block on purpose. Scattered among the harvested strings, a
   * reviewer would have to read all 387 lines looking for the ones that need
   * attention; here they read one section.
   * ──────────────────────────────────────────────────────────────────────── */

  'drv.offer.detourLabel': 'الانعطاف',
  'role.shipper': 'أحتاج نقل بضائع',
  'role.driver': 'أقود شاحنة',
  'load.submit': 'اطلب عرض سعر',
  'home.search.aria': 'إلى أين تريد النقل؟ اختر مدينتين ونحن نتولى الباقي.',
  'common.error.aria': 'تعذّر تحميل ذلك. حاول مرة أخرى',
  'book.origin.ctaNamed': 'الاستلام من هنا — {city}',
  'track.price.acceptNamed': 'موافق على {amount}',
  'track.assigned.takingNamed': '{name} سيأخذ شحنتك.',
  'track.rate.starAria': '{n} نجوم',
  'label.referenceNamed': 'المرجع {ref}',

  'status.posted': 'تم الإرسال',
  'status.matched': 'وُجدت شاحنة',
  'status.assigned': 'تم تعيين شاحنة',
  'status.in_transit': 'على الطريق',
  'status.closed': 'مكتملة',
  'status.cancelled': 'ملغاة',

  'error.generic': 'حدث خطأ ما. حاول مرة أخرى.',
  'error.offline': 'لا يوجد اتصال. حفظنا هذا وسنرسله عند عودة الاتصال.',

  'auth.signIn.kicker': 'أهلاً بعودتك',
  'auth.signUp.title': 'أنشئ حسابك',
  'auth.signUp.kicker': 'دقيقتان، مرة واحدة',
  'auth.email.placeholder': 'you@company.com',
  'auth.password.placeholder': '٨ أحرف على الأقل',
  'auth.name.placeholder': 'الاسم الكامل',
  'auth.phone.placeholder': '‎+968 …',
  'auth.phone.help': 'لنتواصل معك بخصوص الشحنة. لا نشاركه مع أحد.',
  'auth.submit.signIn': 'تسجيل الدخول',
  'auth.submit.signUp': 'إنشاء حساب',
  'auth.toSignUp': 'جديد في تركو؟ أنشئ حساباً',
  'auth.toSignIn': 'لديك حساب بالفعل؟ سجّل الدخول',
  'auth.or': 'أو',
  'auth.google': 'المتابعة عبر جوجل',
  'auth.apple': 'المتابعة عبر آبل',
  'auth.checkEmail': 'تحقق من بريدك لتأكيد حسابك، ثم سجّل الدخول.',
  'auth.role.title': 'أيّهما أنت؟',
  'auth.role.help': 'تختار هذا مرة واحدة ولا يمكن تغييره لاحقاً، فخذ لحظة.',
  'auth.role.shipper.title': 'لدي بضائع لنقلها',
  'auth.role.shipper.detail': 'أخبرنا إلى أين تذهب. نجد الشاحنة ونعود إليك بالسعر.',
  'auth.role.driver.title': 'أقود شاحنة',
  'auth.role.driver.detail': 'أخبرنا بالرحلات التي تقوم بها أصلاً. نحن نملأ المساحة الفارغة.',
  'auth.truck.title': 'شاحنتك',
  'auth.truck.help': 'نطابق الشحنات مع حجم شاحنتك، لذا يجب أن يكون هذا صحيحاً.',
  'auth.truck.unavailable': 'تعذّر تحميل أحجام الشاحنات. تحقق من الاتصال وحاول مرة أخرى.',
  'auth.truck.plate': 'رقم اللوحة',
  'auth.truck.plate.placeholder': 'اختياري',
  'auth.reset.title': 'اضبط كلمة مرور جديدة',
  'auth.reset.explain': 'اختر كلمة مرور جديدة. سيتم تسجيل دخولك مباشرة بعدها.',
  'auth.reset.password': 'كلمة المرور الجديدة',
  'auth.reset.submit': 'حفظ كلمة المرور',
  'auth.reset.invalid': 'هذا الرابط غير صالح. اطلب رابطاً جديداً من شاشة تسجيل الدخول.',
  'auth.confirm.title': 'جارٍ تأكيد بريدك',
  'auth.confirm.working': 'لحظة واحدة.',
  'auth.confirm.invalid': 'هذا الرابط غير صالح. سجّل الدخول وسنرسل رابطاً جديداً.',
  'auth.forgot': 'نسيت كلمة المرور؟',
  'auth.forgot.needEmail': 'اكتب بريدك أعلاه أولاً، ثم اضغط هنا مرة أخرى.',
  'auth.forgot.sent': 'إذا كان لهذا البريد حساب، فقد أرسلنا إليه رابط إعادة التعيين. تحقق من بريدك.',

  'auth.welcome.title': 'أخبرنا إلى أين يجب أن تذهب.',
  'auth.welcome.body': 'نجد الشاحنة المتجهة إلى هناك أصلاً. من عُمان إلى الخليج، كل يوم.',
  'auth.welcome.start': 'ابدأ',
  'auth.welcome.signIn': 'لدي حساب بالفعل',
  'auth.welcome.legal': 'بالمتابعة فإنك توافق على شروطنا. لا نشارك رقمك مع أحد.',
  'auth.email.q': 'ما بريدك الإلكتروني؟',
  'auth.email.help.up': 'تسجّل الدخول به. لا نشاركه مع أحد.',
  'auth.email.help.in': 'البريد الذي سجّلت به.',
  'auth.password.q.up': 'اختر كلمة مرور.',
  'auth.password.help.up': '٨ أحرف على الأقل. اكتبها في مكان آمن.',
  'auth.password.q.in': 'وكلمة المرور.',
  'auth.password.show': 'إظهار',
  'auth.password.hide': 'إخفاء',
  'auth.password.showA11y': 'إظهار كلمة المرور',
  'auth.password.hideA11y': 'إخفاء كلمة المرور',
  'auth.signInInstead': 'سجّل الدخول بدلاً من ذلك',
  'error.signUp.failed': 'تعذّر إنشاء حساب بهذا البريد. إن كان لديك حساب بالفعل، فسجّل الدخول بدلاً من ذلك.',
  'auth.role.cta.shipper': 'لدي بضائع لنقلها — متابعة',
  'auth.role.cta.driver': 'أقود شاحنة — متابعة',
  'auth.name.q': 'بماذا نناديك؟',
  'auth.name.help.shipper': 'يُكتب على الأوراق، وهو ما سيراه السائق.',
  'auth.name.help.driver': 'يُكتب على الأوراق، وهو ما سيراه صاحب الشحنة.',
  'auth.phone.q': 'ما رقمك؟',
  'auth.phone.skip': 'تخطَّ — أضفه لاحقاً',
  'error.phone.oman': 'رقم الجوال العُماني ٨ أرقام ويبدأ بـ ٧ أو ٩.',
  'auth.truck.q': 'ماذا تقود يا {name}؟',
  'auth.truck.help.fit': 'نرسل لك فقط الشحنات التي تناسب شاحنتك. يجب أن يكون هذا صحيحاً.',
  'auth.truck.finish': 'إنهاء الإعداد',
  'auth.done.title': 'أنت معنا يا {name}.',
  'auth.done.titlePlain': 'أنت معنا.',
  'auth.done.body.driver': 'مستنداتك لدى فريقنا. بعد التحقق، ستصلك الشحنات المناسبة.',
  'auth.done.body.shipper': 'أخبرنا أين بضاعتك وإلى أين يجب أن تذهب. يسعّرها شخص ويعود إليك خلال دقائق.',
  'auth.done.cta.driver': 'أضف أول رحلة لي',
  'auth.done.cta.shipper': 'احجز أول شحنة لي',
  'auth.done.later': 'ليس الآن',

  'error.email.invalid': 'هذا لا يبدو عنوان بريد إلكتروني.',
  'error.password.short': 'استخدم ٨ أحرف على الأقل.',
  'error.name.required': 'من فضلك أخبرنا باسمك.',
  'error.role.required': 'من فضلك اختر واحداً.',
  'error.truck.required': 'من فضلك اختر حجم شاحنتك.',
  'error.signIn.failed': 'البريد وكلمة المرور غير متطابقين. حاول مرة أخرى.',
  'error.oauth.unavailable': 'طريقة الدخول هذه غير مفعّلة بعد. استخدم بريدك في الوقت الحالي.',
  'error.reset.expired': 'انتهت صلاحية الرابط. اطلب رابطاً جديداً من شاشة تسجيل الدخول.',
  'error.confirm.expired': 'انتهت صلاحية الرابط. سجّل الدخول وسنرسل رابطاً جديداً.',

  'cust.newLoad': 'انقل شيئاً',
  'cust.empty.title': 'لا شيء يتحرك بعد',
  'cust.empty.explain':
    'أخبرنا بما يجب نقله وإلى أين. سنجد شاحنة متجهة إلى هناك بالفعل — أو نرتب رحلة جديدة.',
  'cust.empty.action': 'أرسل أول شحنة لك',
  'cust.section.past': 'المكتملة',
  'cust.record.title': 'الشحنات المكتملة',
  'cust.record.none.title': 'لا شيء مكتمل بعد',
  'cust.record.none.explain': 'الشحنات المسلّمة والملغاة تُحفظ هنا.',
  'cust.finding.explain':
    'نبحث عن شاحنة متجهة إلى هناك بالفعل. وإن لم يناسب شيء، نرتب رحلة جديدة — لن تُترك بلا إجابة.',
  'cust.driver.title': 'سائقك',
  'cust.driver.call': 'راسل سائقك',
  'cust.progress.title': 'التقدّم',
  'cust.pod.title': 'إثبات التسليم',

  'driver.masthead': 'اليوم',
  'driver.trip.none.title': 'لا توجد رحلة الآن',
  'driver.trip.none.explain':
    'أخبرنا إلى أين ستقود بعد ذلك. وحين تناسب شحنة مسارك، ستصلك هنا.',
  'driver.postLeg': 'أضف رحلة ستقوم بها',
  'driver.section.offers': 'شحنات معروضة عليك',
  'driver.offers.none.title': 'لا توجد عروض بعد',
  'driver.offers.none.explain':
    'أضف المسارات التي تقودها بالفعل. نرسل لك فقط الشحنات التي تقع عليها.',
  'driver.section.legs': 'مساراتك القادمة',
  'driver.pay': 'ستحصل على',
  'driver.pay.pending': 'ستؤكد تركو السعر معك قبل الاستلام.',
  'driver.accept': 'اقبل هذه الشحنة',
  'driver.decline': 'ليست هذه',
  'driver.advance.pickedUp': 'لقد استلمتها',
  'driver.advance.delivered': 'تحديد كمُسلّمة',
  'driver.trip.title': 'رحلتك',
  'driver.trip.next': 'الخطوة التالية',
  'driver.routes.title': 'المسارات التي أضفتها',
  'driver.routes.none.title': 'لا توجد مسارات',
  'driver.routes.none.explain':
    'أضف إلى أين ستقود بعد ذلك. نعرض عليك فقط الشحنات التي تقع على أحد مساراتك — فالدفتر الفارغ هنا يعني شاحنة فارغة.',
  'driver.offer.sheet': 'شحنة معروضة عليك',

  'tab.offers': 'العروض',
  'tab.routes': 'المسارات',
  'offers.title': 'معروضة عليك',
  'offers.hint': 'فقط الشحنات التي تقع على مسار أضفته',
  'routes.title': 'مساراتك',
  'routes.hint': 'نطابق الشحنات مع هذه',

  'home.entry': 'إلى أين؟',
  'home.entry.hint': 'أخبرنا بمكان الاستلام والتسليم — ونحن نجد الشاحنة',
  'home.again': 'أرسلها مرة أخرى',
  'home.again.hint': 'مسار استخدمته من قبل',
  'loads.seg.live': 'قيد التنفيذ',
  'loads.seg.past': 'المكتملة',


  'leg.stamp.empty': 'فارغة',
  'leg.stamp.part': 'جزئية',
  'label.replyBy': 'الرد قبل',


  'note.title': 'بوليصة الشحن',
  'note.carrier': 'نقلها',
  'note.query': 'اسألنا عن هذه الشحنة',
  'note.pod.alt': 'صورة التقطت عند التسليم',
  'note.missing.title': 'لا نجد هذه الشحنة',
  'note.missing.explain':
    'ربما أُلغيت، أو أنها تخص حساباً آخر. شحناتك المكتملة معروضة على شاشتك الرئيسية.',
  'note.open': 'اعرض البوليصة كاملة',
  'label.load': 'بوليصة الشحن',
  'label.offer': 'عرض شحنة',
  'label.leg': 'مسارك',

  'price.action': 'اطلب سعراً',
  'price.retry': 'اسأل مرة أخرى',
  'price.none.explain': 'اطلب منا سعراً وسنعود إليك مباشرة.',
  'price.heldUntil': 'السعر محفوظ حتى {when}',
  'price.settle': 'لا يُخصم شيء في التطبيق. نرتب الدفع معك مباشرة.',

  'event.picked_up': 'تم الاستلام',
  'event.en_route': 'على الطريق',
  'event.note': 'ملاحظة',

  'common.error.title': 'تعذّر تحميل ذلك',
  'common.error.explain': 'تحقق من اتصالك وحاول مرة أخرى. لم يُفقد شيء.',
  'account.language.hint': 'أعد تشغيل التطبيق بعد تغيير هذا',
  'account.signOut.waiting': 'جارٍ تسجيل الخروج…',
  'account.signOut.failed': 'تعذّر تسجيل الخروج. تحقق من اتصالك وحاول مرة أخرى.',
  'app.direction.reopen': 'أغلق تركو ثم افتحه من جديد، وستظهر الشاشة بالاتجاه الصحيح.',
  'drv.home.onJob': 'مهمتك',
  'drv.job.open': 'افتح هذه المهمة',
  'drv.waiting.title': 'لا توجد شحنات لك بعد',
  'drv.waiting.body': 'عندما تناسب شحنةٌ شاحنتك، تظهر هنا لتقبلها أو تتركها.',
  'drv.past.title': 'الرحلات السابقة',
  'drv.past.month': 'هذا الشهر',
  'drv.past.monthTotal': '{amount} · {count} رحلات',
  'drv.past.monthTotal.one': '{amount} · رحلة واحدة',
  'drv.past.row': '{date} · {goods}',
  'drv.past.aria': 'من {origin} إلى {destination}، سُلّمت {date}، {amount}',
  'drv.past.none.title': 'لا توجد رحلات بعد',
  'drv.past.none.body': 'تظهر هنا الشحنات التي توصلها، مع ما دفعته كل واحدة.',
  'tab.past': 'الرحلات السابقة',

  'post.load.title': 'ما الذي تريد نقله؟',

  'post.leg.title': 'إلى أين تقود؟',
  'post.leg.submit': 'أضف هذا المسار',
  'post.leg.date': 'متى تنطلق؟',
  'post.leg.empty': 'هل الشاحنة فارغة؟',
  'post.leg.empty.yes': 'فارغة — يمكنني أخذ شحنة',
  'post.leg.empty.no': 'محمّلة جزئياً — بقي بعض المكان',
  'post.leg.help': 'نرسل لك فقط الشحنات التي تقع على مسار أضفته.',

  'trip.collect.title': 'هل استلمت الشحنة؟',
  'trip.collect.explain': 'حدّد هذا فقط بعد أن تصبح البضاعة على شاحنتك.',
  'trip.collect.action': 'نعم، تم تحميلها',
  'trip.deliver.title': 'تم التسليم؟',
  'trip.deliver.explain':
    'التقط صورة واحدة للبضاعة المسلّمة. هذه إثباتك، ولا يمكن تغييرها بعد ذلك.',
  'trip.deliver.photo': 'التقط صورة',
  'trip.deliver.retake': 'التقط صورة أخرى',
  'trip.deliver.action': 'تأكيد التسليم',
  'trip.deliver.needPhoto': 'الصورة مطلوبة قبل تحديد الشحنة كمُسلّمة.',
  'trip.photo.denied': 'نحتاج إذن الكاميرا لالتقاط إثبات التسليم. يمكنك تفعيله من الإعدادات.',
  'trip.uploading': 'جارٍ الإرسال…',
  'map.country.YE': 'اليمن',
  'map.country.IR': 'إيران',
  'map.sea.gulfOfOman': 'خليج عُمان',
  'map.sea.arabianSea': 'بحر العرب',
  'map.sea.arabianGulf': 'الخليج العربي',
  'map.sea.hormuz': 'مضيق هرمز',
  'book.review.priceLabel': 'سعرك',
  'book.review.priceWhy': 'هذا هو السعر. احجز ونرسلها إلى السائقين فوراً.',
  'book.review.bookFor': 'احجز مقابل {price}',
  'book.review.chosenFor': '{truck}، لحمولة {weight} كجم',
  'book.weight.helpInstant': 'بالكيلوغرام. أخبرنا وتحصل على السعر فوراً — أو تجاوزها ليسعّرها شخص.',
  'drv.avail.on': 'أنت متاح',
  'drv.avail.off': 'أنت غير متاح',
  'drv.avail.near': 'بالقرب من {city}',
  'drv.avail.unknown': 'لم نعرف مدينتك بعد',
  'drv.avail.goOn': 'كن متاحاً',
  'drv.avail.goOff': 'توقف مؤقتاً',
  'drv.avail.help': 'ما دمت متاحاً، تصلك الشحنات القريبة منك على هذه الشاشة مباشرة.',
  'drv.avail.why': 'كن متاحاً لتصلك الشحنات القريبة منك. نستخدم موقعك فقط وأنت متاح.',
  'drv.offer.minutesLeft': 'متبقٍ {minutes} دقيقة',
  'loc.notify.title': 'أنت متاح',
  'loc.notify.body': 'نشارك موقعك لنجد لك شحنات قريبة منك.',
  'loc.ask.q': 'هل تسمح لتروكو بمعرفة مكان شاحنتك حتى عندما يكون التطبيق مغلقاً؟',
  'loc.ask.body': 'نستخدمه لنرسل لك الشحنات القريبة منك، فقط وأنت متاح، ولا نحتفظ إلا بآخر موقع لك.',
  'loc.ask.android': 'في الشاشة التالية، اختر «السماح طوال الوقت».',
  'loc.ask.later': 'ليس الآن',
  'loc.card.always': 'الموقع مفعّل · آخر إرسال {age}',
  'loc.card.waiting': 'الموقع مفعّل · بانتظار أول قراءة',
  'loc.card.foreground': 'الموقع يعمل فقط والتطبيق مفتوح',
  'loc.card.none': 'الموقع متوقف · تصلك الشحنات القريبة من مدينتك',
  'loc.card.turnOn': 'تفعيل الموقع',
  'pos.secondsAgo': 'منذ {seconds} ثانية',
  'places.search.placeholder': 'ابحث عن مكان أو منطقة أو شركة',
  'places.search.current': 'استخدم موقعي الحالي',
  'places.search.locating': 'نحدد موقعك…',
  'places.search.or': 'أو اختر مدينة',
  'places.search.none': 'لم نجد أماكن. جرّب اسماً آخر، أو اختر مدينة.',
  'places.search.unavailable': 'البحث لا يعمل الآن. اختر مدينة بدلاً من ذلك.',
  'places.pin.q': 'ضع الدبوس على البوابة',
  'places.pin.help': 'حرّك الخريطة، لا الدبوس.',
  'places.pin.near': 'قرب {city}',
  'places.pin.unnamed': 'هذا الموقع',
  'places.pin.sameCity': 'الاستلام والتسليم كلاهما في {city}. اختر مكاناً آخر، أو راسلنا على واتساب.',
  'places.pin.noCity': 'تعذّر التحقق من هذا الموقع. اختر مدينة بدلاً من ذلك.',
  'places.pin.chooseCity': 'اختر مدينة بدلاً من ذلك',
  'places.pin.confirmPickup': 'تأكيد الاستلام',
  'places.pin.confirmDrop': 'تأكيد التسليم',
  'places.details.q': 'هل هناك ما يجب أن يعرفه السائق؟',
  'places.details.help': 'اختياري. يساعد السائق على إيجاد البوابة.',
  'places.details.note': 'مثال: البوابة ٣ خلف محطة شل',
  'places.details.someonePickup': 'شخص آخر عند الاستلام؟',
  'places.details.someoneDrop': 'من سيستلمها؟',
  'places.details.name': 'الاسم',
  'places.details.phone': 'رقم الهاتف',
  'places.details.badPhone': 'تحقق من الرقم: أرقام فقط، مع + لرمز الدولة.',
  'places.details.skip': 'تخطَّ',
  'places.review.pickup': 'الاستلام: {place}',
  'places.review.drop': 'التسليم: {place}',
  'places.call': 'اتصل بـ{name}',
  'places.askFor': 'اسأل عن {name}',
  'places.review.contact': 'اسأل عن {name}: {phone}',
  'places.review.contactPhone': 'للتواصل: {phone}',
  'drv.trip.directionsTo': 'الاتجاهات إلى {city}',
  // bidding, 2026-10-04 (44 strings)
  'book.target.optional': 'اختياري',
  'book.target.q': 'ما أقصى مبلغ تريد دفعه؟',
  'book.target.help': 'يحدد السائقون أسعارهم. إذا كان أرخص سعر عند هذا المبلغ أو أقل، نقبله نيابةً عنك عند انتهاء العروض. لا يرى السائقون هذا الرقم.',
  'book.target.unit': 'ر.ع.',
  'book.target.cta': 'عرض الملخص',
  'book.target.skip': 'تخطَّ — سأختار من الأسعار',
  'money.invalid': 'اكتب مبلغاً مثل ١٢٠ أو ١٢٠٫٥٠٠.',
  'book.review.bidLabel': 'كيف يُحدَّد السعر',
  'book.review.bidWhy': 'يحدد السائقون المتجهون في طريقك أسعارهم خلال الساعة القادمة. أنت تختار — أو نقبل أرخص سعر ضمن حدّك.',
  'book.review.target': 'أقصى ما تدفعه',
  'book.review.noTarget': 'أنت تختار',
  'book.review.bidCta': 'اطلب الأسعار من السائقين',
  'book.review.incomplete': 'أكمل هذه الإجابات قبل أن نبحث عن شاحنة.',
  'book.review.continue': 'أكمل الحجز',
  'book.review.home': 'العودة إلى الرئيسية',
  'bid.open.pill': 'نستقبل الأسعار',
  'bid.open.none': 'السائقون يطّلعون على شحنتك. ستظهر أسعارهم هنا — لا حاجة لإبقاء التطبيق مفتوحاً.',
  'bid.closes': 'تُغلق الأسعار {when}',
  'bid.closesIn': 'تُغلق الأسعار بعد {minutes} دقيقة',
  'status.bidding': 'نستقبل الأسعار',
  'bid.count': 'الأسعار حتى الآن: {count}',
  'bid.choose': 'اختر سعراً',
  'bid.row.gone': 'لم يعد متاحاً',
  'bid.target': 'حدّك {amount}. عند إغلاق الأسعار نقبل أرخص سعر عنده أو أقل.',
  'bid.target.none': 'لم تحدد حداً — تختار أنت عند إغلاق الأسعار.',
  'bid.closeNow': 'أوقف استقبال الأسعار',
  'bid.manage.title': 'إعدادات السعر',
  'bid.manage.limit': 'غيّر الحد الأقصى',
  'bid.manage.saveLimit': 'احفظ الحد',
  'bid.manage.clearLimit': 'احذف الحد',
  'bid.manage.extend': 'أعط السائقين ٣٠ دقيقة إضافية',
  'bid.manage.close': 'أنهِ استقبال الأسعار',
  'bid.manage.closeExplain': 'إذا كان سعر ضمن حدك، قد نحجز ذلك السائق الآن. وإلا فستختار أنت.',
  'bid.manage.closeConfirm': 'أنهِ الآن',
  'bid.manage.unavailable': 'تعذر إجراء هذا التغيير. حدّث الشحنة وحاول من جديد.',
  'bid.gone': 'هذا السعر لم يعد متاحاً. اختر غيره.',
  'bid.best.label': 'أفضل سعر',
  'bid.best.from': 'من {name}',
  'bid.others': 'أسعار أخرى',
  'drv.bid.pill': 'حدّد سعرك',
  'drv.bid.yours': 'سعرك: {amount}',
  'drv.bid.none': 'لم تحدد سعراً بعد',
  'drv.bid.cta': 'حدّد سعرك',
  'drv.bid.change': 'غيّر سعرك',
  'drv.bid.others': 'سائقون آخرون',
  'drv.bid.othersNone': 'لا أسعار أخرى بعد.',
  'drv.bid.row': 'سائق {n}',
  'drv.bid.rowYou': 'أنت',
  'drv.bid.how': 'يرى صاحب الشحنة كل الأسعار ويختار. لا تظهر الأسماء أبداً.',
  'drv.bid.gone': 'أُغلقت الأسعار على هذه الشحنة.',
  'drv.bid.q': 'كم تريد مقابل هذه الرحلة؟',
  'drv.bid.help': 'المبلغ الذي تحتفظ به، بالريال. يمكنك تغييره حتى تُغلق الأسعار.',
  'drv.bid.lowest': 'أقل سعر حتى الآن: {amount}',
  'drv.bid.submit': 'أرسل {amount}',
  'drv.bid.submit.bare': 'أرسل سعري',
  'drv.bid.notEligible': 'لا يمكنك إرسال سعر الآن — تأكد أنك متصل ولست في رحلة أخرى.',
  // push notifications, 2026-10-04 (10 strings)
  'push.channel': 'الأعمال والتسليمات',
  'push.ask.q': 'هل نُعلمك عندما يحدث شيء؟',
  'push.ask.shipper': 'نُعلمك عندما يحدد سائق سعراً، ويستلم شحنتك، ويحملها، ويسلّمها. لا شيء غير ذلك.',
  'push.ask.driver': 'نُعلمك لحظة وصول عمل جديد، وعندما تحصل عليه. لا شيء غير ذلك.',
  'push.ask.cta': 'شغّل الإشعارات',
  'push.ask.later': 'ليس الآن',
  'push.ask.settings': 'سيفتح هاتفك الإعدادات — فعّل الإشعارات لتركو من هناك.',
  'push.row': 'الإشعارات',
  'push.row.on': 'مفعّلة',
  'push.row.off': 'متوقفة — اضغط لتفعيلها',
  'auth.capacity.q': 'ما الحمولة القصوى لشاحنتك بالكيلوغرام؟',
  'auth.capacity.help': 'استخدم الحد القانوني للشاحنة. نرسل لك فقط الشحنات التي تناسبها.',
  'auth.capacity.placeholder': 'مثلاً ١٠٬٠٠٠',
  'auth.plate.q': 'ما رقم لوحة شاحنتك؟',
  'auth.plate.help': 'أدخل رقم اللوحة المكتوب في ملكية المركبة.',
  'auth.plate.placeholder': 'رقم اللوحة',
  'auth.verify.id_front': 'صوّر الوجه الأمامي لبطاقة هويتك.',
  'auth.verify.id_back': 'صوّر الوجه الخلفي لبطاقة هويتك.',
  'auth.verify.mulkiya': 'صوّر ملكية المركبة.',
  'auth.verify.truck_photo': 'صوّر شاحنتك.',
  'auth.verify.help': 'أظهر الزوايا الأربع. يراجع هذه الصور الخاصة موظفو تركو المعيّنون فقط.',
  'auth.verify.camera': 'التقط صورة',
  'auth.verify.gallery': 'اختر من الصور',
  'auth.verify.change': 'اختر صورة أخرى',
  'auth.verify.upload': 'أرسل الصورة',
  'auth.verify.done': 'تم — انتظر المراجعة',
  'auth.verify.status.pending': 'وصلت — قيد المراجعة',
  'auth.verify.status.approved': 'تمت الموافقة',
  'auth.verify.status.rejected': 'أرسل صورة جديدة من فضلك',
  'auth.verify.format': 'استخدم صورة JPG أو PNG أو WebP.',
  'auth.verify.size': 'اختر صورة أصغر من ٨ ميغابايت.',
  'auth.verify.unavailable': 'تعذّر إرسال الصورة أو تحميلها. تحقق من اتصالك وحاول مرة أخرى.',
  'account.verification': 'التحقق من السائق',
  'account.verification.open': 'افحص المستندات أو أرسلها',
  'drv.verify.finish': 'أكمل مستنداتك',
  'drv.verify.pending': 'نراجع مستنداتك',
  'drv.verify.open': 'افتح التحقق من السائق',
  'case.report': 'الإبلاغ عن مشكلة',
  'case.q': 'ماذا حدث؟',
  'case.help': 'سيقرأ فريق التشغيل بلاغك ويتصل بك. في حالة الطوارئ اتصل بخدمات الطوارئ أولاً.',
  'case.kind.delay': 'تأخير',
  'case.kind.breakdown': 'عطل الشاحنة',
  'case.kind.damage': 'تلف الشحنة',
  'case.kind.other': 'شيء آخر',
  'case.details': 'أخبرنا ماذا حدث',
  'case.cta': 'أرسل إلى فريق التشغيل',
  'case.error': 'تعذّر إرسال البلاغ. تحقق من الاتصال وحاول مرة أخرى.',
  'case.cancel.action': 'إلغاء هذه الشحنة',
  'case.cancel.q': 'لماذا تريد الإلغاء؟',
  'case.cancel.help': 'قبل تعيين سائق نلغيها الآن. إذا استلمها سائق، سيتولى فريق التشغيل طلبك.',
  'case.cancel.cta': 'اطلب الإلغاء',
  'case.sent': 'أُرسل البلاغ. سيتصل بك فريق التشغيل.',
  'case.cancel.done': 'أُلغيت الشحنة.',
  'case.cancel.queued': 'أُرسل الطلب. سيتصل بك فريق التشغيل.',
};

/**
 * Both dictionaries, exported.
 *
 * `tests/unit/i18n.test.ts` and `scripts/rtl-proof.tsx` both have to enumerate
 * every key — for placeholder parity, for completeness, and for the proof-sheet.
 * Exporting beats duplicating the key list in a test, which is how a test drifts
 * from what ships.
 *
 * Typed with `en` as its literal type rather than as `Record<Language, ...>`, so
 * `dictionaries.en[key]` stays a string literal and the placeholder types below
 * can read it.
 */
/** Complete Urdu draft dictionary; human linguistic and device proof remain. */
const ur: Record<StringKey, string> = {
  ...urduCore,
  'auth.otp.phone.q': 'آپ کا واٹس ایپ نمبر کیا ہے؟',
  'auth.otp.phone.help': 'ہم واٹس ایپ پر ایک بار استعمال ہونے والا کوڈ بھیجیں گے۔ پہلے ای میل یا گوگل استعمال کرتے ہیں تو اسی طریقے سے سائن اِن کریں تاکہ اکاؤنٹ برقرار رہے۔',
  'auth.otp.send': 'واٹس ایپ کوڈ بھیجیں',
  'auth.otp.code.q': 'کوڈ درج کریں۔',
  'auth.otp.code.help': '{phone} پر واٹس ایپ دیکھیں۔ کوڈ نجی ہے؛ کسی کو نہ بتائیں۔',
  'auth.otp.code.label': 'ایک بار استعمال ہونے والا کوڈ',
  'auth.otp.verify': 'کوڈ کی تصدیق کریں',
  'auth.otp.resend': 'نیا کوڈ بھیجیں',
  'auth.otp.resendWait': '{seconds} سیکنڈ بعد دوبارہ بھیجیں',
  'auth.otp.change': 'نمبر بدلیں',
  'auth.otp.email': 'ای میل استعمال کریں',
  'auth.otp.sendError': 'کوڈ نہیں بھیجا جا سکا۔ رابطہ اور واٹس ایپ نمبر چیک کرکے دوبارہ کوشش کریں۔',
  'auth.otp.codeError': 'کوڈ کی تصدیق نہیں ہو سکی۔ کوڈ چیک کریں یا نیا مانگیں۔',
  'auth.otp.sending': 'واٹس ایپ کوڈ مانگ رہے ہیں…',
  'auth.otp.verifying': 'کوڈ چیک ہو رہا ہے…',
  'app.name': 'ٹرکو',
  'action.continue': 'آگے بڑھیں',
  'common.retry': 'دوبارہ کوشش کریں',
  'auth.truck.q': 'آپ کون سی گاڑی چلاتے ہیں، {name}؟',
  'auth.truck.help.fit': 'ہم صرف وہی سامان بھیجتے ہیں جو آپ کے ٹرک میں سما سکے۔',
  'auth.truck.finish': 'سیٹ اپ مکمل کریں',
  'auth.capacity.q': 'آپ کے ٹرک کی زیادہ سے زیادہ گنجائش کتنے کلوگرام ہے؟',
  'auth.capacity.help': 'قانونی حد درج کریں۔ ہم صرف مناسب وزن والا سامان بھیجیں گے۔',
  'auth.capacity.placeholder': 'مثلاً ۱۰٬۰۰۰',
  'auth.plate.q': 'آپ کے ٹرک کا پلیٹ نمبر کیا ہے؟',
  'auth.plate.help': 'ملکیہ پر درج نمبر لکھیں۔',
  'auth.plate.placeholder': 'پلیٹ نمبر',
  'auth.verify.id_front': 'شناختی کارڈ کے اگلے حصے کی تصویر لیں۔',
  'auth.verify.id_back': 'شناختی کارڈ کے پچھلے حصے کی تصویر لیں۔',
  'auth.verify.mulkiya': 'گاڑی کی ملکیہ کی تصویر لیں۔',
  'auth.verify.truck_photo': 'اپنے ٹرک کی تصویر لیں۔',
  'auth.verify.help': 'چاروں کونے نظر آنے چاہییں۔ صرف مقررہ ٹرکو عملہ یہ نجی تصاویر دیکھتا ہے۔',
  'auth.verify.camera': 'تصویر لیں',
  'auth.verify.gallery': 'تصاویر میں سے منتخب کریں',
  'auth.verify.change': 'دوسری تصویر منتخب کریں',
  'auth.verify.upload': 'تصویر بھیجیں',
  'auth.verify.done': 'مکمل — جائزے کا انتظار کریں',
  'auth.verify.status.pending': 'موصول — جائزہ باقی ہے',
  'auth.verify.status.approved': 'منظور شدہ',
  'auth.verify.status.rejected': 'براہ کرم نئی تصویر بھیجیں',
  'auth.verify.format': 'JPG، PNG یا WebP تصویر استعمال کریں۔',
  'auth.verify.size': 'آٹھ میگابائٹ سے چھوٹی تصویر چنیں۔',
  'auth.verify.unavailable': 'تصویر نہیں بھیجی جا سکی۔ رابطہ چیک کریں اور دوبارہ کوشش کریں۔',
  'account.verification': 'ڈرائیور کی تصدیق',
  'account.verification.open': 'دستاویزات دیکھیں یا بھیجیں',
  'drv.verify.finish': 'اپنی دستاویزات مکمل کریں',
  'drv.verify.pending': 'آپ کی دستاویزات کا جائزہ جاری ہے',
  'drv.verify.open': 'ڈرائیور کی تصدیق کھولیں',
  'account.language': 'زبان',
  'account.language.hint': 'زبان بدلنے کے بعد ایپ دوبارہ کھولیں',
  'auth.done.title': 'آپ شامل ہو گئے، {name}۔',
  'auth.done.titlePlain': 'آپ شامل ہو گئے۔',
  'auth.done.body.driver': 'آپ کی دستاویزات کا جائزہ لیا جائے گا۔ منظوری کے بعد آپ کو مناسب کام ملے گا۔',
  'auth.done.cta.driver': 'اپنی پہلی ٹرپ شامل کریں',
  'auth.done.later': 'ابھی نہیں',
  'tab.home': 'گھر',
  'tab.offers': 'پیشکشیں',
  'tab.routes': 'راستے',
  'tab.account': 'اکاؤنٹ',
  'case.report': 'مسئلہ بتائیں',
  'case.q': 'کیا ہوا؟',
  'case.help': 'ٹرکو کا عملہ آپ کی رپورٹ پڑھے گا اور رابطہ کرے گا۔ ہنگامی صورت میں پہلے ایمرجنسی سروس کو کال کریں۔',
  'case.kind.delay': 'تاخیر',
  'case.kind.breakdown': 'ٹرک خراب ہو گیا',
  'case.kind.damage': 'سامان کو نقصان',
  'case.kind.other': 'کوئی اور مسئلہ',
  'case.details': 'بتائیں کیا ہوا',
  'case.cta': 'عملے کو بھیجیں',
  'case.error': 'رپورٹ نہیں بھیجی جا سکی۔ رابطہ چیک کریں اور دوبارہ کوشش کریں۔',
  'case.cancel.action': 'یہ سامان منسوخ کریں',
  'case.cancel.q': 'آپ کیوں منسوخ کرنا چاہتے ہیں؟',
  'case.cancel.help': 'ڈرائیور مقرر ہونے سے پہلے فوراً منسوخ ہو جائے گا۔ بعد میں عملہ آپ سے رابطہ کرے گا۔',
  'case.cancel.cta': 'منسوخی کی درخواست بھیجیں',
  'case.sent': 'رپورٹ بھیج دی گئی۔ عملہ آپ سے رابطہ کرے گا۔',
  'case.cancel.done': 'سامان منسوخ ہو گیا۔',
  'case.cancel.queued': 'درخواست بھیج دی گئی۔ عملہ آپ سے رابطہ کرے گا۔',
};

export const dictionaries: { en: typeof en; ar: Partial<Record<StringKey, string>>; ur: Partial<Record<StringKey, string>> } = { en, ar, ur };

/**
 * Current language. Read once at startup: React Native applies RTL layout at
 * the native level and requires a reload to flip it, so language cannot change
 * mid-session. That is a documented, accepted tradeoff (STACK.md §5).
 */
let current: Language = 'en';

export function initLanguage(preferred?: Language): Language {
  const device = Localization.getLocales()[0]?.languageCode;
  // English ships first; Arabic activates when its dictionary is complete or the
  // user explicitly picks it.
  current = preferred ?? (device === 'ar' || device === 'ur' ? device : 'en');
  return current;
}

export function getLanguage(): Language {
  return current;
}

export function isRTL(): boolean {
  return I18nManager.isRTL;
}

/**
 * Placeholder names inside a dictionary value, at the type level.
 *
 * `en` is `as const`, so each value is a literal type and its `{name}` markers
 * are readable by the compiler. That makes a missing or misspelt param a
 * typecheck failure rather than a `{km}` rendered on a driver's screen.
 */
type Placeholders<S extends string> = S extends `${string}{${infer K}}${infer Rest}`
  ? K | Placeholders<Rest>
  : never;

/**
 * The params argument for a key: absent when the string has no placeholders,
 * required and exhaustive when it has any.
 *
 * `K extends K ?` is a deliberate no-op condition that makes this distribute
 * over a union. Without it, a caller holding a widened `StringKey` — which is
 * every `t(\`status.${x}\` as StringKey)` site — gets the placeholders of ALL
 * values unioned together and is forced to pass params it has no way to know.
 * Distributing turns the result into a union of tuples that includes `[]`, so a
 * dynamic key stays callable while a literal key stays strict.
 *
 * Inside, `[X] extends [never]` rather than `X extends never` — the bare form is
 * itself a distributive conditional and collapses to `never` for every key.
 */
type ParamsFor<K extends StringKey> = K extends K
  ? [Placeholders<(typeof en)[K]>] extends [never]
    ? []
    : [params: Record<Placeholders<(typeof en)[K]>, string | number>]
  : never;

/**
 * Substitute `{name}` markers.
 *
 * An unknown marker is left visible rather than replaced with "undefined": a
 * literal `{oops}` on screen is a bug someone reports, and "undefined" is a bug
 * someone assumes is data.
 */
export function interpolate(raw: string, params: Record<string, string | number>): string {
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/**
 * Look up a string. Falls back to English rather than rendering a key or a
 * blank — a missing translation should look unfinished, not broken.
 *
 * Values are NOT formatted here. A number is stringified by the caller through
 * `formatNumber`, so `t()` stays a lookup and a substitution with no opinion
 * about numerals — which is what keeps it swappable for i18next later.
 */
export function t<K extends StringKey>(key: K, ...args: ParamsFor<K>): string {
  const raw: string = dictionaries[current][key] ?? en[key];
  const params = args[0] as Record<string, string | number> | undefined;
  return params ? interpolate(raw, params) : raw;
}

/**
 * Pick the right-language field off a reference row (cities, truck_types).
 * Those tables carry `name_en` / `name_ar` because the website did.
 */
export function localized<T extends { name_en: string; name_ar: string }>(row: T): string {
  return current === 'ar' ? row.name_ar : row.name_en;
}

/**
 * Text alignment that follows the writing direction.
 *
 * THESE ARE CONSTANTS, AND THAT IS THE FIX. Until 2026-08-02 they read
 * `I18nManager.isRTL` and returned the opposite value, on the belief — written
 * into CLAUDE.md — that React Native does not flip `textAlign` under RTL.
 *
 * It does, on both platforms:
 *
 *   Android, TextAttributeProps.kt
 *     "left"  -> if (isRTL) Gravity.RIGHT else Gravity.LEFT
 *     "right" -> if (isRTL) Gravity.LEFT  else Gravity.RIGHT
 *
 *   iOS, RCTTextAttributes.mm
 *     if (layoutDirection == RightToLeft) { Right -> Left; Left -> Right; }
 *
 * So the old `align.start` returned 'right' in Arabic, React Native flipped that
 * to LEFT, and every label using it sat on the wrong edge. It was measured on a
 * device: the flex-positioned brand moved from x62 to x973 between LTR and RTL
 * while a label using `align.start` did not move at all.
 *
 * Reading `isRTL` here is therefore not just unnecessary, it is the bug. Naming
 * the physical edge and letting React Native mirror it is the whole job — which
 * also means these can never go stale inside a module-scope `StyleSheet.create`,
 * the way a getter silently did.
 */
export const align = {
  /** The edge a line of text begins at. RN mirrors it under RTL. */
  start: 'left',
  /** The edge it ends at. */
  end: 'right',
} as const satisfies { start: 'left'; end: 'right' };

/**
 * Directional glyphs must mirror too. An arrow pointing at the destination
 * points the wrong way in Arabic if it is hardcoded.
 */
export function directionArrow(): string {
  return I18nManager.isRTL ? '←' : '→';
}

/**
 * Numerals. The website renders Eastern-Arabic digits in Arabic copy (٤٠ طن),
 * so match it — PRODUCT.md records this as the chosen convention.
 *
 * Mapped explicitly rather than through Intl: Hermes ships a trimmed ICU and
 * `Intl.NumberFormat('ar-OM')` returns Latin digits on Android often enough
 * that a date or a weight would silently render in the wrong system.
 */
const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toArabicIndic(s: string): string {
  return s.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]);
}

export function formatNumber(n: number): string {
  const grouped = new Intl.NumberFormat('en-OM').format(n);
  return current === 'ar' ? toArabicIndic(grouped) : grouped;
}
