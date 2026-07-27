/**
 * Environment access. SECURITY.md §9.
 *
 * **Anything reachable from this file is in the app bundle and is public
 * forever.** Expo inlines every `EXPO_PUBLIC_*` variable at build time. Treat
 * every value here as printed on a billboard.
 *
 * Only two values are allowed to be public:
 *   - the Supabase project URL
 *   - the Supabase **anon** key — a public identifier by design; it grants
 *     nothing on its own because every table denies by default and RLS scopes
 *     each row to `auth.uid()`
 *
 * The **service-role key must never appear here, in app.json, in a comment, or
 * in any `EXPO_PUBLIC_` variable.** It bypasses all RLS. Its only home is
 * `supabase/functions/` (server-side), where it is read from the function's own
 * secret store.
 *
 * Fail closed and loud (§0.5): a missing variable throws at startup rather than
 * letting the app run half-configured and fail later with a confusing 401.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and fill it in, then restart ` +
        `the dev server with a cache clear (npx expo start -c) — Expo inlines ` +
        `these at build time, so a running server will not pick up a new value.`,
    );
  }
  return value.trim();
}

export const env = {
  supabaseUrl: required(
    'EXPO_PUBLIC_SUPABASE_URL',
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  ),
  supabaseAnonKey: required(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
} as const;

/**
 * Guard against the single most damaging config mistake in this stack: pasting
 * the service-role key where the anon key belongs. It bypasses RLS, so the app
 * would appear to work perfectly while every user could read every row.
 *
 * Supabase JWTs carry a `role` claim. We decode the payload only — this is not
 * verification, just a shape check on a value we already trust to be public.
 */
function assertNotServiceRole(key: string): void {
  try {
    const payload = key.split('.')[1];
    if (!payload) return;
    const json = JSON.parse(
      // base64url → base64, then decode
      globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { role?: string };

    if (payload && json.role && json.role !== 'anon') {
      throw new Error(
        `EXPO_PUBLIC_SUPABASE_ANON_KEY carries role "${json.role}", not "anon". ` +
          `A service_role key in the client bundle bypasses every row-level ` +
          `security policy and exposes all data to all users. Replace it with ` +
          `the anon/publishable key immediately, then rotate the leaked key in ` +
          `the Supabase dashboard.`,
      );
    }
  } catch (e) {
    // Re-throw our own error; ignore decode failures (newer key formats are
    // not JWTs and have nothing to check).
    if (e instanceof Error && e.message.includes('bypasses every row-level')) throw e;
  }
}

assertNotServiceRole(env.supabaseAnonKey);
