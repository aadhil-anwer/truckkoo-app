import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { initLanguage } from '@/i18n';
import { cityNear, currentPlace, nameAt, newSessionToken, usePlaceSearch } from '@/lib/places';
import { supabase } from '@/lib/supabase';

const invoke = supabase.functions.invoke as jest.Mock;
const L = Location as jest.Mocked<typeof Location>;

beforeEach(() => {
  initLanguage('en');
  invoke.mockReset();
  (supabase.rpc as jest.Mock).mockReset();
});

describe('usePlaceSearch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for three characters and a pause before asking', async () => {
    invoke.mockResolvedValue({ data: { suggestions: [{ placeId: 'p1', main: 'Lulu Barka', secondary: 'Barka' }] }, error: null });
    const { result } = await renderHook(() => usePlaceSearch());
    await act(async () => result.current.setQuery('lu'));
    await act(async () => { jest.advanceTimersByTime(500); });
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => result.current.setQuery('lulu'));
    await act(async () => { jest.advanceTimersByTime(299); });
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1); });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.suggestions[0].main).toBe('Lulu Barka');
    expect(invoke).toHaveBeenCalledWith('places', {
      body: expect.objectContaining({ action: 'autocomplete', input: 'lulu', language: 'en' }),
    });
  });

  it('drops stale suggestions and says so when search fails', async () => {
    invoke
      .mockResolvedValueOnce({ data: { suggestions: [{ placeId: 'p1', main: 'Sohar Port', secondary: '' }] }, error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('503') });
    const { result } = await renderHook(() => usePlaceSearch());
    await act(async () => result.current.setQuery('soha'));
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    await act(async () => result.current.setQuery('sohar p'));
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(result.current.status).toBe('failed'));
    expect(result.current.suggestions).toEqual([]);
  });

  it('ends the session with one details call, then starts a new one', async () => {
    invoke
      .mockResolvedValueOnce({ data: { suggestions: [{ placeId: 'p1', main: 'Lulu Barka', secondary: '' }] }, error: null })
      .mockResolvedValueOnce({ data: { place: { lat: 23.69, lng: 57.88, address: 'Barka' } }, error: null })
      .mockResolvedValueOnce({ data: { suggestions: [] }, error: null });
    const { result } = await renderHook(() => usePlaceSearch());
    await act(async () => result.current.setQuery('lulu'));
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let picked: Awaited<ReturnType<typeof result.current.pick>> = null;
    await act(async () => { picked = await result.current.pick(result.current.suggestions[0]); });
    expect(picked).toEqual({ lat: 23.69, lng: 57.88, placeName: 'Lulu Barka' });

    const first = invoke.mock.calls[0][1].body.sessionToken;
    expect(invoke.mock.calls[1][1].body).toEqual(expect.objectContaining({ action: 'details', placeId: 'p1', sessionToken: first }));

    await act(async () => result.current.setQuery('sohar'));
    await act(async () => { jest.advanceTimersByTime(300); });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3));
    expect(invoke.mock.calls[2][1].body.sessionToken).not.toBe(first);
  });
});

it('makes a v4-shaped session token', () => {
  expect(newSessionToken()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

it('asks the server which city a point is near', async () => {
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: 7, error: null });
  await expect(cityNear(23.69, 57.88)).resolves.toBe(7);
  expect(supabase.rpc).toHaveBeenCalledWith('city_near', { p_lat: 23.69, p_lng: 57.88 });
});

it('names a point from the phone geocoder, or says nothing', async () => {
  L.reverseGeocodeAsync.mockResolvedValueOnce([{ name: 'Lulu Hypermarket', district: 'Barka' } as never]);
  await expect(nameAt(23.69, 57.88)).resolves.toBe('Lulu Hypermarket, Barka');
  L.reverseGeocodeAsync.mockRejectedValueOnce(new Error('no geocoder'));
  await expect(nameAt(23.69, 57.88)).resolves.toBeNull();
});

it('gives no current place when permission is refused', async () => {
  L.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false } as never);
  await expect(currentPlace()).resolves.toBeNull();
  expect(L.getCurrentPositionAsync).not.toHaveBeenCalled();
});

it('gives the phone position, named, when permitted', async () => {
  L.requestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: true } as never);
  L.getCurrentPositionAsync.mockResolvedValueOnce({ coords: { latitude: 23.6, longitude: 58.4 } } as never);
  L.reverseGeocodeAsync.mockResolvedValueOnce([{ name: 'Ruwi' } as never]);
  await expect(currentPlace()).resolves.toEqual({ lat: 23.6, lng: 58.4, placeName: 'Ruwi' });
});
