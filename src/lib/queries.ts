/**
 * Data access. Every read names its columns explicitly (SECURITY.md §10) and
 * every write that touches a status or a price goes through an RPC, because no
 * client holds an UPDATE grant on those columns (SENSITIVE_FIELDS.md).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from './session';
import { supabase } from './supabase';

/** One literal string. Supabase derives row types from it, so it cannot be built by concatenation. */
const LOAD_COLUMNS =
  "id, origin_city, dest_city, pickup_from, pickup_to, weight_kg, truck_type_code, goods_description, status, price_baisa, currency, created_at";

/* ─── types ──────────────────────────────────────────────────────────────── */

export type City = {
  id: number;
  name_en: string;
  name_ar: string;
  country: string;
  corridor: string | null;
  /** WGS84, from 0020. NOT NULL in the database — the map projects these directly. */
  lat: number;
  lng: number;
};

/**
 * The cities select list, hoisted so a test can assert the map's columns survive.
 *
 * If `lat`/`lng` fall out of here the map does not error — every pin projects
 * from `undefined`, lands in the same corner, and it reads as a projection bug
 * for an afternoon. `tests/unit/city-coordinates.test.ts` guards it.
 */
export const CITY_COLUMNS = 'id, name_en, name_ar, country, corridor, lat, lng';
export type TruckType = {
  code: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  capacity_kg: number;
};

/**
 * `quoted` and `accepted` arrived with 0022 and reordered the flow: a price now
 * waits for the shipper, and it is their acceptance — not `post_load` — that
 * releases the load to drivers. Anything switching on this union has to handle
 * both, and a list that filters for "still live" that predates them silently
 * drops a load at exactly the moment the shipper is being asked a question.
 */
export type LoadStatus =
  | 'posted' | 'finding_truck' | 'quoted' | 'accepted' | 'matched' | 'assigned'
  | 'in_transit' | 'delivered' | 'closed' | 'cancelled';

export type Load = {
  id: string;
  origin_city: number;
  dest_city: number;
  pickup_from: string;
  pickup_to: string;
  weight_kg: number | null;
  truck_type_code: string | null;
  goods_description: string;
  status: LoadStatus;
  price_baisa: number | null;
  currency: string;
  created_at: string;
};

export type Leg = {
  id: string;
  origin_city: number;
  dest_city: number;
  depart_from: string;
  depart_to: string;
  is_empty: boolean;
  /** Room left on a part-loaded truck. NULL is "empty, or did not say" (0029). */
  free_kg: number | null;
  status: 'open' | 'matched' | 'closed' | 'cancelled';
};

export type Offer = {
  id: string;
  load_id: string;
  leg_id: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expires_at: string;
};

export type Trip = {
  id: string;
  load_id: string;
  truck_id: string | null;
  /**
   * Readable because `trips` is row-restricted to its two participants — a
   * shipper only ever sees the driver carrying their own load. It is here so T3
   * and T5 can ask `driver_summary` for a rating, which is keyed on the driver
   * rather than the trip.
   */
  driver_id: string | null;
  status: 'assigned' | 'in_transit' | 'delivered' | 'closed' | 'cancelled';
  created_at: string;
};

/* ─── reference data ─────────────────────────────────────────────────────── */

/**
 * Cities and truck types never change during a session. Cache hard.
 *
 * **Both are gated on having a session, and that is load-bearing.** The tables
 * are granted to `authenticated` only — `anon` gets `permission denied`, by
 * design (0001: reference data is read-only *to signed-in users*). Combined with
 * `staleTime: Infinity`, firing one of these while signed out poisons the cache:
 * the query fails, and because the observer belongs to a component that stays
 * mounted, nothing ever refetches it once a session appears.
 *
 * That is not hypothetical. It broke driver signup: `sign-up.tsx` mounts at step
 * 1 with no session, so `useTruckTypes()` failed there, and by step 3 the truck
 * picker rendered zero options while validation still demanded a truck size — an
 * unsatisfiable form at the last step of creating an account.
 */
