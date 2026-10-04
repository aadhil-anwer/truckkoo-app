/**
 * The screens 0036 changed: booking at an upfront price, and a driver's switch.
 *
 * What is guarded:
 * - the review screen shows the exact price and books AT it — the number sent
 *   back is the number shown, so the server can refuse anything else;
 * - "let us choose" names the truck the price is for, never a database code;
 * - no price is the human path, not an error, and books with no seen price;
 * - the button never books while the price is still arriving;
 * - going available reads the position once and sends it; no permission still
 *   goes available (the server falls back to the last delivery's town);
 * - a driver who loses the race is told someone else took it.
 *
 * IMPORT ORDER MATTERS: `./harness` first (see driver-screens.test.tsx).
 */
import {
  MUSCAT,
  SALALAH,
  TRUCK,
  mockBookMutate,
  mockPostBidMutate,
  mockBack,
  mockLocation,
  mockLocationAccess,
  mockPush,
  mockReplace,
  mockSetAvailableMutate,
  ok,
  PENDING,
  resetQueries,
} from './harness';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import Review from '@/app/(app)/book/review';
import DriverHome from '@/app/(app)/(tabs)/driver';
import LocationPermission from '@/app/(app)/location-permission';
import { __resetLocationPrompt } from '@/lib/location-prompt';
import { expiryLabel } from '@/components/driver/OfferCard';
import { initLanguage } from '@/i18n';
import * as features from '@/lib/features';
import * as queries from '@/lib/queries';
import { offerErrorMessage } from '@/lib/offer-errors';

const baseDraft = {
  originCityId: MUSCAT.id,
  destinationCityId: SALALAH.id,
  destinationCountry: 'OM',
  collectionDate: '2026-09-28',
  cargoDescription: 'Building materials',
  truckPreference: 'auto',
  weightKg: 8000,
};
const mockDraft = { current: { ...baseDraft } as Record<string, unknown> };
let mockDraftReady = true;

jest.mock('@/lib/booking', () => {
  const actual = jest.requireActual('@/lib/booking');
  return {
    ...actual,
    useBookingDraft: () => ({ draft: mockDraft.current, update: jest.fn(), ready: mockDraftReady }),
    clearDraft: jest.fn(async () => {}),
  };
});

const m = (name: string) => (queries as unknown as Record<string, jest.Mock>)[name];

beforeEach(() => {
  initLanguage('en');
  resetQueries(queries as unknown as Record<string, unknown>);
  m('useTruckTypes').mockReturnValue(ok([TRUCK]));
  mockDraft.current = { ...baseDraft };
  mockDraftReady = true;
});

describe('Review recovery', () => {
  it('shows a visible loading shell while draft storage is pending', async () => {
    mockDraftReady = false;
    await render(<Review />);
    expect(screen.getByText('Check this before we start')).toBeTruthy();
  });

  it('lets the shipper repair a missing route instead of settling on a blank screen', async () => {
    mockDraft.current = { ...mockDraft.current, originCityId: null };
    await render(<Review />);
    await fireEvent.press(screen.getByLabelText('Continue booking'));
    expect(mockReplace).toHaveBeenCalledWith('/book/origin');
  });

  it('offers a retry when the city list fails to load', async () => {
    const refetch = jest.fn();
    m('useCities').mockReturnValue({ data: undefined, isPending: false, isError: true, refetch });
    await render(<Review />);
    await fireEvent.press(screen.getByLabelText('Try again'));
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps a usable review visible when a background city refresh fails', async () => {
    m('useCities').mockReturnValue({ ...ok([MUSCAT, SALALAH]), isError: true });
    await render(<Review />);
    expect(screen.getByLabelText('Muscat to Salalah')).toBeTruthy();
    expect(screen.queryByLabelText('Try again')).toBeNull();
  });
});

