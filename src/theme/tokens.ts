/**
 * Truckkoo design tokens — the app's design system.
 *
 * ── The 2026 redesign ──────────────────────────────────────────────────────
 *
 * Two grounds, not one. INK (#0B0C0F) is the working ground: home, tracking,
 * offers, lists — everywhere the user is reading state. CREAM (#F4F0E9) is the
 * asking ground: one question per screen, set in display type. A screen is one
 * or the other, never a mix.
 *
 * Reference points, per the handoff: Uber for the shape of the product, Typeform
 * for the shape of the asking, Opal for the room it sits in.
 *
 * WHAT IS LOAD-BEARING HERE:
 *   - `font.button` at >=18.66px. An accessibility floor, not taste. See below.
 *   - One accent. #F1551F is the pinned primary action OR the live state, never
 *     both on one screen.
 *   - #F1551F is never text on dark. `accentLight` (#FF7A45) exists for that.
 *   - `color.delivered` appears exactly ONCE in the product (T5).
 *   - Every type token names a fontFamily. Never fontWeight — see faces.ts.
 */

import { face, arabicFaceFor } from './faces';

export const color = {
  /** Root ground on working surfaces. */
  ink: '#0B0C0F',
  /** Sheets and cards. */
  surface: '#15171C',
  /** Fields, chips, nested cards. */
  raised: '#1E2128',

  /** The pinned primary action OR the live state. Never both on one screen. */
  accent: '#F1551F',
  /** Accent-as-text-on-dark, and active map labels. #F1551F is never text here. */
  accentLight: '#FF7A45',
  /** Status pill and icon tile fills. */
  accentWash: 'rgba(241,85,31,.16)',
  /** Selected card fill on cream. */
  accentTint: '#FFF6F2',

  /** The asking ground. */
  cream: '#F4F0E9',
  /** Cards and fields on cream. */
  creamCard: '#FFFFFF',
  /** The keypad tray. */
  creamKeyboard: '#DDD8D0',

  /** Primary text on cream. */
  inkText: '#16171A',
  /** Helper text on cream. */
  mutedText: '#6C6A63',
  /** Primary text on ink. */
  lightText: '#F7F5F2',

  /** Icon strokes in raised tiles. */
  iconGrey: '#92959D',
  /** Empty-state icons. */
  iconGreyDim: '#5F636B',

  /**
   * Terminal success. Appears ONCE in the entire product, on T5 (delivered).
   * If this shows up on a second screen, that screen is wrong.
   */
  delivered: '#79E0AF',
} as const;

/**
 * Text alpha ramps.
 *
 * The handoff specifies a ramp down to `.32`. Anything carrying real copy has
 * been RAISED to the lowest alpha that still clears WCAG AA 4.5:1 over its
 * ground, because an alpha ramp is where sub-AA text hides: the handoff's `.45`
 * measures 4.26:1 over ink and its `.42` measures 3.84:1. Both would have
 * shipped looking like decisions.
 *
 * `tests/unit/contrast.test.ts` asserts every entry here. Lowering one is not a
 * style change — the test will tell you what you did.
 *
 * Values below AA are deliberately NOT in this object. Decorative non-text uses
 * (map minor geometry, hairlines, a disabled label) take their rgba inline at
 * the call site, where it is visible that no one has to read it.
 */
export const alpha = {
  onInk: {
    /** Body copy on ink. */
    body: 'rgba(247,245,242,.62)',
    /** Secondary values. */
    secondary: 'rgba(247,245,242,.55)',
    /** Tertiary — timestamps, units. */
    tertiary: 'rgba(247,245,242,.5)',
    /** Group labels and inactive tab labels. Handoff said .45/.42; both failed. */
    label: 'rgba(247,245,242,.47)',
  },
  /**
   * Cream has no light text ramp, and this is the file that found out.
   *
   * The handoff specifies .6 body / .5 tertiary / .45 label. Measured over
   * #F4F0E9 those are 4.48:1, 3.29:1 and 2.95:1 — all short of AA, and raising
   * them to pass collapses all three onto the same value, because ink-on-cream
   * runs out of headroom at about .61.
   *
   * So cream gets two text levels instead of three, and anything that wanted the
   * third uses the solid `color.mutedText` (#6C6A63, 4.77:1) — which is the
   * handoff's own token for helper text on cream.
   */
  onCream: {
    body: 'rgba(22,23,26,.72)',
    /** Step counters and group labels. The floor — nothing lighter clears AA. */
    label: 'rgba(22,23,26,.61)',
  },
} as const;

/**
 * Hairlines.
 *
 * Depth comes from soft shadow and filled surfaces. A hairline only divides rows
 * INSIDE a surface — on a phone at arm's length a 1px rule doing structural work
 * is invisible, and it gives a tappable area no bounds.
 */
