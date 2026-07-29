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
 * Arabic values already present below were lifted verbatim from the live
 * bilingual website (`~/truckkoo`), not machine-translated. Where a key has no
 * Arabic yet it falls back to English, visibly, so gaps are findable rather
 * than silently blank.
 *
 * This is deliberately a plain typed dictionary rather than i18next. It is ~40
 * lines of machinery instead of a dependency, and `t()` has the same shape, so
 * swapping to i18next in phase 2 (for pluralisation, which Arabic genuinely
 * needs — six CLDR categories) does not touch call sites.
 */

import { I18nManager } from 'react-native';
import * as Localization from 'expo-localization';

export type Language = 'en' | 'ar';

/** English is the source of truth: every key must exist here. */
const en = {
  'app.name': 'Truckkoo',
  'app.tagline': 'Driven. Delivered. Trusted.',
  'app.positioning': 'Connecting Oman to the GCC.',

  'role.shipper': 'I need to move cargo',
  'role.driver': 'I drive a truck',

  'load.from': 'Pickup from',
  'load.to': 'Deliver to',
  'load.goods': 'Type of goods',
  'load.goods.placeholder': 'e.g. furniture, building materials',
  'load.truckType': 'Truck type (optional)',
  'load.truckType.unsure': 'Not sure — advise me',
  'load.city.placeholder': 'e.g. Muscat',
  'load.submit': 'Request a quote',

  'status.posted': 'Posted',
  'status.finding_truck': 'Finding you a truck',
  'status.matched': 'Truck found',
  'status.assigned': 'Truck assigned',
  'status.in_transit': 'On the road',
  'status.delivered': 'Delivered',
  'status.closed': 'Complete',
  'status.cancelled': 'Cancelled',

  'whatsapp.action': 'WhatsApp us',
  'whatsapp.promise': 'Replies in minutes · 7 days a week',

  'error.generic': 'Something went wrong. Please try again.',
  'error.offline': 'No connection. We saved this and will send it when you are back online.',
  'error.required': 'Please fill this in.',

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
  "auth.checkEmail": "Check your email to confirm your account, then sign in.",

  "auth.role.title": "Which are you?",
  "auth.role.help": "You can only pick once, so pick the one that fits.",
  "auth.role.shipper.title": "I need to move cargo",
  "auth.role.shipper.detail": "Post what needs moving and we find the truck.",
  "auth.role.driver.title": "I drive a truck",
  "auth.role.driver.detail": "Tell us your routes and get loads that fit them.",

  "auth.truck.title": "Your truck",
  "auth.truck.help": "We match loads to your truck size, so this has to be right.",
  // Shown when the truck-size list could not be loaded. Says what to do, not what
  // failed — and never leaves the step demanding a choice with nothing to choose.
  "auth.truck.unavailable": "We could not load the truck sizes. Check your connection and try again.",
  "auth.truck.plate": "Plate number",
  "auth.truck.plate.placeholder": "Optional",

  // ── errors ────────────────────────────────────────────────────────────────
  "error.email.invalid": "That does not look like an email address.",
  "error.password.short": "Use at least 8 characters.",
  "error.name.required": "Please tell us your name.",
  "error.role.required": "Please choose one.",
  "error.truck.required": "Please choose your truck size.",
  "error.signIn.failed": "That email and password did not match. Try again.",
  "error.oauth.unavailable": "That sign-in method is not switched on yet. Use your email for now.",

  // ── customer home ─────────────────────────────────────────────────────────
  "cust.masthead": "Your loads",
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

  // ── stepped flows ─────────────────────────────────────────────────────────
  // Both posting flows are now a sequence of one-question screens with a pinned
  // action, rather than one long scroll. Each step needs its own title, because
  // the title IS the question.
  "common.next": "Next",
  "step.route": "Where is it going?",
  "step.route.hint": "Pickup first, then delivery",
  "step.details": "What are we moving?",
  "step.details.hint": "A rough answer is fine — we will confirm it with you",
  "step.of": "of",

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
  "review.title": "Check this before we start",
  "review.priceLabel": "Your price",
  "review.confirm": "Yes, book this",
  "review.change": "Change something",
  "review.checking": "Working out your price…",
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
  "price.advise_me": "You asked us to recommend the truck, so we will price it with the recommendation. Expect an answer within minutes.",
  "price.no_rate": "We price this route by hand. We are working it out now and will come back to you within minutes.",
  "price.over_capacity": "This load is heavier than the truck you chose can carry. We will suggest the right truck and price it for you.",
  // Prefixes a formatted date. Not "expires": a held price is a promise Truckkoo
  // is keeping, and "expires" reads as a threat to hurry up.
  "price.heldUntil": "Price held until",
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
  "label.pickup": "Pickup",
  "label.goods": "Goods",
  "label.truck": "Truck",
  "label.weight": "Weight",
  "label.driver": "Driver",
  "label.dates": "Dates",
  "label.reference": "Reference",
  "label.load": "Consignment note",
  "label.trip": "Current trip",
  "label.offer": "Load offer",
  "label.leg": "Your route",
  "truck.unset": "We will advise",
  "weight.unset": "Not given",
  "common.retry": "Try again",
  "common.loading": "Loading…",
  "common.error.title": "We could not load that",
  "common.error.explain": "Check your connection and try again. Nothing was lost.",

  "common.close": "Done",
  "common.search": "Search",
  "common.noMatches": "Nothing matches that. Try a shorter word.",
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

  "date.today": "Today",
  "date.tomorrow": "Tomorrow",

  // ── post a load ───────────────────────────────────────────────────────────
  "post.load.title": "What needs moving?",
  "post.load.submit": "Send to Truckkoo",
  "post.load.weight": "Rough weight (optional)",
  "post.load.weight.placeholder": "e.g. 8000",
  "post.load.weight.unit": "Kilograms. Leave blank if you are not sure.",
  "post.load.date": "When should we collect it?",
  "post.load.sameCity": "Pickup and delivery cannot be the same place.",
  "post.load.done.title": "We have it",
  "post.load.done.explain": "We are finding a truck already heading that way. You will see it on your loads.",

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
} as const;

