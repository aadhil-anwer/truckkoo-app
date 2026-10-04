/**
 * Auth actions.
 *
 * Every function returns a discriminated result rather than throwing, because
 * every caller is a screen that has to say something useful to a user with
 * near-zero tech skills. Errors are translated into plain instructions here, once
 * — SECURITY.md §10: client-facing errors stay generic, and raw provider messages
 * never reach the UI.
 */

import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

import { t } from '@/i18n';
import { startTracking, stopTracking, trackingNow } from './background-location';
import { registerPush, unregisterPush } from '@/lib/push';
import { OMAN_DIAL } from './auth-draft';
import { safeText } from './safe-text';
import { supabase } from './supabase';

export type AuthResult = { ok: true } | { ok: false; message: string };

/**
 * Redirect back into the app after the provider's browser flow.
 *
 * This resolves DIFFERENTLY depending on how the app is running, and both forms
 * have to be allow-listed in Supabase → Authentication → URL Configuration or the
 * provider returns a redirect the app never receives:
 *
 *   Expo Go        exp://192.168.x.x:8081/--/...   (host changes with your LAN)
 *   dev/standalone truckkoo://
 *
 * A mismatch here is the single most common reason a provider button appears to
 * do nothing: the browser opens, the user signs in, and the hand-back is dropped.
 */
const redirectTo = AuthSession.makeRedirectUri({ scheme: 'truckkoo' });

/**
 * Closes the auth session popup on web. A no-op on native, and harmless to call
 * at module scope — but without it the web build hangs on an orphaned popup.
 */
WebBrowser.maybeCompleteAuthSession();

/** The redirect this build will actually use. Surfaced so a screen can show it. */
export function authRedirectUri(): string {
  return redirectTo;
}

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
): Promise<AuthResult & { needsConfirmation?: boolean; existing?: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: confirmRedirectTo },
  });

  if (error) {
    const raw = error.message.toLowerCase();
    // Worded so it neither confirms nor denies the account (SECURITY.md §3),
    // but still points at the one thing that helps.
    if (raw.includes('already')) {
      return { ok: false, message: t('error.signUp.failed'), existing: true };
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
  // On iOS, Apple sign-in must be NATIVE. Apple requires it (and App Store
  // review enforces it) once any other social login is offered, and the native
  // sheet is a single tap against a browser round-trip. Everywhere else — Apple
  // on Android, Google anywhere — falls through to the browser flow below.
  if (provider === 'apple' && Platform.OS === 'ios') return signInWithAppleNative();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });

  // The overwhelmingly likely cause here is that the provider is switched off in
  // the Supabase dashboard, so the message points at that rather than saying
  // "something went wrong" to a user who cannot act on it.
  if (error || !data?.url) return { ok: false, message: t('error.oauth.unavailable') };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  // `dismiss` is the user backing out, and `cancel` is the sheet being closed.
  // Neither is a failure worth shouting about — an empty message tells the
  // caller to show nothing at all.
  if (result.type !== 'success') return { ok: false, message: '' };

  return exchangeReturnedUrl(result.url);
}

/**
 * Native Sign in with Apple, exchanged for a Supabase session.
 *
 * Uses the identity token directly rather than a browser round-trip, so there is
 * no redirect URI involved and nothing to allow-list.
 */
async function signInWithAppleNative(): Promise<AuthResult> {
  if (!(await AppleAuthentication.isAvailableAsync())) {
    return { ok: false, message: t('error.oauth.unavailable') };
  }

  let identityToken: string | null = null;
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    identityToken = credential.identityToken;
  } catch (e) {
    // ERR_REQUEST_CANCELED is the user dismissing the sheet — silent, like the
    // browser flow's dismissal.
    const code = (e as { code?: string })?.code;
    if (code === 'ERR_REQUEST_CANCELED') return { ok: false, message: '' };
    return { ok: false, message: t('error.oauth.unavailable') };
  }

  if (!identityToken) return { ok: false, message: t('error.oauth.unavailable') };

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
  });
  if (error) return { ok: false, message: t('error.oauth.unavailable') };
  return { ok: true };
}

/**
 * Turn the URL the provider handed back into a session.
 *
 * PKCE returns a `code` in the query string, which is the configured flow
 * (`flowType: 'pkce'` in supabase.ts). Implicit returns tokens in the fragment
 * instead — handled too, because a provider or a dashboard setting can put us on
 * that path without the app changing, and silently failing there looks identical
 * to "the button does nothing".
 */
async function exchangeReturnedUrl(returnedUrl: string): Promise<AuthResult> {
  const url = new URL(returnedUrl);

  const code = url.searchParams.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? { ok: false, message: t('error.generic') } : { ok: true };
  }

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const access_token = fragment.get('access_token');
  const refresh_token = fragment.get('refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    return error ? { ok: false, message: t('error.generic') } : { ok: true };
  }

  // The provider handed back an error rather than a credential — most often
  // `redirect_uri_mismatch`, which is a configuration problem, not a user one.
  return { ok: false, message: t('error.oauth.unavailable') };
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

/**
 * The last step of getting in: write the profile, and for a driver the truck.
 *
 * The phone is stored in E.164 (`+96891234567`) — the form a dispatcher's dialer
 * and a WhatsApp link both take without reformatting.
 *
 * If the truck insert fails, the account still exists and works; the driver just
 * is not matched on capacity until a truck is added. That is reported, not
 * rolled back — undoing an account someone just made is the worse failure.
 */
export async function finishSetup(input: {
  role: 'shipper' | 'driver';
  fullName: string;
  omaniMobile: string | null;
  truckType: string | null;
}): Promise<AuthResult> {
  const profile = await createProfile({
    role: input.role,
    fullName: input.fullName,
    phone: input.omaniMobile ? `${OMAN_DIAL}${input.omaniMobile}` : null,
  });
  if (!profile.ok) return profile;

  if (input.role === 'driver' && input.truckType) {
    return createTruck({ truckType: input.truckType });
  }
  return { ok: true };
}

async function within<T>(operation: PromiseLike<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Sign-out timed out')), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function signOut(): Promise<void> {
  // Before the session goes: a shared phone must never report a position under
  // the account that just left. Bound a stalled native stop; global auth
  // revocation is the final guard against future server-side location writes.
  const resumeMode = trackingNow();
  await within(stopTracking(), 4_000).catch(() => {});
  try {
    // The phone's push token belongs to this account. If the server has not
    // confirmed revocation, keep the session and a retry path on the account UI.
    const pushRevoked = await within(unregisterPush(), 4_000).catch(() => false);
    if (!pushRevoked) throw new Error('Push token revocation failed');
    // Global scope revokes server-side. A timeout/error must never be reported as
    // successful logout because local-only sign-out leaves sessions valid.
    const { error } = await within(supabase.auth.signOut({ scope: 'global' }), 12_000);
    if (error) throw error;
  } catch (e) {
    // Still signed in, so put back what was taken away above: a driver on a trip
    // must keep reporting, and must keep receiving offers. The tracking provider
    // will not do it — nothing it watches changed. Neither call throws here.
    if (resumeMode) startTracking(resumeMode).catch(() => {});
    registerPush().catch(() => {});
    throw e;
  }
}
