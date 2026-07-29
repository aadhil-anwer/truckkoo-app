/**
 * Display formatting, in one place so two screens can never disagree about what
 * a date range or a reference number looks like.
 */

import { getLanguage, toArabicIndic } from '@/i18n';

/** Locale for dates and numbers. Oman, in the active language. */
function locale(): string {
  return getLanguage() === 'ar' ? 'ar-OM' : 'en-OM';
}

/**
 * Restyle the digits in an already-formatted string to match the language.
 *
 * Call this at the output boundary, on a string some other formatter produced —
 * never on a value you are about to do arithmetic with.
 */
export function localizeDigits(s: string): string {
  return getLanguage() === 'ar' ? toArabicIndic(s) : s;
}

/**
 * A pickup or departure window.
 *
 * Dates arrive as ISO `date` strings (no time), so they are split rather than
 * passed to `new Date()` on their own — `new Date('2026-07-25')` is parsed as UTC
 * midnight and renders as the previous day for anyone west of Greenwich. Oman is
 * UTC+4 so it would not bite here, but it would bite the moment anyone tests from
 * elsewhere, and a delivery date off by one is a dispute.
 */
export function formatWindow(from: string, to: string): string {
  const day = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale(), {
      day: 'numeric',
      month: 'short',
    });
  };
  return localizeDigits(from === to ? day(from) : `${day(from)} – ${day(to)}`);
}

/** Long form with a weekday, for a picker row where the choice must be obvious. */
export function formatLongDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return localizeDigits(
    new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
  );
}

/**
 * A deadline: the time, plus the day only when it is not today.
 *
 * Unlike the `date` columns this takes a real `timestamptz`, so `new Date()` is
 * correct here — the value carries its own zone and is converted to the device's.
 * A driver deciding on an offer needs to know how long it waits, and "18:40"
 * with no day is the shortest form that cannot be misread.
 */
export function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) return localizeDigits(time);
  return localizeDigits(`${d.toLocaleDateString(locale(), { weekday: 'short' })} ${time}`);
}

/** Today's date as an ISO `date` string in the device's own timezone. */
export function isoToday(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * A short human reference for a consignment. Never show a raw uuid to a driver
 * reading a number down a phone line.
 */
export function reference(id: string): string {
  return `NO. ${id.slice(0, 8).toUpperCase()}`;
}

/** Weight, or the explicit "not given" case. Never a blank cell. */
export function formatWeight(kg: number | null | undefined, fallback: string): string {
  if (!kg) return fallback;
  return localizeDigits(`${new Intl.NumberFormat(locale()).format(kg)} kg`);
}
