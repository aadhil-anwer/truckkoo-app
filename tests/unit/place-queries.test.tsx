import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { placeOf, useBookLoad, useLoadPlaces } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => client.clear());

it('reads one end of a driver row as a place, or nothing', () => {
  const row = {
    pickup_lat: 23.6, pickup_lng: 58.4, pickup_name: 'Ruwi', pickup_note: 'Gate 3',
    pickup_contact_name: 'Rashid', pickup_contact_phone: '+968 9000 0000',
    drop_lat: null, drop_lng: null, drop_name: null, drop_note: null, drop_contact_name: null, drop_contact_phone: null,
  };
  expect(placeOf(row, 'pickup')).toEqual({
    lat: 23.6, lng: 58.4, name: 'Ruwi', note: 'Gate 3', contactName: 'Rashid', contactPhone: '+968 9000 0000',
  });
  expect(placeOf(row, 'drop')).toBeNull();
});

it('sends places to book_load by name', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: [{ load_id: 'L1', price_matched: true }], error: null });
  const { result } = await renderHook(() => useBookLoad(), { wrapper });
  const place = { lat: 23.6, lng: 58.4, place_name: 'Ruwi', note: null, contact_name: null, contact_phone: null };
  await result.current.mutateAsync({
    originCity: 1, destCity: 2, collectionDate: '2026-10-01', goods: 'x', weightKg: null,
    truckTypeCode: null, seenPriceBaisa: null, originPlace: place, destPlace: null,
  });
  expect(supabase.rpc).toHaveBeenCalledWith('book_load', expect.objectContaining({
    p_origin_place: place, p_dest_place: null,
  }));
});

it('reads the shipper\u2019s own places for a load', async () => {
  const eq = jest.fn().mockResolvedValue({
    data: [{ kind: 'drop', lat: 17.0, lng: 54.1, place_name: 'Port', note: null, contact_name: null, contact_phone: null }],
    error: null,
  });
  (supabase.from as jest.Mock).mockReturnValue({ select: jest.fn(() => ({ eq })) });
  const { result } = await renderHook(() => useLoadPlaces('L1'), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(supabase.from).toHaveBeenCalledWith('load_places');
  expect(eq).toHaveBeenCalledWith('load_id', 'L1');
  expect(result.current.data?.pickup).toBeNull();
  expect(result.current.data?.drop?.name).toBe('Port');
});
