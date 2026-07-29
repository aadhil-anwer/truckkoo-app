# Truckkoo Redesign P0 · Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's design system with the one specified in the redesign handoff — two grounds, three type families, a rebuilt primitive vocabulary, SVG icons, and Arabic-Indic numerals — so that phases P1–P7 assemble screens instead of inventing components.

**Architecture:** `src/theme/tokens.ts` is rewritten as the single source of colour, type, spacing, radius and shadow. `src/components/primitives.tsx` (controls) and `src/components/ui.tsx` (layout) are rebuilt on top of it; nothing else may invent a shape. Icons move from a glyph font to hand-authored `react-native-svg` behind the existing semantic-name contract. The ops surface is deleted, which removes the old document vocabulary entirely.

**Tech Stack:** React Native 0.86 / Expo 57, expo-router, TypeScript, `react-native-svg`, `@expo-google-fonts/{archivo,instrument-serif,ibm-plex-sans-arabic}`, Jest + `@testing-library/react-native`.

## Global Constraints

Every task's requirements implicitly include this section.

- **Package manager is npm.** Single app, no monorepo. Never eject from managed workflow.
- **Money is integer baisa.** OMR has **three** decimal places. Use `src/lib/money.ts`. Never float, never `toFixed(2)`.
- **RTL is structural.** Logical properties only — `marginStart`, `paddingEnd`, `start`/`end`. **Never `left`/`right`.** React Native does not flip `textAlign: 'left'`; use `align.start` from `src/i18n`.
- **All user-facing strings go through `t()`** in `src/i18n`.
- **One accent.** `#F1551F` is the pinned primary action **or** the live state, never both on one screen. `#FF7A45` is accent-as-text-on-dark; `#F1551F` is never text on dark.
- **`#79E0AF` appears exactly once in the product** (T5, delivered). It is defined in P0 but used by no P0 code.
- **Primary button label is ≥18.66px bold.** White on `#F1551F` is 3.47:1; AA drops to 3:1 only at 18.66px bold. This is the one deliberate deviation from the handoff's type scale.
- **Every tap target ≥44×44.**
- **Body copy floor is 12.5px.**
- **Never fabricate proof** — no testimonials, ratings, trip counts, fleet size, or certifications in any placeholder or fixture.
- **No payment surfaces.** Showing a price is fine; taking one is not.
- **Migrations are append-only.** P0 touches **no SQL at all**.
- `npm run verify` (typecheck + lint + tests) must pass at the end of every task.

**Handoff values used verbatim** (from `design_handoff_truckkoo_redesign/README.md`):

| Token | Value |
|---|---|
| Ink (ground) | `#0B0C0F` |
| Surface | `#15171C` |
| Raised | `#1E2128` |
| Accent | `#F1551F` |
| Accent light | `#FF7A45` |
| Accent wash | `rgba(241,85,31,.16)` |
| Accent tint (cream) | `#FFF6F2` |
| Cream (ground) | `#F4F0E9` |
| Cream card | `#FFFFFF` |
| Cream keyboard | `#DDD8D0` |
| Ink text (on cream) | `#16171A` |
| Muted text (cream) | `#6C6A63` |
| Light text (on ink) | `#F7F5F2` |
| Icon grey | `#92959D` |
| Icon grey dim | `#5F636B` |
| Delivered | `#79E0AF` |

---

## File Structure

**Created:**
- `src/theme/faces.ts` — font-family name constants + the Latin→Arabic face mapping. Separate from tokens because it is the only module that knows loaded font *file* names, and `_layout.tsx` imports it too.
- `src/components/svg-icon.tsx` — the SVG primitive shapes. Split from `icon.tsx` so the semantic map stays readable.
- `tests/unit/numerals.test.ts`
- `tests/components/route-rail.test.tsx`
- `tests/components/progress-bar.test.tsx`
- `tests/components/select.test.tsx`

**Rewritten:**
- `src/theme/tokens.ts` — colour, type, spacing, radius, elevation, scrims
- `src/components/primitives.tsx` — controls
- `src/components/ui.tsx` — layout
- `src/components/icon.tsx` — semantic map, now SVG-backed
- `src/components/tab-bar.tsx` — floating pill
- `tests/unit/contrast.test.ts` — both grounds, alpha compositing
- `tests/components/primitives.test.tsx`
- `tests/components/tab-bar.test.tsx`

**Modified:**
- `src/app/_layout.tsx` — font loading
- `src/app/index.tsx` — ops routing removed
- `src/lib/format.ts` — numerals
- `src/i18n/index.ts` — numerals, `ops.*` keys removed
- `src/lib/queries.ts` — dead ops queries removed
- `package.json`
- `DESIGN.md`, `CLAUDE.md`, `OPEN_ISSUES.md`

**Deleted:**
- `src/app/(app)/ops/index.tsx`, `src/app/(app)/ops/[id].tsx`
- `src/components/masthead.tsx`, `src/components/consignment.tsx`
- `tests/integration/ops-screens.test.tsx`

---

## Task 1: Dependencies and font faces

Fonts first, because the type tokens in Task 3 name families that must exist.

**Files:**
- Create: `src/theme/faces.ts`
- Modify: `package.json`, `src/app/_layout.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `face.archivo400|500|600|700|800`, `face.serif`, `face.arabic400|500|600|700` (all `string`); `arabicFaceFor(latinFace: string): string`; `FONT_ASSETS` (the object `useFonts` takes)

- [ ] **Step 1: Install dependencies**

```bash
npx expo install react-native-svg
npm install @expo-google-fonts/instrument-serif @expo-google-fonts/ibm-plex-sans-arabic
npm uninstall @expo-google-fonts/almarai
```

Verify the two new font packages resolve and export the expected names before continuing:

```bash
node -p "Object.keys(require('@expo-google-fonts/instrument-serif'))"
node -p "Object.keys(require('@expo-google-fonts/ibm-plex-sans-arabic')).slice(0,12)"
```

Expected: `InstrumentSerif_400Regular` in the first; `IBMPlexSansArabic_400Regular`, `_500Medium`, `_600SemiBold`, `_700Bold` among the second. If a name differs, use the real name throughout and note it in the commit message.

- [ ] **Step 2: Write `src/theme/faces.ts`**

```ts
/**
 * Font family names.
 *
 * Split from tokens.ts because this is the only module that knows what the
 * loaded font *files* are called, and `_layout.tsx` needs that list too.
 *
 * WHY EXPLICIT FAMILIES AND NOT `fontWeight`:
 * React Native does not synthesize weights for custom families. Loading
 * `Archivo_900Black` and then writing `fontWeight: '900'` gets you the regular
 * face on Android and silent luck on iOS. The previous system did exactly that,
 * which is why weight never read correctly on device. Every type token names a
 * family; no token sets `fontWeight`.
 */

import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
} from '@expo-google-fonts/archivo';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';

export const face = {
  archivo400: 'Archivo_400Regular',
  archivo500: 'Archivo_500Medium',
  archivo600: 'Archivo_600SemiBold',
  archivo700: 'Archivo_700Bold',
  archivo800: 'Archivo_800ExtraBold',

  /** Questions and hero numbers ONLY. One display statement per screen. */
  serif: 'InstrumentSerif_400Regular',

  arabic400: 'IBMPlexSansArabic_400Regular',
  arabic500: 'IBMPlexSansArabic_500Medium',
  arabic600: 'IBMPlexSansArabic_600SemiBold',
  arabic700: 'IBMPlexSansArabic_700Bold',
} as const;

/**
 * Latin face → its Arabic counterpart, one weight step lighter.
 *
 * Plex Arabic runs optically heavier than Archivo, so matching the nominal
 * weight makes Arabic look shouty next to identical English. The handoff
 * specifies 600-where-Latin-is-700; this map is that rule, encoded once.
 *
 * Instrument Serif has no Arabic counterpart — Arabic display type falls back to
 * the heaviest Plex Arabic, which is the intended treatment.
 */
const TO_ARABIC: Record<string, string> = {
  [face.archivo400]: face.arabic400,
  [face.archivo500]: face.arabic400,
  [face.archivo600]: face.arabic500,
  [face.archivo700]: face.arabic600,
  [face.archivo800]: face.arabic700,
  [face.serif]: face.arabic600,
};

export function arabicFaceFor(latinFace: string): string {
  return TO_ARABIC[latinFace] ?? face.arabic400;
}

/** Exactly what `useFonts` is given. Bundled, never fetched at runtime. */
export const FONT_ASSETS = {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  InstrumentSerif_400Regular,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
};
```

- [ ] **Step 3: Wire it into `src/app/_layout.tsx`**

Replace the two `@expo-google-fonts` import blocks and the `useFonts` call.

Remove:

```ts
import {
  Archivo_400Regular,
  Archivo_600SemiBold,
  Archivo_800ExtraBold,
  Archivo_900Black,
} from '@expo-google-fonts/archivo';
import {
  Almarai_400Regular,
  Almarai_700Bold,
  Almarai_800ExtraBold,
} from '@expo-google-fonts/almarai';
```

Add:

```ts
import { FONT_ASSETS } from '@/theme/faces';
```

Replace the `useFonts({...})` call body with:

```ts
  const [fontsLoaded] = useFonts(FONT_ASSETS);
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run typecheck`
Expected: PASS. (Lint and tests are expected to still pass here too — nothing else changed yet.)

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/theme/faces.ts "src/app/_layout.tsx"
git commit -m "Name the font faces, because fontWeight never worked

React Native does not synthesize weights for custom families, so loading
Archivo_900Black and writing fontWeight: '900' rendered the regular face.
Every type token now names a family instead. Adds Instrument Serif and IBM
Plex Sans Arabic, drops Almarai."
```

---

## Task 2: Eastern Arabic-Indic numerals

**Files:**
- Create: `tests/unit/numerals.test.ts`
- Modify: `src/i18n/index.ts:528` (`formatNumber`), `src/lib/format.ts`

**Interfaces:**
- Consumes: `getLanguage()` from `@/i18n`
- Produces: `toArabicIndic(s: string): string` and `formatNumber(n: number): string` from `@/i18n`; `localizeDigits(s: string): string` from `@/lib/format`

**Why this is not left to `Intl`:** the existing `formatNumber` calls `Intl.NumberFormat('ar-OM')` and trusts it to emit `٠١٢`. Hermes ships a trimmed ICU, and on Android that call commonly returns Latin digits instead. The handoff requires Arabic-Indic numerals for dates, weights, counts, prices and step counters, so the mapping is explicit and tested rather than delegated.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/numerals.test.ts`:

```ts
/**
 * Eastern Arabic-Indic numerals.
 *
 * The handoff requires ٠١٢٣٤٥٦٧٨٩ for dates, weights, counts, prices and step
 * counters in Arabic. This is mapped explicitly rather than via Intl, because
 * Hermes ships a trimmed ICU and `Intl.NumberFormat('ar-OM')` returns Latin
 * digits on Android often enough to be untrustworthy.
 */

