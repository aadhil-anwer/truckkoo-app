/**
 * Data access. Every read names its columns explicitly (SECURITY.md §10) and
 * every write that touches a status or a price goes through an RPC, because no
 * client holds an UPDATE grant on those columns (SENSITIVE_FIELDS.md).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from './session';
import { supabase } from './supabase';
import type { PlacePayload } from './booking';

/** One literal string. Supabase derives row types from it, so it cannot be built by concatenation. */
const LOAD_COLUMNS =
  "id, origin_city, dest_city, pickup_from, pickup_to, weight_kg, truck_type_code, goods_description, status, price_baisa, currency, created_at, pricing_mode, bid_deadline";

export type DriverDocumentStatus = {
  kind: 'id_front' | 'id_back' | 'mulkiya' | 'truck_photo';
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
};

/** A driver's own review state. The query key includes the account because the
 * root QueryClient survives sign-out and another driver may use this phone. */
export function useDriverVerification() {
  const { profile } = useSession();
  return useQuery({
    queryKey: ['driver', 'verification', profile?.id],
    enabled: profile?.role === 'driver',
    queryFn: async () => {
      const [driver, documents] = await Promise.all([
        supabase.from('drivers').select('verified_at').eq('profile_id', profile!.id).maybeSingle(),
        supabase.rpc('driver_document_status'),
      ]);
      if (driver.error) throw driver.error;
      if (documents.error) throw documents.error;
      return {
        verified: !!driver.data?.verified_at,
        documents: (documents.data ?? []) as DriverDocumentStatus[],
      };
    },
  });
}

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
  /**
   * `bid` loads (0045) are priced by drivers' bids. Their `price_baisa` stays
   * NULL until a bid is accepted, so a bid load's screens read the bids through
   * `shipper_load_bids` / `shipper_bid_status`, never this column.
   */
  pricing_mode: 'fixed' | 'bid';
  /** When bidding closes. NULL on a fixed-price load. */
  bid_deadline: string | null;
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
/**
 * While a reference-data fetch is failing, try again every 30 s. Focus and
 * pull-to-refresh recover only if the user does something; a driver who opened
 * the app in a dead zone and keeps it open would otherwise read "—" for every
 * city until they did. Stops the moment a fetch succeeds.
 */
const RETRY_WHILE_FAILED = (query: { state: { status: string } }) =>
  query.state.status === 'error' ? 30_000 : false;

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
    refetchInterval: RETRY_WHILE_FAILED,
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
    refetchInterval: RETRY_WHILE_FAILED,
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


/** The exact price for a route before booking, and the truck it is for. */
export type RoutePrice = {
  /** NULL when a person has to price it (no weight on "let us choose", no rate). */
  price_baisa: number | null;
  currency: string;
  outcome: QuoteOutcome;
  /** The truck the price is for — the resolved one when the shipper said "let us choose". */
  truck_type_code: string | null;
  /** 0069: the road distance the price was measured on — between the pins when both are set. */
  km?: number | null;
  /** 0069: waiting terms that come with this price; null when the band charges none. */
  wait_free_minutes?: number | null;
  wait_per_15min_baisa?: number | null;
};

/**
 * The review screen's price. The same measure the server books against (0069
 * `quote_trip`: between the pins when both are set, so a job inside one town
 * has a distance),
 * so the number shown is the number booked: `useBookLoad` sends it back and the
 * server refuses to auto-accept anything else. `bigint` arrives from PostgREST
 * as a string, and a string price concatenates — it is made a number here.
 */