export const hairline = {
  /** Rules between rows inside a card. */
  inner: 'rgba(255,255,255,.07)',
  card: 'rgba(255,255,255,.08)',
  /** Sheet top edge and the tab bar. */
  sheet: 'rgba(255,255,255,.09)',
  /** A secondary button's edge. */
  emphasis: 'rgba(255,255,255,.13)',
  onCream: 'rgba(22,23,26,.1)',
} as const;

/** Spacing, on the handoff's scale. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Screen gutters. Different by ground, per the handoff. */
export const GUTTER_INK = 22;
export const GUTTER_CREAM = 28;
export const GUTTER_SHEET = 20;

/** Clearance above the floating tab bar, so a pinned action is never under it. */
export const TABBAR_CLEARANCE_3 = 116;
export const TABBAR_CLEARANCE_4 = 108;

export const radius = {
  /** Buttons, chips, pills, tab bar, avatars, progress tracks. */
  round: 100,
  /** Tracking sheets. */
  sheetTrack: 32,
  sheet: 30,
  offer: 26,
  review: 24,
  card: 22,
  input: 20,
  row: 18,
  tile: 16,
  notice: 14,
  tileSm: 13,
  tileXs: 12,
  key: 9,
  /** The destination square on a route rail. Nearly square, deliberately. */
  marker: 3,
} as const;

/**
 * Type.
 *
 * Two families carry the product. Instrument Serif is reserved for questions and
 * hero numbers — ONE display statement per screen. Two serif headlines on one
 * screen is a bug. Archivo does everything else.
 *
 * Every token names a fontFamily. None sets fontWeight: React Native does not
 * synthesize weights for custom families, so a weight without a family is a
 * silent no-op. See faces.ts.
 */
export const font = {
  // ── Instrument Serif: questions and hero numbers only ──
  /** The price on T2. The largest type in the product. */
  priceHero: { fontFamily: face.serif, fontSize: 76, lineHeight: 68, letterSpacing: -1.5 },
  /** Driver payout, D2. */
  payoutHero: { fontFamily: face.serif, fontSize: 52, lineHeight: 49, letterSpacing: -1 },
  /** Payout on an offer card, D1. */
  payout: { fontFamily: face.serif, fontSize: 44, lineHeight: 40, letterSpacing: -0.8 },
  /** Screen headline, N1/N6/T5. */
  displayLg: { fontFamily: face.serif, fontSize: 44, lineHeight: 46, letterSpacing: -0.6 },
  /** Screen headline, question screens. */
  display: { fontFamily: face.serif, fontSize: 42, lineHeight: 45, letterSpacing: -0.5 },
  /** The estimate range, S9. */
  estimate: { fontFamily: face.serif, fontSize: 38, lineHeight: 40, letterSpacing: -0.4 },
  /** A question inside a sheet, where there is less room than on cream. */
  question: { fontFamily: face.serif, fontSize: 32, lineHeight: 35, letterSpacing: -0.3 },

  // ── Archivo: everything else ──
  /** Greetings and statements. */
  statement: { fontFamily: face.archivo700, fontSize: 21, lineHeight: 26, letterSpacing: -0.5 },
  /** Card and row titles. */
  title: { fontFamily: face.archivo700, fontSize: 18, lineHeight: 23, letterSpacing: -0.3 },
  rowTitle: { fontFamily: face.archivo700, fontSize: 16, lineHeight: 21, letterSpacing: -0.2 },

  /**
   * The primary button label. >=18.66px bold, and this must not drop.
   *
   * White on #F1551F measures 3.47:1. AA wants 4.5:1 for normal text and 3:1 for
   * large text, where "large" for bold starts at 18.66px (14pt). The handoff
   * specifies 17px, which fails outright. Darkening does not rescue it either —
   * #d9430f on white is 4.41:1, still short. So the type crosses the large-text
   * threshold instead, keeping the committed brand orange intact.
   *
   * 18px would still fail. The bar is 18.66. This is the single deliberate
   * deviation from the handoff's type scale, and it is an accessibility floor.
   */
  button: { fontFamily: face.archivo700, fontSize: 19, lineHeight: 24 },
  /** Secondary and tertiary button labels — not on accent, so free of the above. */
  buttonSecondary: { fontFamily: face.archivo600, fontSize: 16, lineHeight: 21 },

  /** Values and strong labels. */
  value: { fontFamily: face.archivo600, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: face.archivo400, fontSize: 14.5, lineHeight: 22 },
  bodySmall: { fontFamily: face.archivo400, fontSize: 13, lineHeight: 20 },
  /** Chips, captions, timestamps. */
  caption: { fontFamily: face.archivo600, fontSize: 12.5, lineHeight: 17 },
  /** Uppercase tracked group labels. */
  groupLabel: {
    fontFamily: face.archivo700,
    fontSize: 12.5,
    lineHeight: 16,
    letterSpacing: 1.5,
  },
  /** Tab bar labels. At the 12.5px floor deliberately — see BODY_FLOOR. */
  tabLabel: { fontFamily: face.archivo700, fontSize: 12.5, lineHeight: 15 },
  /** Load references. The one place a monospace face is honest. */
  reference: { fontFamily: 'Menlo', fontSize: 14.5, lineHeight: 19, letterSpacing: 0.4 },
} as const;

