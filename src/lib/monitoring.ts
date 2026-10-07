/**
 * Crash and error reporting (Sentry).
 *
 * SECURITY.md: "PII never enters logs — no phone numbers, names, or cargo
 * descriptions." Everything below that differs from Sentry's quick-start
 * snippet differs for that reason:
 *
 * - `sendDefaultPii: false` — no IP, cookies or user fields attached by default.
 * - No session replay. Even masked, it ships recordings of screens carrying
 *   names, phones and cargo to a third country, and costs data and battery on
 *   the exact phones this app is built for.
 * - No feedback widget. Its UI is Sentry's English, not `t()`, and it would be
 *   a second way to "contact us" beside WhatsApp.
 * - Console breadcrumbs dropped, and long digit runs (phone numbers) scrubbed
 *   from exception text — a Postgres error echoes the value that violated it.
 *
 * The DSN is not a secret: it only permits sending events, and it ships in the
 * bundle whether it comes from an env var or a literal. A literal cannot be
 * silently missing from a build.
 */

import * as Sentry from '@sentry/react-native';

const DSN =
  'https://cb4c3b12f177b8e0a8d2668252d3c94f@o4512152945295360.ingest.us.sentry.io/4512152950669312';

/**
 * Eight or more digits (spaces allowed, optional +) standing alone: a phone
 * number. Not part of a longer token, so row UUIDs — which SECURITY.md says to
 * log instead — and ISO dates survive.
 */
const PHONE_LIKE = /(^|[^\w-])(\+?\d[\d ]{6,}\d)(?=$|[^\w-])/g;

export function scrub(text: string): string {
  return text.replace(PHONE_LIKE, '$1[redacted]');
}

export function initMonitoring() {
  Sentry.init({
    dsn: DSN,
    enabled: !__DEV__,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    beforeBreadcrumb(crumb) {
      return crumb.category === 'console' ? null : crumb;
    },
    beforeSend(event) {
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrub(ex.value);
      }
      if (event.message) event.message = scrub(event.message);
      return event;
    },
  });
}

export function reportError(error: unknown) {
  Sentry.captureException(error);
}

export const wrapRoot = Sentry.wrap;

/**
 * A failure the app handled — the user saw "We could not post that", not a
 * crash — reported so a person learns about it without being told.
 *
 * Grouped by flow and error code, so Sentry opens one issue per kind of
 * failure (and emails once), not one per tap. Only the message and code are
 * sent: a Postgres error's `details` echoes the failing row ("Failing row
 * contains (…)"), which is a shipper's cargo and phone, so it never leaves.
 */
export function reportFailure(flow: string, error: unknown) {
  const raw = (error ?? {}) as { message?: unknown; code?: unknown; status?: unknown; name?: unknown };
  const code = typeof raw.code === 'string' && raw.code ? raw.code
    : typeof raw.status === 'number' ? `http_${raw.status}`
    : typeof raw.name === 'string' && raw.name ? raw.name : 'unknown';
  const message = typeof raw.message === 'string' ? raw.message : String(error);
  const wrapped = new Error(scrub(`${flow}: ${message}`));
  wrapped.name = `Handled ${code}`;
  Sentry.captureException(wrapped, {
    level: 'warning',
    tags: { flow, code, handled: 'yes' },
    fingerprint: ['handled', flow, code],
  });
}
