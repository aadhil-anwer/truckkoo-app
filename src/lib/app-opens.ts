/**
 * Which time the person has opened the app, counted from launch: 1 at launch,
 * +1 each time it comes back from the background.
 *
 * A permission that is off is asked about again on each opening (founder,
 * 2026-10-08) — not once per launch, because Android keeps a process alive in
 * the background for days, and a driver with location or notifications off
 * gets no jobs.
 *
 * Only background → active counts. iOS goes `inactive` while its own permission
 * dialog is up; counting that would treat "Don't allow" as a fresh opening and
 * ask again on the spot.
 */
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

let opens = 1;
let last: AppStateStatus = AppState.currentState ?? 'active';
const listeners = new Set<(n: number) => void>();

AppState.addEventListener('change', (next) => {
  if (next === 'active' && last === 'background') {
    opens += 1;
    for (const f of listeners) f(opens);
  }
  last = next;
});

export function currentOpen(): number {
  return opens;
}

/** Re-renders the caller on each opening, and returns which one it is. */
export function useAppOpen(): number {
  const [n, setN] = useState(opens);
  useEffect(() => {
    listeners.add(setN);
    return () => {
      listeners.delete(setN);
    };
  }, []);
  return n;
}

/** For tests: as if the app came back from the background. */
export function __openAgain(): void {
  opens += 1;
  for (const f of listeners) f(opens);
}
