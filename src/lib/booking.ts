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

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { greatCircleKm } from '@/map/distance';
import { BIDDING } from './features';
import { useSession } from './session';

const KEY_PREFIX = 'truckkoo.booking.draft.v2.';

/** ISO `YYYY-MM-DD`. Dates are days, not instants — a pickup has no timezone. */
export type IsoDate = string;

/** An exact place (0041). The city beside it is always the server's `city_near`. */
export type DraftPlace = {
  lat: number;
  lng: number;
  placeName: string | null;
  note: string;
  contactName: string;
  contactPhone: string;
};

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
  /** Null when the shipper chose a city only — a real answer, not a gap. */
  originPlace: DraftPlace | null;
  destinationPlace: DraftPlace | null;
  /**
   * The most the shipper will pay in total, in baisa (0045). Optional; never
   * shown to a driver. When bidding closes, the lowest bid at or under it is
   * taken without asking again. Null is "I will choose myself".
   */
  targetTotalBaisa: number | null;
};

export const EMPTY_DRAFT: BookingDraft = {
  originCityId: null,
  destinationCityId: null,
  destinationCountry: 'OM',
  collectionDate: null,
  cargoDescription: '',
  truckPreference: 'auto',
  weightKg: null,
  originPlace: null,
  destinationPlace: null,
  targetTotalBaisa: null,
};

/**
 * The steps, in order. Used for the progress counter and for routing.
 *
 * `target` — "the most you will pay" — exists only for bid loads (0045), so it
 * is last and counted only while BIDDING is on: six steps without it, seven
 * with it.
 */
export const STEPS = ['origin', 'destination', 'date', 'cargo', 'truck', 'weight', 'target'] as const;
export type Step = (typeof STEPS)[number];
export const TOTAL_STEPS = BIDDING ? STEPS.length : STEPS.length - 1;

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

/** What book_load's p_origin_place / p_dest_place receive. Blank means nothing. */
export type PlacePayload = {
  lat: number;
  lng: number;
  place_name: string | null;
  note: string | null;
  contact_name: string | null;
  contact_phone: string | null;
};

const blank = (s: string | null | undefined) => {
  const v = (s ?? '').trim();
  return v.length ? v : null;
};

export function toPlacePayload(p: DraftPlace | null): PlacePayload | null {
  if (!p) return null;
  return {
    lat: p.lat,
    lng: p.lng,
    place_name: blank(p.placeName),
    note: blank(p.note),
    contact_name: blank(p.contactName),
    contact_phone: blank(normalizePhone(p.contactPhone)),
  };
}

/**
 * An Arabic keyboard types ٩٦٨, a Persian one ۹۶۸; the database accepts 0-9.
 * Normalised here, before validation and before saving, or every contact typed
 * on an Arabic phone would be refused at the last step.
 */
export function normalizePhone(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim();
}

