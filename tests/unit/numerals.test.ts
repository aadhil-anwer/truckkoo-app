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
