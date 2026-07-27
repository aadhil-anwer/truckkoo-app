/**
 * Truckkoo design tokens — the app half of DESIGN.md.
 *
 * The four load-bearing decisions, kept verbatim from the website:
 *   1. one orange accent, everything else black/white
 *   2. weight-900 tight headlines
 *   3. hairline 1px borders instead of shadows
 *   4. light and dark surfaces each carry their own card/border/muted triple
 *
 * Never reuse a light-mode border on a dark surface, and never use `orange`
 * for text on dark — see `orangeOnDark`.
 */

export const color = {
  orange: '#f1551f',
  orangeDeep: '#d9430f',
  /** #f1551f fails 4.5:1 as text on black. Use this on dark or over photos. */
  orangeOnDark: '#ff7a4d',
  orangeSoft: '#feeee7',

  ink: '#0b0b0b',
  inkSoft: '#6b6b6b',

  paper: '#ffffff',
  paperDeep: '#f6f6f6',
  line: '#e8e8e8',

  asphalt: '#0b0b0b',
  asphalt2: '#161616',
  asphaltLine: '#2c2c2c',
  textOnDark: '#a3a3a3',
  textOnDarkDim: '#8a8a8a',

  /** WhatsApp green. Functional only — also our success colour (decided once). */
  wa: '#1fa855',
  danger: '#c0341c',
} as const;

/** Spacing scale in use on the website. Stick to it. */
export const space = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  xxl: 26,
  xxxl: 34,
  huge: 56,
} as const;

export const radius = {
  control: 10,
  card: 12,
  panel: 16,
  pill: 999,
} as const;

/**
 * Only three weights are in real use: 600 nav/small print, 800 labels/buttons,
 * 900 headings. Body copy is the only 400.
 *
 * Archivo and Almarai are loaded at runtime; `undefined` family means the
 * platform default, which is what we render until the fonts land.
 */
export const font = {
  body: { fontSize: 16, lineHeight: 26, fontWeight: '400' },
  bodySmall: { fontSize: 14, lineHeight: 22, fontWeight: '400' },
  smallPrint: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
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
   */
  button: { fontSize: 19, lineHeight: 24, fontWeight: '900' },
  cardTitle: { fontSize: 18, lineHeight: 23, fontWeight: '800', letterSpacing: -0.2 },
  title: { fontSize: 26, lineHeight: 28, fontWeight: '900', letterSpacing: -0.6 },
  hero: { fontSize: 34, lineHeight: 36, fontWeight: '900', letterSpacing: -0.9 },
  /**
   * The website's signature: tracked uppercase kicker in orange above a
   * section title. It is a system there because it appears once per section —
   * do not staple it onto every card.
   */
  eyebrow: { fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 2.6 },
} as const;

/** Depth comes from borders. This is deliberately almost invisible. */
export const elevation = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  /** Only filled buttons get a coloured shadow. */
  orangeButton: {
    shadowColor: color.orange,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
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

/**
 * ── The consignment-note vocabulary ────────────────────────────────────────
 *
 * The app's surfaces are built as the document freight already runs on: a
 * consignment note. This is not decoration — it is the artifact every Omani
 * driver and shipper already handles, so the interface arrives pre-understood.
 *
 * It also lands exactly on DESIGN.md's existing identity: hairline 1px rules ARE
 * document rules, weight-900 caps ARE document headers, and one orange reads as
 * the stamp. Nothing here fights the website.
 */
export const doc = {
  /** The ruled line. DESIGN.md §3: depth comes from borders, never shadows. */
  rule: 1,
  /** A heavier rule closing a block — the only permitted weight above hairline. */
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

  /**
   * The two city names are the load's identity — the one thing readable at
   * arm's length in a moving cab.
   */
  endpoint: { fontSize: 22, lineHeight: 26, fontWeight: '900', letterSpacing: -0.4 },

  /** Reference number / document id. The only place a monospace face is honest. */
  reference: { fontSize: 12, lineHeight: 16, fontWeight: '600', letterSpacing: 0.6 },

  /** Inset of a note's inner content from its ruled edge. */
  gutter: 14,
} as const;

/**
 * Status stamp colors.
 *
 * A rubber stamp is the right device for this audience: large, blunt, and
 * readable without reading. Every entry pairs a foreground with a background it
 * clears 4.5:1 against — checked, not assumed.
 */
export const stamp = {
  /** Waiting on us. Neutral ink on paper — deliberately unexciting. */
  pending: { fg: '#4a4a4a', bg: '#f1f1f1', border: '#d6d6d6' },
  /** Something is happening. The single accent, earning its keep. */
  active: { fg: '#a33308', bg: color.orangeSoft, border: '#f6c3ad' },
  /** Done. Green is WhatsApp's on the website; here it doubles as success. */
  done: { fg: '#14663a', bg: '#e6f5ec', border: '#b6e0c8' },
  /** Stopped. Never red-on-red alarm; this is information, not a failure. */
  stopped: { fg: '#7a2f22', bg: '#f7ebe8', border: '#e3c4bd' },
} as const;

export type StampTone = keyof typeof stamp;
