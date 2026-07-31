/**
 * The driver's reads (0030), at the seam where SQL becomes TypeScript.
 *
 * Two things can only go wrong here and nowhere else:
 *
 * 1. **A bigint arrives as a string.** PostgREST serialises `bigint` as a JSON
 *    string, so `week_baisa` is `"78000"`, and `"78000" + 0` is `"780000"`.
 *    Money that silently becomes a string is money that silently becomes wrong,
 *    and `formatMoney` would render it without complaint.
 * 2. **`driver_offer` is called with the wrong argument.** It takes an OFFER id.
 *    A load id passed here would return nothing and read as "that offer has
 *    gone" — a bug that looks exactly like correct behaviour.
 */

import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useDriverEarnings, useDriverOffer, useDriverOffers } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** One row, shaped as PostgREST returns it: every bigint a string. */
const offerRow = {
  offer_id: 'off-1',
  expires_at: '2026-08-02T00:00:00Z',
  leg_id: 'leg-1',
  origin_city: 1,
  dest_city: 32,
  pickup_from: '2026-08-01',
  pickup_to: '2026-08-03',
  goods: 'Dates, palletised',
  weight_kg: 8000,
  truck_type_code: '10t',
  collect_baisa: 96000,
  payout_baisa: 78000,
  owed_baisa: 18000,
  currency: 'OMR',
  detour_km: 16,
  free_after_kg: 2000,
};

beforeEach(() => {
  (supabase.rpc as jest.Mock).mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => client.clear());

describe('useDriverOffers', () => {
  it('reads the composed view, never the loads table', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [offerRow], error: null });

    const { result } = await renderHook(() => useDriverOffers(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(supabase.rpc).toHaveBeenCalledWith('driver_offers');
    expect(result.current.data?.[0].payout_baisa).toBe(78000);
  });

  it('is an empty book, not an error, when nothing is offered', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: null });

    const { result } = await renderHook(() => useDriverOffers(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });
});

describe('useDriverOffer', () => {
  it('asks by offer id', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [offerRow], error: null });

    const { result } = await renderHook(() => useDriverOffer('off-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(supabase.rpc).toHaveBeenCalledWith('driver_offer', { p_offer_id: 'off-1' });
    expect(result.current.data?.offer_id).toBe('off-1');
  });

  it('reports an offer that has gone as null, not as an empty list', async () => {
    // D2 renders "That offer has gone" off this. An empty array is truthy and
    // would render a blank card instead.
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    const { result } = await renderHook(() => useDriverOffer('off-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  it('does not ask at all without an id', async () => {
    const { result } = await renderHook(() => useDriverOffer(undefined), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('useDriverEarnings', () => {
  it('turns the bigints into numbers, because money must never concatenate', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [{ week_baisa: '78000', week_trips: '1', all_time_trips: '4' }],
      error: null,
    });

    const { result } = await renderHook(() => useDriverEarnings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ week_baisa: 78000, week_trips: 1, all_time_trips: 4 });
    expect(typeof result.current.data?.week_baisa).toBe('number');
  });

  it('is null when there is no row to read', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    const { result } = await renderHook(() => useDriverEarnings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });
});