describe('Review — the price is the price', () => {
  // The fixed-price path, which is what BIDDING off falls back to.
  beforeEach(() => {
    jest.replaceProperty(features, 'BIDDING', false);
  });

  it('shows the exact price and books at it', async () => {
    await render(<Review />);
    expect(screen.getByText('YOUR PRICE')).toBeTruthy();
    const book = screen.getByLabelText(/^Book for 405\.698 OMR$/);
    fireEvent.press(book);
    expect(mockBookMutate).toHaveBeenCalledTimes(1);
    const [input] = mockBookMutate.mock.calls[0];
    expect(input).toMatchObject({
      originCity: MUSCAT.id,
      destCity: SALALAH.id,
      weightKg: 8000,
      // "Let us choose" is still NULL on the wire — non-negotiable #1.
      truckTypeCode: null,
      seenPriceBaisa: 405698,
    });
  });

  it('sends the same request id on a retry, so a timed-out tap cannot book twice', async () => {
    await render(<Review />);
    const book = screen.getByLabelText(/^Book for 405\.698 OMR$/);
    await fireEvent.press(book);
    await fireEvent.press(book);
    const [first, second] = mockBookMutate.mock.calls.map(([input]) => input.requestId);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  it('goes to the load without flashing "incomplete" as the draft is cleared', async () => {
    const { clearDraft } = jest.requireMock('@/lib/booking') as { clearDraft: jest.Mock };
    clearDraft.mockImplementationOnce(async () => {
      // What the real clearDraft does: publish an empty draft at once.
      mockDraft.current = { ...baseDraft, originCityId: null, destinationCityId: null, collectionDate: null, cargoDescription: '' };
    });
    mockBookMutate.mockImplementationOnce((_input, opts) => opts.onSuccess({ loadId: 'new-load' }));
    await render(<Review />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText(/^Book for 405\.698 OMR$/));
    });
    expect(mockReplace).toHaveBeenCalledWith('/load/new-load');
    expect(mockReplace.mock.invocationCallOrder[0]).toBeLessThan(clearDraft.mock.invocationCallOrder[0]);
    expect(screen.queryByLabelText('Continue booking')).toBeNull();
  });

  it('names the truck let-us-choose was priced for, never its code', async () => {
    await render(<Review />);
    expect(screen.getByText('10-ton truck, for 8,000 kg')).toBeTruthy();
    expect(screen.queryByText('10t')).toBeNull();
  });

  it('names an explicit truck by its name too', async () => {
    mockDraft.current = { ...mockDraft.current, truckPreference: '10t' };
    await render(<Review />);
    expect(screen.getByText('10-ton truck')).toBeTruthy();
    expect(screen.queryByText('10t')).toBeNull();
  });

  it('with no price, is the human path and books with no seen price', async () => {
    m('useRoutePrice').mockReturnValue(
      ok({ price_baisa: null, currency: 'OMR', outcome: 'advise_me', truck_type_code: null }),
    );
    mockDraft.current = { ...mockDraft.current, weightKg: null };
    await render(<Review />);
    expect(screen.getByText(/A person prices this/)).toBeTruthy();
    expect(screen.getByText('We choose it')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Find me a truck'));
    expect(mockBookMutate.mock.calls[0][0]).toMatchObject({ seenPriceBaisa: null });
  });

  it('shows the chosen places, and books with them (0041)', async () => {
    mockDraft.current = {
      ...mockDraft.current,
      originPlace: { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: 'Gate 3', contactName: '', contactPhone: '' },
      destinationPlace: null,
    };
    await render(<Review />);
    expect(screen.getByText('Pickup: Ruwi')).toBeTruthy();
    expect(screen.getByText('Gate 3')).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/^Book for/));
    expect(mockBookMutate.mock.calls[0][0]).toMatchObject({
      originPlace: { lat: 23.6, lng: 58.4, place_name: 'Ruwi', note: 'Gate 3', contact_name: null, contact_phone: null },
      destPlace: null,
    });
    mockDraft.current = { ...mockDraft.current, originPlace: null, destinationPlace: null };
  });

  it('shows who is at the gate, and the note on a pin with no name', async () => {
    mockDraft.current = {
      ...mockDraft.current,
      originPlace: { lat: 23.6, lng: 58.4, placeName: 'Ruwi', note: '', contactName: 'Rashid', contactPhone: '+968 9000 0000' },
      destinationPlace: { lat: 17.0, lng: 54.1, placeName: null, note: 'Blue gate', contactName: '', contactPhone: '' },
    };
    await render(<Review />);
    expect(screen.getByText('Ask for Rashid: \u2066+968 9000 0000\u2069')).toBeTruthy();
    expect(screen.getByText('Drop-off: This spot')).toBeTruthy();
    expect(screen.getByText('Blue gate')).toBeTruthy();
    mockDraft.current = { ...mockDraft.current, originPlace: null, destinationPlace: null };
  });

  it('does not book while the price is still arriving', async () => {
    m('useRoutePrice').mockReturnValue(PENDING);
    await render(<Review />);
    fireEvent.press(screen.getByLabelText('Find me a truck'));
    expect(mockBookMutate).not.toHaveBeenCalled();
  });
});

