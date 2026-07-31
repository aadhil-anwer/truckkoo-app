/**
 * The two answers a driver gives while declaring a route.
 *
 * MODULE SCOPE, NOT ASYNCSTORAGE. The booking draft is persisted because six
 * questions is a lot to lose to a phone call. This is two questions asked at a
 * fuel stop with the engine running — the cost of losing it is one re-tap, and
 * the cost of persisting it is a stale route offered back to a driver next week,
 * which is worse than the thing it prevents.
 *
 * `freeKg` is `null` for "did not say", exactly like `loads.truck_type_code`.
 * Not answering must stay possible for this audience, and `post_leg` drops the
 * number entirely when the truck is empty.
 */

export type LegDraft = {
  originCityId: number | null;
  destCityId: number | null;
  departFrom: string | null;
  isEmpty: boolean;
  freeKg: number | null;
};

const EMPTY: LegDraft = {
  originCityId: null,
  destCityId: null,
  departFrom: null,
  isEmpty: true,
  freeKg: null,
};

let draft: LegDraft = { ...EMPTY };

export function getLegDraft(): LegDraft {
  return draft;
}

export function updateLegDraft(patch: Partial<LegDraft>): LegDraft {
  draft = { ...draft, ...patch };
  return draft;
}

/** Called once the leg is posted, so the next declaration starts clean. */
export function clearLegDraft(): void {
  draft = { ...EMPTY };
}
