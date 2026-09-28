/**
 * Shipper places in the booking flow (0041): search, current location, the pin,
 * the details — and every way back to a plain city still working.
 *
 * `./harness` first: its jest.mock calls must run before anything imports.
 */
import { MUSCAT, SALALAH, mockParams, mockPush, resetQueries } from './harness';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Origin from '@/app/(app)/book/origin';
import Pin from '@/app/(app)/book/pin';
import PlaceDetails from '@/app/(app)/book/place-details';
import Destination from '@/app/(app)/book/destination';
import * as places from '@/lib/places';
import { EMPTY_DRAFT, loadDraft } from '@/lib/booking';
import * as queries from '@/lib/queries';

jest.mock('@/lib/places', () => ({
  usePlaceSearch: jest.fn(),
  currentPlace: jest.fn(),
  cityNear: jest.fn(),
  nameAt: jest.fn(async () => 'Lulu Barka'),
}));
const search = places.usePlaceSearch as jest.Mock;

function searchState(over: Partial<ReturnType<typeof places.usePlaceSearch>> = {}) {
  return { query: '', setQuery: jest.fn(), suggestions: [], status: 'idle', pick: jest.fn(), ...over };
}

async function seed(patch: Partial<typeof EMPTY_DRAFT>) {
  await AsyncStorage.setItem('truckkoo.booking.draft.v1', JSON.stringify({ ...EMPTY_DRAFT, ...patch }));
}

beforeEach(async () => {
  resetQueries(queries as unknown as Record<string, unknown>);
  mockPush.mockReset();
  await AsyncStorage.clear();
  search.mockReturnValue(searchState());
});

it('takes a searched place to the pin screen', async () => {
  const pick = jest.fn(async () => ({ lat: 23.69, lng: 57.88, placeName: 'Lulu Barka' }));
  search.mockReturnValue(searchState({
    status: 'ready', suggestions: [{ placeId: 'p1', main: 'Lulu Barka', secondary: 'Barka, Oman' }], pick,
  }));
  await render(<Origin />);
  await fireEvent.press(await screen.findByText('Lulu Barka'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: '/book/pin', params: { end: 'pickup' } }));
  expect((await loadDraft()).originPlace).toEqual(expect.objectContaining({ lat: 23.69, placeName: 'Lulu Barka' }));
});

it('keeps the city list usable when search is down', async () => {
  search.mockReturnValue(searchState({ status: 'failed' }));
  await render(<Origin />);
  expect(await screen.findByText("Search isn't working right now. Choose a city instead.")).toBeTruthy();
  await fireEvent.press(screen.getByText('Muscat'));
  expect((await loadDraft()).originCityId).toBe(MUSCAT.id);
});

it('hides "Use my current location" once the shipper refuses it', async () => {
  (places.currentPlace as jest.Mock).mockResolvedValue(null);
  await render(<Origin />);
  await fireEvent.press(screen.getByLabelText('Use my current location'));
  await waitFor(() => expect(screen.queryByLabelText('Use my current location')).toBeNull());
  expect(mockPush).not.toHaveBeenCalled();
});

it('clears the place when the shipper picks a city instead', async () => {
  await seed({ originPlace: { lat: 23.69, lng: 57.88, placeName: 'Lulu', note: '', contactName: '', contactPhone: '' } });
  await render(<Origin />);
  await fireEvent.press(await screen.findByText('Muscat'));
  const d = await loadDraft();
  expect(d.originPlace).toBeNull();
  expect(d.originCityId).toBe(MUSCAT.id);
});

