/**
 * When the driver's location is reported — the policy half of
 * `background-location.ts`.
 *
 * Tracked while ONLINE or ON A JOB (heading to the pickup or carrying the load),
 * never otherwise, never a shipper.
 * With "Allow all the time" the OS task does it; with while-using only, one fix
 * on opening the app and every five minutes it stays open; with nothing, no
 * jobs are offered (0076: no live fix, no job). Mounted once, in the (app) layout.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import {
  type LocationAccess,
  type TrackingMode,
  locationAccess,
  reportOnce,
  requestLocationAccess,
  startTracking,
  stopTracking,
} from '@/lib/background-location';
import { useMyAvailability, useMyTrips } from '@/lib/queries';
import { useSession } from '@/lib/session';

const FOREGROUND_INTERVAL_MS = 5 * 60_000;

export function trackingMode(
  role: string | undefined,
  available: boolean | undefined,
  trips: { status: string }[] | undefined,
): TrackingMode | null {
  if (role !== 'driver') return null;
  // Heading to the pickup counts as on a trip (0069): the server notices the
  // driver reaching the pin from these reports, so they must be close together.
  if ((trips ?? []).some((tr) => tr.status === 'in_transit' || tr.status === 'assigned')) return 'trip';
  return available ? 'online' : null;
}

type Ctx = {
  access: LocationAccess | null;
  refresh: () => void;
  request: () => Promise<LocationAccess>;
};
const LocationCtx = createContext<Ctx>({
  access: null,
  refresh: () => {},
  request: async () => 'none',
});

export function useLocationAccess() {
  return useContext(LocationCtx);
}

export function LocationTrackingProvider({ children }: { children: ReactNode }) {
  const { profile } = useSession();
  const role = profile?.role;
  const availability = useMyAvailability();
  const trips = useMyTrips();
  const mode = trackingMode(role, availability.data?.available, trips.data);
  const [access, setAccess] = useState<LocationAccess | null>(null);

  const refresh = useCallback(() => {
    locationAccess().then(setAccess, () => setAccess('none'));
  }, []);

  // On mount, and every time the app comes back — Settings is where Android 11+
  // grants "Allow all the time", so returning from it is the moment it changes.
  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!mode || access === null) {
      if (!mode) stopTracking().catch(() => {});
      return;
    }
    if (access === 'always') {
      startTracking(mode).catch(() => {});
      return;
    }
    stopTracking().catch(() => {});
    if (access === 'foreground') {
      reportOnce().catch(() => {});
      const id = setInterval(() => {
        if (AppState.currentState === 'active') reportOnce().catch(() => {});
      }, FOREGROUND_INTERVAL_MS);
      return () => clearInterval(id);
    }
  }, [mode, access]);

  const request = useCallback(async () => {
    const next = await requestLocationAccess();
    setAccess(next);
    return next;
  }, []);

  const value = useMemo(() => ({ access, refresh, request }), [access, refresh, request]);
  return <LocationCtx.Provider value={value}>{children}</LocationCtx.Provider>;
}
