import { useEffect, useState } from 'react';

/**
 * Re-renders the caller every `ms` while `on`, so a label derived from
 * `Date.now()` — "Seen 35 s ago" — keeps telling the truth between fetches.
 *
 * It returns nothing worth reading: the point is the render. The caller keeps
 * deriving from the clock itself, so there is one notion of "now", not two.
 * Not a live region, deliberately — a screen reader announcing a counter every
 * second would drown out the screen.
 */
export function useTick(ms: number, on = true): void {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms, on]);
}