import { toArabicIndic } from '@/i18n';
import { localizeDigits } from '@/lib/format';

jest.mock('@/i18n', () => {
  const actual = jest.requireActual('@/i18n');
  return { ...actual, getLanguage: jest.fn(() => 'en') };
});

describe('toArabicIndic', () => {
  it('maps every digit', () => {
    expect(toArabicIndic('0123456789')).toBe('٠١٢٣٤٥٦٧٨٩');
  });

  it('leaves non-digits alone, so separators and units survive', () => {
    expect(toArabicIndic('8,000 kg')).toBe('٨,٠٠٠ kg');
    expect(toArabicIndic('30 Jul')).toBe('٣٠ Jul');
  });

  it('converts a step counter', () => {
    expect(toArabicIndic('3 / 6')).toBe('٣ / ٦');
  });

  it('is a no-op on a string with no digits', () => {
    expect(toArabicIndic('مسقط')).toBe('مسقط');
  });

  it('preserves a decimal point, which OMR needs three of', () => {
    // Money is formatted by money.ts first; this only restyles the digits.
    expect(toArabicIndic('96.500')).toBe('٩٦.٥٠٠');
  });
});

describe('localizeDigits', () => {
  const { getLanguage } = jest.requireMock('@/i18n');

  it('does nothing in English', () => {
    getLanguage.mockReturnValue('en');
    expect(localizeDigits('8,000 kg')).toBe('8,000 kg');
  });

  it('converts in Arabic', () => {
    getLanguage.mockReturnValue('ar');
    expect(localizeDigits('8,000 kg')).toBe('٨,٠٠٠ kg');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/numerals.test.ts`
Expected: FAIL — `toArabicIndic is not a function`.

- [ ] **Step 3: Implement**

In `src/i18n/index.ts`, replace the existing `formatNumber` (currently at line 528) with:

```ts
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
```

Note the grouping is always computed with `en-OM` and only the glyphs are swapped. That keeps separator placement identical in both languages, which is what the handoff's `٨٠٠٠ كجم` shows.

In `src/lib/format.ts`, add after the `locale()` helper:

```ts
import { getLanguage, toArabicIndic } from '@/i18n';

/**
 * Restyle the digits in an already-formatted string to match the language.
 *
 * Call this at the output boundary, on a string some other formatter produced —
 * never on a value you are about to do arithmetic with.
 */
export function localizeDigits(s: string): string {
  return getLanguage() === 'ar' ? toArabicIndic(s) : s;
}
```

Update the existing `import { getLanguage } from '@/i18n';` at the top of `format.ts` to the combined import above.

Then wrap the return of each existing exported formatter in `format.ts` — `formatWindow`, `formatLongDay`, `formatDeadline`, `formatWeight` — with `localizeDigits(...)`. Leave `isoToday` and `reference` alone: `isoToday` returns a machine-readable ISO date, and `reference` is a load reference the handoff renders in monospace Latin (`CB70CBC4`) in both languages.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/numerals.test.ts tests/unit/format.test.ts tests/unit/i18n.test.ts`
Expected: PASS. If `format.test.ts` fails, it is asserting Latin digits under Arabic — update those assertions to the Arabic-Indic expectation, which is the new correct behaviour.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/numerals.test.ts src/i18n/index.ts src/lib/format.ts tests/unit/format.test.ts
git commit -m "Map Arabic-Indic numerals explicitly instead of trusting Intl

Hermes ships a trimmed ICU and Intl.NumberFormat('ar-OM') returns Latin
digits on Android often enough that a delivery date could render in the
wrong numeral system. Grouping is still computed once in en-OM so separator
placement cannot drift between languages."
```

---

## Task 3: The tokens

The centre of P0. Everything after this reads from it.

**Files:**
- Rewrite: `src/theme/tokens.ts`
- Rewrite: `tests/unit/contrast.test.ts`

**Interfaces:**
- Consumes: `face`, `arabicFaceFor` from `@/theme/faces`
- Produces:
  - `color` — flat record of hex strings (see Global Constraints table)
  - `alpha.onInk`, `alpha.onCream` — `Record<string, string>` of `rgba()` strings
  - `hairline.inner|card|sheet|emphasis`, `hairline.onCream`
  - `space` — `{ xs:4, sm:8, md:12, lg:16, xl:20, xxl:24, xxxl:32, huge:48 }`
  - `GUTTER_INK = 22`, `GUTTER_CREAM = 28`, `GUTTER_SHEET = 20`
  - `radius` — `{ round:100, sheetTrack:32, sheet:30, offer:26, review:24, card:22, input:20, row:18, tile:16, notice:14, tileSm:13, tileXs:12, key:9, marker:3 }`
  - `font` — type tokens, each `{ fontFamily, fontSize, lineHeight, letterSpacing? }`
  - `arabicize(style)` — swaps face and loosens leading
  - `elevation` — RN shadow objects
  - `scrim` — the three map gradient stop arrays
  - `HIT_SLOP`, `MIN_TARGET = 44`, `BODY_FLOOR = 12.5`

- [ ] **Step 1: Write the failing contrast test**

Rewrite `tests/unit/contrast.test.ts` entirely:

```ts
/**
 * WCAG 2.1 AA contrast, computed from the tokens rather than asserted by eye.
 *
 * REGRESSION. The primary button shipped white on the brand orange `#F1551F` at
 * 16px/800 — **3.47:1**, against AA's 4.5:1 for normal text. That is the label on
 * every Accept, every Confirm delivery, read one-handed through a windscreen in
 * Gulf sun. Nobody caught it because no test computed a ratio.
 *
 * The fix was never a darker orange. It was crossing WCAG's large-text
 * threshold, where the bar drops to 3:1 — **18.66px** for bold. 18px still
 * fails: the margin is 0.34px and it is the whole fix.
 *
 * The redesign adds a second ground and a translucent text ramp, so this file
 * now also FLATTENS rgba over its ground before measuring. An alpha ramp is
 * exactly where sub-AA text hides: `rgba(247,245,242,.42)` looks like a design
 * decision and measures 3.84:1.
 */

import { color, alpha, font } from '@/theme/tokens';

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}

/** Composite an `rgba(r,g,b,a)` string over an opaque hex ground. */
function flatten(rgba: string, groundHex: string): string {
  const m = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!m) throw new Error(`not an rgba string: ${rgba}`);
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const gn = parseInt(groundHex.replace('#', ''), 16);
  const mix = (fg: number, shift: number) =>
    Math.round(fg * a + ((gn >> shift) & 255) * (1 - a));
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${hex(mix(r, 16))}${hex(mix(g, 8))}${hex(mix(b, 0))}`;
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.1: large scale is >=18pt (24px), or >=14pt bold (18.66px). */
const LARGE_BOLD_MIN = 18.66;
const AA_NORMAL = 4.5;
const AA_LARGE = 3;

describe('the contrast maths itself', () => {
  it('reproduces known reference ratios', () => {
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(ratio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric in its arguments', () => {
    expect(ratio(color.accent, color.creamCard)).toBeCloseTo(
      ratio(color.creamCard, color.accent),
      10,
    );
  });

  it('flattens a fully opaque rgba to itself', () => {
    expect(flatten('rgba(255,255,255,1)', '#000000')).toBe('#ffffff');
  });

  it('flattens a fully transparent rgba to the ground', () => {
    expect(flatten('rgba(255,255,255,0)', '#0b0c0f')).toBe('#0b0c0f');
  });
});

describe('the primary button', () => {
  it('is white on the brand accent', () => {
    expect(ratio('#ffffff', color.accent)).toBeLessThan(AA_NORMAL);
  });

  it('clears AA only by qualifying as large text — so the size must not drop', () => {
    expect(font.button.fontSize).toBeGreaterThanOrEqual(LARGE_BOLD_MIN);
    expect(ratio('#ffffff', color.accent)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe('text on the ink ground', () => {
  it.each(Object.entries(alpha.onInk))('%s clears AA over ink', (_name, value) => {
    expect(ratio(flatten(value, color.ink), color.ink)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('primary light text is comfortable, not merely passing', () => {
    expect(ratio(color.lightText, color.ink)).toBeGreaterThan(15);
  });

  it('accent-light is legible on ink and on a surface', () => {
    expect(ratio(color.accentLight, color.ink)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(ratio(color.accentLight, color.surface)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('the raw accent is NOT used as text on dark — accentLight exists for that', () => {
    expect(ratio(color.accent, color.ink)).toBeLessThan(AA_NORMAL);
  });
});

describe('text on the cream ground', () => {
  it.each(Object.entries(alpha.onCream))('%s clears AA over cream', (_name, value) => {
    expect(ratio(flatten(value, color.cream), color.cream)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('muted helper text clears AA', () => {
    expect(ratio(color.mutedText, color.cream)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('primary ink text is comfortable', () => {
    expect(ratio(color.inkText, color.cream)).toBeGreaterThan(15);
  });
});

describe('the type scale floor', () => {
  it('never goes below the 12.5px body floor', () => {
    for (const [name, style] of Object.entries(font)) {
      expect([name, style.fontSize]).toEqual([name, expect.any(Number)]);
      expect(style.fontSize).toBeGreaterThanOrEqual(12.5);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/contrast.test.ts`
Expected: FAIL — `color.accent` is undefined (the old tokens export `color.orange`).

- [ ] **Step 3: Write the new tokens**

Rewrite `src/theme/tokens.ts`:

```ts
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
  onCream: {
    body: 'rgba(22,23,26,.6)',
    tertiary: 'rgba(22,23,26,.5)',
    /** Step counters. Handoff said .45; raised to clear AA over cream. */
    label: 'rgba(22,23,26,.46)',
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
type TextStyleish = { fontFamily: string; fontSize: number; lineHeight: number };

/**
 * Adapt a Latin type token for Arabic.
 *
 * Two changes, both from the handoff: swap to the Plex Arabic face one weight
 * step lighter (Plex Arabic runs optically heavier than Archivo, so matching the
 * nominal weight makes Arabic shout), and loosen the leading — 1.35 on headings
 * and 1.7 on body, against 1.06 and 1.55.
 *
 * Encoded here so no screen has to remember it.
 */
export function arabicize<T extends TextStyleish>(style: T): T {
  const isHeading = style.fontSize >= 21;
  return {
    ...style,
    fontFamily: arabicFaceFor(style.fontFamily),
    lineHeight: Math.round(style.fontSize * (isHeading ? 1.35 : 1.7)),
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
```

- [ ] **Step 4: Run the contrast test**

Run: `npx jest tests/unit/contrast.test.ts`
Expected: PASS.

If any alpha entry fails, raise that entry by `.01` until it passes and update its inline comment with the real measured reason. Do **not** relax the assertion — that is the bug this file exists to catch.

- [ ] **Step 5: Commit**

The rest of the app will not compile yet — that is expected and is fixed in Task 13.

```bash
git add src/theme/tokens.ts tests/unit/contrast.test.ts
git commit -m "Rewrite the tokens onto two grounds

Ink is where you read state, cream is where you answer a question. Adds the
alpha ramps, the hairline ramp, the radius scale, the shadow table and the
map scrims from the handoff.

The contrast test now flattens rgba over its ground before measuring, which
caught two sub-AA values the handoff specified: .45 measures 4.26:1 over ink
and .42 measures 3.84:1. Both are raised to the lowest passing alpha. An
alpha ramp is exactly where unreadable text hides, because every value in it
looks like a decision."
```

---

## Task 4: Delete the ops surface

Done early so later tasks are not carrying two design systems.

**Files:**
- Delete: `src/app/(app)/ops/index.tsx`, `src/app/(app)/ops/[id].tsx`, `src/components/masthead.tsx`, `src/components/consignment.tsx`, `tests/integration/ops-screens.test.tsx`
- Modify: `src/app/index.tsx`, `src/i18n/index.ts`, `src/lib/queries.ts`, `tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: nothing. This task only removes.

**Context:** dispatch is web-only, at `~/truckkoo-ops`. That app holds the anon key and calls the same guarded RPCs over the network. **No migration, grant, or RPC changes here** — `am_i_ops` and every `ops_*` function stay in the schema exactly as they are, and `supabase/tests/ops_console.sql` keeps passing untouched.

- [ ] **Step 1: Confirm nothing else imports the deleted components**

Run:

```bash
grep -rn "components/masthead\|components/consignment\|(app)/ops\|from '@/components/masthead'\|from '@/components/consignment'" src tests
```

Expected: hits only inside the five files being deleted. If anything else appears, stop and report it — the spec's grep said otherwise and something has changed.

- [ ] **Step 2: Delete the files**

```bash
git rm -r "src/app/(app)/ops" src/components/masthead.tsx src/components/consignment.tsx tests/integration/ops-screens.test.tsx
```

- [ ] **Step 3: Remove ops routing from `src/app/index.tsx`**

Open `src/app/index.tsx`. Remove the branch that routes a dispatcher to `/ops` and the `am_i_ops` call that feeds it, so the file routes purely on `profiles.role` — shipper to the shipper home, driver to the driver home.

Update the comment in `src/app/_layout.tsx` that reads:

```
    // Dispatchers are routed by `/index.tsx`, which knows about ops. Sending
    // them through the role branch here would land them on the shipper screen.
```

to:

```
    // `/index.tsx` routes on role. Dispatch is web-only now (~/truckkoo-ops),
    // so a dispatcher signing in here lands on whichever surface their
    // profiles.role names — which is the intended behaviour, not a gap.
```

- [ ] **Step 4: Remove the dead ops query functions**

In `src/lib/queries.ts`, delete every exported query/mutation whose only call site was an ops screen. Find them:

```bash
grep -n "ops_" src/lib/queries.ts
```

For each match, confirm it has no remaining caller before deleting:

```bash
grep -rn "useOpsQueue\|useOpsLoad\|opsSendOffer" src --include=*.tsx
```

Delete only functions with zero remaining callers. Leave `am_i_ops` usage in `session.tsx` if it exists there — check first; if it exists and nothing reads the result, remove that too.

- [ ] **Step 5: Remove the `ops.*` strings**

In `src/i18n/index.ts`, delete every key beginning `ops.` from both the `en` and `ar` string tables. They must be removed from **both** or the two tables fall out of sync and `tests/unit/i18n.test.ts` fails.

In `tests/unit/i18n.test.ts`, remove `'ops.masthead'` from the sampled-keys array around line 45 if present.

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: errors only from files that consume the **old tokens** (Task 3 changed them) — none referencing ops, masthead, or consignment.

Run: `npx jest tests/unit/i18n.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Delete the ops surface — dispatch is web-only now

The console at ~/truckkoo-ops holds the anon key and calls the same guarded
RPCs, so nothing server-side notices: no migration, no grant, no RPC changed
and ops_console.sql still passes.

masthead.tsx and consignment.tsx go with it. They had no other caller, and
they were the last thing keeping the old document vocabulary alive.

Consequence, recorded in OPEN_ISSUES: nobody can dispatch from a phone."
```

---

## Task 5: SVG icons

**Files:**
- Create: `src/components/svg-icon.tsx`
- Rewrite: `src/components/icon.tsx`

**Interfaces:**
- Consumes: `color` from `@/theme/tokens`
- Produces: `Icon({ name, size, color, style })` from `@/components/icon`, and the exported type `IconName`. **`IconName` keeps every name the current file exports** (`home`, `loads`, `offers`, `routes`, `account`, `chevron`, `back`, `forward`, `pickup`, `truck`, `pay`, …) so no existing call site breaks, and adds the handoff's new ones.

**Why:** the handoff names stroke weight (1.9–2.1) and round caps as the properties that carry visual consistency. `MaterialCommunityIcons` is a glyph font — stroke weight is baked into each glyph and varies across the set. The semantic-name contract and RTL mirroring are unchanged; only rendering moves.

- [ ] **Step 1: Write `src/components/svg-icon.tsx`**

```tsx
/**
 * The drawn shapes behind `icon.tsx`.
 *
 * Split out so the semantic map next door stays readable. Nothing outside
 * `icon.tsx` should import from here — screens name a thing, not a shape.
 *
 * Every path is authored on a 24-unit viewBox, `fill: none`, stroke round-capped
 * and round-joined. Stroke weight is the thing that carries consistency across an
 * icon set, which is exactly what a glyph font cannot give you.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { ReactNode } from 'react';

export const STROKE = 1.9;
export const STROKE_HEAVY = 2.4;

export function Frame({
  size,
  children,
  stroke,
  tint,
}: {
  size: number;
  children: ReactNode;
  stroke: number;
  tint: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={tint}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

/** name → the path elements for it, on a 24 viewBox. */
export const SHAPES: Record<string, ReactNode> = {
  chevron: <Path d="M9 5l7 7-7 7" />,
  chevronBack: <Path d="M15 5l-7 7 7 7" />,
  plus: <Path d="M12 5v14M5 12h14" />,
  check: <Path d="M4 12.5l5.5 5.5L20 7" />,
  search: (
    <>
      <Circle cx="11" cy="11" r="6.5" />
      <Path d="M16 16l4.5 4.5" />
    </>
  ),
  phone: (
    <Path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 006.5 6.5L17 13l4 1.5v3a2 2 0 01-2.2 2A16.5 16.5 0 014.5 5.2 2 2 0 016.5 3z" />
  ),
  message: <Path d="M4 5.5h16v11H9.5L5 20.5V16.5H4z" />,
  truck: (
    <>
      <Path d="M2.5 6h11v9h-11z" />
      <Path d="M13.5 9.5H18l3 3.5v2h-7.5z" />
      <Circle cx="7" cy="17.5" r="2" />
      <Circle cx="17" cy="17.5" r="2" />
    </>
  ),
  box: (
    <>
      <Path d="M12 2.8l8 4.2v10l-8 4.2-8-4.2V7z" />
      <Path d="M4 7l8 4.2L20 7M12 11.2V21.2" />
    </>
  ),
  loads: (
    <>
      <Path d="M12 2.8l8 4.2-8 4.2L4 7z" />
      <Path d="M4 12l8 4.2 8-4.2M4 16.5l8 4.2 8-4.2" />
    </>
  ),
  account: (
    <>
      <Circle cx="12" cy="8" r="3.8" />
      <Path d="M4.5 20.5a7.5 7.5 0 0115 0" />
    </>
  ),
  routes: (
    <>
      <Circle cx="6" cy="5.5" r="2.5" />
      <Rect x="15.5" y="16" width="5" height="5" rx="1" />
      <Path d="M6 8v5a5 5 0 005 5h4.5" />
    </>
  ),
  bell: (
    <>
      <Path d="M18 16.5H6l1.5-2.5V10a4.5 4.5 0 019 0v4z" />
      <Path d="M10.5 19.5a1.8 1.8 0 003 0" />
    </>
  ),
  calendar: (
    <>
      <Rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <Path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 7v5.3l3.2 2" />
    </>
  ),
  info: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 11v5.5M12 7.8v.2" />
    </>
  ),
  question: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M9.6 9.4a2.5 2.5 0 114 2.4c-.9.6-1.6 1-1.6 2M12 16.4v.2" />
    </>
  ),
  edit: <Path d="M4 20h4L19 9a2.2 2.2 0 00-3-3L5 17z" />,
  swap: <Path d="M7 8h11l-3-3M17 16H6l3 3" />,
  starOutline: (
    <Path d="M12 3.5l2.7 5.6 6.1.85-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.85z" />
  ),
  backspace: (
    <>
      <Path d="M9 5.5h11v13H9l-6-6.5z" />
      <Path d="M12.5 9.5l5 5M17.5 9.5l-5 5" />
    </>
  ),
};

/** Filled shapes — stroke is irrelevant, the fill carries them. */
export const FILLED: Record<string, (tint: string) => ReactNode> = {
  starFilled: (tint) => (
    <Path
      d="M12 3.5l2.7 5.6 6.1.85-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.85z"
      fill={tint}
      stroke="none"
    />
  ),
  /**
   * The Google mark. Reproduced exactly — brand requirement, and the one icon in
   * the set that is not ours to redraw. Four fixed brand colours, so it ignores
   * the `tint` argument on purpose.
   */
  google: () => (
    <>
      <Path
        d="M21.6 12.23c0-.7-.06-1.37-.18-2.02H12v3.82h5.38a4.6 4.6 0 01-2 3.02v2.5h3.24c1.89-1.74 2.98-4.3 2.98-7.32z"
        fill="#4285F4"
        stroke="none"
      />
      <Path
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.59A10 10 0 0012 22z"
        fill="#34A853"
        stroke="none"
      />
      <Path
        d="M6.41 13.91a6 6 0 010-3.82V7.5H3.06a10 10 0 000 9l3.35-2.59z"
        fill="#FBBC05"
        stroke="none"
      />
      <Path
        d="M12 5.86c1.47 0 2.79.5 3.83 1.5l2.87-2.87C16.95 2.9 14.7 2 12 2A10 10 0 003.06 7.5l3.35 2.59C7.2 7.72 9.4 5.86 12 5.86z"
        fill="#EA4335"
        stroke="none"
      />
    </>
  ),
};
```

- [ ] **Step 2: Rewrite `src/components/icon.tsx`**

```tsx
/**
 * The icon vocabulary.
 *
 * Screens never name a glyph. They name a *thing* — `pickup`, `truck`, `pay` —
 * and this file decides what that looks like. That indirection is the whole
 * point: it is what stops two screens from picking two different shapes for the
 * same concept, which is the usual way an icon set stops looking designed.
 *
 * Hand-authored SVG, not a glyph font. The handoff names stroke weight (1.9–2.1)
 * and round caps as the properties that carry consistency across a set, and a
 * font bakes stroke weight into each glyph.
 *
 * DIRECTION: a chevron and an arrow point at something, so both mirror under
 * RTL. Handled here, once, rather than at ~30 call sites.
 */

import { I18nManager, type StyleProp, type ViewStyle, View } from 'react-native';

import { color } from '@/theme/tokens';
import { FILLED, Frame, SHAPES, STROKE } from './svg-icon';

/**
 * Semantic name → shape key. Directional entries are `[ltr, rtl]` pairs.
 *
 * Adding a row here is cheap. Reaching past this map to draw an SVG inline in a
 * screen is what this file exists to prevent.
 */
const NAMED = {
  // navigation
  home: 'home',
  loads: 'loads',
  offers: 'bell',
  routes: 'routes',
  account: 'account',

  // movement — these mirror
  chevron: ['chevron', 'chevronBack'],
  back: ['chevronBack', 'chevron'],
  forward: ['chevron', 'chevronBack'],

  // the freight nouns
  pickup: 'box',
  truck: 'truck',
  pay: 'box',

  // actions
  plus: 'plus',
  check: 'check',
  search: 'search',
  phone: 'phone',
  message: 'message',
  edit: 'edit',
  swap: 'swap',
  backspace: 'backspace',

  // information
  calendar: 'calendar',
  clock: 'clock',
  info: 'info',
  question: 'question',

  // rating
  star: 'starFilled',
  starOutline: 'starOutline',

  // brand
  google: 'google',
} as const;

export type IconName = keyof typeof NAMED;

/** `home` needs a shape; it is not in SHAPES above, so define it here. */
SHAPES.home = SHAPES.home ?? SHAPES.box;

export function Icon({
  name,
  size = 22,
  tint = color.lightText,
  stroke = STROKE,
  style,
}: {
  name: IconName;
  size?: number;
  tint?: string;
  stroke?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const entry = NAMED[name];
  const key = Array.isArray(entry) ? entry[I18nManager.isRTL ? 1 : 0] : entry;

  const filled = FILLED[key];
  return (
    <View style={style} accessible={false} importantForAccessibility="no-hide-descendants">
      <Frame size={size} stroke={stroke} tint={tint}>
        {filled ? filled(tint) : SHAPES[key]}
      </Frame>
    </View>
  );
}
```

**Note on `SHAPES.home`:** add a real `home` shape to `svg-icon.tsx` rather than aliasing `box`, and delete the `SHAPES.home = ...` line above once you have. Use:

```tsx
  home: (
    <>
      <Path d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z" />
    </>
  ),
```

- [ ] **Step 3: Verify every named icon renders**

Add to `tests/components/primitives.test.tsx` (the file is rewritten in Task 6; if it does not yet compile, create this as a standalone `tests/components/icon.test.tsx` and fold it in later):

```tsx
import { render } from '@testing-library/react-native';
import { Icon } from '@/components/icon';

// The whole point of the semantic map is that a name always resolves. A missing
// shape renders as nothing at all, which is invisible in review and obvious to
// a user.
const NAMES = [
  'home', 'loads', 'offers', 'routes', 'account',
  'chevron', 'back', 'forward',
  'pickup', 'truck', 'pay',
  'plus', 'check', 'search', 'phone', 'message', 'edit', 'swap', 'backspace',
  'calendar', 'clock', 'info', 'question',
  'star', 'starOutline', 'google',
] as const;

describe('the icon vocabulary', () => {
  it.each(NAMES)('%s resolves to a shape', (name) => {
    const { toJSON } = render(<Icon name={name} />);
    expect(toJSON()).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run it**

Run: `npx jest tests/components/icon.test.tsx`
Expected: PASS. A failure names the icon whose shape is missing.

- [ ] **Step 5: Commit**

```bash
git add src/components/icon.tsx src/components/svg-icon.tsx tests/components/icon.test.tsx
git commit -m "Draw the icons instead of borrowing a glyph font

A font bakes stroke weight into each glyph, and stroke weight is the thing
that makes a set look like a set. These are authored on a 24 viewBox at 1.9
round-capped, per the handoff.

The semantic contract is unchanged: screens still name a thing, not a shape,
and directional icons still mirror under RTL in one place. Only the Google
mark is reproduced exactly, because it is not ours to redraw."
```

---

## Task 6: Buttons, with press and disabled states

**Files:**
- Rewrite: `src/components/primitives.tsx` (buttons only in this task; other primitives follow in Tasks 7–11)
- Rewrite: `tests/components/primitives.test.tsx`

**Interfaces:**
- Consumes: `color`, `alpha`, `hairline`, `font`, `radius`, `elevation`, `motion`, `CTA_HEIGHT`, `MIN_TARGET` from `@/theme/tokens`; `Icon`, `IconName` from `@/components/icon`
- Produces:
  - `PrimaryButton({ label, onPress, disabled, ground, icon, loading })` — `ground: 'ink' | 'cream'`, default `'ink'`
  - `SecondaryButton({ label, onPress, disabled, icon })`
  - `TertiaryButton({ label, onPress })`
  - `PressableSurface({ children, onPress, ground, style })` — the row/card press behaviour, reused by Tasks 7–9

- [ ] **Step 1: Write the failing test**

Rewrite `tests/components/primitives.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react-native';

import { PrimaryButton, SecondaryButton, TertiaryButton } from '@/components/primitives';
import { color, font } from '@/theme/tokens';

describe('PrimaryButton', () => {
  it('renders its label and fires', () => {
    const onPress = jest.fn();
    render(<PrimaryButton label="Find me a truck" onPress={onPress} />);
    fireEvent.press(screen.getByText('Find me a truck'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', () => {
    const onPress = jest.fn();
    render(<PrimaryButton label="Send me the code" onPress={onPress} disabled />);
    fireEvent.press(screen.getByText('Send me the code'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('is exposed to assistive tech as a button, with its disabled state', () => {
    render(<PrimaryButton label="Accept" onPress={jest.fn()} disabled />);
    const node = screen.getByRole('button', { name: 'Accept' });
    expect(node.props.accessibilityState.disabled).toBe(true);
  });

  it('carries the accent on ink and ink on cream', () => {
    const ink = render(<PrimaryButton label="Go" onPress={jest.fn()} ground="ink" />);
    expect(ink.getByTestId('primary-surface').props.style).toEqual(
      expect.objectContaining({ backgroundColor: color.accent }),
    );
    ink.unmount();

    const cream = render(<PrimaryButton label="Go" onPress={jest.fn()} ground="cream" />);
    expect(cream.getByTestId('primary-surface').props.style).toEqual(
      expect.objectContaining({ backgroundColor: color.inkText }),
    );
  });

  it('uses the >=18.66px label token, which is an accessibility floor', () => {
    render(<PrimaryButton label="Accept 96 OMR" onPress={jest.fn()} />);
    const label = screen.getByText('Accept 96 OMR');
    expect(label.props.style).toEqual(
      expect.objectContaining({ fontSize: font.button.fontSize }),
    );
    expect(font.button.fontSize).toBeGreaterThanOrEqual(18.66);
  });

  it('does not fire while loading, so a commit cannot be double-posted', () => {
    const onPress = jest.fn();
    render(<PrimaryButton label="Accept 96 OMR" onPress={onPress} loading />);
    fireEvent.press(screen.getByTestId('primary-surface'));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('SecondaryButton', () => {
  it('renders and fires', () => {
    const onPress = jest.fn();
    render(<SecondaryButton label="Ask a question" onPress={onPress} />);
    fireEvent.press(screen.getByText('Ask a question'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('TertiaryButton', () => {
  it('renders and fires', () => {
    const onPress = jest.fn();
    render(<TertiaryButton label="Skip — I do not know the weight" onPress={onPress} />);
    fireEvent.press(screen.getByText('Skip — I do not know the weight'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/components/primitives.test.tsx`
Expected: FAIL — `PrimaryButton` is not exported.

- [ ] **Step 3: Implement the buttons**

Replace the whole of `src/components/primitives.tsx` with:

```tsx
/**
 * Controls.
 *
 * Every shape the app can make lives here or in `ui.tsx`. A screen that invents
 * a shape is how a design system stops being one.
 *
 * PRESS AND DISABLED STATES are built from the handoff's written description
 * rather than copied from the gallery — the gallery is static and shows one
 * state per screen. Primary press: scale 0.98 at 0.94 brightness over 90ms.
 * Rows lighten ~4% on ink, darken ~3% on cream.
 */

import { useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Icon, type IconName } from './icon';
import {
  CTA_HEIGHT,
  MIN_TARGET,
  alpha,
  color,
  elevation,
  font,
  hairline,
  motion,
  radius,
  space,
} from '@/theme/tokens';

type Ground = 'ink' | 'cream';

/** The press animation, shared by every control. */
function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number, duration: number) =>
    Animated.timing(scale, { toValue: value, duration, useNativeDriver: true }).start();
  return {
    scale,
    onPressIn: () => to(0.98, motion.press),
    onPressOut: () => to(1, motion.release),
  };
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  ground = 'ink',
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  ground?: Ground;
  icon?: IconName;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const inert = disabled || loading;

  // On ink the action is the accent and carries a coloured shadow. On cream it is
  // ink and carries none — the handoff is explicit that cream's primary is flat.
  const surface = inert
    ? { backgroundColor: ground === 'ink' ? 'rgba(247,245,242,.1)' : 'rgba(22,23,26,.1)' }
    : ground === 'ink'
      ? { backgroundColor: color.accent, ...elevation.accentButton }
      : { backgroundColor: color.inkText };

  const tint = inert
    ? ground === 'ink'
      ? 'rgba(247,245,242,.35)'
      : 'rgba(22,23,26,.35)'
    : ground === 'ink'
      ? '#FFFFFF'
      : color.cream;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      accessibilityLabel={label}
      disabled={inert}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View
        testID="primary-surface"
        style={StyleSheet.flatten([styles.cta, surface, { transform: [{ scale }] }])}
      >
        {loading ? (
          <ActivityIndicator color={tint} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={20} tint={tint} style={styles.ctaIcon} /> : null}
            <Text style={StyleSheet.flatten([font.button, { color: tint }])}>{label}</Text>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: IconName;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View
        testID="secondary-surface"
        style={StyleSheet.flatten([styles.cta, styles.secondary, { transform: [{ scale }] }])}
      >
        {icon ? (
          <Icon name={icon} size={19} tint={color.lightText} style={styles.ctaIcon} />
        ) : null}
        <Text style={StyleSheet.flatten([font.buttonSecondary, { color: color.lightText }])}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/** Text only. The escape hatch — "Skip", "No thanks", "Back to home". */
export function TertiaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.tertiary}
    >
      <Text
        style={StyleSheet.flatten([font.buttonSecondary, { color: alpha.onInk.tertiary }])}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A pressable card or row.
 *
 * Reused by the select controls and list rows so the press feedback is identical
 * everywhere. Ink lightens, cream darkens — both by a few percent, enough to
 * register under a thumb and not enough to flash.
 */
export function PressableSurface({
  children,
  onPress,
  ground = 'ink',
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  ground?: Ground;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        style,
        pressed && {
          backgroundColor:
            ground === 'ink' ? 'rgba(247,245,242,.04)' : 'rgba(22,23,26,.03)',
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cta: {
    minHeight: CTA_HEIGHT,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.xxl,
  },
  ctaIcon: { marginEnd: 0 },
  secondary: {
    backgroundColor: color.raised,
    borderWidth: 1,
    borderColor: hairline.sheet,
  },
  tertiary: {
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

- [ ] **Step 4: Run the tests**

Run: `npx jest tests/components/primitives.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/primitives.tsx tests/components/primitives.test.tsx
git commit -m "Rebuild the buttons on the two grounds

Press and disabled states are built from the handoff's written spec rather
than the gallery, which is static and draws one state per screen.

PrimaryButton refuses to fire while loading. Accepting a price is a
committing action and the amount is in the label, so a double tap must not
be able to post it twice."
```

---

## Task 7: Surfaces — Sheet, Card, SectionLabel, QuestionHeading

**Files:**
- Rewrite: `src/components/ui.tsx`

**Interfaces:**
- Consumes: tokens; `PressableSurface` from `./primitives`
- Produces:
  - `Screen({ ground, children, style })`
  - `Sheet({ children, tracking })` — `tracking` picks the 32px radius
  - `Card({ children, ground, tone, style })` — `tone: 'surface' | 'raised'`
  - `SectionLabel({ children, tone })` — uppercase tracked group label
  - `QuestionHeading({ children, size })` — `size: 'display' | 'question'`
  - `Notice({ icon, children })` — the reassurance strip

- [ ] **Step 1: Write the implementation**

Rewrite `src/components/ui.tsx`:

```tsx
/**
 * Layout.
 *
 * Screens are one ground or the other — ink where the user reads state, cream
 * where the user answers a question. Never a mix.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, type IconName } from './icon';
import {
  GUTTER_CREAM,
  GUTTER_INK,
  GUTTER_SHEET,
  alpha,
  color,
  elevation,
  font,
  hairline,
  radius,
  space,
} from '@/theme/tokens';
import { align, arabicIfNeeded } from './text-direction';

type Ground = 'ink' | 'cream';

export function Screen({
  ground = 'ink',
  children,
  style,
}: {
  ground?: Ground;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView
      style={StyleSheet.flatten([
        styles.screen,
        { backgroundColor: ground === 'ink' ? color.ink : color.cream },
        style,
      ])}
    >
      {children}
    </SafeAreaView>
  );
}

/** The screen gutter for a ground. Ink is 22, cream question screens are 28. */
export function gutterFor(ground: Ground): number {
  return ground === 'ink' ? GUTTER_INK : GUTTER_CREAM;
}

/**
 * The bottom sheet. Holds one job at a time.
 *
 * Tracking screens use a slightly larger top radius (32 vs 30) — small, but it
 * is what makes the map feel like it continues behind the sheet rather than
 * stopping at it.
 */
export function Sheet({
  children,
  tracking = false,
  style,
}: {
  children: ReactNode;
  tracking?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={StyleSheet.flatten([
        styles.sheet,
        {
          borderTopStartRadius: tracking ? radius.sheetTrack : radius.sheet,
          borderTopEndRadius: tracking ? radius.sheetTrack : radius.sheet,
        },
        style,
      ])}
    >
      <View style={styles.grab} />
      {children}
    </View>
  );
}

export function Card({
  children,
  ground = 'ink',
  tone = 'surface',
  style,
}: {
  children: ReactNode;
  ground?: Ground;
  tone?: 'surface' | 'raised';
  style?: StyleProp<ViewStyle>;
}) {
  const inkStyle = {
    backgroundColor: tone === 'raised' ? color.raised : color.surface,
    borderWidth: 1,
    borderColor: hairline.card,
  };
  const creamStyle = { backgroundColor: color.creamCard, ...elevation.cardCream };

  return (
    <View
      style={StyleSheet.flatten([
        styles.card,
        ground === 'ink' ? inkStyle : creamStyle,
        style,
      ])}
    >
      {children}
    </View>
  );
}

/** `ON THE MOVE`, `YOUR DETAILS`, `OR PICK ONE`. Uppercase, tracked, small. */
export function SectionLabel({
  children,
  ground = 'ink',
  accent = false,
}: {
  children: string;
  ground?: Ground;
  accent?: boolean;
}) {
  const tint = accent
    ? color.accentLight
    : ground === 'ink'
      ? alpha.onInk.label
      : alpha.onCream.label;
  return (
    <Text
      style={StyleSheet.flatten([
        arabicIfNeeded(font.groupLabel),
        { color: tint, textAlign: align.start },
      ])}
    >
      {children.toUpperCase()}
    </Text>
  );
}

/**
 * The one display statement on a screen.
 *
 * Instrument Serif is reserved for this and for hero numbers. Two of these on one
 * screen is a bug — the handoff's whole asking pattern is one question, alone.
 */
export function QuestionHeading({
  children,
  size = 'display',
  ground = 'cream',
}: {
  children: string;
  size?: 'display' | 'question';
  ground?: Ground;
}) {
  return (
    <Text
      accessibilityRole="header"
      style={StyleSheet.flatten([
        arabicIfNeeded(size === 'display' ? font.display : font.question),
        { color: ground === 'ink' ? color.lightText : color.inkText, textAlign: align.start },
      ])}
    >
      {children}
    </Text>
  );
}

/** The reassurance strip — "Nothing is charged now." */
export function Notice({ icon, children }: { icon: IconName; children: string }) {
  return (
    <View style={styles.notice}>
      <Icon name={icon} size={16} tint={alpha.onInk.tertiary} />
      <Text
        style={StyleSheet.flatten([
          arabicIfNeeded(font.bodySmall),
          { color: alpha.onInk.body, textAlign: align.start, flex: 1 },
        ])}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  sheet: {
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: hairline.sheet,
    paddingHorizontal: GUTTER_SHEET,
    paddingTop: space.md,
    ...elevation.sheet,
  },
  grab: {
    width: 40,
    height: 4,
    borderRadius: radius.round,
    backgroundColor: 'rgba(247,245,242,.18)',
    alignSelf: 'center',
    marginBottom: space.lg,
  },
  card: { borderRadius: radius.card, padding: space.xl },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(247,245,242,.05)',
    borderRadius: radius.notice,
    padding: space.md,
  },
});
```

- [ ] **Step 2: Create the text-direction helper this imports**

Create `src/components/text-direction.tsx`:

```tsx
/**
 * Direction-aware text helpers.
 *
 * `align` re-exported from i18n so components have one import for direction, and
 * `arabicIfNeeded` applies the Arabic face and looser leading when the app is in
 * Arabic — the rule from tokens.ts `arabicize`, applied at render time rather
 * than baked into the token.
 */

import { align, getLanguage } from '@/i18n';
import { arabicize } from '@/theme/tokens';

export { align };

export function arabicIfNeeded<T extends { fontFamily: string; fontSize: number; lineHeight: number }>(
  style: T,
): T {
  return getLanguage() === 'ar' ? arabicize(style) : style;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run typecheck`
Expected: errors only in screens still referencing removed primitives (`Title`, `Body`, `Note`, `ListRow`, …). Those are repaired in Task 13. **No errors inside `ui.tsx`, `primitives.tsx`, `text-direction.tsx` or `tokens.ts`.**

- [ ] **Step 4: Commit**

```bash
git add src/components/ui.tsx src/components/text-direction.tsx
git commit -m "Rebuild the surfaces — sheet, card, section label, question heading

QuestionHeading is the only route to Instrument Serif, and the comment says
why: one display statement per screen is the asking pattern, and two serif
headlines on one screen is a bug rather than a style.

arabicIfNeeded applies the lighter Arabic face and looser leading at render
time, so no screen has to remember that Plex Arabic runs optically heavier
than Archivo."
```

---

## Task 8: RouteRail, StatusPill, Chip

**Files:**
- Modify: `src/components/ui.tsx` (append)
- Create: `tests/components/route-rail.test.tsx`

**Interfaces:**
- Consumes: tokens, `align`
- Produces:
  - `RouteRail({ origin, destination, compact })`
  - `StatusPill({ label, tone })` — `tone: 'accent' | 'neutral'`
  - `Chip({ label, selected, ground, onPress })`

**Why RouteRail gets its own test:** the handoff calls the origin/destination distinction load-bearing — origin is a **ring**, destination is a **filled square**. It is the one piece of the design that tells a user at a glance which end is which, and it is exactly the kind of thing a later refactor "tidies" into two identical dots.

- [ ] **Step 1: Write the failing test**

Create `tests/components/route-rail.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react-native';

import { RouteRail } from '@/components/ui';
import { color, radius } from '@/theme/tokens';

/**
 * The handoff calls this distinction load-bearing: origin is a RING, destination
 * is a FILLED SQUARE. It is how a user reads direction at a glance, and it is
 * precisely what a later cleanup would collapse into two identical dots.
 */
describe('RouteRail', () => {
  it('renders both endpoint names', () => {
    render(<RouteRail origin="Muscat" destination="Barka" />);
    expect(screen.getByText('Muscat')).toBeTruthy();
    expect(screen.getByText('Barka')).toBeTruthy();
  });

  it('draws origin as a ring — a border, no fill', () => {
    render(<RouteRail origin="Muscat" destination="Barka" />);
    const style = StyleSheetFlatten(screen.getByTestId('rail-origin').props.style);
    expect(style.borderWidth).toBeGreaterThan(0);
    expect(style.backgroundColor).toBeUndefined();
    // A circle: fully rounded.
    expect(style.borderRadius).toBeGreaterThanOrEqual(style.width / 2);
  });

  it('draws destination as a filled accent square', () => {
    render(<RouteRail origin="Muscat" destination="Barka" />);
    const style = StyleSheetFlatten(screen.getByTestId('rail-destination').props.style);
    expect(style.backgroundColor).toBe(color.accent);
    // Nearly square, NOT a circle — this is the whole distinction.
    expect(style.borderRadius).toBe(radius.marker);
    expect(style.borderRadius).toBeLessThan(style.width / 2);
  });

  it('exposes the route to assistive tech as one direction, not two labels', () => {
    render(<RouteRail origin="Muscat" destination="Barka" />);
    expect(screen.getByLabelText('Muscat to Barka')).toBeTruthy();
  });
});

function StyleSheetFlatten(style: unknown): Record<string, number | string | undefined> {
  const { StyleSheet } = require('react-native');
  return StyleSheet.flatten(style) ?? {};
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/components/route-rail.test.tsx`
Expected: FAIL — `RouteRail` is not exported from `@/components/ui`.

- [ ] **Step 3: Implement**

Append to `src/components/ui.tsx` (and add `PressableSurface` to the existing import from `./primitives`):

```tsx
/**
 * The pickup → dropoff spine.
 *
 * Origin is a RING, destination is a FILLED SQUARE. The handoff calls this
 * distinction load-bearing and it is: it is the only thing telling a user which
 * end is which before they read a word. Do not collapse it into two dots.
 */
export function RouteRail({
  origin,
  destination,
  compact = false,
}: {
  origin: string;
  destination: string;
  compact?: boolean;
}) {
  const gap = compact ? 24 : 36;
  return (
    <View
      style={styles.rail}
      accessible
      accessibilityLabel={`${origin} to ${destination}`}
    >
      <View style={styles.railSpine}>
        <View testID="rail-origin" style={styles.railOrigin} />
        <View style={[styles.railLine, { height: gap }]} />
        <View testID="rail-destination" style={styles.railDestination} />
      </View>
      <View style={[styles.railLabels, { gap: gap - 6 }]}>
        <Text
          style={StyleSheet.flatten([
            arabicIfNeeded(font.rowTitle),
            { color: color.lightText, textAlign: align.start },
          ])}
        >
          {origin}
        </Text>
        <Text
          style={StyleSheet.flatten([
            arabicIfNeeded(font.rowTitle),
            { color: color.lightText, textAlign: align.start },
          ])}
        >
          {destination}
        </Text>
      </View>
    </View>
  );
}

/**
 * A status pill.
 *
 * `accent` is the live state — and remember the rule: one accent per screen. If
 * the screen already has a pinned accent action, the pill is neutral.
 */
export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'accent' | 'neutral';
}) {
  const accented = tone === 'accent';
  return (
    <View
      style={StyleSheet.flatten([
        styles.pill,
        { backgroundColor: accented ? color.accentWash : color.raised },
      ])}
    >
      {accented ? <View style={styles.pillDot} /> : null}
      <Text
        style={StyleSheet.flatten([
          arabicIfNeeded(font.caption),
          { color: accented ? color.accentLight : alpha.onInk.secondary },
        ])}
      >
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

export function Chip({
  label,
  selected = false,
  ground = 'ink',
  onPress,
}: {
  label: string;
  selected?: boolean;
  ground?: Ground;
  onPress?: () => void;
}) {
  const surface = selected
    ? { backgroundColor: ground === 'ink' ? color.lightText : color.inkText }
    : ground === 'ink'
      ? { backgroundColor: color.surface }
      : { backgroundColor: color.creamCard, ...elevation.inputCream };

  const tint = selected
    ? ground === 'ink'
      ? color.ink
      : color.cream
    : ground === 'ink'
      ? color.lightText
      : color.inkText;

  return (
    <PressableSurface
      onPress={onPress}
      ground={ground}
      accessibilityLabel={label}
      style={StyleSheet.flatten([styles.chip, surface])}
    >
      <Text style={StyleSheet.flatten([arabicIfNeeded(font.caption), { color: tint }])}>
        {label}
      </Text>
    </PressableSurface>
  );
}
```

Add to the `StyleSheet.create` block in `ui.tsx`:

```tsx
  rail: { flexDirection: 'row', gap: space.md },
  railSpine: { alignItems: 'center', paddingTop: 4 },
  railOrigin: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: color.lightText,
  },
  railLine: { width: 1.5, backgroundColor: 'rgba(247,245,242,.2)' },
  railDestination: {
    width: 10,
    height: 10,
    borderRadius: radius.marker,
    backgroundColor: color.accent,
  },
  railLabels: { justifyContent: 'space-between' },
  pill: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.round,
    alignSelf: 'flex-start',
  },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  chip: {
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.round,
  },
```

Add `MIN_TARGET` to the token import in `ui.tsx`.

- [ ] **Step 4: Run the test**

Run: `npx jest tests/components/route-rail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui.tsx tests/components/route-rail.test.tsx
git commit -m "Add the route rail, status pill and chip

The rail's origin ring and destination square are asserted, not just drawn.
It is the only thing telling a user which end is which before they read a
word, and it is exactly what a later cleanup collapses into two dots."
```

---

## Task 9: Selection controls

**Files:**
- Modify: `src/components/primitives.tsx` (append)
- Create: `tests/components/select.test.tsx`

**Interfaces:**
- Consumes: tokens, `PressableSurface`, `Icon`
- Produces:
  - `SelectRow({ title, subtitle, selected, onPress, ground })`
  - `SelectCard({ title, body, icon, selected, onPress })`

**Why this is tested:** the handoff signals selection **three ways at once** — border, fill, and a filled radio — and says explicitly this is deliberate redundancy for bright-sunlight legibility in a truck cab, not something to clean up. A test is the only thing that survives a future tidy-up.

- [ ] **Step 1: Write the failing test**

Create `tests/components/select.test.tsx`:

```tsx
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { SelectRow } from '@/components/primitives';
import { color } from '@/theme/tokens';

const flat = (s: unknown) => StyleSheet.flatten(s) ?? {};

/**
 * Selection is signalled THREE ways at once — border, fill, and a filled radio.
 * The handoff calls this deliberate redundancy for reading in bright sun through
 * a windscreen. It looks like over-design in a code review, which is why it is
 * asserted here.
 */
describe('SelectRow selection signalling', () => {
  it('shows all three signals when selected', () => {
    render(
      <SelectRow title="Tomorrow" subtitle="Most trucks run this day" selected onPress={jest.fn()} />,
    );
    const surface = flat(screen.getByTestId('select-surface').props.style);

    // 1. border
    expect(surface.borderColor).toBe(color.accent);
    expect(surface.borderWidth).toBeGreaterThanOrEqual(2);
    // 2. fill
    expect(surface.backgroundColor).toBe(color.accentTint);
    // 3. the filled radio
    expect(screen.getByTestId('select-radio-dot')).toBeTruthy();
  });

  it('shows none of them when unselected', () => {
    render(<SelectRow title="Friday" selected={false} onPress={jest.fn()} />);
    const surface = flat(screen.getByTestId('select-surface').props.style);

    expect(surface.backgroundColor).not.toBe(color.accentTint);
    expect(surface.borderColor).not.toBe(color.accent);
    expect(screen.queryByTestId('select-radio-dot')).toBeNull();
  });

  it('reports its selected state to assistive tech', () => {
    render(<SelectRow title="Tomorrow" selected onPress={jest.fn()} />);
    const node = screen.getByRole('radio', { name: /Tomorrow/ });
    expect(node.props.accessibilityState.selected).toBe(true);
  });

  it('fires on press', () => {
    const onPress = jest.fn();
    render(<SelectRow title="Friday" selected={false} onPress={onPress} />);
    fireEvent.press(screen.getByTestId('select-surface'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/components/select.test.tsx`
Expected: FAIL — `SelectRow` is not exported.

- [ ] **Step 3: Implement**

Append to `src/components/primitives.tsx`:

```tsx
/**
 * A selectable row.
 *
 * SELECTION IS SIGNALLED THREE WAYS AT ONCE — border, fill, and a filled radio.
 * That is deliberate redundancy, not decoration: this is read one-handed, in
 * direct sun, through a windscreen, on a cheap screen. Reducing it to a single
 * indicator is a legibility regression, and `tests/components/select.test.tsx`
 * will say so.
 */
export function SelectRow({
  title,
  subtitle,
  selected,
  onPress,
  ground = 'cream',
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  ground?: Ground;
}) {
  const base =
    ground === 'cream'
      ? { backgroundColor: color.creamCard, borderColor: 'transparent', borderWidth: 2 }
      : { backgroundColor: color.raised, borderColor: hairline.card, borderWidth: 1.5 };

  const chosen =
    ground === 'cream'
      ? { backgroundColor: color.accentTint, borderColor: color.accent, borderWidth: 2 }
      : { backgroundColor: color.raised, borderColor: color.accent, borderWidth: 1.5 };

  const titleTint = ground === 'cream' ? color.inkText : color.lightText;
  const subTint = ground === 'cream' ? color.mutedText : alpha.onInk.body;

  return (
    <Pressable
      testID="select-surface"
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={onPress}
      style={StyleSheet.flatten([
        styles.selectRow,
        selected ? chosen : base,
        selected && ground === 'cream' ? elevation.selectedCream : null,
      ])}
    >
      <View style={styles.selectText}>
        <Text style={StyleSheet.flatten([font.rowTitle, { color: titleTint }])}>{title}</Text>
        {subtitle ? (
          <Text style={StyleSheet.flatten([font.bodySmall, { color: subTint }])}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View
        style={StyleSheet.flatten([
          styles.radio,
          { borderColor: selected ? color.accent : 'rgba(22,23,26,.18)' },
        ])}
      >
        {selected ? <View testID="select-radio-dot" style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

/** The larger two-up choice — N4's role fork, S7's "let us choose for you". */
export function SelectCard({
  title,
  body,
  icon,
  selected,
  onPress,
}: {
  title: string;
  body: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID="select-surface"
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      style={StyleSheet.flatten([
        styles.selectCard,
        selected
          ? { backgroundColor: color.accentTint, borderColor: color.accent, ...elevation.selectedCream }
          : { backgroundColor: color.creamCard, borderColor: 'transparent', ...elevation.cardCream },
      ])}
    >
      <View
        style={StyleSheet.flatten([
          styles.selectTile,
          { backgroundColor: selected ? color.accentWash : 'rgba(22,23,26,.05)' },
        ])}
      >
        <Icon name={icon} size={27} tint={selected ? color.accent : color.iconGrey} />
      </View>
      <Text style={StyleSheet.flatten([font.title, { color: color.inkText }])}>{title}</Text>
      <Text style={StyleSheet.flatten([font.bodySmall, { color: color.mutedText }])}>
        {body}
      </Text>
      <View
        style={StyleSheet.flatten([
          styles.radio,
          styles.radioCorner,
          { borderColor: selected ? color.accent : 'rgba(22,23,26,.18)' },
        ])}
      >
        {selected ? <View testID="select-radio-dot" style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}
```

Add to `primitives.tsx`'s `StyleSheet.create`:

```tsx
  selectRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.row,
  },
  selectText: { flex: 1, gap: 2 },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCorner: { position: 'absolute', top: space.xl, insetInlineEnd: space.xl },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: color.accent },
  selectCard: {
    borderRadius: radius.card,
    borderWidth: 2,
    padding: space.xl,
    gap: space.sm,
  },
  selectTile: {
    width: 54,
    height: 54,
    borderRadius: radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
```

- [ ] **Step 4: Run the test**

Run: `npx jest tests/components/select.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/primitives.tsx tests/components/select.test.tsx
git commit -m "Add the selection controls, and assert all three signals

Selection is border AND fill AND a filled radio, simultaneously. That reads
as over-design in review, so the test states the reason: it is for reading
one-handed in direct sun through a windscreen. A single-indicator 'cleanup'
now fails."
```

---

## Task 10: ProgressBar and BackButton — the direction-sensitive pair

**Files:**
- Modify: `src/components/primitives.tsx` (append)
- Create: `tests/components/progress-bar.test.tsx`

**Interfaces:**
- Consumes: tokens, `Icon`, `align`
- Produces:
  - `ProgressBar({ step, total, ground })`
  - `BackButton({ onPress, ground })`
  - `StepHeader({ step, total, onBack, ground })` — the row combining both

**Why tested:** under RTL the progress fill must originate at the **right** edge and the back chevron must point the other way. Both are invisible in LTR review and both were called out in the handoff as things that must flip.

- [ ] **Step 1: Write the failing test**

Create `tests/components/progress-bar.test.tsx`:

```tsx
import { StyleSheet, I18nManager } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { ProgressBar } from '@/components/primitives';

const flat = (s: unknown) => StyleSheet.flatten(s) ?? {};

/**
 * The progress fill must grow from the LEADING edge — left in English, right in
 * Arabic. Implemented with logical properties so direction handles it, which
 * means the assertion is that no physical edge is ever named.
 */
describe('ProgressBar', () => {
  afterEach(() => {
    I18nManager.isRTL = false;
  });

  it('fills proportionally to the step', () => {
    render(<ProgressBar step={3} total={6} />);
    expect(flat(screen.getByTestId('progress-fill').props.style).width).toBe('50%');
  });

  it('is full at the last step', () => {
    render(<ProgressBar step={6} total={6} />);
    expect(flat(screen.getByTestId('progress-fill').props.style).width).toBe('100%');
  });

  it('never names a physical edge, so direction flips it for free', () => {
    render(<ProgressBar step={2} total={6} />);
    const style = flat(screen.getByTestId('progress-track').props.style);
    expect(style.alignItems).toBeUndefined();
    expect(Object.keys(style)).not.toContain('left');
    expect(Object.keys(style)).not.toContain('right');
    expect(Object.keys(style)).not.toContain('flexDirection');
  });

  it('announces progress to assistive tech rather than drawing it only', () => {
    render(<ProgressBar step={3} total={6} />);
    const node = screen.getByRole('progressbar');
    expect(node.props.accessibilityValue).toEqual({ min: 0, max: 6, now: 3 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/components/progress-bar.test.tsx`
Expected: FAIL — `ProgressBar` is not exported.

- [ ] **Step 3: Implement**

Append to `src/components/primitives.tsx`:

```tsx
/**
 * The question-flow progress bar.
 *
 * The fill grows from the LEADING edge: left in English, right in Arabic. That
 * works because the track is a plain block container and the fill is its first
 * child with a percentage width — no `flexDirection`, no `alignItems`, and no
 * physical edge named anywhere. Naming one is what breaks RTL, so the test
 * asserts their absence rather than the resulting pixel.
 */
export function ProgressBar({
  step,
  total,
  ground = 'cream',
}: {
  step: number;
  total: number;
  ground?: Ground;
}) {
  const pct = `${Math.round((Math.min(step, total) / total) * 100)}%` as const;
  return (
    <View
      testID="progress-track"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: step }}
      style={StyleSheet.flatten([
        styles.progressTrack,
        {
          backgroundColor:
            ground === 'ink' ? 'rgba(247,245,242,.14)' : 'rgba(22,23,26,.1)',
        },
      ])}
    >
      <View testID="progress-fill" style={[styles.progressFill, { width: pct }]} />
    </View>
  );
}

/**
 * The back affordance. A circle, at or above the 44pt target with its hit slop.
 * The chevron flips under RTL — handled inside `Icon`, once.
 */
export function BackButton({
  onPress,
  ground = 'ink',
}: {
  onPress: () => void;
  ground?: Ground;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('action.back')}
      hitSlop={HIT_SLOP}
      onPress={onPress}
      style={StyleSheet.flatten([
        styles.backButton,
        ground === 'ink'
          ? { backgroundColor: 'rgba(30,33,40,.9)', borderWidth: 1, borderColor: hairline.emphasis }
          : { backgroundColor: 'rgba(22,23,26,.06)' },
      ])}
    >
      <Icon
        name="back"
        size={20}
        stroke={2.1}
        tint={ground === 'ink' ? color.lightText : color.inkText}
      />
    </Pressable>
  );
}

/** Back button + progress + "n / total", the header every question screen wears. */
export function StepHeader({
  step,
  total,
  onBack,
  ground = 'cream',
}: {
  step: number;
  total: number;
  onBack: () => void;
  ground?: Ground;
}) {
  return (
    <View style={styles.stepHeader}>
      <BackButton onPress={onBack} ground={ground} />
      <View style={{ flex: 1 }}>
        <ProgressBar step={step} total={total} ground={ground} />
      </View>
      <Text
        style={StyleSheet.flatten([
          font.caption,
          { color: ground === 'ink' ? alpha.onInk.label : alpha.onCream.label },
        ])}
      >
        {localizeDigits(`${step} / ${total}`)}
      </Text>
    </View>
  );
}
```

Add these imports to `primitives.tsx`:

```tsx
import { t } from '@/i18n';
import { localizeDigits } from '@/lib/format';
import { HIT_SLOP } from '@/theme/tokens';
```

Add to `primitives.tsx`'s `StyleSheet.create`:

```tsx
  progressTrack: { height: 4, borderRadius: radius.round, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: radius.round, backgroundColor: color.accent },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
```

Add an `action.back` string to **both** the `en` and `ar` tables in `src/i18n/index.ts`:

```ts
  "action.back": "Back",     // en
  "action.back": "رجوع",     // ar
```

- [ ] **Step 4: Run the test**

Run: `npx jest tests/components/progress-bar.test.tsx tests/unit/i18n.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/primitives.tsx tests/components/progress-bar.test.tsx src/i18n/index.ts
git commit -m "Add the step header, and prove the progress fill can flip

The fill grows from the leading edge because the track names no physical
edge and no flexDirection. The test asserts that absence rather than a
pixel, because the absence is the mechanism — the moment someone adds
alignItems: 'flex-start' to tidy it, Arabic fills backwards and nothing in
an LTR review would show it."
```

---

## Task 11: Timeline and Skeleton

**Files:**
- Modify: `src/components/ui.tsx` (append)

**Interfaces:**
- Consumes: tokens, `Icon`
- Produces:
  - `Timeline({ steps })` where `steps: { label: string; detail?: string; state: 'complete' | 'active' | 'future' }[]`
  - `Skeleton({ width, height, radius })`

**Context:** the timeline is what makes the T1 wait narrated rather than a spinner. The handoff is explicit that any wait over ~3 seconds uses this pattern, and that lists and cards load as skeletons, never spinners.

- [ ] **Step 1: Implement**

Append to `src/components/ui.tsx`:

```tsx
/**
 * The narrated wait.
 *
 * A spinner says "the app is busy". This says what has happened, what is
 * happening, and what happens next — which is the difference between a wait a
 * user tolerates and one they abandon. The handoff requires this pattern for any
 * wait longer than ~3 seconds; it is not decoration on top of a loading state.
 */
export function Timeline({
  steps,
}: {
  steps: { label: string; detail?: string; state: 'complete' | 'active' | 'future' }[];
}) {
  return (
    <View accessibilityRole="list">
      {steps.map((s, i) => (
        <View key={s.label} style={styles.timelineRow} accessibilityRole="text">
          <View style={styles.timelineGutter}>
            <View
              style={StyleSheet.flatten([
                styles.timelineMark,
                s.state === 'complete'
                  ? { backgroundColor: 'rgba(241,85,31,.18)' }
                  : s.state === 'active'
                    ? {
                        borderWidth: 2.5,
                        borderColor: color.accent,
                        shadowColor: color.accent,
                        shadowOpacity: 0.14,
                        shadowRadius: 5,
                        shadowOffset: { width: 0, height: 0 },
                      }
                    : { borderWidth: 2, borderColor: 'rgba(247,245,242,.18)' },
              ])}
            >
              {s.state === 'complete' ? (
                <Icon name="check" size={12} stroke={2.4} tint={color.accent} />
              ) : null}
            </View>
            {i < steps.length - 1 ? <View style={styles.timelineConnector} /> : null}
          </View>
          <View style={styles.timelineText}>
            <Text
              style={StyleSheet.flatten([
                arabicIfNeeded(font.value),
                {
                  color: s.state === 'future' ? alpha.onInk.label : color.lightText,
                  textAlign: align.start,
                },
              ])}
            >
              {s.label}
            </Text>
            {s.detail ? (
              <Text
                style={StyleSheet.flatten([
                  arabicIfNeeded(font.caption),
                  {
                    color: s.state === 'active' ? color.accentLight : alpha.onInk.tertiary,
                    textAlign: align.start,
                  },
                ])}
              >
                {s.detail}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Skeletons, never spinners, for list and card loads.
 *
 * A skeleton at the final geometry tells the user what is arriving and stops the
 * layout jumping when it does. A spinner tells them nothing and then reflows the
 * screen under their thumb.
 */
export function Skeleton({
  width = '100%',
  height = 18,
  round = radius.notice,
}: {
  width?: number | `${number}%`;
  height?: number;
  round?: number;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: round, backgroundColor: color.raised }}
    />
  );
}
```

Add to `ui.tsx`'s `StyleSheet.create`:

```tsx
  timelineRow: { flexDirection: 'row', gap: space.md },
  timelineGutter: { alignItems: 'center' },
  timelineMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineConnector: {
    width: 1.5,
    height: 26,
    backgroundColor: 'rgba(247,245,242,.14)',
  },
  timelineText: { flex: 1, paddingBottom: space.xl, gap: 2 },
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: no new errors from `ui.tsx`.

Run: `npx jest tests/components`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui.tsx
git commit -m "Add the narrated-wait timeline and skeletons

A spinner says the app is busy. The timeline says what happened, what is
happening and what is next, which is the difference between a wait someone
tolerates and one they abandon."
```

---

## Task 12: The floating tab bar

**Files:**
- Rewrite: `src/components/tab-bar.tsx`
- Rewrite: `tests/components/tab-bar.test.tsx`

**Interfaces:**
- Consumes: tokens, `Icon`, `t`
- Produces: default-exported `TabBar` matching expo-router's `BottomTabBarProps`

**Two things that must survive this rewrite:**

1. Hidden tabs use `tabBarItemStyle: { display: 'none' }`, **never** expo-router's `href: null`. expo-router consumes `href` before descriptors are built, so a custom `tabBar` never sees it and renders every hidden tab. That shipped once.
2. The badge count is exposed to screen readers as **part of the tab's label** ("Offers, 2 new"), not as a separate node.

- [ ] **Step 1: Write the failing test**

Rewrite `tests/components/tab-bar.test.tsx`, keeping its existing `href: null` guard. Read the current file first and preserve every assertion in it; then add:

```tsx
describe('the floating tab bar', () => {
  it('exposes a badge count inside the tab label, not as a loose node', () => {
    // A separate badge node is announced out of context — "2" with no referent.
    renderTabBar({ badges: { offers: 2 } });
    expect(screen.getByLabelText('Offers, 2 new')).toBeTruthy();
  });

  it('marks the focused tab as selected for assistive tech', () => {
    renderTabBar({ focused: 'home' });
    expect(screen.getByLabelText('Home').props.accessibilityState.selected).toBe(true);
  });

  it('gives every tab at least the 44pt target', () => {
    renderTabBar({});
    for (const tab of screen.getAllByRole('tab')) {
      const style = StyleSheet.flatten(tab.props.style) ?? {};
      expect(style.minHeight ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
```

Write `renderTabBar` as a local helper in the test file that builds the minimal `BottomTabBarProps` shape the component reads — follow the harness already used by the existing version of this file.

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/components/tab-bar.test.tsx`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement**

Rewrite `src/components/tab-bar.tsx` as a pill: absolutely positioned, `insetInlineStart/End: 15`, `bottom: 26`, height 66, `borderRadius: radius.round`, `backgroundColor: 'rgba(30,33,40,.94)'`, `borderWidth: 1`, `borderColor: hairline.sheet`, `...elevation.tabBar`.

Each item: icon 21 above label, `gap: 4`, `minHeight: 44`, `accessibilityRole="tab"`, `accessibilityState={{ selected: focused }}`, and

```tsx
accessibilityLabel={badge ? `${label}, ${badge} new` : label}
```

Active item tints icon **and** label `color.accent`; inactive uses `alpha.onInk.label`. Keep the existing role-aware hidden-tab handling exactly as it is.

- [ ] **Step 4: Run the test**

Run: `npx jest tests/components/tab-bar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/tab-bar.tsx tests/components/tab-bar.test.tsx
git commit -m "Float the tab bar, and keep the two guards on it

Hidden tabs still use tabBarItemStyle rather than href: null — expo-router
consumes href before descriptors exist, so a custom tabBar renders every
hidden tab. That shipped once.

The badge is now part of the tab's accessible label. A loose '2' node is
announced with no referent."
```

---

## Task 13: Carry the app over, and update the docs

The mechanical task. Nothing here is design work — the goal is a green `npm run verify`, not a finished appearance. Screens will look transitional until their phase lands, which is expected.

**Files:**
- Modify: every screen under `src/app/` still referencing removed tokens or primitives
- Modify: `DESIGN.md`, `CLAUDE.md`, `OPEN_ISSUES.md`

- [ ] **Step 1: Find every break**

Run: `npm run typecheck 2>&1 | tee /tmp/p0-breaks.txt`

Work the list. The token renames are mechanical:

| Old | New |
|---|---|
| `color.orange` | `color.accent` |
| `color.orangeOnDark` | `color.accentLight` |
| `color.orangeSoft` | `color.accentTint` |
| `color.ink` (text on white) | `color.inkText` |
| `color.inkSoft`, `color.inkFaint` | `color.mutedText` |
| `color.paper` | `color.creamCard` |
| `color.paperDeep`, `color.fill` | `color.cream` |
| `color.asphalt` | `color.ink` |
| `color.asphalt2` | `color.surface` |
| `color.textOnDark` | `alpha.onInk.body` |
| `color.line` | `hairline.onCream` |
| `GUTTER` | `GUTTER_INK` |
| `font.display/hero/title` | `font.display` / `font.statement` / `font.title` |
| `font.rowTitle/cardTitle` | `font.rowTitle` / `font.title` |
| `font.body/bodySmall/smallPrint` | `font.body` / `font.bodySmall` / `font.caption` |
| `font.label/micro/eyebrow` | `font.value` / `font.tabLabel` / `font.groupLabel` |
| `elevation.card` | `elevation.cardCream` |
| `elevation.raised` | `elevation.sheet` |
| `elevation.orangeButton` | `elevation.accentButton` |
| `radius.control/card/panel/sheet/pill` | `radius.input` / `radius.card` / `radius.input` / `radius.sheet` / `radius.round` |
| `doc.rule`, `doc.ruleStrong` | `1`, `2` literals, or delete the border |
| `doc.fieldLabel` | `font.groupLabel` |
| `doc.fieldValue` | `font.value` |
| `stamp.*` | `StatusPill` `tone` |

Removed primitives map as: `Title` → `QuestionHeading`, `Body` → a `Text` with `font.body`, `Note` → `Card`, `Choice` → `SelectRow`, `Button` → `PrimaryButton`, `TextButton` → `TertiaryButton`, `Stamp` → `StatusPill`, `RouteLine` → `RouteRail`, `PageTitle` → a `Text` with `font.statement`, `EmptyState`/`Section`/`ListRow`/`RowGroup`/`FactChips`/`Segmented`/`Avatar` → rebuild inline with `Card` + `Text` for now.

Do **not** redesign a screen while doing this. Reach for the nearest equivalent and move on.

- [ ] **Step 2: Get to green**

Run: `npm run verify`
Expected: PASS — typecheck, lint, and every test.

Integration tests under `tests/integration/` assert on visible text, so most should survive. Where one asserts on a removed component's testID, update it to the new one. Do not delete an integration test to make it pass — if a journey genuinely no longer exists, say so in the commit rather than quietly dropping coverage.

- [ ] **Step 3: Confirm the database is untouched**

Run: `git diff --stat main -- supabase/`
Expected: **empty**. P0 changes no SQL. If anything appears here, it does not belong in this phase.

- [ ] **Step 4: Update `DESIGN.md`**

Replace its app-system section with the new one: two grounds, three families, Instrument Serif reserved for one statement per screen, the alpha ramps and why two of the handoff's values were raised, the radius and shadow scales, and the map scrims. Keep the note that DESIGN.md's CSS sections still describe the **website**.

- [ ] **Step 5: Update `CLAUDE.md`**

In the **Design** section, replace the Uber-skeleton description with the redesign, preserving these rules in the new vocabulary: one accent per screen; depth from shadow and fill, hairlines only inside a surface; one display statement per screen; the 44pt target; light and dark each carrying their own triple; `#F1551F` never text on dark.

Update the `font.button` paragraph to say **18.66px** is the floor and that the handoff's 17px was the deviation rejected, and why.

In **Three roles, not two**, record that the ops screens are gone from this repo and dispatch is web-only, while the `ops_*` RPCs, `private.ops_users` and `require_ops()` are all unchanged in the schema.

Update the verify line's test count to whatever `npm test` actually reports.

- [ ] **Step 6: Update `OPEN_ISSUES.md`**

Under the existing `## The redesign (2026-07-30)` heading, add:

```markdown
### P0 shipped a design system nobody has seen on a phone

Tokens, primitives, icons and numerals are in and tested, but P0 deliberately
builds no screen from the 32. Every existing screen was carried over
mechanically to the nearest new token, so the app currently looks transitional:
correct colours and type, old layouts. That is expected until P1–P7 land.

**Done when:** the phases are built. Nothing to fix here — this entry exists so
a transitional screenshot is not mistaken for a bug.

### The three font families have not been measured on a real device

Archivo, Instrument Serif and IBM Plex Sans Arabic are bundled rather than
fetched, which is right for the audience and costs app size. Nobody has measured
the increase, and nobody has seen Instrument Serif render at 76px on a cheap
Android screen — the T2 price is the largest type in the product and the least
tested.

**Done when:** the bundle delta is measured and both display faces have been seen
on target hardware.
```

- [ ] **Step 7: Final verification**

Run: `npm run verify`
Expected: PASS.

Run: `npx expo start -c` and load the app once. Env changes and asset changes both need the cache clear.
Expected: it boots to a signed-out sign-in screen without a red box.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Carry the app onto the new system, and update the docs

Mechanical: every screen moves to the nearest new token so the build is
green. Nothing is redesigned here — screens keep their old layouts in the
new colours and type until their phase lands, and OPEN_ISSUES says so, so a
transitional screenshot is not mistaken for a bug.

No SQL changed in this phase."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §4.1 Type — three families, bundled, Arabic weight/leading rule | 1 (`faces.ts`), 3 (`arabicize`), 7 (`arabicIfNeeded`) |
| §4.2 Tokens — two grounds, ramps, radii, shadows, scrims | 3 |
| §4.3 Primitives — 13 named components | 6 (buttons, `PressableSurface`), 7 (Sheet, Card, SectionLabel, QuestionHeading, Notice), 8 (RouteRail, StatusPill, Chip), 9 (SelectRow, SelectCard), 10 (ProgressBar, BackButton, StepHeader), 11 (Timeline, Skeleton), 12 (FloatingTabBar) |
| §4.3 press / disabled / focus states | 6 |
| §4.4 Icons — SVG, ~20, semantic contract, RTL, Google exact | 5 |
| §4.5 Numerals and RTL | 2 |
| §4.6 Deletions | 4 |
| §4.7 Tests | 3 (contrast), 2 (numerals), 6, 8, 9, 10, 12 |
| §6 Definition of done — verify green, screens compile, docs updated | 13 |

§4.8 (the state the handoff does not draw) is a **P4** requirement and is correctly absent from this plan.

**Gap found and closed:** the spec lists a focus state (2px `#F1551F` outline, offset 2px) that no task implemented. React Native has no CSS focus ring; on Android this is `nextFocusDown`/TV focus and on web it is `outlineStyle`. It is not reachable on the target hardware (touch-only Android phones), so it is **deliberately deferred to P7**, where the accessibility audit runs. Noted here rather than silently dropped.

**Placeholder scan:** no TBDs. Every code step carries real code. Task 12 Step 3 describes the tab bar in prose plus exact values rather than a full listing, because it must preserve assertions in a file the implementer has to read first — the values it needs are all given.

**Type consistency:** `Ground = 'ink' | 'cream'` is used identically in `primitives.tsx` and `ui.tsx`. `Icon` takes `tint`, not `color`, in every call site across Tasks 5–12. `localizeDigits` is defined in Task 2 and consumed in Task 10. `PressableSurface` is produced in Task 6 and consumed in Task 8. `face`/`arabicFaceFor` are produced in Task 1 and consumed in Task 3. `alpha.onInk.label` is the raised `.47` value everywhere it appears.