export function useCities() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['cities'],
    enabled: !!session,
    staleTime: Infinity,
    // The app-wide default (_layout.tsx) turns this off; reference data is the
    // one case worth overriding it for. `staleTime: Infinity` means a failed
    // fetch is never retried by react-query's own staleness clock, so without
    // this a bad-signal failure at sign-up or on first launch renders "—" on
    // every city name until the process is killed (OPEN_ISSUES.md). Requires
    // `focusManager` wired to `AppState` (done once, in _layout.tsx) — RN has
    // no window-focus event for react-query's default listener to hear.
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<City[]> => {
      const { data, error } = await supabase
        .from('cities')
        .select(CITY_COLUMNS)
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTruckTypes() {
  const { session } = useSession();
  return useQuery({
    queryKey: ['truck_types'],
    // See useCities: without this, signup's step 1 poisons this cache and the
    // truck picker on step 3 renders nothing.
    enabled: !!session,
    staleTime: Infinity,
    // See useCities just above — same failure mode, same fix.
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<TruckType[]> => {
      const { data, error } = await supabase
        .from('truck_types')
        .select('code, name_en, name_ar, description_en, description_ar, capacity_kg')
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Lookup map so a screen can turn a city id into a name without a join. */
export function cityIndex(cities: City[] | undefined): Map<number, City> {
  return new Map((cities ?? []).map((c) => [c.id, c]));
}

/* ─── shipper ────────────────────────────────────────────────────────────── */

export function useMyLoads() {
  return useQuery({
    queryKey: ['loads', 'mine'],
    queryFn: async (): Promise<Load[]> => {
      const { data, error } = await supabase
        .from('loads')
        .select(LOAD_COLUMNS)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type PostLoadInput = {
  originCity: number;
  destCity: number;
  pickupFrom: string;
  pickupTo: string;
  goods: string;
  weightKg?: number | null;
  /** null means "Not sure — advise me". Never coerce this to a default. */
  truckTypeCode?: string | null;
};

export function usePostLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PostLoadInput): Promise<string> => {
      // RPC, not an insert: status is server-owned and the call is rate-limited.
      const { data, error } = await supabase.rpc('post_load', {
        p_origin_city: input.originCity,
        p_dest_city: input.destCity,
        p_pickup_from: input.pickupFrom,
        p_pickup_to: input.pickupTo,
        p_goods: input.goods,
        p_weight_kg: input.weightKg ?? null,
        p_truck_type_code: input.truckTypeCode ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loads', 'mine'] }),
  });
}

/* ─── the quote ───────────────────────────────────────────────────────────────
 *
 * There is no pricing logic here, and there must never be. The rate card is the
 * business's moat (SECURITY.md §1) and anything in the app bundle is public
 * forever (§9), so the formula lives only in `private.compute_price` and the
 * client's entire job is to render a number the server computed.
 *
 * A NULL price is not an error. Three outcomes produce one, and all three mean
 * "a human is pricing this" rather than "something went wrong" — which is the
 * no-dead-end promise in PRODUCT.md, expressed as a data shape.
 */

export type QuoteOutcome =
  /** Priced from the rate card. */
  | 'quoted'
  /** "Let us choose" with no weight: nothing to choose a truck by (0036). */
  | 'advise_me'
  /** No rate loaded for this corridor band yet. The normal state at launch. */
  | 'no_rate'
  /** The weight exceeds the chosen truck's capacity, so pricing it would be a lie. */
  | 'over_capacity';

export type Quote = {
  quote_id: string;
  price_baisa: number | null;
  currency: string;
  outcome: QuoteOutcome;
  expires_at: string;
};

/**
 * The shipper's live quote for a load, or null.
 *
 * Expiry is applied server-side inside `current_quote()` — deliberately not by
 * filtering `expires_at` here, because a client that forgot the filter would show
 * a stale price indefinitely and never know.
 */
export function useCurrentQuote(loadId: string | undefined) {
  return useQuery({
    queryKey: ['quote', loadId],
    enabled: !!loadId,
    queryFn: async (): Promise<Quote | null> => {
      const { data, error } = await supabase.rpc('current_quote', { p_load_id: loadId });
      if (error) throw error;
      return ((data ?? []) as Quote[])[0] ?? null;
    },
  });
}

/**
 * Price a route *before* committing to it — the estimate on the post-load review
 * step. Writes nothing: no load, no quote row. The binding quote is issued by
 * `quote_load` at post time, from the same rate card via the same
 * `private.price_for`, so the number reviewed is the number received.
 */
export function useQuoteRoute() {
  return useMutation({
    mutationFn: async (input: {
      originCity: number;
      destCity: number;
      truckTypeCode?: string | null;
      weightKg?: number | null;
    }): Promise<Quote | null> => {
      const { data, error } = await supabase.rpc('quote_route', {
        p_origin_city: input.originCity,
        p_dest_city: input.destCity,
        p_truck_type_code: input.truckTypeCode ?? null,
        p_weight_kg: input.weightKg ?? null,
      });
      if (error) throw error;
      return ((data ?? []) as Quote[])[0] ?? null;
    },
  });
}

/** The exact price for a route before booking, and the truck it is for. */
export type RoutePrice = {
  /** NULL when a person has to price it (no weight on "let us choose", no rate). */
  price_baisa: number | null;
  currency: string;
  outcome: QuoteOutcome;
  /** The truck the price is for — the resolved one when the shipper said "let us choose". */
  truck_type_code: string | null;
};

/**
 * The review screen's price. The same `quote_route` the server books against,
 * so the number shown is the number booked: `useBookLoad` sends it back and the
 * server refuses to auto-accept anything else. `bigint` arrives from PostgREST
 * as a string, and a string price concatenates — it is made a number here.
 */
export function useRoutePrice(input: {
  originCity: number | null;
  destCity: number | null;
  truckTypeCode: string | null;
  weightKg: number | null;
}) {
  return useQuery({
    queryKey: ['routePrice', input.originCity, input.destCity, input.truckTypeCode, input.weightKg],
    enabled: input.originCity != null && input.destCity != null,
    // Rate-limited server-side (30 an hour); a review screen re-rendering must
    // not spend them.
    staleTime: 60_000,
    queryFn: async (): Promise<RoutePrice | null> => {
      const { data, error } = await supabase.rpc('quote_route', {
        p_origin_city: input.originCity,
        p_dest_city: input.destCity,
        p_truck_type_code: input.truckTypeCode,
        p_weight_kg: input.weightKg,
      });
      if (error) throw error;
      const row = ((data ?? []) as Record<string, unknown>[])[0];
      if (!row) return null;
      return {
        price_baisa: row.price_baisa == null ? null : Number(row.price_baisa),
        currency: String(row.currency ?? 'OMR'),
        outcome: row.outcome as QuoteOutcome,
        truck_type_code: (row.truck_type_code as string | null) ?? null,
      };
    },
  });
}

export type BookInput = {
  originCity: number;
  destCity: number;
  collectionDate: string;
  goods: string;
  weightKg: number | null;
  truckTypeCode: string | null;
  /** The price on screen when "Book" was tapped; NULL when none was shown. */
  seenPriceBaisa: number | null;
};

/**
 * Book = accept, the Uber/Porter way. The server posts, prices, and — only if
 * its price is the one the shipper saw — accepts and starts dispatch in the same
 * call. If the price moved, the load is still posted and waits at "quoted" for
 * the shipper to accept the real number on the load screen.
 */
export function useBookLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BookInput) => {
      const { data, error } = await supabase.rpc('book_load', {
        p_origin_city: input.originCity,
        p_dest_city: input.destCity,
        p_pickup_from: input.collectionDate,
        p_pickup_to: input.collectionDate,
        p_goods: input.goods,
        p_weight_kg: input.weightKg,
        p_truck_type_code: input.truckTypeCode,
        p_seen_price_baisa: input.seenPriceBaisa,
      });
      if (error) throw error;
      const row = ((data ?? []) as Record<string, unknown>[])[0];
      if (!row?.load_id) throw new Error('book_load returned no load');
      return { loadId: String(row.load_id), priceMatched: row.price_matched === true };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loads', 'mine'] });
    },
  });
}

/** Ask for a price. Rate-limited server-side; shipper-owned loads only. */
export function useQuoteLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (loadId: string): Promise<Quote | null> => {
      const { data, error } = await supabase.rpc('quote_load', { p_load_id: loadId });
      if (error) throw error;
      return ((data ?? []) as Quote[])[0] ?? null;
    },
    onSuccess: (_q, loadId) => {
      qc.invalidateQueries({ queryKey: ['quote', loadId] });
      // An unpriceable load moves to finding_truck, so the load list changes too.
      qc.invalidateQueries({ queryKey: ['loads', 'mine'] });
    },
  });
}

/**
 * The shipper says yes, and that is what sends the load to drivers.
 *
 * `accept_quote` is idempotent and re-checks ownership inside the definer
 * function, which is what makes it safe to fire from a screen with a live
 * countdown on a phone with bad signal: a double tap and a retry after a timeout
 * both land on a load that is already accepted, and both come back a success.
 * The screen therefore does not need to guard the button beyond `isPending`.
 *
 * It returns the resulting status rather than void — a load already `assigned`
 * when the tap arrives answers `assigned`, and the screen re-renders into the
 * state it is actually in instead of claiming a transition that never happened.
 */
export function useAcceptQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (loadId: string): Promise<LoadStatus> => {
      const { data, error } = await supabase.rpc('accept_quote', { p_load_id: loadId });
      if (error) throw error;
      return data as LoadStatus;
    },
    onSuccess: (_status, loadId) => {
      qc.invalidateQueries({ queryKey: ['loads', 'mine'] });
      qc.invalidateQueries({ queryKey: ['quote', loadId] });
      // Acceptance is what triggers dispatch, so a trip can appear moments later.
      qc.invalidateQueries({ queryKey: ['trips', 'mine'] });
    },
  });
}