/** Empty is fine — the contact is optional. Mirrors load_places_phone. */
export function isValidPhone(raw: string): boolean {
  const v = normalizePhone(raw);
  return v.length === 0 || /^\+?[0-9 ]{6,24}$/.test(v);
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

function keyFor(ownerId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(ownerId)}`;
}

const pendingWrites = new Map<string, Promise<void>>();

function queueWrite(ownerId: string, write: () => Promise<void>): Promise<void> {
  const previous = pendingWrites.get(ownerId) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(write).catch(() => {});
  pendingWrites.set(ownerId, pending);
  void pending.then(() => {
    if (pendingWrites.get(ownerId) === pending) pendingWrites.delete(ownerId);
  });
  return pending;
}

function placeFromStorage(value: unknown): DraftPlace | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = value as Record<string, unknown>;
  if (typeof p.lat !== 'number' || !Number.isFinite(p.lat) || Math.abs(p.lat) > 90 ||
      typeof p.lng !== 'number' || !Number.isFinite(p.lng) || Math.abs(p.lng) > 180) return null;
  return {
    lat: p.lat,
    lng: p.lng,
    placeName: typeof p.placeName === 'string' ? p.placeName : null,
    note: typeof p.note === 'string' ? p.note : '',
    contactName: typeof p.contactName === 'string' ? p.contactName : '',
    contactPhone: typeof p.contactPhone === 'string' ? p.contactPhone : '',
  };
}

function draftFromStorage(value: unknown): BookingDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_DRAFT;
  const d = value as Record<string, unknown>;
  const city = (x: unknown) => typeof x === 'number' && Number.isSafeInteger(x) && x > 0 ? x : null;
  return {
    originCityId: city(d.originCityId),
    destinationCityId: city(d.destinationCityId),
    destinationCountry: d.destinationCountry === 'AE' || d.destinationCountry === 'SA'
      ? d.destinationCountry : 'OM',
    collectionDate: typeof d.collectionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.collectionDate)
      ? d.collectionDate : null,
    cargoDescription: typeof d.cargoDescription === 'string' ? d.cargoDescription : '',
    truckPreference: typeof d.truckPreference === 'string' && d.truckPreference.length > 0
      ? d.truckPreference : 'auto',
    weightKg: typeof d.weightKg === 'number' && Number.isFinite(d.weightKg) && d.weightKg > 0
      ? d.weightKg : null,
    originPlace: placeFromStorage(d.originPlace),
    destinationPlace: placeFromStorage(d.destinationPlace),
    targetTotalBaisa: typeof d.targetTotalBaisa === 'number' && Number.isSafeInteger(d.targetTotalBaisa) &&
      d.targetTotalBaisa >= 0 ? d.targetTotalBaisa : null,
  };
}

export async function loadDraft(ownerId: string): Promise<BookingDraft> {
  if (!ownerId) return EMPTY_DRAFT;
  try {
    await pendingWrites.get(ownerId);
    const raw = await AsyncStorage.getItem(keyFor(ownerId));
    if (!raw) return EMPTY_DRAFT;
    return draftFromStorage(JSON.parse(raw));
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(draft: BookingDraft, ownerId: string): Promise<void> {
  if (!ownerId) return Promise.resolve();
  // Serialise writes: a slower earlier keystroke must not overwrite the last
  // answer after navigation. Failure remains best effort for the live screen.
  return queueWrite(ownerId, () => AsyncStorage.setItem(keyFor(ownerId), JSON.stringify(draft)));
}

export function clearDraft(ownerId: string): Promise<void> {
  if (!ownerId) return Promise.resolve();
  if (sharedOwner === ownerId) {
    generation += 1;
    publish(EMPTY_DRAFT);
  }
  return queueWrite(ownerId, () => AsyncStorage.removeItem(keyFor(ownerId)));
}

/**
 * "Send this route again" (home, T5): a fresh draft from a load the shipper has
 * already sent.
 *
 * The route, the cargo, the truck and the weight carry over — a repeat shipment
 * is usually the same goods on the same road. The date does not: it is the one
 * answer that is always new, which is why the flow opens on it. Places and the
 * price limit do not carry over either; a gate or a budget from last time is a
 * guess this time, and every step still shows its answer before review.
 *
 * Starts from EMPTY_DRAFT rather than merging into whatever was half-typed: the
 * shipper asked for that load again, not a mixture of it and another.
 */
export function draftFromLoad(load: {
  origin_city: number;
  dest_city: number;
  goods_description: string;
  truck_type_code: string | null;
  weight_kg: number | null;
  /** The destination city's country, so the destination step opens on its list. */
  destCountry?: string | null;
}): BookingDraft {
  const country = load.destCountry === 'AE' || load.destCountry === 'SA' ? load.destCountry : 'OM';
  return {
    ...EMPTY_DRAFT,
    originCityId: load.origin_city,
    destinationCityId: load.dest_city,
    destinationCountry: country,
    cargoDescription: load.goods_description,
    // NULL stays "advise me" — never turned into a guessed code.
    truckPreference: load.truck_type_code ?? 'auto',
    weightKg: load.weight_kg,
  };
}

/**
 * Replace the draft and wait until it is stored, so the screen pushed next
 * reads it rather than racing the write.
 */
export async function startDraft(draft: BookingDraft, ownerId: string): Promise<void> {
  if (sharedOwner === ownerId) {
    generation += 1;
    publish(draft);
  }
  await saveDraft(draft, ownerId);
}

/**
 * The one in-memory draft every mounted booking screen shares.
 *
 * Each screen used to hold its own copy, loaded on mount, and every `update`
 * wrote that whole copy back. A stack keeps earlier screens mounted, so going
 * back and answering again wrote a stale copy over newer answers: a note typed
 * on the details screen vanished when the pin under it confirmed again, and a
 * swap on destination could pair one end's city with the other end's place —
 * which book_load refuses at the very last step.
 *
 * Held only while some booking screen is mounted; when the last one unmounts
 * it is dropped, and the next reads storage again.
 */
let shared: BookingDraft | null = null;
let sharedOwner: string | null = null;
let generation = 0;
let mounted = 0;
const listeners = new Set<() => void>();

function publish(next: BookingDraft | null) {
  shared = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Read/write the draft with persistence handled.
 *
 * `ready` matters: the first render has no draft yet, and a screen that renders
 * its inputs against `EMPTY_DRAFT` before the stored one arrives will flash
 * blank fields at a user who has answers.
 */
export function useBookingDraft() {
  const { session } = useSession();
  const ownerId = session?.user.id ?? null;
  const snapshot = () => sharedOwner === ownerId ? shared : null;
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!ownerId) return;
    mounted += 1;
    if (sharedOwner !== ownerId) {
      sharedOwner = ownerId;
      publish(null);
    }
    if (shared == null) {
      const ticket = ++generation;
      loadDraft(ownerId).then((d) => {
        // A screen may have written while storage was being read; its answer wins.
        if (sharedOwner === ownerId && generation === ticket && shared == null && mounted > 0) publish(d);
      });
    }
    return () => {
      mounted -= 1;
      if (mounted === 0) {
        shared = null;
        sharedOwner = null;
        generation += 1;
      }
    };
  }, [ownerId]);

  const update = useCallback((patch: Partial<BookingDraft>) => {
    if (!ownerId) return;
    const next = { ...((sharedOwner === ownerId ? shared : null) ?? EMPTY_DRAFT), ...patch };
    void saveDraft(next, ownerId);
    if (sharedOwner === ownerId) {
      generation += 1;
      publish(next);
    }
  }, [ownerId]);

  const reset = useCallback(() => {
    if (ownerId) void clearDraft(ownerId);
  }, [ownerId]);

  return { draft: current ?? EMPTY_DRAFT, update, reset, ready: current != null };
}

/**
 * A job inside one town (0069) needs both pins, far enough apart to be a job.
 * The same rule `check_same_city` applies on the server, which decides; this
 * only lets the pin screen say so before the shipper gets to the price.
 * 300 m mirrors the server's default `same_city_min_m`.
 */
export const SAME_TOWN_MIN_M = 300;
export function sameTownProblem(
  originCityId: number | null,
  destCityId: number | null,
  originPin: { lat: number; lng: number } | null,
  destPin: { lat: number; lng: number } | null,
): 'needsPickupPin' | 'tooClose' | null {
  if (originCityId == null || destCityId == null || originCityId !== destCityId) return null;
  if (!originPin || !destPin) return 'needsPickupPin';
  return greatCircleKm(originPin, destPin) * 1000 < SAME_TOWN_MIN_M ? 'tooClose' : null;
}
