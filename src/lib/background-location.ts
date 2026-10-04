/**
 * Driver location, in the background (spec 2026-09-28).
 *
 * The one module that reports a driver's position. It runs only while the driver
 * is online or carrying a load (the provider in `location-tracking.tsx` decides),
 * at low frequency — the concern is battery and data — and sends only the newest
 * fix. The server keeps only the latest point, and stores nothing while the
 * driver is off (0039): this file is the client half, not the control.
 *
 * `defineTask` must run at module scope on every launch, including a headless
 * one after the OS restarts the service — which is why `src/app/_layout.tsx`
 * imports this file for its side effect.
 */
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';

export const LOCATION_TASK = 'truckkoo-driver-location';

export type TrackingMode = 'online' | 'trip';
export type LocationAccess = 'always' | 'foreground' | 'none';

/**
 * Online: often enough that a point is rarely 15 min old at dispatch. On a trip:
 * the shipper is watching T4, so the marker should move while they look — and
 * `report_location` allows 240 an hour for it (0040).
 */
export const CADENCE: Record<TrackingMode, { timeInterval: number; distanceInterval: number }> = {
  online: { timeInterval: 15 * 60_000, distanceInterval: 2000 },
  trip: { timeInterval: 30_000, distanceInterval: 150 },
};

/** Waiting longer than this for a fix is a driver staring at a switch. */
const FIX_TIMEOUT_MS = 8000;

export async function sendNewest(locations: Location.LocationObject[]): Promise<void> {
  if (locations.length === 0) return;
  const newest = locations.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
  try {
    await supabase.rpc('report_location', {
      p_lat: newest.coords.latitude,
      p_lng: newest.coords.longitude,
      p_accuracy_m: newest.coords.accuracy ?? null,
      p_recorded_at: new Date(newest.timestamp).toISOString(),
    });
  } catch {
    // No signal in the Hajar, or no session on a headless launch. The next
    // update is minutes away; a throw here would only kill the task.
  }
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    await sendNewest(data.locations);
  },
);

let runningMode: TrackingMode | null = null;

export async function startTracking(mode: TrackingMode): Promise<boolean> {
  const bg = await Location.getBackgroundPermissionsAsync();
  if (!bg.granted) return false;

  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (started && runningMode === mode) return true;
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK);

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: CADENCE[mode].timeInterval,
    distanceInterval: CADENCE[mode].distanceInterval,
    deferredUpdatesInterval: CADENCE[mode].timeInterval,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: t('loc.notify.title'),
      notificationBody: t('loc.notify.body'),
      killServiceOnDestroy: false,
    },
  });
  runningMode = mode;
  return true;
}

/** The mode the OS task is running in, or null — so a failed sign-out can resume it. */
export function trackingNow(): TrackingMode | null {
  return runningMode;
}

export async function stopTracking(): Promise<void> {
  runningMode = null;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

export async function locationAccess(): Promise<LocationAccess> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return 'none';
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.granted ? 'always' : 'foreground';
}

/**
 * Android order: while-using first, then all-the-time (Settings, on 11+).
 *
 * WHEN THE PHONE WILL NO LONGER ASK, SEND THE DRIVER TO SETTINGS. After two
 * refusals, "Don't ask again", or a permission revoked in Settings and refused,
 * the OS request returns "denied" at once and shows nothing. Calling it anyway
 * made "Continue" and "Turn on" buttons that did nothing at all. So read first:
 * a permission the phone has stopped offering is fixed in Settings, and the app
 * re-reads it when the driver comes back (location-tracking's AppState refresh).
 *
 * Only a refusal that was ALREADY final opens Settings. One made just now, in
 * the dialog, is the driver's answer — throwing them into Settings for it would
 * be arguing with them.
 */
export async function requestLocationAccess(): Promise<LocationAccess> {
  const fgNow = await Location.getForegroundPermissionsAsync();
  if (!fgNow.granted) {
    if (fgNow.canAskAgain === false) {
      await Linking.openSettings().catch(() => {});
      return 'none';
    }
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return 'none';
  }
  const bgNow = await Location.getBackgroundPermissionsAsync();
  if (bgNow.granted) return 'always';
  if (bgNow.canAskAgain === false) {
    await Linking.openSettings().catch(() => {});
    return 'foreground';
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.granted ? 'always' : 'foreground';
}

/**
 * One fix within eight seconds — ONLY if the phone already allows it. This never
 * raises the OS prompt: asking is the disclosure screen's job (spec §5.3).
 */
export async function currentFix(): Promise<{ lat: number; lng: number } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return null;
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), FIX_TIMEOUT_MS);
      }),
    ]);
    return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The while-using fallback: one fix, sent. */
export async function reportOnce(): Promise<{ lat: number; lng: number } | null> {
  const fix = await currentFix();
  if (fix) {
    await sendNewest([
      { timestamp: Date.now(), coords: { latitude: fix.lat, longitude: fix.lng, accuracy: null } },
    ] as unknown as Location.LocationObject[]);
  }
  return fix;
}
