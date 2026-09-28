/**
 * The position seam, where SQL becomes TypeScript.
 *
 * Two things can only go wrong here: a numeric arriving as a string (PostgREST
 * serialises `numeric` as a JSON string, so `lat` is `"23.588000"` and
 * `project()` given a string puts the truck in the corner of the map), and the
 * no-fix row being mistaken for no row at all — `trip_position` always returns
 * one, and a screen that treats "no fix" as "no answer" loses the corridor ETA.
 */

import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useTripPosition } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  (supabase.rpc as jest.Mock).mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => client.clear());

describe('useTripPosition', () => {
  it('turns the numerics into numbers, so the projection gets a coordinate', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [
        {
          lat: '23.588000',
          lng: '58.408000',
          seen_at: '2026-07-31T09:00:00Z',
          accuracy_m: '12',
          remaining_km: '1030.4',
          eta_at: '2026-07-31T20:00:00Z',
          eta_source: 'fix',
        },
      ],
      error: null,
    });

    const { result } = await renderHook(() => useTripPosition('trip-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(supabase.rpc).toHaveBeenCalledWith('trip_position', { p_trip_id: 'trip-1' });
    expect(result.current.data?.lat).toBe(23.588);
    expect(typeof result.current.data?.remaining_km).toBe('number');
  });

  it('keeps the corridor row, which is an answer and not an absence', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: [
        {
          lat: null,
          lng: null,
          seen_at: null,
          accuracy_m: null,
          remaining_km: '1030.4',
          eta_at: '2026-07-31T20:00:00Z',
          eta_source: 'corridor',
        },
      ],
      error: null,
    });

    const { result } = await renderHook(() => useTripPosition('trip-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.eta_source).toBe('corridor');
    expect(result.current.data?.lat).toBeNull();
  });

  it('is null when the trip is not the caller s to see', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

    const { result } = await renderHook(() => useTripPosition('trip-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  it('does not ask without a trip id', async () => {
    const { result } = await renderHook(() => useTripPosition(undefined), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  describe('polling', () => {
    const row = {
      lat: '23.588000', lng: '58.408000', seen_at: '2026-07-31T09:00:00Z', accuracy_m: '12',
      remaining_km: '1030.4', eta_at: '2026-07-31T20:00:00Z', eta_source: 'fix',
    };

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    // The phone reports every 30 s on a trip (CADENCE.trip); asking every 20 s
    // means a new fix is on screen within 20 s of arriving.
    it('asks again every 20 s while the load is moving', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: [row], error: null });
      const { result } = await renderHook(() => useTripPosition('trip-1', { live: true }), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(supabase.rpc).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(20_000);
      });
      await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(2));
    });

    it('does not keep asking when nothing is moving', async () => {
      (supabase.rpc as jest.Mock).mockResolvedValue({ data: [row], error: null });
      const { result } = await renderHook(() => useTripPosition('trip-1'), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      await act(async () => {
        jest.advanceTimersByTime(120_000);
      });
      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });
  });
});
