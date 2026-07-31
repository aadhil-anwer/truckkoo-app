/**
 * The position reporter.
 *
 * FOREGROUND ONLY, and that is a product decision, not a shortcut. Continuous
 * background tracking needs an App Store background-mode justification, an
 * Android foreground service with a Play Console demo video, and a licensed
 * library — `STACK.md` calls it "the single hardest thing in the whole product"
 * and defers it to Phase 3. Everything server-side is already shaped for it, so
 * adopting it later changes this file and nothing else.
 *
 * THE HONEST COST: the driver's phone is in their pocket for most of an
 * eleven-hour run, so most of that run produces no fixes. The shipper sees a
 * correctly-stamped old position rather than a moving one. That is the trade,
 * and `OPEN_ISSUES.md` records it.
 *
 * This is the only module in the app that imports `expo-location`.
 */

import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

import { useReportPosition } from './queries';

/** One fix a minute, or every 500 metres — whichever comes first. */
const INTERVAL_MS = 60_000;
const DISTANCE_M = 500;

export function usePositionReporter(
  tripId: string | undefined,
  active: boolean,
): { lastSentAt: string | null; denied: boolean } {
  const report = useReportPosition();
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  // The mutation object is new on every render; the watcher effect must not
  // restart because of that, so it reaches the mutation through a ref rather
  // than depending on it. The ref is updated in its own effect, not during
  // render — a ref written during render is what `react-hooks/refs` forbids,
  // and it is forbidden because it makes the value read depend on render order.
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  });

  useEffect(() => {
    if (!tripId || !active) return;

    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      // FOREGROUND ONLY. expo-location's background permission API is
      // deliberately not called anywhere in this codebase, and `grep` for it is
      // part of the phase's definition of done — so it is not named here
      // either, or the check would always find itself.
      const permission = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (!permission.granted) {
        setDenied(true);
        return;
      }
      setDenied(false);

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: INTERVAL_MS,
          distanceInterval: DISTANCE_M,
        },
        (reading) => {
          reportRef.current
            .mutateAsync({
              tripId,
              lat: reading.coords.latitude,
              lng: reading.coords.longitude,
              accuracyM: reading.coords.accuracy ?? null,
            })
            .then((stored) => {
              // `false` means the trip is no longer live — the delivery landed
              // while this fix was in flight. Not an error, and not something to
              // show a driver standing at a gate.
              if (stored) setLastSentAt(new Date().toISOString());
            })
            .catch(() => {
              // A dropped fix on bad signal is the normal case, not an event.
              // The next one is a minute away, and the shipper's screen already
              // says how old the last one is.
            });
        },
      );

      if (cancelled) {
        subscription.remove();
        subscription = null;
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [tripId, active]);

  return { lastSentAt, denied };
}
