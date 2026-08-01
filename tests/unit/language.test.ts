/**
 * The language preference.
 *
 * `I18nManager.forceRTL` only takes effect on the NEXT launch, so the whole
 * correctness question here is about the reload. Get it wrong in one direction
 * and the user reads Arabic in a left-to-right layout; get it wrong in the other
 * and the app relaunches forever, because the stored preference is still there
 * on the way back in.
 */

import { I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';

import { LANGUAGE_KEY, loadLanguage, needsReload, setLanguage } from '@/lib/language';
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

  it('never reloads on boot when the layout already matches', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'en');
    await loadLanguage();
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('reloads once when a stored Arabic preference meets a left-to-right layout', async () => {
    // The self-healing path: the preference survived, the native direction did
    // not. Exactly one relaunch fixes it, and the next boot is quiet.
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'ar');
    await loadLanguage();
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);

    setRTL(true);
    (Updates.reloadAsync as jest.Mock).mockClear();
    await loadLanguage();
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('still starts when the keystore is unavailable', async () => {
    // A locked keystore is not a reason to fail to boot.
    jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValueOnce(new Error('locked'));
    await expect(loadLanguage()).resolves.toBe('en');
  });
});

describe('setLanguage', () => {
  beforeEach(async () => {
    await SecureStore.deleteItemAsync(LANGUAGE_KEY);
    setRTL(false);
    initLanguage('en');
    jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => {});
  });

  it('persists the choice and reloads', async () => {
    await setLanguage('ar');
    await expect(SecureStore.getItemAsync(LANGUAGE_KEY)).resolves.toBe('ar');
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(Updates.reloadAsync).toHaveBeenCalled();
  });

  it('does nothing when the language is already active and the layout agrees', async () => {
    await SecureStore.setItemAsync(LANGUAGE_KEY, 'en');
    await loadLanguage();
    await setLanguage('en');
    expect(Updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('does not reject when the relaunch is unavailable', async () => {
    // reloadAsync is a no-op in Expo Go and can reject in a dev client. The
    // preference is already stored by then, so the next manual start is correct
    // and an error here would look like the change failed when it did not.
    (Updates.reloadAsync as jest.Mock).mockRejectedValueOnce(new Error('not supported'));
    await expect(setLanguage('ar')).resolves.toBeUndefined();
    await expect(SecureStore.getItemAsync(LANGUAGE_KEY)).resolves.toBe('ar');
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
    expect(Updates.reloadAsync).toHaveBeenCalled();
  });

  it('writes nothing when nobody is signed in', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });
    await setLanguage('ar');
    expect(update).not.toHaveBeenCalled();
  });

  it('writes before the relaunch, because the relaunch may never return', async () => {
    const order: string[] = [];
    eq.mockImplementationOnce(async () => {
      order.push('profile');
      return { error: null };
    });
    (Updates.reloadAsync as jest.Mock).mockImplementationOnce(async () => {
      order.push('reload');
    });
    await setLanguage('ar');
    expect(order).toEqual(['profile', 'reload']);
  });
});
