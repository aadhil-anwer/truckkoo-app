/**
 * The phone's half of push (0046): asking, the Settings fallback, registering,
 * unregistering at sign-out, when to ask again, and where a tap may go.
 */
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { supabase } from '@/lib/supabase';
import {
  declinePush,
  hrefFor,
  pushStatus,
  registerPush,
  requestPush,
  shouldAskForPush,
  unregisterPush,
} from '@/lib/push';

const N = Notifications as jest.Mocked<typeof Notifications>;
const perm = (granted: boolean, status: string, canAskAgain = true) =>
  ({ granted, status, canAskAgain }) as never;

let openSettings: jest.SpyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  N.getPermissionsAsync.mockReset().mockResolvedValue(perm(false, 'undetermined'));
  N.requestPermissionsAsync.mockReset().mockResolvedValue(perm(false, 'denied'));
  (supabase.rpc as jest.Mock).mockReset().mockResolvedValue({ data: null, error: null });
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);
});

afterEach(() => openSettings.mockRestore());

describe('asking', () => {
  it('reads the three states', async () => {
    N.getPermissionsAsync.mockResolvedValueOnce(perm(true, 'granted'));
    await expect(pushStatus()).resolves.toEqual({ access: 'granted', canAskAgain: true });
    N.getPermissionsAsync.mockResolvedValueOnce(perm(false, 'denied', false));
    await expect(pushStatus()).resolves.toEqual({ access: 'denied', canAskAgain: false });
  });

  it('shows the system dialog the first time', async () => {
    N.requestPermissionsAsync.mockResolvedValueOnce(perm(true, 'granted'));
    await expect(requestPush()).resolves.toBe('granted');
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('opens Settings when the phone will no longer ask', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm(false, 'denied', false));
    await expect(requestPush()).resolves.toBe('denied');
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('registering', () => {
  it('sends the token for the signed-in account, and remembers it for sign-out', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm(true, 'granted'));
    await expect(registerPush()).resolves.toBe('ExponentPushToken[testtokenaaaaaaaa]');
    expect(supabase.rpc).toHaveBeenCalledWith('register_push_token', {
      p_token: 'ExponentPushToken[testtokenaaaaaaaa]',
      p_platform: expect.stringMatching(/^(android|ios)$/),
    });
    await unregisterPush();
    expect(supabase.rpc).toHaveBeenLastCalledWith('unregister_push_token', {
      p_token: 'ExponentPushToken[testtokenaaaaaaaa]',
    });
  });

  it('registers nothing without permission', async () => {
    await expect(registerPush()).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('never throws — no signal, server refused', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm(true, 'granted'));
    (supabase.rpc as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
    await expect(registerPush()).resolves.toBeNull();
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: null, error: { message: 'rate limited' } });
    await expect(registerPush()).resolves.toBeNull();
  });

  it('signs out cleanly when this phone never registered', async () => {
    await expect(unregisterPush()).resolves.toBe(true);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('retains the token when the server cannot unregister it', async () => {
    await AsyncStorage.setItem('truckkoo.push.token', 'ExponentPushToken[testtokenaaaaaaaa]');
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await expect(unregisterPush()).resolves.toBe(false);
    expect(await AsyncStorage.getItem('truckkoo.push.token')).toBe('ExponentPushToken[testtokenaaaaaaaa]');
  });
});

describe('when to ask', () => {
  it('asks a phone that has never been asked — right after sign-up', async () => {
    await expect(shouldAskForPush()).resolves.toBe(true);
  });

  // Founder, 2026-10-08: while it is off, ask again. The provider limits it to
  // once per opening of the app (push-screens.test.tsx), not this function.
  it('still asks after "Not now" — off is off, and an off driver misses jobs', async () => {
    await declinePush();
    await expect(shouldAskForPush()).resolves.toBe(true);
  });

  it('asks when a permission that was on has been switched off', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm(true, 'granted'));
    await registerPush();
    N.getPermissionsAsync.mockResolvedValue(perm(false, 'denied', false));
    await expect(shouldAskForPush()).resolves.toBe(true);
  });

  it('never asks while it is on', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm(true, 'granted'));
    await expect(shouldAskForPush()).resolves.toBe(false);
  });
});

describe('where a tap goes', () => {
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

  it('opens the job, the trip or the load it is about', () => {
    expect(hrefFor({ kind: 'driver_new_job', offer_id: id, bid: true })).toBe(`/bid/${id}`);
    expect(hrefFor({ kind: 'staff_message', message_id: id })).toBe('/messages');
    expect(hrefFor({ kind: 'shipper_driver_released', load_id: id })).toBe(`/load/${id}`);
    expect(hrefFor({ kind: 'shipper_driver_released', load_id: 'not-a-uuid' })).toBeNull();
    expect(hrefFor({ kind: 'driver_new_job', offer_id: id, bid: false })).toBe(`/offer/${id}`);
    expect(hrefFor({ kind: 'driver_trip', trip_id: id })).toBe(`/trip/${id}`);
    expect(hrefFor({ kind: 'shipper_load', load_id: id })).toBe(`/load/${id}`);
  });

  it('goes nowhere for anything it does not recognise', () => {
    expect(hrefFor({ kind: 'shipper_load', load_id: '../account' })).toBeNull();
    expect(hrefFor({ kind: 'something_else', load_id: id })).toBeNull();
    expect(hrefFor(null)).toBeNull();
    expect(hrefFor('shipper_load')).toBeNull();
  });
});

describe('jobOfferId (0074)', () => {
  const { jobOfferId } = require('@/lib/push') as typeof import('@/lib/push');
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
  it('names the offer of a fixed-price job', () => {
    expect(jobOfferId({ kind: 'driver_new_job', offer_id: id, bid: false })).toBe(id);
  });
  it('never a bid invitation, which has a price to name first', () => {
    expect(jobOfferId({ kind: 'driver_new_job', offer_id: id, bid: true })).toBeNull();
  });
  it('never a malformed id or another kind', () => {
    expect(jobOfferId({ kind: 'driver_new_job', offer_id: '../trip/1' })).toBeNull();
    expect(jobOfferId({ kind: 'shipper_load', offer_id: id })).toBeNull();
    expect(jobOfferId(null)).toBeNull();
  });
});