it('confirms the pin with the server\u2019s city', async () => {
  mockParams.current = { end: 'pickup' };
  (places.cityNear as jest.Mock).mockResolvedValue(MUSCAT.id);
  await seed({ originPlace: { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' } });
  await render(<Pin />);
  await fireEvent(await screen.findByTestId('pin-map'), 'regionChangeComplete', {
    latitude: 23.61, longitude: 58.41, latitudeDelta: 0.004, longitudeDelta: 0.004,
  });
  expect(await screen.findByText('Near Muscat')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Confirm pickup'));
  const d = await loadDraft();
  expect(d.originCityId).toBe(MUSCAT.id);
  expect(d.originPlace).toEqual(expect.objectContaining({ lat: 23.61, lng: 58.41 }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/book/place-details', params: { end: 'pickup' } });
});

it('will not confirm a drop-off in the pickup\u2019s city, and says why', async () => {
  mockParams.current = { end: 'drop' };
  (places.cityNear as jest.Mock).mockResolvedValue(MUSCAT.id);
  await seed({
    originCityId: MUSCAT.id,
    destinationPlace: { lat: 23.6, lng: 58.5, placeName: 'Qurum', note: '', contactName: '', contactPhone: '' },
  });
  await render(<Pin />);
  await fireEvent(await screen.findByTestId('pin-map'), 'regionChangeComplete', {
    latitude: 23.6, longitude: 58.5, latitudeDelta: 0.004, longitudeDelta: 0.004,
  });
  expect(await screen.findByText(/both in Muscat/)).toBeTruthy();
  expect(screen.getByLabelText('Confirm drop-off').props.accessibilityState.disabled).toBe(true);
});

it('offers the city list when the spot cannot be checked', async () => {
  mockParams.current = { end: 'pickup' };
  (places.cityNear as jest.Mock).mockResolvedValue(null);
  await seed({ originPlace: { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' } });
  await render(<Pin />);
  expect(await screen.findByText("We couldn't check this spot. Choose a city instead.")).toBeTruthy();
  expect(screen.getByLabelText('Confirm pickup').props.accessibilityState.disabled).toBe(true);
});

it('saves an Arabic-keyboard phone in digits the database accepts', async () => {
  mockParams.current = { end: 'pickup' };
  await seed({ originPlace: { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' } });
  await render(<PlaceDetails />);
  await fireEvent.changeText(await screen.findByLabelText('Phone number'), '+٩٦٨ ٩٠٠٠ ٠٠٠٠');
  await fireEvent.press(screen.getByLabelText('Continue'));
  expect((await loadDraft()).originPlace?.contactPhone).toBe('+968 9000 0000');
  expect(mockPush).toHaveBeenCalledWith('/book/destination');
});

it('refuses a phone that is not a phone, and says what to fix', async () => {
  mockParams.current = { end: 'pickup' };
  await seed({ originPlace: { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' } });
  await render(<PlaceDetails />);
  await fireEvent.changeText(await screen.findByLabelText('Phone number'), 'call me');
  expect(screen.getByText('Check the number: digits only, with + for the country code.')).toBeTruthy();
  expect(screen.getByLabelText('Continue').props.accessibilityState.disabled).toBe(true);
});

it('lets the shipper skip the details, and clears what they typed', async () => {
  mockParams.current = { end: 'drop' };
  await seed({ destinationPlace: { lat: 17, lng: 54, placeName: 'Port', note: 'x', contactName: 'y', contactPhone: '9' } });
  await render(<PlaceDetails />);
  await fireEvent.press(await screen.findByLabelText('Skip'));
  const d = await loadDraft();
  expect(d.destinationPlace).toEqual(expect.objectContaining({ note: '', contactName: '', contactPhone: '' }));
  expect(mockPush).toHaveBeenCalledWith('/book/date');
});

it('swaps the places with the cities', async () => {
  const a = { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' };
  const b = { lat: 17, lng: 54, placeName: 'Port', note: '', contactName: '', contactPhone: '' };
  await seed({ originCityId: MUSCAT.id, destinationCityId: SALALAH.id, originPlace: a, destinationPlace: b });
  await render(<Destination />);
  await fireEvent.press(await screen.findByLabelText('Swap pickup and destination'));
  const d = await loadDraft();
  expect(d.originPlace).toEqual(b);
  expect(d.destinationPlace).toEqual(a);
});
