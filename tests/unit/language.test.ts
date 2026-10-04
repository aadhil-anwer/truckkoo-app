/**
 * The language preference.
 *
 * `I18nManager.forceRTL` only takes effect on the NEXT launch, and nothing here
 * relaunches the app — `expo-updates` was tried for that and removed, so the
 * restart is the user's and X2 asks for it.
 *
 * What is left to get right is the direction decision itself: apply it when the
 * stored preference and the native flag disagree, leave it alone when they
 * already agree, and never fail to boot because a keystore was locked.
 */

import { I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import {
  LANGUAGE_KEY,
  loadLanguage,
  needsReload,
  restartPending,
  setLanguage,
} from '@/lib/language';
import { getLanguage, initLanguage } from '@/i18n';
import { supabase } from '@/lib/supabase';

function setRTL(value: boolean) {
  Object.defineProperty(I18nManager, 'isRTL', { value, configurable: true });
}

describe('needsReload', () => {
  it('is true when Arabic is chosen in a left-to-right layout', () => {
    expect(needsReload('ar', false)).toBe(true);
  });

  it('is true when English is chosen in a right-to-left layout', () => {
    expect(needsReload('en', true)).toBe(true);
  });

  it('treats a missing direction as left-to-right, as react-native-web reports it', () => {
    expect(needsReload('en', undefined)).toBe(false);
    expect(needsReload('ar', undefined)).toBe(true);
  });

  it('is false when the layout already matches — this is what stops a reload loop', () => {
    expect(needsReload('ar', true)).toBe(false);
    expect(needsReload('en', false)).toBe(false);
  });
});

describe('loadLanguage', () => {
  beforeEach(async () => {
    await SecureStore.deleteItemAsync(LANGUAGE_KEY);
    setRTL(false);
    initLanguage('en');
    jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => {});
  });

  it('falls back to the device locale when nothing is stored', async () => {
    // tests/setup.ts stubs expo-localization to en-OM.
    await expect(loadLanguage()).resolves.toBe('en');
  });

  it('prefers the stored choice over the device locale', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'ar');
    await expect(loadLanguage()).resolves.toBe('ar');
    expect(getLanguage()).toBe('ar');
  });

  it('ignores a stored value that is not a language', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'klingon');
    await expect(loadLanguage()).resolves.toBe('en');
  });

  it('leaves the direction alone on boot when it already matches', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'en');
    await loadLanguage();
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
  });

  it('heals a stored Arabic preference meeting a left-to-right layout, once', async () => {
    // The self-healing path. Applying forceRTL unconditionally would rewrite the
    // native flag on every launch forever; applying it on a mismatch means the
    // next boot is quiet.
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'ar');
    await loadLanguage();
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);

    setRTL(true);
    (I18nManager.forceRTL as jest.Mock).mockClear();
    await loadLanguage();
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
  });

  it('still starts when the keystore is unavailable', async () => {
    // A locked keystore is not a reason to fail to boot.
    jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValueOnce(new Error('locked'));
    await expect(loadLanguage()).resolves.toBe('en');
  });

  it('starts when the keystore never answers and ignores its late answer', async () => {
    jest.useFakeTimers();
    let release!: (value: string) => void;
    jest.spyOn(SecureStore, 'getItemAsync').mockImplementationOnce(() =>
      new Promise((resolve) => { release = resolve; }));
    try {
      const boot = loadLanguage();
      await jest.advanceTimersByTimeAsync(4_100);
      expect(await boot).toBe('en');
      release('ar');
      await Promise.resolve();
      expect(getLanguage()).toBe('en');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('restartPending — a launch that is already in the wrong direction', () => {
  beforeEach(async () => {
    await SecureStore.deleteItemAsync(LANGUAGE_KEY);
    setRTL(false);
    initLanguage('en');
    jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => {});
  });

  it('is true when Arabic boots into a left-to-right layout', async () => {
    // The first-launch bug: forceRTL lands on the NEXT launch, so this one is
    // wrong and must say so rather than sit there silently mirrored.
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'ar');
    await loadLanguage();
    expect(restartPending()).toBe(true);
  });

  it('is true when English boots into a right-to-left layout', async () => {
    setRTL(true);
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'en');
    await loadLanguage();
    expect(restartPending()).toBe(true);
  });

  it('is false once the layout matches, so the notice never outlives the relaunch', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'ar');
    await loadLanguage();
    setRTL(true);
    await loadLanguage();
    expect(restartPending()).toBe(false);
  });

  it('is not raised by an in-app change, which has its own notice on X2', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'en');
    await loadLanguage();
    await setLanguage('ar');
    expect(restartPending()).toBe(false);
  });
});

describe('setLanguage', () => {
  beforeEach(async () => {
    await SecureStore.deleteItemAsync(LANGUAGE_KEY);
    setRTL(false);
    initLanguage('en');
    jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => {});
  });

  it('persists the choice and flips the direction', async () => {
    await setLanguage('ar');
    await expect(SecureStore.getItemAsync(LANGUAGE_KEY)).resolves.toBe('ar');
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
  });

  it('does nothing when the language is already active and the layout agrees', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'en');
    await loadLanguage();
    await setLanguage('en');
    expect(I18nManager.forceRTL).not.toHaveBeenCalled();
  });
});

describe('setLanguage and the profile column', () => {
  const eq = jest.fn(async () => ({ error: null }));
  const update = jest.fn(() => ({ eq }));

  beforeEach(async () => {
    await SecureStore.deleteItemAsync(LANGUAGE_KEY);
    setRTL(false);
    initLanguage('en');
    jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => {});

    update.mockClear();
    eq.mockClear();
    (supabase.from as jest.Mock).mockReturnValue({ update });
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: { user: { id: 'u1' } } },
    });
  });

  it('records the choice on the profile, so the column stops claiming English', async () => {
    await setLanguage('ar');
    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(update).toHaveBeenCalledWith({ language: 'ar' });
    expect(eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('still changes the language when the profile write fails', async () => {
    // Patchy signal is the normal case for this audience. The local preference
    // is already stored by now, and a stale column is a smaller lie than telling
    // someone their language did not change when it did.
    eq.mockRejectedValueOnce(new Error('offline'));
    await expect(setLanguage('ar')).resolves.toBeUndefined();
    await expect(SecureStore.getItemAsync(LANGUAGE_KEY)).resolves.toBe('ar');
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
  });

  it('writes nothing when nobody is signed in', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });
    await setLanguage('ar');
    expect(update).not.toHaveBeenCalled();
  });

  it('records the profile before flipping the direction', async () => {
    // Order matters if a relaunch is ever reintroduced: the flip is the last
    // thing that happens, so nothing after it can be skipped by a restart.
    const order: string[] = [];
    eq.mockImplementationOnce(async () => {
      order.push('profile');
      return { error: null };
    });
    (I18nManager.forceRTL as jest.Mock).mockImplementationOnce(() => {
      order.push('direction');
    });
    await setLanguage('ar');
    expect(order).toEqual(['profile', 'direction']);
  });
});