describe('Review — drivers name the price (0045)', () => {
  beforeEach(() => {
    jest.replaceProperty(features, 'BIDDING', true);
  });

  it('shows no rate-card price and says how the price is found', async () => {
    await render(<Review />);
    expect(screen.queryByText('YOUR PRICE')).toBeNull();
    expect(screen.queryByText(/405\.698/)).toBeNull();
    expect(screen.getByText('HOW IT IS PRICED')).toBeTruthy();
  });

  it('does not spend a rate-limited price lookup it will never show', async () => {
    await render(<Review />);
    expect(m('useRoutePrice')).toHaveBeenCalledWith(expect.objectContaining({ originCity: null }));
  });

  it('posts for bids with the target, and never a price of its own', async () => {
    mockDraft.current = { ...mockDraft.current, targetTotalBaisa: 120500 };
    await render(<Review />);
    expect(screen.getByText('120.500 OMR')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Ask drivers for prices'));
    expect(mockBookMutate).not.toHaveBeenCalled();
    expect(mockPostBidMutate).toHaveBeenCalledTimes(1);
    const [input] = mockPostBidMutate.mock.calls[0];
    expect(input).toMatchObject({
      originCity: MUSCAT.id,
      destCity: SALALAH.id,
      truckTypeCode: null,
      targetTotalBaisa: 120500,
    });
    expect(input).not.toHaveProperty('seenPriceBaisa');
    mockDraft.current = { ...mockDraft.current, targetTotalBaisa: null };
  });

  it('says the shipper chooses when no target was given', async () => {
    mockDraft.current = { ...mockDraft.current, targetTotalBaisa: null };
    await render(<Review />);
    expect(screen.getByText('You choose')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Ask drivers for prices'));
    expect(mockPostBidMutate.mock.calls[0][0]).toMatchObject({ targetTotalBaisa: null });
  });

  it('opens the load once posted, where the prices arrive', async () => {
    mockPostBidMutate.mockImplementation((_input, opts) => opts.onSuccess({ loadId: 'new-load' }));
    await render(<Review />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ask drivers for prices'));
    });
    expect(mockReplace).toHaveBeenCalledWith('/load/new-load');
  });
});

describe('Driver home — go available', () => {
  it('reads the position once and goes available with it', async () => {
    await render(<DriverHome />);
    // StatusPill sets its label in capitals.
    expect(screen.getByText('YOU ARE OFFLINE')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Go available'));
    });
    expect(mockSetAvailableMutate).toHaveBeenCalledTimes(1);
    expect(mockSetAvailableMutate.mock.calls[0][0]).toEqual({
      available: true,
      lat: 22.9333,
      lng: 57.5333,
    });
  });

  it('without location permission still goes available — the town comes from the last delivery', async () => {
    mockLocation.granted = false;
    await render(<DriverHome />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Go available'));
    });
    expect(mockSetAvailableMutate.mock.calls[0][0]).toEqual({ available: true });
  });

  it('says which town it thinks the truck is in, and going offline sends no position', async () => {
    m('useMyAvailability').mockReturnValue(
      ok({ available: true, city_id: MUSCAT.id, source: 'gps', updated_at: new Date().toISOString() }),
    );
    await render(<DriverHome />);
    expect(screen.getByText('Near Muscat')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Go offline'));
    });
    expect(mockSetAvailableMutate.mock.calls[0][0]).toEqual({ available: false });
  });
});

