/**
 * Shipper places in the booking flow (0041): search, current location, the pin,
 * the details — and every way back to a plain city still working.
 *
 * `./harness` first: its jest.mock calls must run before anything imports.
 */
import { MUSCAT, SALALAH, mockParams, mockPush, mockReplace, resetQueries } from './harness';

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

// The first render here pulls in the whole booking tree cold: ~2 s on a laptop
// with an empty cache, past the 5 s default on a CI runner (PR #10). A test
// that genuinely hangs still fails, just at 20 s.
jest.setTimeout(20_000);

function searchState(over: Partial<ReturnType<typeof places.usePlaceSearch>> = {}) {
  return { query: '', setQuery: jest.fn(), suggestions: [], status: 'idle', pick: jest.fn(), ...over };
}

async function seed(patch: Partial<typeof EMPTY_DRAFT>) {
  await AsyncStorage.setItem('truckkoo.booking.draft.v2.u1', JSON.stringify({ ...EMPTY_DRAFT, ...patch }));
}

beforeEach(async () => {
  resetQueries(queries as unknown as Record<string, unknown>);
  mockPush.mockReset();
  mockReplace.mockReset();
  await AsyncStorage.clear();
  search.mockReturnValue(searchState());
  (places.nameAt as jest.Mock).mockResolvedValue('Lulu Barka');
});

it('takes a searched place to the pin screen', async () => {
  const pick = jest.fn(async () => ({ lat: 23.69, lng: 57.88, placeName: 'Lulu Barka' }));
  search.mockReturnValue(searchState({
    status: 'ready', suggestions: [{ placeId: 'p1', main: 'Lulu Barka', secondary: 'Barka, Oman' }], pick,
  }));
  await render(<Origin />);
  await fireEvent.press(await screen.findByText('Lulu Barka'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: '/book/pin', params: { end: 'pickup' } }));
  expect((await loadDraft('u1')).originPlace).toEqual(expect.objectContaining({ lat: 23.69, placeName: 'Lulu Barka' }));
});