/* ─── driver ─────────────────────────────────────────────────────────────── */

export function useMyLegs() {
  return useQuery({
    queryKey: ['legs', 'mine'],
    queryFn: async (): Promise<Leg[]> => {
      const { data, error } = await supabase
        .from('legs')
        .select('id, origin_city, dest_city, depart_from, depart_to, is_empty, free_kg, status')
        .order('depart_from');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMyOffers() {
  return useQuery({
    queryKey: ['offers', 'mine'],
    queryFn: async (): Promise<Offer[]> => {
      const { data, error } = await supabase
        .from('offers')
        .select('id, load_id, leg_id, status, expires_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * What a driver may know about an offer (0030).
 *
 * `collect_baisa` is the shipper's price and `payout_baisa` is what the driver
 * keeps — both are on the card deliberately. A driver collects the first in cash
 * and remits the difference, so hiding either would leave them guessing at the
 * gate. See the P5 spec §2: the per-load margin is not a secret from the person
 * carrying the load.
 *
 * Every field here is composed server-side. Drivers do not read `public.loads`:
 * payout, detour and remaining capacity are computed beside the price they
 * derive from, and a table read would hand them every column the table grows.
 */
export type DriverOffer = {
  offer_id: string;
  expires_at: string;
  leg_id: string | null;
  origin_city: number;
  dest_city: number;
  pickup_from: string;
  pickup_to: string;
  goods: string;
  weight_kg: number | null;
  truck_type_code: string | null;
  collect_baisa: number | null;
  payout_baisa: number | null;
  owed_baisa: number | null;
  currency: string;
  /** NULL when the offer carries no leg, or a city has no coordinate. */
  detour_km: number | null;
  /** NULL when capacity or weight is unknown — never a guess. */
  free_after_kg: number | null;
};

export function useDriverOffers() {
  return useQuery({
    queryKey: ['driver', 'offers'],
    // Waves last five minutes. Until push notifications land, an offer has to
    // appear while the driver is looking at this screen, not when they next
    // pull to refresh — by then the wave has moved on.
    refetchInterval: 15_000,
    queryFn: async (): Promise<DriverOffer[]> => {
      const { data, error } = await supabase.rpc('driver_offers');
      if (error) throw error;
      return (data ?? []) as DriverOffer[];
    },
  });
}

export type Availability = {
  available: boolean;
  city_id: number | null;
  source: 'gps' | 'delivery' | 'manual';
  updated_at: string;
  /** When the phone last sent a point (0039). The point itself is never readable. */
  located_at: string | null;
};

/** The driver's own switch and town. NULL until they have ever set it. */
export function useMyAvailability() {
  return useQuery({
    queryKey: ['driver', 'availability'],
    // The server turns the switch off after twelve idle hours, and a delivery
    // turns it on. Read once, the card kept saying "online" to a driver the
    // server had already taken out of every wave.
    refetchInterval: 60_000,
    queryFn: async (): Promise<Availability | null> => {
      const { data, error } = await supabase
        .from('driver_availability')
        .select('available, city_id, source, updated_at, located_at')
        .maybeSingle();
      if (error) throw error;
      return (data as Availability | null) ?? null;
    },
  });
}

/**
 * Go available or offline. A position, when there is one, is sent once and
 * snapped server-side to the nearest town — only the town is kept.
 */
export function useSetAvailable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { available: boolean; lat?: number; lng?: number }) => {
      const { error } = await supabase.rpc('set_available', {
        p_available: input.available,
        p_lat: input.lat ?? null,
        p_lng: input.lng ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver', 'availability'] });
      qc.invalidateQueries({ queryKey: ['driver', 'offers'] });
    },
  });
}

/**
 * One offer, by OFFER id — never by load id. A driver holds no load id, and the
 * function is scoped to the caller inside the definer, so an id belonging to
 * somebody else returns nothing rather than a refusal.
 */
export function useDriverOffer(offerId: string | undefined) {
  return useQuery({
    queryKey: ['driver', 'offer', offerId],
    enabled: !!offerId,
    queryFn: async (): Promise<DriverOffer | null> => {
      const { data, error } = await supabase.rpc('driver_offer', { p_offer_id: offerId });
      if (error) throw error;
      return ((data ?? []) as DriverOffer[])[0] ?? null;
    },
  });
}

/** The week starts on Sunday — Oman's weekend is Friday–Saturday. Server-side. */
export type DriverEarnings = {
  week_baisa: number;
  week_trips: number;
  all_time_trips: number;
  /** Oman's calendar month (0033). The Past trips headline. */
  month_baisa: number;
  month_trips: number;
};

export function useDriverEarnings() {
  return useQuery({
    queryKey: ['driver', 'earnings'],
    queryFn: async (): Promise<DriverEarnings | null> => {
      const { data, error } = await supabase.rpc('driver_earnings');
      if (error) throw error;
      const r = ((data ?? []) as Record<string, string | number>[])[0];
      if (!r) return null;
      // bigint arrives as a string over PostgREST. Number() here, not at the
      // call site, so nothing downstream ever concatenates a payout.
      return {
        week_baisa: Number(r.week_baisa),
        week_trips: Number(r.week_trips),
        all_time_trips: Number(r.all_time_trips),
        month_baisa: Number(r.month_baisa ?? 0),
        month_trips: Number(r.month_trips ?? 0),
      };
    },
  });
}

/** One delivered trip, as `driver_trips()` composes it (0033). */
export type PastTrip = {
  trip_id: string;
  origin_city: number;
  dest_city: number;
  goods: string;
  weight_kg: number | null;
  payout_baisa: number | null;
  currency: string;
  delivered_at: string;
};

/**
 * The driver's delivered trips, newest first. The payout is computed in SQL
 * (`private.payout_for`), never here — see CLAUDE.md.
 */
export function useDriverPastTrips() {
  return useQuery({
    queryKey: ['driver', 'past'],
    queryFn: async (): Promise<PastTrip[]> => {
      const { data, error } = await supabase.rpc('driver_trips');
      if (error) throw error;
      // bigint arrives as a string over PostgREST; convert once, here.
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        trip_id: String(r.trip_id),
        origin_city: Number(r.origin_city),
        dest_city: Number(r.dest_city),
        goods: String(r.goods ?? ''),
        weight_kg: r.weight_kg == null ? null : Number(r.weight_kg),
        payout_baisa: r.payout_baisa == null ? null : Number(r.payout_baisa),
        currency: String(r.currency ?? 'OMR'),
        delivered_at: String(r.delivered_at),
      }));
    },
  });
}

/**
 * The job a driver is on (0031), composed like an offer.
 *
 * `payout_baisa` is what they earn; `collect_baisa` is what they take at the
 * gate. Same three numbers as `DriverOffer`, so `DriverMoney` renders either.
 */
export type DriverTrip = {
  trip_id: string;
  status: Trip['status'];
  load_id: string;
  origin_city: number;
  dest_city: number;
  pickup_from: string;
  pickup_to: string;
  goods: string;
  weight_kg: number | null;
  collect_baisa: number | null;
  payout_baisa: number | null;
  owed_baisa: number | null;
  currency: string;
  shipper_name: string | null;
  shipper_phone: string | null;
};

export function useDriverTrip(tripId: string | undefined) {
  return useQuery({
    queryKey: ['driver', 'trip', tripId],
    enabled: !!tripId,
    queryFn: async (): Promise<DriverTrip | null> => {
      const { data, error } = await supabase.rpc('driver_trip', { p_trip_id: tripId });
      if (error) throw error;
      return ((data ?? []) as DriverTrip[])[0] ?? null;
    },
  });
}

/**
 * Where the truck is, and when it lands (0032).
 *
 * ALWAYS ONE ROW for a trip the caller may see. `eta_source` says which answer
 * it is: `'fix'` means `lat`/`lng`/`seen_at` are a real position a phone
 * reported, `'corridor'` means there has never been one and the ETA is the old
 * corridor estimate — in which case the screen must say so.
 *
 * There is no third state and no trail. "Where is my truck" is the product;
 * "where has this driver been" is a movement record, and the server never
 * returns more than this row.
 */
export type TripPosition = {
  lat: number | null;
  lng: number | null;
  seen_at: string | null;
  accuracy_m: number | null;
  remaining_km: number | null;
  eta_at: string | null;
  eta_source: 'fix' | 'corridor';
};

export function useTripPosition(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip', 'position', tripId],
    enabled: !!tripId,
    // A position is the one thing on T4 that changes without the shipper doing
    // anything. Sixty seconds matches the driver's own reporting interval —
    // asking faster cannot produce a newer fix.
    refetchInterval: 60_000,
    queryFn: async (): Promise<TripPosition | null> => {
      const { data, error } = await supabase.rpc('trip_position', { p_trip_id: tripId });
      if (error) throw error;
      const r = ((data ?? []) as Record<string, string | number | null>[])[0];
      if (!r) return null;
      // numeric arrives as a string over PostgREST. Number() here, once, so
      // nothing downstream hands a string to the projection and wonders why the
      // truck is in the corner of the map.
      const num = (v: string | number | null) => (v == null ? null : Number(v));
      return {
        lat: num(r.lat),
        lng: num(r.lng),
        seen_at: (r.seen_at as string | null) ?? null,
        accuracy_m: num(r.accuracy_m),
        remaining_km: num(r.remaining_km),
        eta_at: (r.eta_at as string | null) ?? null,
        eta_source: r.eta_source === 'fix' ? 'fix' : 'corridor',
      };
    },
  });
}

/**
 * Report one fix. Resolves `false` when the trip is no longer live, which is not
 * an error — the delivery transition and the last queued ping race by seconds,
 * and the driver must not see a failure at the gate.
 */
export function useReportPosition() {
  return useMutation({
    mutationFn: async ({
      tripId,
      lat,
      lng,
      accuracyM,
    }: {
      tripId: string;
      lat: number;
      lng: number;
      accuracyM?: number | null;
    }): Promise<boolean> => {
      const { data, error } = await supabase.rpc('report_position', {
        p_trip_id: tripId,
        p_lat: lat,
        p_lng: lng,
        p_accuracy_m: accuracyM ?? null,
      });
      if (error) throw error;
      return data === true;
    },
  });
}

export function useMyTrips() {
  return useQuery({
    queryKey: ['trips', 'mine'],
    queryFn: async (): Promise<Trip[]> => {
      const { data, error } = await supabase
        .from('trips')
        .select('id, load_id, truck_id, driver_id, status, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRespondToOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ offerId, accept }: { offerId: string; accept: boolean }) => {
      const { data, error } = await supabase.rpc('respond_to_offer', {
        p_offer_id: offerId,
        p_accept: accept,
      });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['offers', 'mine'] });
      qc.invalidateQueries({ queryKey: ['trips', 'mine'] });
      qc.invalidateQueries({ queryKey: ['legs', 'mine'] });
      // Everything the driver reads about themselves: the offer they just
      // answered is gone from their book, and if they accepted, the trip and the
      // week's earnings both moved.
      qc.invalidateQueries({ queryKey: ['driver'] });
    },
  });
}

export type PostLegInput = {
  originCity: number;
  destCity: number;
  departFrom: string;
  departTo: string;
  truckId?: string | null;
  isEmpty?: boolean;
  /**
   * Roughly how much room is left on a part-loaded truck. Undefined and null are
   * the same answer — "did not say" — and `post_leg` drops it entirely when the
   * truck is empty, because all of it is free and two answers to one question
   * disagree eventually.
   */
  freeKg?: number | null;
};

export function usePostLeg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PostLegInput): Promise<string> => {
      const { data, error } = await supabase.rpc('post_leg', {
        p_origin_city: input.originCity,
        p_dest_city: input.destCity,
        p_depart_from: input.departFrom,
        p_depart_to: input.departTo,
        p_truck_id: input.truckId ?? null,
        p_is_empty: input.isEmpty ?? true,
        p_free_kg: input.freeKg ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['legs', 'mine'] }),
  });
}

