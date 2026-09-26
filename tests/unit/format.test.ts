/**
 * Display formatting.
 *
 * The load-bearing test in this file is the timezone one. `new Date('2026-07-25')`
 * is parsed as UTC midnight, so west of Greenwich it renders as the 24th — a
 * pickup date silently off by one, which in freight is a dispute. Oman is UTC+4
 * so the bug is invisible at home and appears the moment anyone tests from
 * elsewhere.
 *
 * Assertions are structural rather than exact-string wherever ICU decides the
 * format. Pinning "25 Jul" would make this suite fail on a different Node ICU
 * build without anything actually being wrong.
 */

// Must be set before any Date is constructed. A negative-offset zone is the
// whole point: in UTC these tests pass even against a broken implementation.
process.env.TZ = 'America/New_York';

import { initLanguage } from '@/i18n';
import {
  formatAge,
  formatDeadline,
  formatLongDay,
  formatWeight,
  formatWindow,
  isoToday,
  reference,
} from '@/lib/format';

describe('formatWindow — the off-by-one', () => {
  it('renders the date that was asked for, west of Greenwich', () => {
    // The regression: UTC-midnight parsing would render "24".
    expect(formatWindow('2026-07-25', '2026-07-25')).toContain('25');
    expect(formatWindow('2026-07-25', '2026-07-25')).not.toContain('24');
  });

  it('does not drift across a month boundary', () => {
    // 1 Aug parsed as UTC midnight becomes 31 Jul in a negative offset — the
    // worst version of the bug, because the month changes too.
    const out = formatWindow('2026-08-01', '2026-08-01');
    expect(out).toContain('1');
    expect(out).not.toContain('31');
  });

  it('does not drift across a year boundary', () => {
    const out = formatWindow('2027-01-01', '2027-01-01');
    expect(out).toContain('1');
    expect(out).not.toContain('31');
  });

  it('collapses a single-day window to one date, not a range', () => {
    const out = formatWindow('2026-07-25', '2026-07-25');
    expect(out).not.toContain('–');
  });

  it('renders a real range with both ends', () => {
    const out = formatWindow('2026-07-25', '2026-07-28');
    expect(out).toContain('25');
    expect(out).toContain('28');
    expect(out).toContain('–');
  });

  it('handles a leap day', () => {
    expect(formatWindow('2028-02-29', '2028-02-29')).toContain('29');
  });
});

describe('formatLongDay', () => {
  it('names the correct weekday for a known date', () => {
    // 2026-07-25 is a Saturday. Off-by-one would say Friday.
    expect(formatLongDay('2026-07-25')).toContain('Saturday');
  });

  it('includes the day number', () => {
    expect(formatLongDay('2026-07-25')).toContain('25');
  });
});

