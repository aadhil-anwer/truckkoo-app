/**
 * The background task at its boundaries: the OS (expo-location/task-manager)
 * and the RPC. What matters most is that a bad moment — no session, no signal —
 * never throws out of the task, and that only the newest fix is sent.
 */
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { supabase } from '@/lib/supabase';
import {
  CADENCE,
  LOCATION_TASK,
  locationAccess,
  requestLocationAccess,
  sendNewest,
  startTracking,
  stopTracking,
} from '@/lib/background-location';

const L = Location as jest.Mocked<typeof Location>;
// Recorded at import, before any beforeEach clears mock history.
const defineCalls = [...(TaskManager.defineTask as jest.Mock).mock.calls];
const fix = (ts: number, lat = 23.6) =>
  ({ timestamp: ts, coords: { latitude: lat, longitude: 58.5, accuracy: 20 } }) as Location.LocationObject;

beforeEach(() => {
  jest.clearAllMocks();
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: [{ stored: true, on_trip: false }], error: null });
});

it('defines the task once, at import', () => {
  expect(defineCalls).toHaveLength(1);
  expect(defineCalls[0][0]).toBe(LOCATION_TASK);
});

it('sends only the newest fix of a batch', async () => {
  await sendNewest([fix(1000, 23.1), fix(3000, 23.3), fix(2000, 23.2)]);
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith('report_location', {
    p_lat: 23.3, p_lng: 58.5, p_accuracy_m: 20, p_recorded_at: new Date(3000).toISOString(), p_speed_mps: null,
  });
});

it('sends the speed when the phone knows it, so driving past a pin is not arriving (0069)', async () => {
  const moving = { timestamp: 5000, coords: { latitude: 23.4, longitude: 58.5, accuracy: 15, speed: 12.5 } } as Location.LocationObject;
  const unknown = { timestamp: 6000, coords: { latitude: 23.4, longitude: 58.5, accuracy: 15, speed: -1 } } as Location.LocationObject;
  await sendNewest([moving]);
  expect(supabase.rpc).toHaveBeenLastCalledWith('report_location', expect.objectContaining({ p_speed_mps: 12.5 }));
  await sendNewest([unknown]);
  expect(supabase.rpc).toHaveBeenLastCalledWith('report_location', expect.objectContaining({ p_speed_mps: null }));
});

it('never throws — no session, no signal', async () => {
  (supabase.rpc as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
  await expect(sendNewest([fix(1)])).resolves.toBeUndefined();
  (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: null, error: { message: 'JWT expired' } });
  await expect(sendNewest([fix(2)])).resolves.toBeUndefined();
});

it('the task handler swallows an OS error', async () => {
  const handler = defineCalls[0][1];
  await expect(handler({ data: null, error: { message: 'denied' } })).resolves.toBeUndefined();
  expect(supabase.rpc).not.toHaveBeenCalled();
});

it('does not start without background permission', async () => {
  L.getBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
  await expect(startTracking('online')).resolves.toBe(false);
  expect(L.startLocationUpdatesAsync).not.toHaveBeenCalled();
});

it('starts at the online cadence, with the notification', async () => {
  L.getBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  await expect(startTracking('online')).resolves.toBe(true);
  expect(L.startLocationUpdatesAsync).toHaveBeenCalledWith(
    LOCATION_TASK,
    expect.objectContaining({
      timeInterval: CADENCE.online.timeInterval,
      distanceInterval: 2000,
      foregroundService: expect.objectContaining({ notificationTitle: expect.any(String) }),
    }),
  );
  expect(CADENCE.online.timeInterval).toBe(15 * 60_000);
  // On a trip the shipper is watching T4: a fix every 30 s or 150 m is what
  // makes the marker move while they look at it.
  expect(CADENCE.trip).toEqual({ timeInterval: 30_000, distanceInterval: 150 });
});

it('restarts when the mode changes, not when it is the same', async () => {
  L.getBackgroundPermissionsAsync.mockResolvedValue({ granted: true } as never);
  L.hasStartedLocationUpdatesAsync.mockResolvedValue(true);
  await startTracking('trip');
  expect(L.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  await startTracking('trip');
  expect(L.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
});

it('stops only what is running', async () => {
  L.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(false);
  await stopTracking();
  expect(L.stopLocationUpdatesAsync).not.toHaveBeenCalled();
  L.hasStartedLocationUpdatesAsync.mockResolvedValueOnce(true);
  await stopTracking();
  expect(L.stopLocationUpdatesAsync).toHaveBeenCalledWith(LOCATION_TASK);
});

it('reads and requests permission in Android order', async () => {
  L.getForegroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  L.getBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
  await expect(locationAccess()).resolves.toBe('foreground');

  // Nothing granted yet, and the phone still willing to ask for both.
  L.getForegroundPermissionsAsync.mockReset().mockResolvedValue({ granted: false, canAskAgain: true } as never);
  L.getBackgroundPermissionsAsync.mockReset().mockResolvedValue({ granted: false, canAskAgain: true } as never);
  L.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  L.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  await expect(requestLocationAccess()).resolves.toBe('always');
  expect(L.requestForegroundPermissionsAsync.mock.invocationCallOrder[0]).toBeLessThan(
    L.requestBackgroundPermissionsAsync.mock.invocationCallOrder[0],
  );
});

describe('when the phone will no longer ask', () => {
  let openSettings: jest.SpyInstance;
  beforeEach(() => {
    // Drain once-values other tests queued and left unused.
    L.getForegroundPermissionsAsync.mockReset().mockResolvedValue({ granted: false } as never);
    L.getBackgroundPermissionsAsync.mockReset().mockResolvedValue({ granted: false } as never);
    L.requestForegroundPermissionsAsync.mockReset().mockResolvedValue({ granted: false } as never);
    L.requestBackgroundPermissionsAsync.mockReset().mockResolvedValue({ granted: false } as never);
    openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);
  });
  afterEach(() => openSettings.mockRestore());

  it('opens Settings instead of a request that would show nothing', async () => {
    L.getForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false } as never);
    await expect(requestLocationAccess()).resolves.toBe('none');
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(L.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('opens Settings for "all the time" once that dialog is spent too', async () => {
    L.getForegroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
    L.getBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false } as never);
    await expect(requestLocationAccess()).resolves.toBe('foreground');
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(L.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks normally the first time, and takes a refusal made in the dialog as an answer', async () => {
    L.getForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true } as never);
    L.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false } as never);
    await expect(requestLocationAccess()).resolves.toBe('none');
    expect(L.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('does not ask again for what is already granted', async () => {
    L.getForegroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
    L.getBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
    await expect(requestLocationAccess()).resolves.toBe('always');
    expect(L.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(L.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });
});