export function useAdvanceTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      tripId,
      to,
      photoPath,
    }: {
      tripId: string;
      to: 'in_transit' | 'delivered';
      photoPath?: string | null;
    }) => {
      const { error } = await supabase.rpc('advance_trip', {
        p_trip_id: tripId,
        p_to: to,
        p_note: null,
        p_photo_path: photoPath ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips', 'mine'] });
      // The trip screen and the home job card read ['driver', 'trip', id];
      // without this both kept offering "Yes, it is loaded" after the trip had
      // started. Delivering also moves the week's earnings and past trips.
      qc.invalidateQueries({ queryKey: ['driver'] });
    },
  });
}

/* ─── who is carrying my cargo ────────────────────────────────────────────────
 *
 * Both of these cross a tenant boundary, and both do it through a definer
 * function that re-checks trip participation internally. A shipper cannot read
 * `profiles` or `trucks` for anyone else — these RPCs are the only doors, and
 * they only open for the two people actually on the trip.
 */

export type TripCounterpart = { full_name: string; phone: string | null; role: 'shipper' | 'driver' };
export type TripTruck = { truck_type: string; plate: string | null; is_verified: boolean };

/** The other party on a trip: a driver to a shipper, a shipper to a driver. */
export function useTripCounterpart(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip', tripId, 'counterpart'],
    enabled: !!tripId,
    queryFn: async (): Promise<TripCounterpart | null> => {
      const { data, error } = await supabase.rpc('trip_counterpart', { p_trip_id: tripId });
      if (error) throw error;
      // Returns a set; a trip not yet assigned yields no row rather than an error.
      return ((data ?? []) as TripCounterpart[])[0] ?? null;
    },
  });
}

