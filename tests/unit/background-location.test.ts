/**
 * The background task at its boundaries: the OS (expo-location/task-manager)
 * and the RPC. What matters most is that a bad moment — no session, no signal —
 * never throws out of the task, and that only the newest fix is sent.
 */
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
    p_lat: 23.3, p_lng: 58.5, p_accuracy_m: 20, p_recorded_at: new Date(3000).toISOString(),
  });
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
  expect(CADENCE.trip).toEqual({ timeInterval: 2 * 60_000, distanceInterval: 500 });
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

  L.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  L.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  await expect(requestLocationAccess()).resolves.toBe('always');
  expect(L.requestForegroundPermissionsAsync.mock.invocationCallOrder[0]).toBeLessThan(
    L.requestBackgroundPermissionsAsync.mock.invocationCallOrder[0],
  );
});
