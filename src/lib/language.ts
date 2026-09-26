/**
 * The language preference: reading it, writing it, and making the layout match.
 *
 * This is the only file that calls `I18nManager.forceRTL`, and that matters:
 * forceRTL does not take effect until the next launch. Every call has to be
 * followed by a restart or the user is left reading Arabic in a left-to-right
 * layout, so the two belong in one place where the pair is checkable.
 *
 * THE RESTART IS THE USER'S. `expo-updates` was added for `reloadAsync()` and
 * then removed: it failed the EAS "Configure expo-updates" build phase, and
 * making it pass means enabling EAS Update — an OTA check at every launch, for
 * an audience on patchy signal in a truck cab, bought solely to save one tap.
 * X2 shows `account.language.hint` instead and asks them to reopen the app.
 *
 * `needsReload` therefore still decides, and still matters: it is what makes the
 * boot path self-healing when the stored preference and the native direction
 * disagree, and what stops that healing from being an infinite loop.
 *
 * BEFORE P7 there was no path to Arabic at all. `allowRTL(true)` was called and
 * `forceRTL` never was, and `initLanguage()` took no argument and stored
 * nothing — so the only way to read the app in Arabic was to change the phone's
 * system language. X2's chevron had to lead somewhere.
 */

import { I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { getLanguage, initLanguage, type Language } from '@/i18n';
import { supabase } from '@/lib/supabase';

export const LANGUAGE_KEY = 'truckkoo.language';

function isLanguage(v: string | null): v is Language {
  return v === 'en' || v === 'ar';
}

/** Whether the native layout direction disagrees with the chosen language. */
export function needsReload(lang: Language, isRTL: boolean | undefined): boolean {
  // `!!` because react-native-web does not report a boolean here, and
  // `false !== undefined` read every English launch in a browser as a mismatch.
  return (lang === 'ar') !== !!isRTL;
}

/**
 * Boot. Reads the stored choice, falls back to the device locale, and applies
 * the direction.
 *
 * Called before first render rather than from an effect: a screen that renders
 * left-to-right and then flips is worse than one that waits, and the root layout
 * already gates on fonts, so the wait costs nothing.
 */
export async function loadLanguage(): Promise<Language> {
  let stored: string | null = null;
  try {
    stored = await SecureStore.getItemAsync(LANGUAGE_KEY);
  } catch {
    // A locked or unavailable keystore is not a reason to fail to start. Fall
    // through to the device locale.
  }

  const lang = initLanguage(isLanguage(stored) ? stored : undefined);

  // Self-healing, and conditional on purpose. Applying forceRTL unconditionally
  // would rewrite the native flag on every single launch; applying it only on a
  // mismatch means the next launch is quiet.
  bootMismatch = needsReload(lang, I18nManager.isRTL);
  if (bootMismatch) I18nManager.forceRTL(lang === 'ar');
  return lang;
}

let bootMismatch = false;

/**
 * Whether THIS launch is running in the wrong direction.
 *
 * True when `loadLanguage()` found the chosen language and the native layout
 * disagreeing — the flag it just wrote lands on the next launch, so this one is
 * already wrong and silently so. The root layout says so instead.
 *
 * On Android, launch 1 on an Arabic phone no longer gets here: the direction is
 * seeded natively (plugins/with-first-launch-direction.js). What is left is iOS
 * launch 1, and a phone whose language changed after the app was installed.
 *
 * Deliberately NOT set by `setLanguage()`: an in-app change has X2's own notice,
 * and saying it twice on one screen is noise.
 */
export function restartPending(): boolean {
  return bootMismatch;
}

/**
 * Record the choice on the profile too, best effort.
 *
 * SecureStore is the source of truth for BOOT — the direction has to be settled
 * before a session exists, because the auth screens need one. `profiles.language`
 * is the source of truth for everything SERVER-side: a notification, an ops
 * screen, an export. It has carried an UPDATE grant since 0001 and nothing had
 * ever written it, so every row claimed its owner reads English.
 *
 * Failure is swallowed on purpose. This audience is on patchy signal, the local
 * preference is already stored by the time this runs, and a language change that
 * reports an error because the network was down would be a worse lie than a
 * stale column.
 */
async function rememberOnProfile(next: Language): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user.id;
    if (!id) return;
    await supabase.from('profiles').update({ language: next }).eq('id', id);
  } catch {
    // See above.
  }
}

/**
 * Change the language.
 *
 * Persists, records it on the profile, and flips the native direction — which
 * takes effect on the NEXT launch. The caller is responsible for telling the
 * user that, which X2 does.
 */
export async function setLanguage(next: Language): Promise<void> {
  if (next === getLanguage() && !needsReload(next, I18nManager.isRTL)) return;
  await SecureStore.setItemAsync(LANGUAGE_KEY, next);
  await rememberOnProfile(next);
  I18nManager.forceRTL(next === 'ar');
}
