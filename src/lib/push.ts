/**
 * Push notifications, the phone's half (0046). The server composes and sends;
 * this asks permission, registers the phone, and opens the right screen when a
 * notification is tapped.
 *
 * WHEN THE PHONE WILL NO LONGER ASK, SEND THE PERSON TO SETTINGS — the same
 * rule as location (`background-location.ts`). After a refusal Android and iOS
 * stop showing their dialog, and a button that calls the request anyway does
 * nothing at all.
 *
 * THE TOKEN IS THE DEVICE. It goes to `register_push_token`, which moves a
 * shared phone to whoever signed in last; `unregisterPush` runs before sign-out
 * so the account that left stops buzzing a phone it no longer holds.
 */
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';

export type PushAccess = 'granted' | 'denied' | 'undetermined';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TOKEN_KEY = 'truckkoo.push.token';
const ASKED_KEY = 'truckkoo.push.asked';
const GRANTED_KEY = 'truckkoo.push.wasGranted';

/**
 * Show a notification even while the app is open — a new job is news either way.
 * A fixed-price job is the exception: the provider opens its card full screen
 * (0074), so a banner on top of it would only cover the buttons. It still rings.
 */
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const job = jobOfferId(n.request.content.data) !== null;
    return {
      shouldShowBanner: !job,
      shouldShowList: !job,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

/**
 * 0074: Accept and Decline on a new job. Accept opens the job card — it never
 * takes a job from the lock screen, where a brushed thumb in a moving cab would
 * commit a driver to 40 km. Decline answers without opening the app.
 */
export const JOB_OFFER_CATEGORY = 'job_offer';

async function ensureCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(JOB_OFFER_CATEGORY, [
    { identifier: 'accept', buttonTitle: t('push.job.accept'), options: { opensAppToForeground: true } },
    {
      identifier: 'decline',
      buttonTitle: t('push.job.decline'),
      options: { opensAppToForeground: false, isDestructive: true },
    },
  ]);
}

/** The offer a fixed-price job notification is about, or null — never a bid invite. */
export function jobOfferId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== 'driver_new_job' || d.bid === true) return null;
  return typeof d.offer_id === 'string' && UUID.test(d.offer_id) ? d.offer_id : null;
}

/** Decline from the notification. Never throws: an unanswered offer lapses on its own. */
export async function declineJob(offerId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('respond_to_offer', { p_offer_id: offerId, p_accept: false });
    return !error;
  } catch {
    return false;
  }
}

export async function pushStatus(): Promise<{ access: PushAccess; canAskAgain: boolean }> {
  const p = await Notifications.getPermissionsAsync();
  const access: PushAccess = p.granted ? 'granted' : p.status === 'undetermined' ? 'undetermined' : 'denied';
  return { access, canAskAgain: p.canAskAgain !== false };
}

/** Ask, or open Settings when the phone has stopped offering to. */
export async function requestPush(): Promise<PushAccess> {
  await markAsked();
  const now = await pushStatus();
  if (now.access === 'granted') return 'granted';
  if (!now.canAskAgain) {
    await Linking.openSettings().catch(() => {});
    return 'denied';
  }
  const p = await Notifications.requestPermissionsAsync();
  return p.granted ? 'granted' : 'denied';
}

/**
 * Android 8+ shows nothing without a channel. One, named in the app's language,
 * matching the `channelId` the server sends.
 */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: t('push.channel'),
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Register this phone for the signed-in account. Never throws. */
export async function registerPush(): Promise<string | null> {
  try {
    const { access } = await pushStatus();
    if (access !== 'granted') return null;
    await AsyncStorage.setItem(GRANTED_KEY, '1').catch(() => {});
    await ensureChannel();
    await ensureCategories();
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    if (error) return null;
    await AsyncStorage.setItem(TOKEN_KEY, token).catch(() => {});
    return token;
  } catch {
    return null;
  }
}

/** Revoke the token before sign-out. Keep it locally if revocation is uncertain. */
export async function unregisterPush(): Promise<boolean> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (!token) return true;
    const { error } = await supabase.rpc('unregister_push_token', { p_token: token });
    if (error) return false;
    await AsyncStorage.removeItem(TOKEN_KEY);
    return true;
  } catch {
    return false;
  }
}

async function markAsked(): Promise<void> {
  await AsyncStorage.setItem(ASKED_KEY, '1').catch(() => {});
}

/**
 * Whether to show the permission screen on this opening of the app.
 *
 * Whenever notifications are off (founder, 2026-10-08): a driver who misses the
 * push misses the job, and a shipper misses "your truck is here". The provider
 * asks at most once per opening, so "Not now" holds for the rest of that visit.
 */
export async function shouldAskForPush(): Promise<boolean> {
  const { access } = await pushStatus();
  return access !== 'granted';
}

/** "Not now": stop treating a revoked permission as news. */
export async function declinePush(): Promise<void> {
  await markAsked();
  await AsyncStorage.removeItem(GRANTED_KEY).catch(() => {});
}

/**
 * Where a tapped notification goes. The data is the server's, but it is still
 * input to a router: only known kinds, only well-formed ids.
 */
export function hrefFor(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const id = (k: string) => (typeof d[k] === 'string' && UUID.test(d[k] as string) ? (d[k] as string) : null);
  switch (d.kind) {
    case 'driver_new_job': {
      const offer = id('offer_id');
      return offer ? (d.bid === true ? `/bid/${offer}` : `/offer/${offer}`) : null;
    }
    // 0069: the shipper said the driver is not at the pin.
    case 'driver_absence_reported':
    case 'driver_trip': {
      const trip = id('trip_id');
      return trip ? `/trip/${trip}` : null;
    }
    case 'shipper_load':
    // 0069: the truck reached the pickup or the drop-off; the load shows the waiting.
    case 'shipper_driver_arrived':
    // 0065: the driver released the job; the load page says a new truck is being found.
    case 'shipper_driver_released': {
      const load = id('load_id');
      return load ? `/load/${load}` : null;
    }
    // 0065: staff wrote; the words are in the app, never on the lock screen.
    case 'staff_message':
      return '/messages';
    default:
      return null;
  }
}