export function useRoutePrice(input: {
  originCity: number | null;
  destCity: number | null;
  truckTypeCode: string | null;
  weightKg: number | null;
  originPin?: { lat: number; lng: number } | null;
  destPin?: { lat: number; lng: number } | null;
}) {
  return useQuery({
    queryKey: ['routePrice', input.originCity, input.destCity, input.truckTypeCode, input.weightKg,
      input.originPin?.lat, input.originPin?.lng, input.destPin?.lat, input.destPin?.lng],
    enabled: input.originCity != null && input.destCity != null,
    // Rate-limited server-side (30 an hour); a review screen re-rendering must
    // not spend them.
    staleTime: 60_000,
    queryFn: async (): Promise<RoutePrice | null> => {
      const { data, error } = await supabase.rpc('quote_trip', {
        p_origin_city: input.originCity,
        p_dest_city: input.destCity,
        p_truck_type_code: input.truckTypeCode,
        p_weight_kg: input.weightKg,
        p_origin_lat: input.originPin?.lat ?? null,
        p_origin_lng: input.originPin?.lng ?? null,
        p_dest_lat: input.destPin?.lat ?? null,
        p_dest_lng: input.destPin?.lng ?? null,
      });
      if (error) throw error;
      const row = ((data ?? []) as Record<string, unknown>[])[0];
      if (!row) return null;
      return {
        price_baisa: row.price_baisa == null ? null : Number(row.price_baisa),
        currency: String(row.currency ?? 'OMR'),
        outcome: row.outcome as QuoteOutcome,
        truck_type_code: (row.truck_type_code as string | null) ?? null,
        km: row.km == null ? null : Number(row.km),
        wait_free_minutes: row.wait_free_minutes == null ? null : Number(row.wait_free_minutes),
        wait_per_15min_baisa: row.wait_per_15min_baisa == null ? null : Number(row.wait_per_15min_baisa),
      };
    },
  });
}

/** One stop's waiting, as the database computed it (0069 `private.trip_wait`). */
export type WaitStop = {
  stop: 'pickup' | 'drop';
  arrived_at: string | null;
  ended_at: string | null;
  running: boolean;
  minutes: number;
  free_minutes: number;
  per_15min_baisa: number;
  cap_minutes: number;
  capped: boolean;
  waived: boolean;
  /** "Driver isn't here": charged nothing until a person at Truckkoo checks. */
  held: boolean;
  charge_baisa: number;
};
export type TripWaiting = {
  terms: { free_minutes: number; per_15min_baisa: number; cap_minutes: number } | null;
  stops: WaitStop[];
  waiting_baisa: number;
  price_baisa: number | null;
  /** Price + waiting: what the shipper pays and the driver collects. */
  total_baisa: number | null;
  /** The driver's own earnings on the trip; null for the shipper, always. */
  payout_baisa: number | null;
};

/**
 * A trip's waiting charge and totals, for its driver or its shipper. Every
 * amount is computed in SQL; nothing here adds money up. Refreshes while a
 * clock may be running.
 */