it('keeps a way home when draft storage has not answered', async () => {
  const read = AsyncStorage.getItem as jest.Mock;
  const original = read.getMockImplementation()!;
  read.mockImplementation(() => new Promise(() => {}));
  try {
    await render(<Origin />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Back to home'));
    expect(mockReplace).toHaveBeenCalledWith('/customer');
  } finally {
    read.mockImplementation(original);
  }
});

it('shows a way out when a pin deep link has no place to pin', async () => {
  mockParams.current = { end: 'pickup' };
  await render(<Pin />);
  expect(await screen.findByLabelText('Back to home')).toBeTruthy();
  expect(mockReplace).toHaveBeenCalledWith('/book/origin');
});

it('keeps the city list usable when search is down', async () => {
  search.mockReturnValue(searchState({ status: 'failed' }));
  await render(<Origin />);
  expect(await screen.findByText("Search isn't working right now. Choose a city instead.")).toBeTruthy();
  await fireEvent.press(screen.getByText('Muscat'));
  expect((await loadDraft('u1')).originCityId).toBe(MUSCAT.id);
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
  const d = await loadDraft('u1');
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
  const d = await loadDraft('u1');
  expect(d.originCityId).toBe(MUSCAT.id);
  expect(d.originPlace).toEqual(expect.objectContaining({ lat: 23.61, lng: 58.41 }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/book/place-details', params: { end: 'pickup' } });
});

// 0069: a job inside one town is a pickup's everyday job — allowed with both
// pins, far enough apart. Without a pickup pin it would be a 0 km job.
it('a drop-off in the pickup\u2019s town needs the pickup on the map too, and says so', async () => {
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
  expect(await screen.findByText('For a job inside Muscat, put the pickup on the map too.')).toBeTruthy();
  expect(screen.getByLabelText('Confirm drop-off').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByText('Put the pickup on the map'));
  expect(mockPush).toHaveBeenCalledWith('/book/origin');
});

it('confirms a drop-off in the pickup\u2019s town when both are pinned apart', async () => {
  mockParams.current = { end: 'drop' };
  (places.cityNear as jest.Mock).mockResolvedValue(MUSCAT.id);
  await seed({
    originCityId: MUSCAT.id,
    originPlace: { lat: 23.588, lng: 58.40, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' },
    destinationPlace: { lat: 23.6, lng: 58.5, placeName: 'Qurum', note: '', contactName: '', contactPhone: '' },
  });
  await render(<Pin />);
  await fireEvent(await screen.findByTestId('pin-map'), 'regionChangeComplete', {
    latitude: 23.6, longitude: 58.5, latitudeDelta: 0.004, longitudeDelta: 0.004,
  });
  await screen.findByText(/Muscat/);
  expect(screen.queryByText(/put the pickup on the map/)).toBeNull();
  expect(screen.getByLabelText('Confirm drop-off').props.accessibilityState.disabled).toBe(false);
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
  expect((await loadDraft('u1')).originPlace?.contactPhone).toBe('+968 9000 0000');
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
  const d = await loadDraft('u1');
  expect(d.destinationPlace).toEqual(expect.objectContaining({ note: '', contactName: '', contactPhone: '' }));
  expect(mockPush).toHaveBeenCalledWith('/book/date');
});

it('swaps the places with the cities', async () => {
  const a = { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' };
  const b = { lat: 17, lng: 54, placeName: 'Port', note: '', contactName: '', contactPhone: '' };
  await seed({ originCityId: MUSCAT.id, destinationCityId: SALALAH.id, originPlace: a, destinationPlace: b });
  await render(<Destination />);
  await fireEvent.press(await screen.findByLabelText('Swap pickup and destination'));
  const d = await loadDraft('u1');
  expect(d.originPlace).toEqual(b);
  expect(d.destinationPlace).toEqual(a);
});

// ─── final review fixes ─────────────────────────────────────────────────────

const RUWI = { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: '', contactPhone: '' };

it('does not leave a picked place beside a city it was never checked against', async () => {
  // Muscat by hand, then a search for somewhere else, then Back out of the pin:
  // "Continue from Muscat" with a Sohar place would fail on review, every time.
  await seed({ originCityId: MUSCAT.id });
  const pick = jest.fn(async () => ({ lat: 24.35, lng: 56.7, placeName: 'Sohar port' }));
  search.mockReturnValue(searchState({
    status: 'ready', suggestions: [{ placeId: 'p2', main: 'Sohar port', secondary: 'Sohar, Oman' }], pick,
  }));
  await render(<Origin />);
  await fireEvent.press(await screen.findByText('Sohar port'));
  await waitFor(() => expect(mockPush).toHaveBeenCalled());
  const d = await loadDraft('u1');
  expect(d.originPlace).toEqual(expect.objectContaining({ placeName: 'Sohar port' }));
  expect(d.originCityId).toBeNull();
});

it('keeps the note when the shipper goes back to the pin and confirms again', async () => {
  // The pin screen stays mounted under the details screen. It must not write
  // back the draft it loaded before the note existed.
  mockParams.current = { end: 'pickup' };
  (places.cityNear as jest.Mock).mockResolvedValue(MUSCAT.id);
  await seed({ originPlace: RUWI });
  await render(
    <>
      <Pin />
      <PlaceDetails />
    </>,
  );
  await fireEvent.changeText(await screen.findByLabelText('e.g. Gate 3, behind the Shell station'), 'Gate 3');
  expect(await screen.findByText('Near Muscat')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Confirm pickup'));
  expect((await loadDraft('u1')).originPlace?.note).toBe('Gate 3');
});

it('keeps the searched name while the pin has not moved', async () => {
  mockParams.current = { end: 'pickup' };
  (places.cityNear as jest.Mock).mockResolvedValue(MUSCAT.id);
  await seed({ originPlace: RUWI });
  await render(<Pin />);
  expect(await screen.findByText('Near Muscat')).toBeTruthy();
  expect(screen.getByText('Ruwi')).toBeTruthy();
  expect(screen.queryByText('Lulu Barka')).toBeNull();
});

it('never gives a moved pin an old name', async () => {
  // No signal for the phone geocoder at the new spot: "This spot", not "Ruwi"
  // several kilometres away — the driver would be sent looking for Ruwi.
  mockParams.current = { end: 'pickup' };
  (places.cityNear as jest.Mock).mockResolvedValue(MUSCAT.id);
  (places.nameAt as jest.Mock).mockResolvedValue(null);
  await seed({ originPlace: RUWI });
  await render(<Pin />);
  await fireEvent(await screen.findByTestId('pin-map'), 'regionChangeComplete', {
    latitude: 23.65, longitude: 58.45, latitudeDelta: 0.004, longitudeDelta: 0.004,
  });
  expect(await screen.findByText('Near Muscat')).toBeTruthy();
  expect(screen.getByText('This spot')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Confirm pickup'));
  expect((await loadDraft('u1')).originPlace).toEqual(expect.objectContaining({ lat: 23.65, placeName: null }));
});

it('can still confirm when the map re-reports the spot it already checked', async () => {
  mockParams.current = { end: 'pickup' };
  (places.cityNear as jest.Mock).mockResolvedValue(MUSCAT.id);
  await seed({ originPlace: RUWI });
  await render(<Pin />);
  expect(await screen.findByText('Near Muscat')).toBeTruthy();
  await fireEvent(screen.getByTestId('pin-map'), 'regionChangeComplete', {
    latitude: RUWI.lat, longitude: RUWI.lng, latitudeDelta: 0.004, longitudeDelta: 0.004,
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Confirm pickup').props.accessibilityState.disabled).toBe(false),
  );
});

it('opens one pin screen for a double tap on a slow connection', async () => {
  // Two taps, two paid Details calls, two pin screens stacked — unless the
  // second tap waits for the first.
  let resolve: (p: places.PickedPlace) => void = () => {};
  const pick = jest.fn(() => new Promise<places.PickedPlace>((r) => { resolve = r; }));
  search.mockReturnValue(searchState({
    status: 'ready', suggestions: [{ placeId: 'p1', main: 'Lulu Barka', secondary: 'Barka, Oman' }], pick,
  }));
  await render(<Origin />);
  const row = await screen.findByText('Lulu Barka');
  await fireEvent.press(row);
  await fireEvent.press(row);
  resolve({ lat: 23.69, lng: 57.88, placeName: 'Lulu Barka' });
  await waitFor(() => expect(mockPush).toHaveBeenCalled());
  expect(pick).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledTimes(1);
});

it('shows no city for a moved pin until the new spot is checked', async () => {
  mockParams.current = { end: 'pickup' };
  (places.cityNear as jest.Mock).mockResolvedValueOnce(MUSCAT.id).mockResolvedValueOnce(SALALAH.id);
  await seed({ originPlace: RUWI });
  await render(<Pin />);
  expect(await screen.findByText('Near Muscat')).toBeTruthy();
  await fireEvent(screen.getByTestId('pin-map'), 'regionChangeComplete', {
    latitude: 17.02, longitude: 54.09, latitudeDelta: 0.004, longitudeDelta: 0.004,
  });
  expect(screen.queryByText('Near Muscat')).toBeNull();
  expect(await screen.findByText('Near Salalah')).toBeTruthy();
});

it('sends a pin screen with no place back to choosing one, not to a blank page', async () => {
  mockParams.current = { end: 'drop' };
  await render(<Pin />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/book/destination'));
});

it('sends a details screen with no place back to choosing one', async () => {
  mockParams.current = { end: 'pickup' };
  await render(<PlaceDetails />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/book/origin'));
});
