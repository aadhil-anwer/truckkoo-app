/**
 * Reference data must not be fetched before there is a session.
 *
 * REGRESSION. `cities` and `truck_types` are granted to `authenticated` only —
 * `anon` gets `permission denied for table truck_types`, which is deliberate
 * (0001: reference data is read-only *to signed-in users*). Both hooks also set
 * `staleTime: Infinity`.
 *
 * Together those two facts are a trap. `sign-up.tsx` mounts at step 1, before any
 * session exists, and its `useTruckTypes()` observer lives as long as the screen
 * does. Firing there failed, cached the failure, and never refetched once the
 * session arrived at step 3 — so the truck picker rendered zero options while
 * validation still demanded a truck size.
 *
 * A driver could not create an account. These tests pin the fix: the query does
 * not run without a session, and does run once there is one.
 */

import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useCities, useTruckTypes } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

let mockSession: { user: { id: string } } | null = null;

jest.mock('@/lib/session', () => ({
  useSession: () => ({
    session: mockSession,
    profile: null,
    loading: false,
    refreshProfile: jest.fn(),
  }),
}));

/** A `from()` chain shaped like the one the hooks actually call. */
function mockTable(rows: unknown[]) {
  const order = jest.fn(async () => ({ data: rows, error: null }));
  const select = jest.fn(() => ({ order }));
  (supabase.from as jest.Mock).mockReturnValue({ select });
  return { select, order };
}

/**
 * The client is built per test and captured, NOT constructed inside the wrapper
 * component. A `new QueryClient()` in the component body produces a new context
 * value on every render, which re-renders every consumer, which renders again —
 * the suite hangs rather than fails, which is the worse outcome of the two.
 */
let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockSession = null;
  (supabase.from as jest.Mock).mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
});

describe.each([
  ['useTruckTypes', useTruckTypes],
  ['useCities', useCities],
] as const)('%s', (name, hook) => {
  it('does not touch the database while signed out', async () => {
    mockTable([]);
    const { result } = await renderHook(() => hook(), { wrapper });

    // Give the query every chance to fire before asserting it did not.
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('fetches once a session exists', async () => {
    mockSession = { user: { id: 'u1' } };
    mockTable([{ code: '10t' }]);

    const { result } = await renderHook(() => hook(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(supabase.from).toHaveBeenCalled();
    expect(result.current.data).toHaveLength(1);
  });

  it('reports pending rather than empty while signed out', async () => {
    /**
     * The distinction the signup screen depends on. A screen that cannot tell
     * "no data yet" from "no data exists" renders an empty list and an empty list
     * is what stranded the driver — so `data` must stay undefined here, never an
     * empty array standing in for an answer.
     */
    mockTable([]);
    const { result } = await renderHook(() => hook(), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(result.current.data).toBeUndefined();
  });

  it('tries again by itself after a failed fetch, with no tap or refocus', async () => {
    // A dead zone on first launch. Before this, "—" stayed on every city until
    // the user pulled to refresh, backgrounded the app, or killed it.
    jest.useFakeTimers();
    try {
      mockSession = { user: { id: 'u1' } };
      const order = jest
        .fn()
        .mockResolvedValueOnce({ data: null, error: new Error('network') })
        .mockResolvedValue({ data: [{ code: '10t' }], error: null });
      (supabase.from as jest.Mock).mockReturnValue({ select: () => ({ order }) });

      const { result } = await renderHook(() => hook(), { wrapper });
      await waitFor(() => expect(result.current.isError).toBe(true));

      await jest.advanceTimersByTimeAsync(30_000);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toHaveLength(1);
      expect(order).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
