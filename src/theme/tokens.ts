/**
 * Truckkoo design tokens — the app half of DESIGN.md.
 *
 * ── The 2026 rewire ────────────────────────────────────────────────────────
 *
 * The app used to be a consignment note: hairline rules doing all the structural
 * work, no shadows, no icons, no fills. That identity came off the website, and
 * it was internally coherent — but a website reads at desk distance and a phone
 * app does not. Held at arm's length in a cab, hairlines vanish and every block
 * on the screen weighs the same.
 *
 * So the *skeleton* is now Uber's, deliberately: surfaces with soft depth,
 * generous radii, one enormous entry point per screen, list rows carrying an
 * icon chip, and a single pinned action at the thumb. The *palette* stays ours —
 * one orange, black, white. Uber's structure, Truckkoo's colour.
 *
 * What survived the rewire, and why:
 *   - `font.button` at 19/900. This is an accessibility floor, not taste. See below.
 *   - `doc.*` and `stamp.*`. The finished consignment note is still a document,
 *     and it is the one screen where that is literally true (see load/[id].tsx).
 *   - Logical properties everywhere. RTL is structural (CLAUDE.md §4).
 */

export const color = {
  orange: '#f1551f',
  orangeDeep: '#d9430f',
  /** #f1551f fails 4.5:1 as text on white. Use this on dark or over photos. */
  orangeOnDark: '#ff7a4d',
  orangeSoft: '#feeee7',

  ink: '#0b0b0b',
  inkSoft: '#6b6b6b',
  /** Tertiary type only — timestamps, units. Never a label a decision rests on. */
  inkFaint: '#8e8e8e',

  paper: '#ffffff',
  paperDeep: '#f6f6f6',
  line: '#e8e8e8',

  /**
   * Filled neutral surfaces — the Uber device the old system had no equivalent
   * for. An icon chip, a secondary button, an unselected segment: all this grey,
   * never a border.
   */
  fill: '#f2f2f2',
  fillPress: '#e4e4e4',

  asphalt: '#0b0b0b',
  asphalt2: '#161616',
  asphaltLine: '#2c2c2c',
  textOnDark: '#a3a3a3',
  textOnDarkDim: '#8a8a8a',

  /** WhatsApp green. Functional only — also our success colour (decided once). */
  wa: '#1fa855',
  danger: '#c0341c',
} as const;

/**
 * Spacing, on an 8pt grid.
 *
 * The names are unchanged from the old 6/10/14/18/22/26/34/56 scale so no call
 * site had to be rewritten, but every value moved onto the grid. That single
 * change is most of why the app now reads as regularly spaced rather than
 * approximately spaced.
 */
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

/** The screen gutter. One number, every screen, so nothing is optically off-axis. */
export const GUTTER = 20;

export const radius = {
  /** Inputs, chips, small controls. */
  control: 12,
  /** The workhorse surface. */
  card: 16,
  /** A sheet's top corners, and full-bleed panels. */
  panel: 20,
  sheet: 24,
  pill: 999,
} as const;

/**
 * Type scale.
 *
 * Uber's hierarchy is aggressive: one very large thing per screen, then a hard
 * drop to 16. The old scale crowded four sizes between 18 and 26, which is what
 * made every screen read as one undifferentiated weight.
 */
export const font = {
  /** The one big statement per screen. "Where to?", "Arriving Friday". */
  display: { fontSize: 32, lineHeight: 36, fontWeight: '900', letterSpacing: -1 },
  hero: { fontSize: 28, lineHeight: 32, fontWeight: '900', letterSpacing: -0.8 },
  title: { fontSize: 22, lineHeight: 27, fontWeight: '900', letterSpacing: -0.5 },
  /** Section headers above a list. */
  section: { fontSize: 18, lineHeight: 23, fontWeight: '800', letterSpacing: -0.2 },
  /** A list row's first line. */
  rowTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700', letterSpacing: -0.1 },
  cardTitle: { fontSize: 18, lineHeight: 23, fontWeight: '800', letterSpacing: -0.2 },

  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodySmall: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  smallPrint: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '700' },
  /** Tab bar labels, unit suffixes, counts. The floor of the scale. */
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 0.1 },

  /**
   * 19px, not 16, and it is an accessibility fix rather than a taste one.
   *
   * White on the brand orange `#f1551f` measures **3.47:1**. WCAG 2.1 AA wants
   * 4.5:1 for normal text and 3:1 for large text, where "large" for bold starts
   * at **18.66px** (14pt). At 16px the primary button — every Accept, every
   * Confirm delivery, every Post your first load — failed AA outright.
   *
   * Darkening does not rescue it: `orangeDeep #d9430f` on white is 4.41:1, still
   * short. So the type crosses the large-text threshold instead, which keeps the
   * committed brand orange intact and is independently right for the use scene:
   * read one-handed, gloved, through a windscreen, in Gulf sun, on a cheap
   * screen. 18px would still fail — the bar is 18.66, so this must not drop.
   *
   * This survived the Uber rewire unchanged. Uber's own CTA is black and could
   * take 16px; ours is orange by decision, so it cannot.
   */
  button: { fontSize: 19, lineHeight: 24, fontWeight: '900' },
  /**
   * The website's tracked uppercase kicker. Kept for the finished consignment
   * note and nowhere else — it is a print device, and the app is no longer print.
   */
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 2.6 },
} as const;