export function useTripTruck(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip', tripId, 'truck'],
    enabled: !!tripId,
    queryFn: async (): Promise<TripTruck | null> => {
      const { data, error } = await supabase.rpc('trip_truck', { p_trip_id: tripId });
      if (error) throw error;
      return ((data ?? []) as TripTruck[])[0] ?? null;
    },
  });
}

/**
 * What a shipper may know about the driver carrying their load.
 *
 * `avgStars` is **null when nobody has rated them**, and that null is the whole
 * point: with no history T3 shows the name and the vehicle and no rating at all
 * — not "0.0", not "New driver ★". Inventing a score is fabricating proof
 * (CLAUDE.md #5), and a zero reads as a *bad* driver rather than a new one.
 *
 * `driver_summary` refuses a driver the caller has no trip with, so this cannot
 * become a directory of every driver's performance.
 */
export type DriverSummary = { trips: number; avgStars: number | null; ratings: number };

export function useDriverSummary(driverId: string | null | undefined) {
  return useQuery({
    queryKey: ['driver', driverId, 'summary'],
    enabled: !!driverId,
    queryFn: async (): Promise<DriverSummary | null> => {
      const { data, error } = await supabase.rpc('driver_summary', { p_driver_id: driverId });
      if (error) throw error;
      const row = ((data ?? []) as { trips: number; avg_stars: number | null; ratings: number }[])[0];
      if (!row) return null;
      return {
        trips: Number(row.trips),
        // `numeric` arrives as a string from PostgREST; Number(null) is 0, which
        // is exactly the fabricated score this must not produce.
        avgStars: row.avg_stars == null ? null : Number(row.avg_stars),
        ratings: Number(row.ratings),
      };
    },
  });
}