describe('Offers — minutes, and a lost race', () => {
  it('counts minutes on a five-minute wave offer', () => {
    const now = Date.parse('2026-09-27T10:00:00Z');
    expect(expiryLabel('2026-09-27T10:04:10Z', now)).toBe('5 min left');
    expect(expiryLabel('2026-09-27T10:00:20Z', now)).toBe('1 min left');
  });

  it('keeps the deadline for a dispatcher’s longer offer', () => {
    const now = Date.parse('2026-09-27T10:00:00Z');
    expect(expiryLabel('2026-09-29T10:00:00Z', now)).toMatch(/^Expires /);
  });

  it.each(['load already assigned', 'offer already resolved', 'offer expired'])(
    'reads "%s" as another driver taking it',
    (message) => {
      expect(offerErrorMessage(new Error(message))).toBe(offerErrorMessage(new Error('load already assigned')));
      expect(offerErrorMessage(new Error(message))).not.toBe(offerErrorMessage(new Error('boom')));
    },
  );

  it('reads a Supabase error object, not only an Error', () => {
    expect(offerErrorMessage({ message: 'offer already resolved', code: '23514' })).toBe(
      offerErrorMessage(new Error('load already assigned')),
    );
  });
});

describe('Driver location — background GPS (0039)', () => {
  const online = (over: Record<string, unknown> = {}) =>
    m('useMyAvailability').mockReturnValue(
      ok({
        available: true,
        city_id: MUSCAT.id,
        source: 'gps',
        updated_at: new Date().toISOString(),
        located_at: null,
        ...over,
      }),
    );

  beforeEach(() => {
    __resetLocationPrompt();
    mockPush.mockReset();
    mockBack.mockReset();
  });

  it.each([
    ['always', 'Location on · waiting for the first reading'],
    ['foreground', 'Location only while the app is open'],
    ['none', 'Location off · you get loads near your town'],
  ] as const)('%s shows its line', async (access, line) => {
    mockLocationAccess.access = access;
    online();
    await render(<DriverHome />);
    expect(screen.getByText(line)).toBeTruthy();
  });

  it('offers "Turn on location" when it is not Always', async () => {
    mockLocationAccess.access = 'foreground';
    online();
    await render(<DriverHome />);
    expect(screen.getByText('Turn on location')).toBeTruthy();
  });

  it('does not offer it when it is already Always', async () => {
    mockLocationAccess.access = 'always';
    online();
    await render(<DriverHome />);
    expect(screen.queryByText('Turn on location')).toBeNull();
  });

  it('says when the last point was sent', async () => {
    mockLocationAccess.access = 'always';
    online({ located_at: new Date(Date.now() - 4 * 60_000).toISOString() });
    await render(<DriverHome />);
    expect(screen.getByText(/^Location on · last sent/)).toBeTruthy();
  });

  it('shows no location line while offline', async () => {
    mockLocationAccess.access = 'none';
    online({ available: false });
    await render(<DriverHome />);
    expect(screen.queryByText('Location off · you get loads near your town')).toBeNull();
  });

  it('opens the disclosure — never the OS prompt directly — once per launch', async () => {
    mockLocationAccess.access = 'foreground';
    online();
    // Two home screens mounted in one launch — the second must not ask again.
    await render(<DriverHome />);
    await render(<DriverHome />);
    expect(mockPush.mock.calls.filter((c) => c[0] === '/location-permission')).toHaveLength(1);
    expect(mockLocationAccess.request).not.toHaveBeenCalled();
  });

  it('the disclosure asks one question, then requests on Continue', async () => {
    await render(<LocationPermission />);
    expect(screen.getByText('Let Truckkoo see where your truck is, even when the app is closed?')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Continue'));
    });
    expect(mockLocationAccess.request).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalled();
  });

  it('"Not now" asks nothing', async () => {
    await render(<LocationPermission />);
    fireEvent.press(screen.getByLabelText('Not now'));
    expect(mockLocationAccess.request).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });
});
