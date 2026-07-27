/**
 * The single Supabase client. SECURITY.md §2, §9, §10.
 *
 * Session storage: the refresh token is a bearer credential, so it lives in the
 * OS keychain / keystore via `expo-secure-store` — never AsyncStorage, never a
 * URL. SecureStore has a ~2KB per-value limit, so the adapter chunks values that
 * exceed it rather than silently truncating a session.
 */

import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { env } from './env';

/** SecureStore rejects values over ~2048 bytes. Chunk below that with headroom. */
const CHUNK_SIZE = 1800;
const COUNT_SUFFIX = '__chunks';

/**
 * Keychain-backed storage for the auth session.
 *
 * SecureStore keys must be alphanumeric + `.-_`, and Supabase's keys contain
 * characters outside that set, so keys are normalised on the way in.
 */
const secureStorage = {
  normalize: (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_'),

  async getItem(key: string): Promise<string | null> {
    const k = secureStorage.normalize(key);
    const countRaw = await SecureStore.getItemAsync(k + COUNT_SUFFIX);

    if (!countRaw) return SecureStore.getItemAsync(k);

    const count = Number(countRaw);
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${k}.${i}`);
      // A missing chunk means a corrupt session — fail closed by treating it as
      // absent, which forces a clean re-login rather than a confusing error.
      if (part == null) return null;
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const k = secureStorage.normalize(key);
    await secureStorage.removeItem(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(k, value);
      return;
    }

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    await Promise.all(
      chunks.map((c, i) => SecureStore.setItemAsync(`${k}.${i}`, c)),
    );
    await SecureStore.setItemAsync(k + COUNT_SUFFIX, String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    const k = secureStorage.normalize(key);
    const countRaw = await SecureStore.getItemAsync(k + COUNT_SUFFIX);
    if (countRaw) {
      const count = Number(countRaw);
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${k}.${i}`);
      }
      await SecureStore.deleteItemAsync(k + COUNT_SUFFIX);
    }
    await SecureStore.deleteItemAsync(k);
  },
};

export const supabase: SupabaseClient = createClient(
  env.supabaseUrl,
  env.supabaseAnonKey,
  {
    auth: {
      // Web has no SecureStore; fall back to the SDK default there. The app
      // ships native, so this branch exists only for local web debugging.
      storage: Platform.OS === 'web' ? undefined : secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      // PKCE, not the implicit default. A native app is a public client: it
      // cannot hold a secret, and implicit flow returns tokens in the redirect
      // URL itself, where any app registered for the scheme can read them. It is
      // also what the OAuth and password-reset paths assume — both exchange a
      // `code` for the session (`src/lib/auth.ts`).
      flowType: 'pkce',
      // Native apps have no URL bar to parse a session out of, and enabling it
      // is a token-in-URL risk (§2).
      detectSessionInUrl: false,
    },
  },
);

/**
 * Sign out everywhere. `scope: 'global'` revokes server-side rather than only
 * dropping the local token, per §2 — a local-only logout leaves a live refresh
 * token on a device the user may have just handed to someone else.
 */
export async function signOutEverywhere(): Promise<void> {
  await supabase.auth.signOut({ scope: 'global' });
}
