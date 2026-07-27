/**
 * The service-role guard. SECURITY.md §9.
 *
 * This is the single most damaging config mistake available in this stack:
 * pasting the service-role key where the anon key belongs. The app would appear
 * to work perfectly — better than usual, in fact, since nothing would be denied —
 * while every user could read and write every row. RLS is bypassed entirely and
 * nothing in the UI would look wrong.
 *
 * `src/lib/env.ts` runs its check at import time, so each case here needs a fresh
 * module registry.
 */

const HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

function jwtWithRole(role: string): string {
  const payload = Buffer.from(JSON.stringify({ iss: 'supabase', ref: 'p', role })).toString(
    'base64url',
  );
  return `${HEADER}.${payload}.sig`;
}

/** Import `env.ts` fresh with a given environment. */
function loadEnv(vars: Record<string, string | undefined>) {
  let mod: typeof import('@/lib/env') | undefined;
  jest.isolateModules(() => {
    const prev = { ...process.env };
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
    }
    try {
      mod = require('@/lib/env');
    } finally {
      process.env = prev;
    }
  });
  return mod!;
}

const GOOD_URL = 'https://test-project.supabase.co';

describe('service-role key detection', () => {
  it('throws when a service_role JWT is used as the anon key', () => {
    expect(() =>
      loadEnv({
        EXPO_PUBLIC_SUPABASE_URL: GOOD_URL,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: jwtWithRole('service_role'),
      }),
    ).toThrow(/bypasses every row-level/);
  });

  it('names the remedy, including rotating the leaked key', () => {
    // An error that only says "wrong key" leaves a service-role key sitting in a
    // shell history and a git stash somewhere.
    let message = '';
    try {
      loadEnv({
        EXPO_PUBLIC_SUPABASE_URL: GOOD_URL,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: jwtWithRole('service_role'),
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/rotate/i);
  });

  it('rejects any non-anon role, not just the one spelled service_role', () => {
    for (const role of ['service_role', 'postgres', 'supabase_admin', 'authenticated']) {
      expect(() =>
        loadEnv({
          EXPO_PUBLIC_SUPABASE_URL: GOOD_URL,
          EXPO_PUBLIC_SUPABASE_ANON_KEY: jwtWithRole(role),
        }),
      ).toThrow(/bypasses every row-level/);
    }
  });

  it('accepts a real anon JWT', () => {
    expect(() =>
      loadEnv({
        EXPO_PUBLIC_SUPABASE_URL: GOOD_URL,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: jwtWithRole('anon'),
      }),
    ).not.toThrow();
  });

  it('accepts the modern publishable key, which is not a JWT at all', () => {
    // The guard must not reject the key format the project actually uses now.
    expect(() =>
      loadEnv({
        EXPO_PUBLIC_SUPABASE_URL: GOOD_URL,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_Nzb_HMGN34udEjN0eTg2AkGdnOTE5',
      }),
    ).not.toThrow();
  });

  it('does not crash on a malformed key — it is a guard, not a parser', () => {
    for (const key of ['not.a.jwt', 'nodots', `${HEADER}.!!!notbase64!!!.sig`]) {
      expect(() =>
        loadEnv({ EXPO_PUBLIC_SUPABASE_URL: GOOD_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: key }),
      ).not.toThrow();
    }
  });
});

describe('fail closed on missing configuration', () => {
  it('throws when the URL is absent rather than running half-configured', () => {
    expect(() =>
      loadEnv({
        EXPO_PUBLIC_SUPABASE_URL: undefined,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: jwtWithRole('anon'),
      }),
    ).toThrow(/EXPO_PUBLIC_SUPABASE_URL/);
  });

  it('throws when the key is absent', () => {
    expect(() =>
      loadEnv({ EXPO_PUBLIC_SUPABASE_URL: GOOD_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined }),
    ).toThrow(/EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('treats whitespace as absent', () => {
    expect(() =>
      loadEnv({ EXPO_PUBLIC_SUPABASE_URL: '   ', EXPO_PUBLIC_SUPABASE_ANON_KEY: jwtWithRole('anon') }),
    ).toThrow();
  });

  it('tells the developer to restart with a cache clear', () => {
    // Expo inlines EXPO_PUBLIC_* at build time, so "I set it and it still fails"
    // is the default experience without this hint.
    let message = '';
    try {
      loadEnv({ EXPO_PUBLIC_SUPABASE_URL: undefined, EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('expo start -c');
  });
});
