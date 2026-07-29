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

export type City = { id: number; name_en: string; name_ar: string; country: string; corridor: string | null };
export type TruckType = {
  code: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  capacity_kg: number;
};

export type LoadStatus =
  | 'posted' | 'finding_truck' | 'matched' | 'assigned'
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
    queryFn: async (): Promise<City[]> => {
      const { data, error } = await supabase
        .from('cities')
        .select('id, name_en, name_ar, country, corridor')
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
  /** "Not sure — advise me": no truck type, so nothing to price against. */
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

/* ─── driver ─────────────────────────────────────────────────────────────── */

export function useMyLegs() {
  return useQuery({
    queryKey: ['legs', 'mine'],
    queryFn: async (): Promise<Leg[]> => {
      const { data, error } = await supabase
        .from('legs')
        .select('id, origin_city, dest_city, depart_from, depart_to, is_empty, status')
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
 * Loads the driver may read. RLS restricts this to loads they hold an offer on
 * or are driving, so no filter is needed here — and adding one would be a
 * client-side control, which is not a control.
 */
export function useVisibleLoads() {
  return useQuery({
    queryKey: ['loads', 'visible'],
    queryFn: async (): Promise<Load[]> => {
      const { data, error } = await supabase
        .from('loads')
        .select(LOAD_COLUMNS);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMyTrips() {
  return useQuery({
    queryKey: ['trips', 'mine'],
    queryFn: async (): Promise<Trip[]> => {
      const { data, error } = await supabase
        .from('trips')
        .select('id, load_id, truck_id, status, created_at')
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
      qc.invalidateQueries({ queryKey: ['loads', 'visible'] });
      qc.invalidateQueries({ queryKey: ['legs', 'mine'] });
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
      qc.invalidateQueries({ queryKey: ['loads', 'visible'] });
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
