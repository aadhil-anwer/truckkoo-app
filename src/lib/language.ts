/**
 * The language preference: reading it, writing it, and making the layout match.
 *
 * This is the only file that calls `I18nManager.forceRTL`, and that matters:
 * forceRTL does not take effect until the next launch, so every call has to be
 * paired with a relaunch. A call without one leaves Arabic text sitting in a
 * left-to-right layout. Keeping the pair in one place is what makes it checkable.
 *
 * The reload is conditional on `needsReload`, never unconditional. An
 * unconditional reload after applying a stored preference relaunches the app
 * forever, because the stored preference is still there on the way back in.
 *
 * BEFORE P7 there was no path to Arabic at all. `allowRTL(true)` was called and
 * `forceRTL` never was, and `initLanguage()` took no argument and stored
 * nothing — so the only way to read the app in Arabic was to change the phone's
 * system language. X2's chevron had to lead somewhere.
 */

import { I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';

import { getLanguage, initLanguage, type Language } from '@/i18n';

export const LANGUAGE_KEY = 'truckkoo.language';

function isLanguage(v: string | null): v is Language {
  return v === 'en' || v === 'ar';
}

/** Whether the native layout direction disagrees with the chosen language. */
export function needsReload(lang: Language, isRTL: boolean): boolean {
  return (lang === 'ar') !== isRTL;
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

  if (needsReload(lang, I18nManager.isRTL)) {
    I18nManager.forceRTL(lang === 'ar');
    await reload();
  }
  return lang;
}

/** Change the language. Persists, applies the direction, and relaunches. */
export async function setLanguage(next: Language): Promise<void> {
  if (next === getLanguage() && !needsReload(next, I18nManager.isRTL)) return;
  await SecureStore.setItemAsync(LANGUAGE_KEY, next);
  I18nManager.forceRTL(next === 'ar');
  await reload();
}

/**
 * Relaunch.
 *
 * `reloadAsync` is a no-op in Expo Go and can reject in a dev client. Swallowing
 * that is deliberate: the preference is already stored by this point, so the
 * next manual start comes up correct, and a thrown error here would look like
 * the language change failed when it did not. X2 tells the user to reopen the
 * app if it is still running afterwards.
 */
async function reload(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    // See above.
  }
}
