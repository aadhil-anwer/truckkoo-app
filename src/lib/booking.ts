/**
 * The booking draft.
 *
 * Six questions is a lot to lose. A shipper who gets a phone call at step 4 and
 * comes back to an empty form does not start again — so the draft is persisted
 * on every change and only cleared once a load has actually been posted.
 *
 * ONE key, one blob. The alternative — a key per answer — means a partial write
 * leaves a draft that is internally inconsistent, and there is no version of that
 * bug worth the marginally smaller writes.
 *
 * Two fields carry project non-negotiables and are typed to make them awkward to
 * break:
 *
 *   `truckPreference: 'auto' | <code>` — `auto` posts `truck_type_code = NULL`,
 *   which is the website's "Not sure — advise me" default and the single most
 *   important affordance for this audience (CLAUDE.md #1). It is the DEFAULT
 *   here, not an option someone has to find.
 *
 *   `weightKg: number | null` — null is a legitimate answer, not a missing one.
 */

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'truckkoo.booking.draft.v1';

/** ISO `YYYY-MM-DD`. Dates are days, not instants — a pickup has no timezone. */
export type IsoDate = string;

export type BookingDraft = {
  originCityId: number | null;
  destinationCityId: number | null;
  /** Which country's cities the destination step is showing. */
  destinationCountry: 'OM' | 'AE' | 'SA';
  collectionDate: IsoDate | null;
  cargoDescription: string;
  /** `auto` posts NULL — see the note above. */
  truckPreference: 'auto' | string;
  weightKg: number | null;
};

export const EMPTY_DRAFT: BookingDraft = {
  originCityId: null,
  destinationCityId: null,
  destinationCountry: 'OM',
  collectionDate: null,
  cargoDescription: '',
  truckPreference: 'auto',
  weightKg: null,
};

/** The six steps, in order. Used for the progress counter and for routing. */
export const STEPS = ['origin', 'destination', 'date', 'cargo', 'truck', 'weight'] as const;
export type Step = (typeof STEPS)[number];
export const TOTAL_STEPS = STEPS.length;

export function stepNumber(step: Step): number {
  return STEPS.indexOf(step) + 1;
}

/**
 * What `post_load` should receive for the truck type.
 *
 * Kept as a function rather than inlined at the call site so there is exactly one
 * place that decides NULL means "advise me" — the constraint that a NOT NULL
 * here silently deletes.
 */
export function truckTypeForPost(draft: BookingDraft): string | null {
  return draft.truckPreference === 'auto' ? null : draft.truckPreference;
}

/** Whether the draft has enough to post. Weight and truck are deliberately absent. */
export function isComplete(draft: BookingDraft): boolean {
  return (
    draft.originCityId != null &&
    draft.destinationCityId != null &&
    draft.collectionDate != null &&
    draft.cargoDescription.trim().length > 0
  );
}

export async function loadDraft(): Promise<BookingDraft> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY_DRAFT;
    // Spread over EMPTY_DRAFT so a draft written by an older build, missing a
    // field added since, still opens instead of throwing halfway through a flow.
    return { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<BookingDraft>) };
  } catch {
    return EMPTY_DRAFT;
  }
}

export async function saveDraft(draft: BookingDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // A failed write costs the user their answers on a kill, which is bad but
    // survivable. Throwing here would cost them the answer they just gave, which
    // is worse — so this stays silent by design.
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing useful to do. The next post overwrites it.
  }
}

/**
 * Read/write the draft with persistence handled.
 *
 * `ready` matters: the first render has no draft yet, and a screen that renders
 * its inputs against `EMPTY_DRAFT` before the stored one arrives will flash
 * blank fields at a user who has answers.
 */
export function useBookingDraft() {
  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    loadDraft().then((d) => {
      if (alive) {
        setDraft(d);
        setReady(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((patch: Partial<BookingDraft>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      void saveDraft(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    void clearDraft();
  }, []);

  return { draft, update, reset, ready };
}
