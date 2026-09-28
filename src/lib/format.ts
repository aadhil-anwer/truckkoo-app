/**
 * Display formatting, in one place so two screens can never disagree about what
 * a date range or a reference number looks like.
 */

import { formatNumber, getLanguage, t, toArabicIndic } from '@/i18n';

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

/**
 * The day something happened, from a `timestamptz`, as a day IN OMAN: "19 Sep".
 *
 * A delivery at 1am in Muscat is the previous evening in UTC and further back
 * west of it, and a driver's record must not move a delivery to a day it did not
 * happen on — the same reason the month total buckets in Asia/Muscat (0033).
 * Oman has no daylight saving, so a fixed +4h shift read in UTC is exact, and
 * avoids depending on the engine's time-zone data.
 */
export function formatOmanDay(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 4 * 3600_000);
  return localizeDigits(
    shifted.toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  );
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
 *
 * Returns the bare code with no label — "NO." / "Reference" is a translated
 * word, not part of the reference, so a caller wraps this with `t()`
 * (`label.referenceNamed`) rather than this function composing the sentence.
 */
export function reference(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/** Weight, or the explicit "not given" case. Never a blank cell. */
export function formatWeight(kg: number | null | undefined, fallback: string): string {
  if (!kg) return fallback;
  return t('book.weight.value', { weight: formatNumber(kg) });
}

/**
 * How long ago, in the coarsest unit that is still useful.
 *
 * Returns null for a missing time — absent, never zeroed (CLAUDE.md #5). "Seen
 * 0 minutes ago" for a truck nobody has heard from is exactly the claim P6
 * exists to stop making.
 *
 * Coarse on purpose: a shipper reading "Seen 2h ago" knows what to do with it,
 * and "Seen 127 minutes ago" is arithmetic they have to perform.
 */
export function formatAge(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  // Seconds inside a minute: a trip reports every 30 s (CADENCE.trip), and in
  // minutes every fix T4 shows would read "just now" and never move.
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 10) return t('pos.now');
  if (secs < 60) return t('pos.secondsAgo', { seconds: formatNumber(secs) });

  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${formatNumber(mins)} ${t('pos.min')}`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${formatNumber(hours)} ${t('pos.hour')}`;

  return `${formatNumber(Math.floor(hours / 24))} ${t('pos.day')}`;
}
