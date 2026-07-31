/**
 * Money handling.
 *
 * THE TRAP: the Omani Rial has THREE decimal places — 1000 baisa to the rial.
 * Almost every currency library, `Intl.NumberFormat` default, and payment
 * integration assumes two. A price of 12.500 OMR stored or rendered as if it
 * were two-decimal becomes 1.25 or 125.00 depending on which direction the bug
 * runs, and neither is obviously wrong on screen.
 *
 * Rules:
 *   1. Store integer minor units (baisa for OMR). Never a float, never `numeric`.
 *   2. Never do arithmetic on a formatted string.
 *   3. Always carry the currency alongside the amount — if Truckkoo bills
 *      cross-border, AED/SAR/QAR are two-decimal and OMR is not.
 */

/** Minor-unit exponent per currency. OMR is the odd one out. */
const EXPONENT = {
  OMR: 3, // Oman — baisa
  AED: 2, // UAE
  SAR: 2, // Saudi Arabia
  QAR: 2, // Qatar
  KWD: 3, // Kuwait — also three
  BHD: 3, // Bahrain — also three
} as const;

export type Currency = keyof typeof EXPONENT;

export const DEFAULT_CURRENCY: Currency = 'OMR';

export function exponentFor(currency: Currency): number {
  return EXPONENT[currency];
}

/**
 * Format minor units for display. Returns e.g. "12.500 OMR".
 *
 * `minimumFractionDigits` is set explicitly from the currency's exponent
 * rather than left to the locale, which is the whole point of this module.
 */
export function formatMoney(
  minorUnits: number | null | undefined,
  currency: Currency = DEFAULT_CURRENCY,
  locale = 'en',
): string | null {
  const amount = formatAmount(minorUnits, currency, locale);
  return amount == null ? null : `${amount} ${currency}`;
}

/**
 * The amount alone, with no currency after it.
 *
 * For hero numbers, where the unit is set separately and smaller — D1 and D2 set
 * the payout in Instrument Serif at 44–52px, and "OMR" at that size is a shout.
 * It is the same arithmetic as `formatMoney`, which is why it is the thing
 * `formatMoney` is built from rather than a second copy of it.
 */
export function formatAmount(
  minorUnits: number | null | undefined,
  currency: Currency = DEFAULT_CURRENCY,
  locale = 'en',
): string | null {
  if (minorUnits == null) return null;

  const digits = exponentFor(currency);
  const major = minorUnits / 10 ** digits;

  return new Intl.NumberFormat(locale === 'ar' ? 'ar-OM' : 'en-OM', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
}

/**
 * Parse user-typed major units into integer minor units.
 * Returns null for anything that isn't a clean non-negative number.
 */
export function parseMoney(
  input: string,
  currency: Currency = DEFAULT_CURRENCY,
): number | null {
  const trimmed = input.trim();

  // Validate BEFORE stripping separators, not after.
  //
  // Stripping first turns "12,,5" into "125" and quietly returns 125 rial — a
  // plausible typo silently becoming a tenfold price error, which is exactly the
  // class of bug this module exists to prevent. Commas are only accepted in
  // genuine thousands positions.
  const GROUPED = /^\d{1,3}(,\d{3})*(\.\d+)?$/;
  const PLAIN = /^\d+(\.\d+)?$/;
  if (!GROUPED.test(trimmed) && !PLAIN.test(trimmed)) return null;

  const cleaned = trimmed.replace(/,/g, '');

  const digits = exponentFor(currency);
  // Round rather than truncate so 12.5005 doesn't silently lose a baisa.
  const minor = Math.round(Number(cleaned) * 10 ** digits);

  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}