export type FontToken = keyof typeof font;
type TextStyleish = { fontFamily: string; fontSize: number; lineHeight: number; letterSpacing?: number };

/**
 * Adapt a Latin type token for Arabic.
 *
 * Three changes, from the handoff plus one hazard it didn't call out: swap to
 * the Plex Arabic face one weight step lighter (Plex Arabic runs optically
 * heavier than Archivo, so matching the nominal weight makes Arabic shout),
 * loosen the leading — 1.35 on headings and 1.7 on body, against 1.06 and
 * 1.55 — and drop `letterSpacing` entirely.
 *
 * That last one is not cosmetic. Arabic is a cursive, joined script — glyphs
 * connect to their neighbours to form a letter. Any positive tracking (several
 * type tokens carry it, e.g. `groupLabel`'s 1.5 and the display tokens'
 * negative values) forces those glyphs apart and breaks the joins, which reads
 * as broken text, not just loosely set text. Do not "restore" this — it is not
 * an oversight.
 *
 * Encoded here so no screen has to remember any of it.
 */
export function arabicize<T extends TextStyleish>(style: T): T {
  const isHeading = style.fontSize >= 21;
  return {
    ...style,
    fontFamily: arabicFaceFor(style.fontFamily),
    lineHeight: Math.round(style.fontSize * (isHeading ? 1.35 : 1.7)),
    letterSpacing: undefined,
  };
}

/**
 * Depth.
 *
 * Soft shadow and filled surfaces do the structural work. These are restrained
 * on purpose — the tell of a cheap app is a 20px blur at 0.2 opacity, not the
 * presence of a shadow.
 */
export const elevation = {
  /** A card resting on cream. */
  cardCream: {
    shadowColor: '#16171A',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  /** An input on cream. */
  inputCream: {
    shadowColor: '#16171A',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  /** A selected card on cream — the accent carries the shadow. */
  selectedCream: {
    shadowColor: color.accent,
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  /** A raised card on ink, e.g. the offer card. */
  cardInk: {
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 44,
    shadowOffset: { width: 0, height: 18 },
    elevation: 8,
  },
  /** A bottom sheet. Reads at its top edge, not underneath. */
  sheet: {
    shadowColor: '#000',
    shadowOpacity: 0.65,
    shadowRadius: 44,
    shadowOffset: { width: 0, height: -18 },
    elevation: 16,
  },
  /** The floating tab bar. */
  tabBar: {
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 38,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  /** Only the filled primary button gets a coloured shadow. */
  accentButton: {
    shadowColor: color.accent,
    shadowOpacity: 0.34,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
} as const;

/**
 * Map scrims, so type stays legible over geometry. Which one depends on how much
 * map is showing. Consumed by P1 — defined here so the values live with the rest
 * of the system.
 */
export const scrim = {
  /** Map fills the upper ~470px (S1, S3, S4). */
  topHeavy: {
    colors: ['rgba(11,12,15,.55)', 'rgba(11,12,15,0)', 'rgba(11,12,15,0)', '#0B0C0F'],
    locations: [0, 0.22, 0.58, 1],
  },
  /** Full-bleed hero (N1). */
  hero: {
    colors: ['rgba(11,12,15,.2)', 'rgba(11,12,15,.75)', '#0B0C0F'],
    locations: [0, 0.46, 0.66],
  },
  /** Reduced band, where the decision is the screen (T2). */
  band: {
    colors: ['rgba(11,12,15,.5)', 'rgba(11,12,15,.2)', '#0B0C0F'],
    locations: [0, 0.4, 1],
  },
} as const;

export const motion = {
  /** Primary press down. */
  press: 90,
  /** Press release. */
  release: 140,
  /** A selection confirming before the flow advances. */
  confirm: 180,
  /** The progress bar growing. */
  progress: 240,
  /** Screen transition. */
  screen: 260,
  /** The corridor drawing itself in. */
  corridor: 420,
} as const;

/** Every tap target clears 44pt. Non-negotiable — drivers wear gloves. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TARGET = 44;
/** The pinned primary action, at the thumb. */
export const CTA_HEIGHT = 58;
/** Body copy floor. Nothing carrying words goes below this. */
export const BODY_FLOOR = 12.5;
