/**
 * Auth actions.
 *
 * Every function returns a discriminated result rather than throwing, because
 * every caller is a screen that has to say something useful to a user with
 * near-zero tech skills. Errors are translated into plain instructions here, once
 * — SECURITY.md §10: client-facing errors stay generic, and raw provider messages
 * never reach the UI.
 */

import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import { t } from '@/i18n';
import { safeText } from './safe-text';
import { supabase } from './supabase';

export type AuthResult = { ok: true } | { ok: false; message: string };

/** Redirect back into the app after the provider's browser flow. */
const redirectTo = AuthSession.makeRedirectUri({ scheme: 'truckkoo' });

/** Where a password-reset email lands: the in-app screen that sets a new one. */
const resetRedirectTo = AuthSession.makeRedirectUri({ scheme: 'truckkoo', path: 'reset' });

/**
 * Where a signup-confirmation email lands.
 *
 * Email confirmation is on, so `signUp` returns no session and the role and
 * truck steps cannot be reached in the same sitting. Without this the user is
 * handed off to a browser and has to find their way back — which for an audience
 * with near-zero tech skills is where signup ends.
 */
const confirmRedirectTo = AuthSession.makeRedirectUri({ scheme: 'truckkoo', path: 'confirm' });

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // Deliberately one message for wrong-password AND unknown-email: telling the
  // caller which one it was confirms whether an account exists (SECURITY.md §3).
  if (error) return { ok: false, message: t('error.signIn.failed') };
  return { ok: true };
}

export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<AuthResult & { needsConfirmation?: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: confirmRedirectTo },
  });

  if (error) {
    const raw = error.message.toLowerCase();
    if (raw.includes('already')) {
      return { ok: false, message: t('error.signIn.failed') };
    }
    if (raw.includes('password')) {
      return { ok: false, message: t('error.password.short') };
    }
    return { ok: false, message: t('error.generic') };
  }

  // With email confirmation enabled there is no session yet.
  return { ok: true, needsConfirmation: !data.session };
}

/**
 * Send a password-reset email.
 *
 * Always reports success, even for an address with no account: a different
 * outcome per address turns this into an account-enumeration oracle
 * (SECURITY.md §3). The user is told to check their inbox either way, which is
 * also the only instruction that helps them.
 */
export async function sendPasswordReset(email: string): Promise<AuthResult> {
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: resetRedirectTo });
  return { ok: true };
}

/**
 * Finish a reset: trade the one-time code from the email link for a session,
 * then set the new password.
 *
 * The code is single-use and short-lived, and it is the only thing authorising
 * this change — we never take a user id or email from the link and trust it.
 */
export async function completePasswordReset(
  code: string,
  password: string,
): Promise<AuthResult> {
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  // Expired or already-used link. Say so plainly: this one is worth explaining,
  // because the fix is "ask for another email" and nothing else works.
  if (exchangeError) return { ok: false, message: t('error.reset.expired') };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, message: t('error.password.short') };
  return { ok: true };
}

/**
 * Finish a signup confirmation: trade the emailed one-time code for a session.
 *
 * Identical mechanism to the password reset — same PKCE code, same single use.
 * What differs is where the user goes next, and that is not decided here: after
 * the exchange they have a session but no profile row, which is exactly the
 * state the signup screen already knows how to continue from.
 */
export async function completeEmailConfirmation(code: string): Promise<AuthResult> {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return { ok: false, message: t('error.confirm.expired') };
  return { ok: true };
}

/**
 * OAuth via the system browser.
 *
 * This is the real flow, not a placeholder. If the provider has not been enabled
 * in the Supabase dashboard the call fails, and we tell the user to use email
 * rather than leaving them tapping a dead button.
 */
export async function signInWithProvider(provider: 'google' | 'apple'): Promise<AuthResult> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data?.url) {
    return { ok: false, message: t('error.oauth.unavailable') };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') {
    // User dismissed the sheet. Not an error worth shouting about.
    return { ok: false, message: '' };
  }

  // Exchange the returned code for a session. Tokens arrive in the URL fragment
  // or query depending on flow; both are handled by the SDK's code exchange.
  const url = new URL(result.url);
  const code = url.searchParams.get('code');
  if (!code) return { ok: false, message: t('error.generic') };

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return { ok: false, message: t('error.generic') };

  return { ok: true };
}

/**
 * Create the caller's profile row.
 *
 * `id` comes from the verified session, never a parameter — the acting user is
 * always derived server-side (SECURITY.md §2). `role` is insert-only by grant, so
 * this is the one moment it can be set.
 */
export async function createProfile(input: {
  role: 'shipper' | 'driver';
  fullName: string;
  phone?: string | null;
}): Promise<AuthResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return { ok: false, message: t('error.generic') };

  // Field-by-field, never a spread of form state (SECURITY.md §4).
  const { error } = await supabase.from('profiles').insert({
    id: userId,
    role: input.role,
    full_name: safeText(input.fullName),
    phone: input.phone ? safeText(input.phone) : null,
  });

  if (error) return { ok: false, message: t('error.generic') };
  return { ok: true };
}

/** Register the driver's truck so matching can filter on type and capacity. */
export async function createTruck(input: {
  truckType: string;
  plate?: string | null;
}): Promise<AuthResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return { ok: false, message: t('error.generic') };

  const { error } = await supabase.from('trucks').insert({
    owner_id: userId,
    truck_type: input.truckType,
    plate: input.plate ? safeText(input.plate) : null,
  });

  if (error) return { ok: false, message: t('error.generic') };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  // Global scope revokes server-side, not just locally (SECURITY.md §2).
  await supabase.auth.signOut({ scope: 'global' });
}
