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

});

describe('the accent as text', () => {
  /**
   * The accent is a FILL, a border and a marker — not a text colour.
   *
   * On ink it would actually pass (~5.6:1); the reason it is not used there is
   * the one-accent rule, which is a design decision and not something contrast
   * maths can enforce. On cream it genuinely fails, and that is what this guards:
   * a cream question screen sets its type in `inkText`, and the accent appears
   * only as the selected-card border, the radio fill and the caret.
   */
  it('the accent is never text on cream', () => {
    expect(ratio(color.accent, color.cream)).toBeLessThan(AA_NORMAL);
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

/**
 * Error text.
 *
 * The handoff specifies no error colour, so this pair was added — and a colour
 * added without a measurement is how the 3.47:1 button happened. One red cannot
 * serve both grounds, which is why there are two.
 */
describe('error text', () => {
  it('danger clears AA on cream, which is the ground it exists for', () => {
    expect(ratio(color.danger, color.cream)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('danger is NOT used on ink — it fails there, which is why dangerLight exists', () => {
    expect(ratio(color.danger, color.ink)).toBeLessThan(AA_NORMAL);
  });

  it('dangerLight clears AA on ink and on a surface', () => {
    expect(ratio(color.dangerLight, color.ink)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(ratio(color.dangerLight, color.surface)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('is distinguishable from the accent, so an error never reads as the action', () => {
    // Not a WCAG rule — a legibility one. Two warm tones this close would be
    // indistinguishable in sunlight, and one of them means "stop".
    expect(ratio(color.dangerLight, color.accentLight)).toBeGreaterThan(1.1);
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