/**
 * One rating per trip, by the shipper who owned it, once it is delivered.
 *
 * Insert-once server-side: a second call on the same trip is silently a no-op
 * rather than an error, so the screen can treat a submitted rating as final and
 * show thanks rather than a form.
 */
export function useRateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, stars }: { tripId: string; stars: number }) => {
      const { error } = await supabase.rpc('rate_trip', { p_trip_id: tripId, p_stars: stars });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver'] }),
  });
}

export type TripEvent = {
  id: string;
  trip_id: string;
  type: string;
  note: string | null;
  photo_path: string | null;
  occurred_at: string;
};

/**
 * The trip's trail. Readable by both participants, append-only by the driver —
 * so a shipper sees the milestones without being able to author them.
 */
export function useTripEvents(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip', tripId, 'events'],
    enabled: !!tripId,
    queryFn: async (): Promise<TripEvent[]> => {
      const { data, error } = await supabase
        .from('trip_events')
        .select('id, trip_id, type, note, photo_path, occurred_at')
        .eq('trip_id', tripId!)
        .order('occurred_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TripEvent[];
    },
  });
}

/**
 * A short-lived signed URL for a proof-of-delivery photo.
 *
 * The `pod` bucket is private (SECURITY.md §10) and the storage policy authorises
 * on the trip id in the first path segment. Sixty seconds is enough to render an
 * image and short enough that a leaked URL is worthless.
 */
export function usePodUrl(photoPath: string | null | undefined) {
  return useQuery({
    queryKey: ['pod', photoPath],
    enabled: !!photoPath,
    // Re-sign well before the URL dies, so a screen left open keeps working.
    staleTime: 45_000,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.storage
        .from('pod')
        .createSignedUrl(photoPath!, 60);
      if (error) throw error;
      return data?.signedUrl ?? null;
    },
  });
}