export function useTripWaiting(tripId: string | null | undefined, live: boolean) {
  return useQuery({
    queryKey: ['tripWaiting', tripId],
    enabled: !!tripId,
    refetchInterval: live ? 60_000 : false,
    queryFn: async (): Promise<TripWaiting> => {
      const { data, error } = await supabase.rpc('trip_waiting', { p_trip_id: tripId });
      if (error) throw error;
      const w = (data ?? {}) as Record<string, unknown>;
      const num = (v: unknown) => (v == null ? null : Number(v));
      return {
        terms: (w.terms as TripWaiting['terms']) ?? null,
        stops: ((w.stops as Record<string, unknown>[] | undefined) ?? []).map((s) => ({
          stop: s.stop as WaitStop['stop'],
          arrived_at: (s.arrived_at as string | null) ?? null,
          ended_at: (s.ended_at as string | null) ?? null,
          running: s.running === true,
          minutes: Number(s.minutes ?? 0),
          free_minutes: Number(s.free_minutes ?? 0),
          per_15min_baisa: Number(s.per_15min_baisa ?? 0),
          cap_minutes: Number(s.cap_minutes ?? 0),
          capped: s.capped === true,
          waived: s.waived === true,
          held: s.held === true,
          charge_baisa: Number(s.charge_baisa ?? 0),
        })),
        waiting_baisa: Number(w.waiting_baisa ?? 0),
        price_baisa: num(w.price_baisa),
        total_baisa: num(w.total_baisa),
        payout_baisa: num(w.payout_baisa),
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
  /** Exact places (0041); null when the shipper chose a city only. */
  originPlace: PlacePayload | null;
  destPlace: PlacePayload | null;
  /**
   * One per booking attempt, the same on every retry of it (0047). A call that
   * timed out on the phone may have booked on the server; the retry then gets
   * that load back instead of posting a second one.
   */
  requestId: string;
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
    meta: { flow: 'book_load' },
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
        p_origin_place: input.originPlace,
        p_dest_place: input.destPlace,
        p_request_id: input.requestId,
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
    meta: { flow: 'quote_load' },
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
    meta: { flow: 'accept_quote' },
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

/* ─── bidding · the shipper (0045) ───────────────────────────────────────── */

/** Bids arrive while the shipper watches; poll as offers do, until push lands. */
const BID_POLL_MS = 15_000;

export type PostBidLoadInput = {
  originCity: number;
  destCity: number;
  collectionDate: string;
  goods: string;
  weightKg: number | null;
  /** NULL means "advise me". Never a guessed code. */
  truckTypeCode: string | null;
  originPlace: PlacePayload | null;
  destPlace: PlacePayload | null;
  /** The most the shipper will pay in total; null is "I will choose myself". */
  targetTotalBaisa: number | null;
  /** As on BookInput: one per attempt, so a retry cannot post twice (0047). */
  requestId: string;
};

/**
 * Post a load for drivers to bid on. No price goes up — there is none yet, and
 * the server never takes one from a client. The fee is the server's, snapshotted
 * at posting.
 */
export function usePostBidLoad() {
  const qc = useQueryClient();
  return useMutation({
    meta: { flow: 'post_bid_load' },
    mutationFn: async (input: PostBidLoadInput): Promise<{ loadId: string }> => {
      const { data, error } = await supabase.rpc('post_bid_load', {
        p_origin_city: input.originCity,
        p_dest_city: input.destCity,
        p_pickup_from: input.collectionDate,
        p_pickup_to: input.collectionDate,
        p_goods: input.goods,
        p_weight_kg: input.weightKg,
        p_truck_type_code: input.truckTypeCode,
        p_origin_place: input.originPlace,
        p_dest_place: input.destPlace,
        p_target_total_baisa: input.targetTotalBaisa,
        p_request_id: input.requestId,
      });
      if (error) throw error;
      if (!data) throw new Error('post_bid_load returned no load');
      return { loadId: String(data) };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loads', 'mine'] });
    },
  });
}

/**
 * One bid, as the shipper sees it: a total with the fee in it, never the
 * driver's payout (total minus payout is the fee — SENSITIVE_FIELDS.md).
 */
export type ShipperBid = {
  bid_id: string;
  driver_name: string;
  truck_type: string | null;
  total_baisa: number;
  submitted_at: string;
  selected: boolean;
  /** False once the driver went offline or took another job. */
  eligible: boolean;
};

export function useShipperLoadBids(loadId: string | undefined, { live = true } = {}) {
  return useQuery({
    queryKey: ['bids', 'shipper', loadId],
    enabled: !!loadId,
    refetchInterval: live ? BID_POLL_MS : false,
    queryFn: async (): Promise<ShipperBid[]> => {
      const { data, error } = await supabase.rpc('shipper_load_bids', { p_load_id: loadId });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        bid_id: String(r.bid_id),
        driver_name: String(r.driver_name ?? ''),
        truck_type: (r.truck_type as string | null) ?? null,
        total_baisa: Number(r.total_baisa),
        submitted_at: String(r.submitted_at),
        selected: r.selected === true,
        eligible: r.eligible === true,
      }));
    },
  });
}

export type ShipperBidStatus = {
  bid_deadline: string;
  target_total_baisa: number | null;
  selected_bid_id: string | null;
  /** The proposed bid's total. Not on `loads` until a bid is accepted. */
  selected_total_baisa: number | null;
  bid_count: number;
};

export function useShipperBidStatus(loadId: string | undefined, { live = true } = {}) {
  return useQuery({
    queryKey: ['bids', 'status', loadId],
    enabled: !!loadId,
    refetchInterval: live ? BID_POLL_MS : false,
    queryFn: async (): Promise<ShipperBidStatus | null> => {
      const { data, error } = await supabase.rpc('shipper_bid_status', { p_load_id: loadId });
      if (error) throw error;
      const r = ((data ?? []) as Record<string, unknown>[])[0];
      if (!r) return null;
      const num = (v: unknown) => (v == null ? null : Number(v));
      return {
        bid_deadline: String(r.bid_deadline),
        target_total_baisa: num(r.target_total_baisa),
        selected_bid_id: (r.selected_bid_id as string | null) ?? null,
        selected_total_baisa: num(r.selected_total_baisa),
        bid_count: Number(r.bid_count ?? 0),
      };
    },
  });
}

/** Everything a bid decision moves: the bids, the load, and the trip it makes. */
function invalidateBidding(qc: ReturnType<typeof useQueryClient>, loadId: string) {
  qc.invalidateQueries({ queryKey: ['bids', 'shipper', loadId] });
  qc.invalidateQueries({ queryKey: ['bids', 'status', loadId] });
  qc.invalidateQueries({ queryKey: ['loads', 'mine'] });
  qc.invalidateQueries({ queryKey: ['trips', 'mine'] });
}

/**
 * Take a bid. Returns the trip, or NULL when the bid went stale after bidding
 * closed and the server proposed the next one instead. While bidding is open a
 * stale bid is refused ("bid no longer available") and nothing changes.
 */
export function useAcceptDriverBid() {
  const qc = useQueryClient();
  return useMutation({
    meta: { flow: 'accept_driver_bid' },
    mutationFn: async ({ loadId, bidId }: { loadId: string; bidId: string }) => {
      const { data, error } = await supabase.rpc('accept_driver_bid', {
        p_load_id: loadId,
        p_bid_id: bidId,
      });
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    onSettled: (_d, _e, { loadId }) => invalidateBidding(qc, loadId),
  });
}

/** End bidding now: the lowest bid is proposed, or taken if it is within the target. */
export function useCloseBidding() {
  const qc = useQueryClient();
  return useMutation({
    meta: { flow: 'close_bidding' },
    mutationFn: async (loadId: string) => {
      const { error } = await supabase.rpc('close_bidding', { p_load_id: loadId });
      if (error) throw error;
    },
    onSettled: (_d, _e, loadId) => invalidateBidding(qc, loadId),
  });
}

/** Set, change or clear the most the shipper will pay, while bidding is open. */
export function useSetBidTarget() {
  const qc = useQueryClient();
  return useMutation({
    meta: { flow: 'set_bid_target' },
    mutationFn: async ({ loadId, targetBaisa }: { loadId: string; targetBaisa: number | null }) => {
      const { error } = await supabase.rpc('set_bid_target', {
        p_load_id: loadId,
        p_target_total_baisa: targetBaisa,
      });
      if (error) throw error;
    },
    onSettled: (_d, _e, { loadId }) => invalidateBidding(qc, loadId),
  });
}

/** Give invited drivers another 30 minutes, within the server's hard deadline. */
export function useExtendBidding() {
  const qc = useQueryClient();
  return useMutation({
    meta: { flow: 'extend_bidding' },
    mutationFn: async (loadId: string) => {
      const { error } = await supabase.rpc('extend_bidding', {
        p_load_id: loadId,
        p_minutes: 30,
      });
      if (error) throw error;
    },
    onSettled: (_d, _e, loadId) => invalidateBidding(qc, loadId),
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
  /** The exact places (0041). All null when the shipper chose cities only. */
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_name: string | null;
  pickup_note: string | null;
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  drop_name: string | null;
  drop_note: string | null;
  drop_contact_name: string | null;
  drop_contact_phone: string | null;
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

/* ─── bidding · the driver (0045) ────────────────────────────────────────── */

/**
 * A load this driver is invited to bid on. The pins and notes are here so the
 * trip can be priced; the contact's name and phone are NOT — far more drivers
 * are invited to bid than to a wave, and the winner gets them from
 * `driver_trip()`.
 */
export type BidInvite = {
  offer_id: string;
  load_id: string;
  bid_deadline: string;
  origin_city: number;
  dest_city: number;
  pickup_from: string;
  pickup_to: string;
  goods: string;
  weight_kg: number | null;
  truck_type_code: string | null;
  /** What this driver asked to keep; null until they bid. */
  own_bid_baisa: number | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_name: string | null;
  pickup_note: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  drop_name: string | null;
  drop_note: string | null;
};

export function useDriverBidInvites() {
  return useQuery({
    queryKey: ['driver', 'bids'],
    // Same reason as useDriverOffers: until push lands, an invitation has to
    // appear while the driver is looking.
    refetchInterval: BID_POLL_MS,
    queryFn: async (): Promise<BidInvite[]> => {
      const { data, error } = await supabase.rpc('driver_bid_invites');
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(toBidInvite);
    },
  });
}

function toBidInvite(r: Record<string, unknown>): BidInvite {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    offer_id: String(r.offer_id),
    load_id: String(r.load_id),
    bid_deadline: String(r.bid_deadline),
    origin_city: Number(r.origin_city),
    dest_city: Number(r.dest_city),
    pickup_from: String(r.pickup_from),
    pickup_to: String(r.pickup_to),
    goods: String(r.goods ?? ''),
    weight_kg: num(r.weight_kg),
    truck_type_code: (r.truck_type_code as string | null) ?? null,
    own_bid_baisa: num(r.own_bid_baisa),
    pickup_lat: num(r.pickup_lat),
    pickup_lng: num(r.pickup_lng),
    pickup_name: (r.pickup_name as string | null) ?? null,
    pickup_note: (r.pickup_note as string | null) ?? null,
    drop_lat: num(r.drop_lat),
    drop_lng: num(r.drop_lng),
    drop_name: (r.drop_name as string | null) ?? null,
    drop_note: (r.drop_note as string | null) ?? null,
  };
}

/**
 * One invitation, by OFFER id — never by load id, for the reason
 * useDriverOffer gives. Read from the same list the offers tab polls, so the
 * two cannot disagree about whether bidding is still open.
 */
export function useDriverBidInvite(offerId: string | undefined) {
  const invites = useDriverBidInvites();
  return {
    ...invites,
    data: invites.data ? (invites.data.find((i) => i.offer_id === offerId) ?? null) : undefined,
  };
}

/**
 * The competing bids, semi-anonymised: a bidder number, a truck type, and the
 * amount each driver keeps. Never a name, a phone or a shipper total.
 */
export type CompetingBid = {
  bidder_no: number;
  truck_type: string | null;
  payout_baisa: number;
  updated_at: string;
  is_you: boolean;
};

export function useDriverLoadBids(offerId: string | undefined, { live = true } = {}) {
  return useQuery({
    queryKey: ['driver', 'bids', offerId],
    enabled: !!offerId,
    refetchInterval: live ? BID_POLL_MS : false,
    queryFn: async (): Promise<CompetingBid[]> => {
      const { data, error } = await supabase.rpc('driver_load_bids', { p_offer_id: offerId });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        bidder_no: Number(r.bidder_no),
        truck_type: (r.truck_type as string | null) ?? null,
        payout_baisa: Number(r.payout_baisa),
        updated_at: String(r.updated_at),
        is_you: r.is_you === true,
      }));
    },
  });
}

/** Bid, or change a bid. The amount is what the driver keeps, in baisa. */
export function usePlaceDriverBid() {
  const qc = useQueryClient();
  return useMutation({
    meta: { flow: 'place_driver_bid' },
    mutationFn: async ({ offerId, payoutBaisa }: { offerId: string; payoutBaisa: number }) => {
      const { error } = await supabase.rpc('place_driver_bid', {
        p_offer_id: offerId,
        p_payout_baisa: payoutBaisa,
      });
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['driver', 'bids'] });
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
    meta: { flow: 'set_available' },
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
  /** The exact places (0041). All null when the shipper chose cities only. */
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_name: string | null;
  pickup_note: string | null;
  pickup_contact_name: string | null;
  pickup_contact_phone: string | null;
  drop_lat: number | null;
  drop_lng: number | null;
  drop_name: string | null;
  drop_note: string | null;
  drop_contact_name: string | null;
  drop_contact_phone: string | null;
};

/** One end of a load, as the driver or shipper reads it (0041). */
export type LoadPlace = {
  lat: number;
  lng: number;
  name: string | null;
  note: string | null;
  contactName: string | null;
  contactPhone: string | null;
};

const num = (v: unknown) => (v == null ? null : Number(v));
const str = (v: unknown) => (typeof v === 'string' && v.length ? v : null);

/** Reads `pickup_*` / `drop_*` off a driver row. No point means no place. */
export function placeOf(row: Record<string, unknown>, end: 'pickup' | 'drop'): LoadPlace | null {
  const lat = num(row[`${end}_lat`]);
  const lng = num(row[`${end}_lng`]);
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return {
    lat,
    lng,
    name: str(row[`${end}_name`]),
    note: str(row[`${end}_note`]),
    contactName: str(row[`${end}_contact_name`]),
    contactPhone: str(row[`${end}_contact_phone`]),
  };
}

/** The shipper's own places for one load. RLS scopes it; a miss is simply none. */
export function useLoadPlaces(loadId: string | undefined) {
  return useQuery({
    queryKey: ['load', 'places', loadId],
    enabled: !!loadId,
    queryFn: async (): Promise<{ pickup: LoadPlace | null; drop: LoadPlace | null }> => {
      const { data, error } = await supabase
        .from('load_places')
        .select('kind, lat, lng, place_name, note, contact_name, contact_phone')
        .eq('load_id', loadId);
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      const as = (kind: 'pickup' | 'drop') => {
        const r = rows.find((x) => x.kind === kind);
        if (!r) return null;
        return placeOf(
          {
            [`${kind}_lat`]: r.lat, [`${kind}_lng`]: r.lng, [`${kind}_name`]: r.place_name,
            [`${kind}_note`]: r.note, [`${kind}_contact_name`]: r.contact_name,
            [`${kind}_contact_phone`]: r.contact_phone,
          },
          kind,
        );
      };
      return { pickup: as('pickup'), drop: as('drop') };
    },
  });
}

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

export function useTripPosition(tripId: string | undefined, { live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: ['trip', 'position', tripId],
    enabled: !!tripId,
    // A position is the one thing on T4 that changes without the shipper doing
    // anything. The phone reports every 30 s on a trip (CADENCE.trip), so asking
    // every 20 s puts a new fix on screen within 20 s of it arriving. Only while
    // the load is moving: before pickup and after delivery nothing changes.
    refetchInterval: live ? 20_000 : false,
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
    meta: { flow: 'respond_to_offer' },
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
    meta: { flow: 'post_leg' },
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
    meta: { flow: 'advance_trip' },
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
    meta: { flow: 'rate_trip' },
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

/* ─── support (0063, 0065) ───────────────────────────────────────────────── */

/** A message from Truckkoo staff (0065). The push only says one exists. */
export type StaffMessage = { id: string; body: string; case_id: string | null; created_at: string; read_at: string | null };

/** The query key includes the account: the root QueryClient survives sign-out. */
export function useMyMessages() {
  const { profile } = useSession();
  return useQuery({
    queryKey: ['messages', profile?.id],
    enabled: !!profile?.id,
    queryFn: async (): Promise<StaffMessage[]> => {
      const { data, error } = await supabase.rpc('my_messages', { p_limit: 50 });
      if (error) throw error;
      return (data ?? []) as StaffMessage[];
    },
  });
}

/** One of the driver's own decided strikes (0063). Never the internal reason. */
export type MyStrike = {
  id: string;
  kind: string;
  weight: number;
  state: 'confirmed' | 'voided';
  trip_id: string | null;
  trip_route: string | null;
  created_at: string;
  decided_at: string | null;
  appeal_open: boolean;
};

export function useMyRecord() {
  const { profile } = useSession();
  return useQuery({
    queryKey: ['record', profile?.id],
    enabled: !!profile?.id,
    queryFn: async (): Promise<MyStrike[]> => {
      const { data, error } = await supabase.rpc('my_record');
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        kind: String(r.kind),
        weight: Number(r.weight),
        state: r.state === 'voided' ? 'voided' : 'confirmed',
        trip_id: (r.trip_id as string | null) ?? null,
        trip_route: (r.trip_route as string | null) ?? null,
        created_at: String(r.created_at),
        decided_at: (r.decided_at as string | null) ?? null,
        appeal_open: r.appeal_open === true,
      }));
    },
  });
}

/** What the person reported, and where it stands (0065). Never staff notes. */
export type MyReport = { id: string; kind: string; status: string; created_at: string; route: string | null };

export function useMyCases() {
  const { profile } = useSession();
  return useQuery({
    queryKey: ['reports', profile?.id],
    enabled: !!profile?.id,
    queryFn: async (): Promise<MyReport[]> => {
      const { data, error } = await supabase.rpc('my_cases');
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        kind: String(r.kind),
        status: String(r.status),
        created_at: String(r.created_at),
        route: (r.route as string | null) ?? null,
      }));
    },
  });
}
