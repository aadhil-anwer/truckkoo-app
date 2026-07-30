/**
 * The booking draft.
 *
 * Two of these assertions guard project non-negotiables rather than behaviour:
 * "Let us choose" must post NULL (CLAUDE.md #1 — a NOT NULL there silently
 * deletes the most important affordance this audience has), and weight must stay
 * genuinely optional.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  EMPTY_DRAFT,
  TOTAL_STEPS,
  clearDraft,
  isComplete,
  loadDraft,
  saveDraft,
  stepNumber,
  truckTypeForPost,
  type BookingDraft,
} from '@/lib/booking';

const FILLED: BookingDraft = {
  originCityId: 1,
  destinationCityId: 7,
  destinationCountry: 'OM',
  collectionDate: '2026-07-31',
  cargoDescription: 'Building materials',
  truckPreference: 'auto',
  weightKg: null,
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('truckTypeForPost', () => {
  it('turns "auto" into NULL — the "advise me" default', () => {
    // A NOT NULL truck_type_code deletes the website's default choice. This is
    // the one place that decision is made, so this is the test that holds it.
    expect(truckTypeForPost({ ...FILLED, truckPreference: 'auto' })).toBeNull();
  });

  it('passes a real code through untouched', () => {
    expect(truckTypeForPost({ ...FILLED, truckPreference: '10t' })).toBe('10t');
  });

  it('defaults to auto, so not answering means "advise me"', () => {
    expect(EMPTY_DRAFT.truckPreference).toBe('auto');
    expect(truckTypeForPost(EMPTY_DRAFT)).toBeNull();
  });
});

describe('isComplete', () => {
  it('does not require a weight — skipping is a real path', () => {
    expect(isComplete({ ...FILLED, weightKg: null })).toBe(true);
  });

  it('does not require a truck choice', () => {
    expect(isComplete({ ...FILLED, truckPreference: 'auto' })).toBe(true);
  });

  it('does require both cities, a date and a description', () => {
    expect(isComplete({ ...FILLED, originCityId: null })).toBe(false);
    expect(isComplete({ ...FILLED, destinationCityId: null })).toBe(false);
    expect(isComplete({ ...FILLED, collectionDate: null })).toBe(false);
    expect(isComplete({ ...FILLED, cargoDescription: '   ' })).toBe(false);
  });
});

describe('persistence', () => {
  it('survives a reload — six answers are too many to lose', async () => {
    await saveDraft(FILLED);
    expect(await loadDraft()).toEqual(FILLED);
  });

  it('returns an empty draft when nothing is stored', async () => {
    expect(await loadDraft()).toEqual(EMPTY_DRAFT);
  });

  it('fills in fields a older build did not write', async () => {
    // A draft saved before a field existed must still open, rather than throwing
    // halfway through a flow the user is standing in.
    await AsyncStorage.setItem(
      'truckkoo.booking.draft.v1',
      JSON.stringify({ originCityId: 3 }),
    );
    const draft = await loadDraft();
    expect(draft.originCityId).toBe(3);
    expect(draft.truckPreference).toBe('auto');
    expect(draft.weightKg).toBeNull();
  });

  it('survives corrupt stored data instead of crashing the flow', async () => {
    await AsyncStorage.setItem('truckkoo.booking.draft.v1', 'not json');
    expect(await loadDraft()).toEqual(EMPTY_DRAFT);
  });

  it('clears', async () => {
    await saveDraft(FILLED);
    await clearDraft();
    expect(await loadDraft()).toEqual(EMPTY_DRAFT);
  });
});

describe('steps', () => {
  it('is a six-step flow', () => {
    expect(TOTAL_STEPS).toBe(6);
  });

  it('numbers steps from one, for the counter', () => {
    expect(stepNumber('origin')).toBe(1);
    expect(stepNumber('weight')).toBe(6);
  });
});
