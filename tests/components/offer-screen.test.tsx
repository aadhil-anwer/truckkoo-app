/**
 * D2 · one offer, taken.
 *
 * Accepting used to leave the driver on this screen. The mutation's cache
 * refresh re-read the offer, which is no longer pending once accepted, so the
 * screen fell through to its "That offer has gone" state — on the one tap that
 * *won* the job. A driver who reads that thinks they lost the load. Taking it
 * must land them on the trip it created.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import OfferDetail from '@/app/(app)/offer/[id]';
import { initLanguage } from '@/i18n';

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockRespond = { tripId: 'trip-1' as string | null, calls: [] as unknown[] };
const mockOffer = { expires_at: '2026-09-29T06:53:49Z', trip_km: null as number | null, to_pickup_km: null as number | null };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ id: 'offer-1' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/queries', () => ({
  cityIndex: (rows: { id: number }[] | undefined) => new Map((rows ?? []).map((c) => [c.id, c])),
  // Pure — the real one, so the screen reads places exactly as it will in the app.
  placeOf: jest.requireActual('@/lib/queries').placeOf,
  useCities: () => ({
    data: [
      { id: 1, name_en: 'Muscat', name_ar: 'مسقط', lat: 23.588, lng: 58.408, region_en: '', region_ar: '', country: 'OM' },
      { id: 36, name_en: 'Dubai', name_ar: 'دبي', lat: 25.2, lng: 55.27, region_en: '', region_ar: '', country: 'AE' },
    ],
  }),
  useMyLegs: () => ({ data: [] }),
  useDriverOffer: () => ({
    isPending: false,
    data: {
      offer_id: 'offer-1',
      leg_id: null,
      origin_city: 1,
      dest_city: 36,
      pickup_from: '2026-09-28',
      pickup_to: '2026-09-28',
      goods: 'Building materials',
      weight_kg: 8000,
      truck_type_code: null,
      collect_baisa: 405698,
      payout_baisa: 405698,
      owed_baisa: 0,
      currency: 'OMR',
      detour_km: 0,
      free_after_kg: null,
      ...mockOffer,
    },
  }),
  useRespondToOffer: () => ({
    isPending: false,
    mutate: (
      vars: unknown,
      opts: { onSuccess?: (tripId: string | null) => void },
    ) => {
      mockRespond.calls.push(vars);
      opts.onSuccess?.(mockRespond.tripId);
    },
  }),
}));

beforeEach(() => {
  initLanguage('en');
  jest.clearAllMocks();
  mockRespond.calls = [];
  mockRespond.tripId = 'trip-1';
  Object.assign(mockOffer, { expires_at: '2026-09-29T06:53:49Z', trip_km: null, to_pickup_km: null });
});

describe('Offer detail', () => {
  it('lands the driver on the trip they just won', async () => {
    await render(<OfferDetail />);
    fireEvent.press(screen.getByText(/Take it/));
    expect(mockRespond.calls).toEqual([{ offerId: 'offer-1', accept: true }]);
    // replace, not push: Back from the trip must not return to a spent offer.
    expect(mockRouter.replace).toHaveBeenCalledWith('/trip/trip-1');
  });

  it('reads like a ride request: trip km, distance to the pickup, and a minute to answer (0074)', async () => {
    Object.assign(mockOffer, {
      expires_at: new Date(Date.now() + 45_000).toISOString(), trip_km: 12.4, to_pickup_km: 6.6,
    });
    await render(<OfferDetail />);
    expect(screen.getByText('12 km')).toBeTruthy();
    expect(screen.getByText('7 km from you')).toBeTruthy();
    expect(screen.getByText(/Answer within \d+ s/)).toBeTruthy();
    // No pin before the job is taken — the screen says when it comes.
    expect(screen.getByText(/exact pickup point and contact show once you accept/)).toBeTruthy();
  });

  it('counts down nothing for an offer a person sent with hours to answer', async () => {
    Object.assign(mockOffer, { expires_at: new Date(Date.now() + 3 * 3_600_000).toISOString() });
    await render(<OfferDetail />);
    expect(screen.queryByText(/Answer within/)).toBeNull();
  });
});