export type StringKey = keyof typeof en;

/**
 * Arabic. Partial on purpose — phase 2 completes it. Values here are the
 * website's own copy.
 */
const ar: Partial<Record<StringKey, string>> = {
  'app.name': 'تركو',
  'app.tagline': 'قيادة. توصيل. ثقة.',
  'app.positioning': 'نربط عُمان بدول الخليج.',

  'load.from': 'من (موقع التحميل)',
  'load.to': 'إلى (موقع التسليم)',
  'load.goods': 'نوع البضاعة',
  'load.goods.placeholder': 'مثال: أثاث، مواد بناء',
  'load.truckType': 'نوع الشاحنة (اختياري)',
  'load.truckType.unsure': 'غير متأكد — انصحوني',
  'load.city.placeholder': 'مثال: مسقط',

  'whatsapp.action': 'واتساب',
  'whatsapp.promise': 'نرد خلال دقائق · طوال أيام الأسبوع',

  'error.required': 'يرجى تعبئة هذا الحقل.',

  "auth.signIn.title": "تسجيل الدخول",
  "auth.email": "البريد الإلكتروني",
  "auth.password": "كلمة المرور",
  "auth.name": "الاسم",
  "auth.phone": "رقم الهاتف",
  "auth.signOut": "تسجيل الخروج",
  "label.from": "من",
  "label.to": "إلى",
  "label.goods": "نوع البضاعة",
  "label.truck": "نوع الشاحنة",
  // Driver-facing, and it appears at the worst possible moment.
  "driver.offer.taken": "سائق آخر أخذ هذه الحمولة.",
};

const dictionaries: Record<Language, Partial<Record<StringKey, string>>> = { en, ar };

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
  current = preferred ?? (device === 'ar' ? 'ar' : 'en');
  return current;
}

export function getLanguage(): Language {
  return current;
}

export function isRTL(): boolean {
  return I18nManager.isRTL;
}

/**
 * Look up a string. Falls back to English rather than rendering a key or a
 * blank — a missing translation should look unfinished, not broken.
 */
export function t(key: StringKey): string {
  return dictionaries[current][key] ?? en[key];
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
 * React Native does NOT flip `textAlign: 'left'` under RTL the way flexbox
 * flips `flexDirection: 'row'`. So 'left' is a bug in Arabic, not a default.
 * Use these instead of literals, always.
 */
export const align = {
  get start(): 'left' | 'right' {
    return I18nManager.isRTL ? 'right' : 'left';
  },
  get end(): 'left' | 'right' {
    return I18nManager.isRTL ? 'left' : 'right';
  },
} as const;

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
