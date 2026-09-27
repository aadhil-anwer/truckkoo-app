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
  mockLocation,
  mockSetAvailableMutate,
  ok,
  PENDING,
  resetQueries,
} from './harness';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import Review from '@/app/(app)/book/review';
import DriverHome from '@/app/(app)/(tabs)/driver';
import { expiryLabel } from '@/components/driver/OfferCard';
import { initLanguage } from '@/i18n';
import * as queries from '@/lib/queries';
import { offerErrorMessage } from '@/lib/offer-errors';

const mockDraft = {
  current: {
    originCityId: MUSCAT.id,
    destinationCityId: SALALAH.id,
    destinationCountry: 'OM',
    collectionDate: '2026-09-28',
    cargoDescription: 'Building materials',
    truckPreference: 'auto',
    weightKg: 8000,
  } as Record<string, unknown>,
};

jest.mock('@/lib/booking', () => {
  const actual = jest.requireActual('@/lib/booking');
  return {
    ...actual,
    useBookingDraft: () => ({ draft: mockDraft.current, update: jest.fn(), ready: true }),
    clearDraft: jest.fn(async () => {}),
  };
});

const m = (name: string) => (queries as unknown as Record<string, jest.Mock>)[name];

beforeEach(() => {
  initLanguage('en');
  resetQueries(queries as unknown as Record<string, unknown>);
  m('useTruckTypes').mockReturnValue(ok([TRUCK]));
  mockDraft.current = { ...mockDraft.current, truckPreference: 'auto', weightKg: 8000 };
});

describe('Review — the price is the price', () => {
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

  it('does not book while the price is still arriving', async () => {
    m('useRoutePrice').mockReturnValue(PENDING);
    await render(<Review />);
    fireEvent.press(screen.getByLabelText('Find me a truck'));
    expect(mockBookMutate).not.toHaveBeenCalled();
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