describe('isoToday', () => {
  it('returns a zero-padded ISO date', () => {
    expect(isoToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses the device timezone, not UTC', () => {
    const now = new Date();
    const expected = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    expect(isoToday()).toBe(expected);
  });

  it('offsets by whole days', () => {
    const today = isoToday(0);
    const tomorrow = isoToday(1);
    expect(tomorrow).not.toBe(today);
    expect(tomorrow > today).toBe(true);
  });

  it('round-trips through formatWindow without shifting', () => {
    // The two functions are used together on every post-a-load: one produces the
    // value, the other displays it. If they disagree the user picks one date and
    // sees another.
    const iso = isoToday();
    const day = Number(iso.slice(8, 10));
    expect(formatWindow(iso, iso)).toContain(String(day));
  });

  it('stays zero-padded across a rollover to a single-digit day', () => {
    for (let i = 0; i < 40; i++) {
      expect(isoToday(i)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('reference', () => {
  it('shortens a uuid to something readable down a phone line', () => {
    expect(reference('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe('AAAAAAAA');
  });

  it('never exposes the full uuid', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    expect(reference(id)).not.toContain(id);
    expect(reference(id).length).toBeLessThan(id.length);
  });

  it('is stable for the same id', () => {
    const id = '12345678-1234-4123-8123-123456789012';
    expect(reference(id)).toBe(reference(id));
  });
});

describe('formatWeight', () => {
  it('appends the unit', () => {
    expect(formatWeight(8000, 'Not given')).toBe('8,000 kg');
  });

  it('separates thousands', () => {
    expect(formatWeight(1234567, 'Not given')).toContain(',');
  });

  it('falls back rather than rendering a blank cell', () => {
    // "Not given" and "0 kg" are different facts, and an empty cell is neither.
    expect(formatWeight(null, 'Not given')).toBe('Not given');
    expect(formatWeight(undefined, 'Not given')).toBe('Not given');
  });

  it('treats zero as not given, matching the nullable column', () => {
    expect(formatWeight(0, 'Not given')).toBe('Not given');
  });
});

describe('formatDeadline', () => {
  // The clock is frozen to midday. These tests build a deadline relative to
  // "now", and against a real clock "now + 1 hour" crosses midnight for the last
  // hour of every day — at which point the deadline genuinely is not today, the
  // formatter correctly adds a weekday, and the test fails. It was recorded as an
  // intermittent failure for a while; it is not intermittent, it is wrong for one
  // hour in twenty-four.
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-30T12:00:00'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows time only when the deadline is today', () => {
    const soon = new Date();
    soon.setHours(soon.getHours() + 1);
    const out = formatDeadline(soon.toISOString());
    expect(out).toMatch(/\d{1,2}:\d{2}/);
    // No weekday when it is today — the day is not the news, the hour is.
    expect(out).not.toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
  });

  it('adds a weekday when the deadline is not today', () => {
    const later = new Date();
    later.setDate(later.getDate() + 3);
    expect(formatDeadline(later.toISOString())).toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
  });

  it('returns an empty string for an unparseable timestamp rather than "Invalid Date"', () => {
    expect(formatDeadline('not-a-timestamp')).toBe('');
    expect(formatDeadline('')).toBe('');
  });
});

describe('Arabic-Indic wiring', () => {
  // Node's Jest runner ships full ICU, so `toLocaleDateString('ar-OM')` and
  // `Intl.NumberFormat('ar-OM')` already emit Eastern Arabic-Indic digits
  // natively here — asserting on that output alone would pass whether or not
  // `localizeDigits(...)` is actually wired in. Hermes on Android is the
  // opposite: its trimmed ICU returns Latin digits for 'ar-OM'. So each test
  // stubs the underlying locale call to return what Hermes would — Latin
  // digits — and asserts the formatter's *return value* is Arabic-Indic
  // anyway. That can only be true if `localizeDigits` converted it, which
  // means the assertion is load-bearing on the wrapping actually being there.
  afterEach(() => {
    initLanguage('en');
    jest.restoreAllMocks();
  });

  it('formatWindow converts Latin digits the underlying formatter returned', () => {
    initLanguage('ar');
    jest.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('25 Jul');
    const out = formatWindow('2026-07-25', '2026-07-25');
    expect(out).toBe('٢٥ Jul');
    expect(out).not.toMatch(/[0-9]/);
  });

  it('formatLongDay converts Latin digits the underlying formatter returned', () => {
    initLanguage('ar');
    jest.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('Saturday, 25 July');
    const out = formatLongDay('2026-07-25');
    expect(out).toBe('Saturday, ٢٥ July');
    expect(out).not.toMatch(/[0-9]/);
  });

  it('formatDeadline converts Latin digits the underlying formatter returned', () => {
    initLanguage('ar');
    // Frozen for the same reason as the block above: "now + 1 hour" crosses
    // midnight for the last hour of every day, and the weekday the formatter
    // then correctly adds is not what this assertion is about.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-30T12:00:00'));
    jest.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue('18:40');
    const soon = new Date();
    soon.setHours(soon.getHours() + 1);
    const out = formatDeadline(soon.toISOString());
    expect(out).toBe('١٨:٤٠');
    expect(out).not.toMatch(/[0-9]/);
    jest.useRealTimers();
  });

  it('formatWeight converts Latin digits the underlying formatter returned', () => {
    initLanguage('ar');
    jest.spyOn(Intl, 'NumberFormat').mockImplementation(
      () => ({ format: () => '8,000' }) as unknown as Intl.NumberFormat,
    );
    const out = formatWeight(8000, 'Not given');
    // The unit itself is translated too — a Latin "kg" in Arabic copy is the
    // exact bug CLAUDE.md #4 bans (units live inside the string, not composed
    // at the call site).
    expect(out).toBe('٨,٠٠٠ كجم');
    expect(out).not.toMatch(/[0-9]/);
  });
});

describe('formatAge', () => {
  beforeEach(() => initLanguage('en'));

  it('says nothing about an absent time rather than saying zero', () => {
    // Rule #5: absent, never zeroed. "Seen 0 minutes ago" for a truck nobody
    // has heard from is the exact lie this phase exists to delete.
    expect(formatAge(null)).toBeNull();
  });

  it('reads in minutes inside an hour', () => {
    const iso = new Date(Date.now() - 4 * 60_000).toISOString();
    expect(formatAge(iso)).toMatch(/4/);
  });

  it('reads in hours past one', () => {
    const iso = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(formatAge(iso)).toMatch(/3/);
  });

  it('reads in days past one', () => {
    const iso = new Date(Date.now() - 50 * 3600_000).toISOString();
    expect(formatAge(iso)).toMatch(/2/);
  });
});