/**
 * Depth.
 *
 * This is the rule the rewire overturned. DESIGN.md used to say depth comes from
 * borders and never shadows; on a phone that produced a flat grey field where
 * nothing announced itself as tappable. Shadows are now the primary device and
 * hairlines are the secondary one.
 *
 * They are still restrained — Uber's are barely-there too. The tell of a cheap
 * app is a 20px blur at 0.2 opacity, not the presence of a shadow at all.
 */
export const elevation = {
  /** A surface resting on the page. */
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  /** A sheet or bar floating above content. Reads at the edge, not underneath. */
  raised: {
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  /** Only the filled primary button gets a coloured shadow. */
  orangeButton: {
    shadowColor: color.orange,
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

export const motion = {
  interactive: 180,
  card: 200,
  sheet: 350,
} as const;

/** Every tap target clears 44pt. Non-negotiable — drivers wear gloves. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TARGET = 44;
/** The pinned CTA. Taller than the minimum on purpose: it is the thumb's target. */
export const CTA_HEIGHT = 56;
/** The circular chip behind a row's icon. Uber's list-row signature. */
export const CHIP = 40;

/**
 * ── The consignment-note vocabulary ────────────────────────────────────────
 *
 * Retained, but demoted. It used to be the whole app; it is now the treatment
 * for exactly one screen — the finished load in `load/[id].tsx`, which really is
 * a document a business files against an offline settlement.
 *
 * Everywhere else, a load is a card with an icon and a price, because everywhere
 * else the user is deciding rather than filing.
 */
export const doc = {
  /** The ruled line. Now a secondary device, behind fills and shadows. */
  rule: 1,
  /** A heavier rule closing a block. */
  ruleStrong: 2,

  /**
   * Field label above a ruled value, the way a printed form does it. Tracked
   * caps at small size: legible, and unmistakably not the value itself.
   */
  fieldLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  /** The value written into a field. Larger than the label, always. */
  fieldValue: { fontSize: 18, lineHeight: 24, fontWeight: '600' },

  /** The two city names on a printed note. */
  endpoint: { fontSize: 22, lineHeight: 26, fontWeight: '900', letterSpacing: -0.4 },

  /** Reference number / document id. The only place a monospace face is honest. */
  reference: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.6 },

  /** Inset of a note's inner content from its ruled edge. */
  gutter: 16,
} as const;

/**
 * Status colors.
 *
 * Now rendered as a soft filled pill rather than a rubber stamp — same job, same
 * checked contrast, less costume. Every entry pairs a foreground with a
 * background it clears 4.5:1 against.
 */
export const stamp = {
  /** Waiting on us. Neutral ink on grey — deliberately unexciting. */
  pending: { fg: '#4a4a4a', bg: '#f1f1f1', border: '#e2e2e2' },
  /** Something is happening. The single accent, earning its keep. */
  active: { fg: '#a33308', bg: color.orangeSoft, border: '#fadbcc' },
  /** Done. Green is WhatsApp's on the website; here it doubles as success. */
  done: { fg: '#14663a', bg: '#e6f5ec', border: '#cceadb' },
  /** Stopped. Never red-on-red alarm; this is information, not a failure. */
  stopped: { fg: '#7a2f22', bg: '#f7ebe8', border: '#ecd6d0' },
} as const;

export type StampTone = keyof typeof stamp;
