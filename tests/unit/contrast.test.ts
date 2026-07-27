/**
 * WCAG 2.1 AA contrast, computed from the tokens rather than asserted by eye.
 *
 * REGRESSION. The primary button shipped white `#ffffff` on the brand orange
 * `#f1551f` at 16px/800 — **3.47:1**, against AA's 4.5:1 for normal text. That is
 * the label on every Accept this load, every Confirm delivery, every Post your
 * first load, read one-handed through a windscreen in Gulf sun. Nobody caught it
 * because DESIGN.md checks orange-as-text-on-black and never checked
 * orange-as-a-fill, and no test computed a ratio.
 *
 * The fix was not a darker orange — `orangeDeep #d9430f` on white is 4.41:1, still
 * short. It was crossing WCAG's large-text threshold, where the bar drops to 3:1.
 * That threshold is **18.66px** for bold (14pt), so 18px would still fail: the
 * margin here is 0.34px and it is the whole fix. Hence `LARGE_BOLD_MIN`.
 *
 * PRODUCT.md commits to WCAG 2.1 AA and then adds sunlight legibility and cheap
 * Android screens on top, so these are floors, not targets.
 */

import { color, font, doc } from '@/theme/tokens';

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

function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.1: large scale is >=18pt (24px), or >=14pt bold (18.66px). */
const LARGE_BOLD_MIN = 18.66;
const LARGE_REGULAR_MIN = 24;

function isLarge(fontSize: number, fontWeight: string): boolean {
  const bold = Number(fontWeight) >= 700;
  return bold ? fontSize >= LARGE_BOLD_MIN : fontSize >= LARGE_REGULAR_MIN;
}

describe('the contrast maths itself', () => {
  it('reproduces known reference ratios', () => {
    // Anchors, so a broken implementation cannot silently pass everything else.
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(ratio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric in its arguments', () => {
    expect(ratio(color.orange, color.paper)).toBeCloseTo(ratio(color.paper, color.orange), 10);
  });
});

describe('the primary button clears AA', () => {
  /**
   * The exact defect this file exists for. White on `#f1551f` is 3.47:1 — it can
   * only pass by qualifying as large text, so the type size is load-bearing and
   * must never drift back down.
   */
  const contrast = ratio(color.paper, color.orange);

  it('is still relying on the large-text threshold, not on 4.5:1', () => {
    expect(contrast).toBeLessThan(4.5);
    expect(contrast).toBeGreaterThanOrEqual(3);
  });

  it('sets button type large enough for the 3:1 threshold to apply', () => {
    expect(isLarge(font.button.fontSize, font.button.fontWeight)).toBe(true);
  });

  it('keeps the button above 18.66px — 18px would fail by 0.66px', () => {
    // Spelled out because "18 looks close enough" is exactly how this regresses.
    expect(font.button.fontSize).toBeGreaterThanOrEqual(LARGE_BOLD_MIN);
    expect(Number(font.button.fontWeight)).toBeGreaterThanOrEqual(700);
  });

  it('would not be rescued by the darker orange either', () => {
    // Documents why the fix is type size and not a palette tweak.
    expect(ratio(color.paper, color.orangeDeep)).toBeLessThan(4.5);
  });
});

describe('body and label text on light surfaces', () => {
  const surfaces: [string, string][] = [
    ['paper', color.paper],
    ['paperDeep', color.paperDeep],
  ];

  it.each(surfaces)('ink clears 4.5:1 on %s', (_name, bg) => {
    expect(ratio(color.ink, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(surfaces)('muted text clears 4.5:1 on %s', (_name, bg) => {
    // inkSoft on paperDeep is 4.93:1 — the tightest passing pair in the system,
    // and the one most likely to be broken by "just slightly lighter grey".
    expect(ratio(color.inkSoft, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the error colour readable', () => {
    expect(ratio(color.danger, color.paper)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the field labels a driver reads at a glance', () => {
  it('clears 4.5:1, because they are the smallest type on the sheet', () => {
    // PICKUP / WEIGHT / REPLY BY, in direct sun, at 11px. Small type has no
    // large-text exemption available to it.
    expect(isLarge(doc.fieldLabel.fontSize, doc.fieldLabel.fontWeight)).toBe(false);
    expect(ratio(color.inkSoft, color.paper)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('which surface orange actually fails on', () => {
  /**
   * DESIGN.md §1 states: "`#f1551f` fails contrast as text on black. Use
   * `#ff7a4d` for accent text and eyebrows on dark backgrounds."
   *
   * **Measured, that is backwards.** Orange on the dark surfaces passes
   * comfortably — 5.68:1 on `--asphalt` and 5.22:1 on `--asphalt-2`. The pairing
   * that fails is orange on *white*, at 3.47:1, which DESIGN.md does not mention
   * at all.
   *
   * This is very likely why the primary button shipped broken: the documented
   * hazard pointed at the safe direction. These assertions pin the real numbers
   * so the guidance cannot drift back.
   */
  it('fails 4.5:1 on paper — the pairing DESIGN.md omits', () => {
    expect(ratio(color.orange, color.paper)).toBeLessThan(4.5);
  });

  it('passes on dark surfaces — the pairing DESIGN.md warns about', () => {
    expect(ratio(color.orange, color.ink)).toBeGreaterThanOrEqual(4.5);
  });

  it('still prefers the lightened variant on dark, on legibility not contrast', () => {
    // #ff7a4d reaches 7.63:1 against 5.68:1, so the guidance is defensible as a
    // legibility preference — saturated orange on near-black vibrates — but it is
    // not a WCAG fix, and should not be described as one.
    expect(ratio(color.orangeOnDark, color.ink)).toBeGreaterThan(ratio(color.orange, color.ink));
  });
});
