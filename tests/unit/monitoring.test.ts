import * as Sentry from '@sentry/react-native';

import { initMonitoring, reportFailure, scrub } from '@/lib/monitoring';

type Options = Parameters<typeof Sentry.init>[0] & {
  beforeSend: (e: Record<string, any>) => Record<string, any> | null;
  beforeBreadcrumb: (c: Record<string, any>) => Record<string, any> | null;
};

function options(): Options {
  initMonitoring();
  return (Sentry.init as jest.Mock).mock.calls.at(-1)[0];
}

describe('monitoring', () => {
  /**
   * SECURITY.md: no phone numbers in error messages. A Postgres constraint
   * error echoes the offending value, so a duplicate phone on signup would
   * otherwise land in a third-party dashboard verbatim.
   */
  it('scrubs Omani phone numbers in every common shape', () => {
    expect(scrub('Key (phone)=(+968 9123 4567) already exists')).toBe(
      'Key (phone)=([redacted]) already exists',
    );
    expect(scrub('call 96891234567')).toBe('call [redacted]');
    expect(scrub('91234567')).toBe('[redacted]');
  });

  it('leaves short numbers — weights, counts, status codes — alone', () => {
    expect(scrub('HTTP 500 after 3 retries, 8000 kg')).toBe('HTTP 500 after 3 retries, 8000 kg');
  });

  it('keeps row UUIDs and dates, which are what we log instead of PII', () => {
    const id = 'load 12345678-1234-4123-8123-123456789012 on 2026-09-26';
    expect(scrub(id)).toBe(id);
  });

  it('does not attach default PII and stays off in development', () => {
    const o = options();
    expect(o.sendDefaultPii).toBe(false);
    expect(o.enabled).toBe(false);
  });

  it('scrubs exception text on the way out', () => {
    const out = options().beforeSend({
      exception: { values: [{ value: 'duplicate phone +968 9123 4567' }] },
    });
    expect(out?.exception.values[0].value).toBe('duplicate phone [redacted]');
  });

  it('drops console breadcrumbs, which carry whatever was logged', () => {
    const { beforeBreadcrumb } = options();
    expect(beforeBreadcrumb({ category: 'console', message: 'Salim, 91234567' })).toBeNull();
    expect(beforeBreadcrumb({ category: 'navigation' })).not.toBeNull();
  });

  describe('reportFailure', () => {
    const last = () => (Sentry.captureException as jest.Mock).mock.calls.at(-1);

    it('groups by flow and code, so a kind of failure emails once, not once per tap', () => {
      reportFailure('book_load', { message: 'price changed', code: 'P0001' });
      const [error, context] = last();
      expect(error.message).toBe('book_load: price changed');
      expect(context).toMatchObject({
        level: 'warning',
        tags: { flow: 'book_load', code: 'P0001', handled: 'yes' },
        fingerprint: ['handled', 'book_load', 'P0001'],
      });
    });

    it('never sends a Postgres error\'s details, which echo the failing row', () => {
      reportFailure('create_profile', {
        message: 'new row violates check constraint',
        code: '23514',
        details: 'Failing row contains (Ahmed, +968 9123 4567, cement)',
      });
      const [error, context] = last();
      expect(JSON.stringify([error.message, error.name, context])).not.toMatch(/Ahmed|cement|9123/);
    });

    it('scrubs a phone number from the message itself', () => {
      reportFailure('sign_up', new Error('duplicate key (phone)=(+968 9123 4567)'));
      expect(last()[0].message).not.toMatch(/9123/);
    });

    it('names an auth error by its HTTP status when it has no code', () => {
      reportFailure('sign_in', { message: 'upstream', status: 503 });
      expect(last()[1].tags.code).toBe('http_503');
    });
  });
});
