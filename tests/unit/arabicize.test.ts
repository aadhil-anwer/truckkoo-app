/**
 * `arabicize` adapts a Latin type token for Arabic: it swaps the face, loosens
 * the leading, and — the part most likely to get "restored" by someone who
 * thinks it was an oversight — strips `letterSpacing`. Arabic is a cursive,
 * joined script; tracking forces the glyphs apart and breaks the joins.
 */

import { arabicize, font } from '@/theme/tokens';
import { face, arabicFaceFor } from '@/theme/faces';

describe('arabicize', () => {
  it('swaps the face to the Arabic counterpart', () => {
    const result = arabicize(font.groupLabel);
    expect(result.fontFamily).toBe(arabicFaceFor(font.groupLabel.fontFamily));
    expect(result.fontFamily).not.toBe(font.groupLabel.fontFamily);
  });

  it('loosens line-height more for headings than for body', () => {
    const heading = arabicize(font.display); // fontSize 42, a heading (>=21)
    expect(heading.lineHeight).toBe(Math.round(font.display.fontSize * 1.35));

    const body = arabicize(font.body); // fontSize 14.5, not a heading
    expect(body.lineHeight).toBe(Math.round(font.body.fontSize * 1.7));

    // Sanity: the heading multiplier is tighter than the body multiplier.
    expect(heading.lineHeight / font.display.fontSize).toBeLessThan(
      body.lineHeight / font.body.fontSize,
    );
  });

  it('removes letterSpacing from a token that carries tracking', () => {
    expect(font.groupLabel.letterSpacing).toBe(1.5);
    const result = arabicize(font.groupLabel);
    expect(result.letterSpacing).toBeUndefined();
  });

  it('removes negative letterSpacing from a display token', () => {
    expect(font.display.letterSpacing).toBeLessThan(0);
    const result = arabicize(font.display);
    expect(result.letterSpacing).toBeUndefined();
  });
});
