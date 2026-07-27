/**
 * Money. The Omani Rial has THREE decimal places, and almost every library
 * assumes two — so these are not "does the formatter work" tests, they are
 * "does the app lose or invent a factor of ten" tests.
 *
 * A bug here is a billing incident, not a rendering glitch.
 */

import {
  DEFAULT_CURRENCY,
  exponentFor,
  formatMoney,
  parseMoney,
  type Currency,
} from '@/lib/money';

describe('exponentFor', () => {
  it('gives OMR three decimals, not two', () => {
    expect(exponentFor('OMR')).toBe(3);
  });

  it('knows the other three-decimal Gulf currencies', () => {
    // Getting these wrong is the same class of bug as OMR, just less visible
    // because they are rarer in testing.
    expect(exponentFor('KWD')).toBe(3);
    expect(exponentFor('BHD')).toBe(3);
  });

  it('keeps the two-decimal currencies at two', () => {
    expect(exponentFor('AED')).toBe(2);
    expect(exponentFor('SAR')).toBe(2);
    expect(exponentFor('QAR')).toBe(2);
  });

  it('defaults to OMR', () => {
    expect(DEFAULT_CURRENCY).toBe('OMR');
  });
});

describe('formatMoney', () => {
  it('renders baisa as three decimal places', () => {
    // 12500 baisa is 12.500 rial. Two-decimal handling renders 125.00 or 1.25.
    expect(formatMoney(12500)).toBe('12.500 OMR');
  });

  it('keeps trailing zeros — 12.5 OMR is not a valid rendering', () => {
    expect(formatMoney(12000)).toBe('12.000 OMR');
    expect(formatMoney(500)).toBe('0.500 OMR');
  });

  it('renders a single baisa without collapsing to zero', () => {
    expect(formatMoney(1)).toBe('0.001 OMR');
  });

  it('renders zero as a real amount, not a blank', () => {
    expect(formatMoney(0)).toBe('0.000 OMR');
  });

  it('returns null for absent amounts rather than "0.000 OMR"', () => {
    // A price that does not exist yet and a price of zero are different facts.
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
  });

  it('uses two decimals for a two-decimal currency', () => {
    expect(formatMoney(12500, 'AED')).toBe('125.00 AED');
  });

  it('separates thousands', () => {
    expect(formatMoney(1234567)).toBe('1,234.567 OMR');
  });

  it('carries the currency code so an amount is never ambiguous', () => {
    for (const c of ['OMR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD'] as Currency[]) {
      expect(formatMoney(1000, c)).toContain(c);
    }
  });
});

describe('parseMoney', () => {
  it('converts major units to integer minor units', () => {
    expect(parseMoney('12.5')).toBe(12500);
    expect(parseMoney('12.500')).toBe(12500);
    expect(parseMoney('0.001')).toBe(1);
  });

  it('returns an integer, never a float', () => {
    const result = parseMoney('12.345');
    expect(Number.isInteger(result)).toBe(true);
  });

  it('rounds rather than truncating, so a baisa is not silently dropped', () => {
    expect(parseMoney('12.5005')).toBe(12501);
    expect(parseMoney('12.5004')).toBe(12500);
  });

  it('survives binary floating point', () => {
    // 0.07 * 1000 is 70.00000000000001 in IEEE 754. Truncation gives 70; a naive
    // parseInt on the product gives 70 as well, but 8.87 * 1000 is
    // 8869.999999999998, which truncates to 8869 — one baisa lost per parse.
    expect(parseMoney('8.87')).toBe(8870);
    expect(parseMoney('0.07')).toBe(70);
    expect(parseMoney('1.005')).toBe(1005);
  });

  it('accepts thousands separators a user would actually type', () => {
    expect(parseMoney('1,234.567')).toBe(1234567);
  });

  it('trims surrounding whitespace', () => {
    expect(parseMoney('  12.5  ')).toBe(12500);
  });

  it('rejects anything that is not a clean number', () => {
    for (const bad of ['', '   ', 'abc', '12.5.5', '1e3', '0x10', '--1', '12 5']) {
      expect(parseMoney(bad)).toBeNull();
    }
  });

  /**
   * Regression test for a bug this suite found on its first run.
   *
   * `parseMoney` stripped commas before validating, so "12,,5" became "125" and
   * returned 125000 baisa — 125 rial for a typo that should have been rejected.
   * Separators are now only accepted in genuine thousands positions.
   */
  it('rejects malformed thousands separators instead of silently reinterpreting them', () => {
    for (const bad of ['12,,5', ',125', '125,', '1,2,5', '12,34', '1,23,456']) {
      expect(parseMoney(bad)).toBeNull();
    }
  });

  it('still accepts correctly grouped separators', () => {
    expect(parseMoney('1,234.567')).toBe(1234567);
    expect(parseMoney('1,000')).toBe(1000000);
    expect(parseMoney('12,345,678')).toBe(12345678000);
  });

  it('rejects negative amounts', () => {
    // There is no such thing as a negative freight price in this product.
    expect(parseMoney('-12.5')).toBeNull();
  });

  it('rejects amounts too large to stay an exact integer', () => {
    expect(parseMoney('99999999999999999999')).toBeNull();
  });

  it('round-trips through formatMoney without drift', () => {
    for (const input of ['0.001', '12.500', '1,234.567', '999.999']) {
      const minor = parseMoney(input);
      expect(minor).not.toBeNull();
      expect(formatMoney(minor)).toBe(`${input} OMR`);
    }
  });
});
