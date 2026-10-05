/**
 * Shared harness for the screen integration tests.
 *
 * Extracted when the two home screens became six. Every screen mocks the same
 * query layer against the same two cities and the same load, so keeping that in
 * one place is what stops `shipper-screens` and `driver-screens` from drifting
 * into disagreeing about what a load looks like.
 *
 * This file is imported for its side effects — the `jest.mock` calls below are
 * hoisted into whichever test file imports it, which is the only way to mock a
 * module for a test that also imports the screen under test.
 */

import type {
  BidInvite,
  City,
  DriverOffer,
  DriverTrip,
  Load,
  ShipperBid,
  TripPosition,
  TruckType,
} from '@/lib/queries';

/**
 * An explicit safe-area mock rather than the library's shipped one.
 *
 * `react-native-safe-area-context/jest/mock` is a `export default {...}` module,
 * so a factory returning it hands back `{ default: ... }` and every named import
 * — `SafeAreaView` included — resolves to `undefined`. React then fails with
 * "Element type is invalid", pointing at the screen rather than at the mock.
 *
 * `SafeAreaView` becomes a plain View: insets are zero under test, and what these
 * tests assert is content, not padding.
 */
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  const insets = { top: 0, bottom: 0, left: 0, right: 0 };
  const frame = { x: 0, y: 0, width: 320, height: 640 };

  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(View, null, children),
    SafeAreaView: ({ children, ...rest }: { children?: React.ReactNode }) =>
      React.createElement(View, rest, children),
    SafeAreaInsetsContext: React.createContext(insets),
    SafeAreaFrameContext: React.createContext(frame),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: { insets, frame },
  };
});

// The `mock` prefix is required, not stylistic: `jest.mock` factories are hoisted
// above these declarations, so Jest rejects any out-of-scope reference that is not
// prefixed `mock` — the guard against reading an uninitialised variable.
export const mockPush = jest.fn();
export const mockReplace = jest.fn();
export const mockBack = jest.fn();
export const mockRespondMutate = jest.fn();
export const mockQuoteMutate = jest.fn();
export const mockAcceptMutate = jest.fn();
export const mockRateMutate = jest.fn();
export const mockPostLegMutate = jest.fn();
export const mockAdvanceMutate = jest.fn();
/** Mutable so a detail-screen test can say which load it opened. */
export const mockParams: { current: Record<string, string> } = { current: {} };

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
  }),
  useLocalSearchParams: () => mockParams.current,
  Redirect: () => null,
  Link: () => null,
}));

jest.mock('@/lib/auth', () => ({ signOut: jest.fn() }));

export const mockSetAvailableMutate = jest.fn();
export const mockBookMutate = jest.fn();
export const mockPostBidMutate = jest.fn();
export const mockAcceptBidMutate = jest.fn();
export const mockPlaceBidMutate = jest.fn();

jest.mock('@/lib/session', () => ({
  useSession: () => ({
    session: { user: { id: 'u1' } },
    profile: { id: 'u1', role: 'shipper', full_name: 'Aisha Trading', phone: null },
    loading: false,
    refreshProfile: jest.fn(),
  }),
}));

jest.mock('@/lib/queries', () => {
  const actual = jest.requireActual('@/lib/queries');
  return {
    ...actual,
    useCities: jest.fn(),
    useDriverVerification: jest.fn(),
    useTruckTypes: jest.fn(),
    useMyLoads: jest.fn(),
    useMyLegs: jest.fn(),
    useMyOffers: jest.fn(),
    useMyTrips: jest.fn(),
    useRespondToOffer: jest.fn(),
    // The shipper's view of who is carrying the load. Mocked like the rest —
    // unmocked they call the real `useQuery`, which needs a QueryClientProvider
    // this harness deliberately does not build.
    useTripCounterpart: jest.fn(),
    useTripTruck: jest.fn(),
    useTripEvents: jest.fn(),
    usePodUrl: jest.fn(),
    // The price. Same reason as the four above.
    useCurrentQuote: jest.fn(),
    useQuoteLoad: jest.fn(),
    // P4. The shipper's decision, the rating, and what may be known about a
    // driver — all three reach the tracking screen and all three would otherwise
    // call the real `useQuery` against a provider this harness does not build.
    useAcceptQuote: jest.fn(),
    useRateTrip: jest.fn(),
    useDriverSummary: jest.fn(),
    // P5. The driver stops reading `loads` and reads composed answers instead:
    // payout, collect, owed, detour and remaining capacity all arrive already
    // computed. Mocked for the same reason as everything above it.
    useDriverOffers: jest.fn(),
    useDriverOffer: jest.fn(),
    useDriverEarnings: jest.fn(),
    useDriverPastTrips: jest.fn(),
    useAdvanceTrip: jest.fn(),
    usePostLeg: jest.fn(),
    useDriverTrip: jest.fn(),
    useTripPosition: jest.fn(),
    // 0036. The driver's switch, and the shipper's upfront price and booking.
    useMyAvailability: jest.fn(),
    useSetAvailable: jest.fn(),
    useRoutePrice: jest.fn(),
    useBookLoad: jest.fn(),
    // 0041. The shipper's own places, on T3/T4.
    useLoadPlaces: jest.fn(),
    // 0045. Bidding, both sides. `useDriverBidInvite` is mocked as well as the
    // list it reads: inside the module it calls the real list hook, which a
    // mock of the export does not reach.
    usePostBidLoad: jest.fn(),
    useShipperLoadBids: jest.fn(),
    useShipperBidStatus: jest.fn(),
    useAcceptDriverBid: jest.fn(),
    useCloseBidding: jest.fn(),
    useExtendBidding: jest.fn(),
    useSetBidTarget: jest.fn(),
    useDriverBidInvites: jest.fn(),
    useDriverBidInvite: jest.fn(),
    useDriverLoadBids: jest.fn(),
    usePlaceDriverBid: jest.fn(),
  };
});

/**
 * Going available reads the position once. Mocked so no test asks a real
 * permission: granted, with a fix in Nizwa, unless a test says otherwise.
 */
export const mockLocation = {
  granted: true,
  fix: { coords: { latitude: 22.9333, longitude: 57.5333 } } as unknown,
};
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  ActivityType: { AutomotiveNavigation: 2 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: mockLocation.granted })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: mockLocation.granted })),
  getCurrentPositionAsync: jest.fn(async () => mockLocation.fix),
}));

/**
 * The tracking policy is mocked whole: it owns the OS background task, which no
 * screen test should start. Screens read `access` and call `request`; these are
 * what the tests set and assert. Default 'always', so no screen is prompted
 * unless a test asks for it.
 */
export const mockLocationAccess = {
  access: 'always' as 'always' | 'foreground' | 'none' | null,
  refresh: jest.fn(),
  request: jest.fn(async () => 'always'),
};
jest.mock('@/lib/location-tracking', () => ({
  LocationTrackingProvider: ({ children }: { children: unknown }) => children,
  useLocationAccess: () => mockLocationAccess,
}));

/* ─── fixtures ───────────────────────────────────────────────────────────── */

/** A resolved react-query result. */
export function ok<T>(data: T) {
  return { data, isPending: false, isError: false, isRefetching: false, refetch: jest.fn() };
}
export const PENDING = {
  data: undefined,
  isPending: true,
  isError: false,
  isRefetching: false,
  refetch: jest.fn(),
};
export const FAILED = {
  data: undefined,
  isPending: false,
  isError: true,
  isRefetching: false,
  refetch: jest.fn(),
};

export const MUSCAT: City = {
  id: 1,
  name_en: 'Muscat',
  name_ar: 'مسقط',
  country: 'OM',
  corridor: 'Muscat',
  // The real coordinates, matching 0020 — a fixture that lies about geography
  // makes a map test pass while the map is wrong.
  lng: 58.408,
  lat: 23.588,
};
export const SALALAH: City = {
  id: 2,
  name_en: 'Salalah',
  name_ar: 'صلالة',
  country: 'OM',
  corridor: 'Dhofar',
  lng: 54.092,
  lat: 17.02,
};

export const TRUCK = {
  code: '10t',
  name_en: '10-ton truck',
  name_ar: 'شاحنة ١٠ طن',
  description_en: 'Commercial freight',
} as TruckType;

export const LOAD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

export function load(over: Partial<Load> = {}): Load {
  return {
    id: LOAD_ID,
    origin_city: 1,
    dest_city: 2,
    pickup_from: '2026-08-01',
    pickup_to: '2026-08-01',
    goods_description: 'Building materials',
    weight_kg: 8000,
    truck_type_code: '10t',
    status: 'posted',
    ...over,
  } as Load;
}

export const OFFER_ID = 'dddddddd-0000-4000-8000-0000000000ca';

/**
 * One offer as `driver_offers()` composes it.
 *
 * Priced at 96.000 with an 18.75% commission — the arithmetic of the plan's own
 * worked example — so a test asserting 78.000 is asserting the split, not a
 * number someone typed twice.
 */
export function driverOffer(over: Partial<DriverOffer> = {}): DriverOffer {
  return {
    offer_id: OFFER_ID,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    leg_id: 'leg-1',
    origin_city: 1,
    dest_city: 2,
    pickup_from: '2026-08-01',
    pickup_to: '2026-08-01',
    goods: 'Building materials',
    weight_kg: 8000,
    truck_type_code: '10t',
    collect_baisa: 96000,
    payout_baisa: 78000,
    owed_baisa: 18000,
    currency: 'OMR',
    detour_km: 16,
    free_after_kg: 2000,
    pickup_lat: null,
    pickup_lng: null,
    pickup_name: null,
    pickup_note: null,
    pickup_contact_name: null,
    pickup_contact_phone: null,
    drop_lat: null,
    drop_lng: null,
    drop_name: null,
    drop_note: null,
    drop_contact_name: null,
    drop_contact_phone: null,
    ...over,
  };
}

/**
 * The job a driver is on, as `driver_trip()` composes it. Same three money
 * fields as an offer, so `DriverMoney` renders either.
 */
export function driverTrip(over: Partial<DriverTrip> = {}): DriverTrip {
  return {
    trip_id: 'trip-1',
    status: 'assigned',
    load_id: LOAD_ID,
    origin_city: 1,
    dest_city: 2,
    pickup_from: '2026-08-01',
    pickup_to: '2026-08-01',
    goods: 'Building materials',
    weight_kg: 8000,
    collect_baisa: 96000,
    payout_baisa: 78000,
    owed_baisa: 18000,
    currency: 'OMR',
    shipper_name: 'Aisha Trading',
    shipper_phone: '+96890000000',
    pickup_lat: null,
    pickup_lng: null,
    pickup_name: null,
    pickup_note: null,
    pickup_contact_name: null,
    pickup_contact_phone: null,
    drop_lat: null,
    drop_lng: null,
    drop_name: null,
    drop_note: null,
    drop_contact_name: null,
    drop_contact_phone: null,
    ...over,
  };
}

/** A fix, as `trip_position()` composes it. Fresh unless a test says otherwise. */
export function tripPosition(over: Partial<TripPosition> = {}): TripPosition {
  return {
    lat: 22.5,
    lng: 57.5,
    seen_at: new Date(Date.now() - 4 * 60_000).toISOString(),
    accuracy_m: 12,
    remaining_km: 640,
    eta_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
    eta_source: 'fix',
    ...over,
  };
}

/**
 * The default world: two cities, one truck type, nothing owned by anyone.
 * Call from `beforeEach`, then override the one hook the test is about.
 */
export function resetQueries(queries: Record<string, unknown>) {
  const m = (name: string) => queries[name] as jest.Mock;

  mockRespondMutate.mockReset();
  mockAcceptMutate.mockReset();
  mockRateMutate.mockReset();
  mockPostLegMutate.mockReset();
  mockPostLegMutate.mockResolvedValue('leg-new');
  mockAdvanceMutate.mockReset();
  mockSetAvailableMutate.mockReset();
  mockLocationAccess.access = 'always';
  mockLocationAccess.request.mockReset().mockResolvedValue('always');
  mockBookMutate.mockReset();
  mockAdvanceMutate.mockResolvedValue(undefined);
  mockParams.current = {};

  m('useCities').mockReturnValue(ok([MUSCAT, SALALAH]));
  m('useLoadPlaces').mockReturnValue(ok({ pickup: null, drop: null }));
  m('useTruckTypes').mockReturnValue(ok([TRUCK]));
  m('useMyLoads').mockReturnValue(ok([]));
  m('useMyLegs').mockReturnValue(ok([]));
  m('useMyOffers').mockReturnValue(ok([]));
  m('useMyTrips').mockReturnValue(ok([]));
  // DEFAULT: NOTHING OFFERED, NOTHING EARNED. That is the state the product
  // launches in, so it is what a fresh test renders — D3, not D1 — and it is why
  // the empty state cannot rot untested.
  m('useDriverOffers').mockReturnValue(ok([]));
  m('useDriverOffer').mockReturnValue(ok(null));
  m('useDriverEarnings').mockReturnValue(ok(null));
  m('useDriverPastTrips').mockReturnValue(ok([]));
  m('usePostLeg').mockReturnValue({ mutateAsync: mockPostLegMutate, isPending: false });
  m('useDriverTrip').mockReturnValue(ok(null));
  // DEFAULT: NO FIX. A trip nobody has reported on is the state every trip
  // starts in, so it is what a fresh test renders.
  m('useTripPosition').mockReturnValue(ok(null));
  m('useAdvanceTrip').mockReturnValue({ mutateAsync: mockAdvanceMutate, isPending: false });
  m('useRespondToOffer').mockReturnValue({
    mutate: mockRespondMutate,
    isPending: false,
    variables: undefined,
  });

  // Default: never set, which is every driver on the day this ships.
  m('useMyAvailability').mockReturnValue(ok(null));
  m('useSetAvailable').mockReturnValue({ mutate: mockSetAvailableMutate, isPending: false });
  mockLocation.granted = true;
  mockLocation.fix = { coords: { latitude: 22.9333, longitude: 57.5333 } };
  // Default: a price, as for a weighed let-us-choose load on a priced corridor.
  m('useRoutePrice').mockReturnValue(
    ok({ price_baisa: 405698, currency: 'OMR', outcome: 'quoted', truck_type_code: '10t' }),
  );
  m('useBookLoad').mockReturnValue({ mutate: mockBookMutate, isPending: false });

  // Default: no trip yet, so a posted load shows none of the carrier detail.
  m('useTripCounterpart').mockReturnValue(ok(null));
  m('useTripTruck').mockReturnValue(ok(null));
  m('useTripEvents').mockReturnValue(ok([]));
  m('usePodUrl').mockReturnValue(ok(null));

  // Default: no quote yet, which is what a just-posted load looks like.
  m('useCurrentQuote').mockReturnValue(ok(null));
  m('useQuoteLoad').mockReturnValue({
    mutate: mockQuoteMutate,
    isPending: false,
    isError: false,
  });

  m('useAcceptQuote').mockReturnValue({
    mutate: mockAcceptMutate,
    isPending: false,
    isError: false,
  });
  m('useRateTrip').mockReturnValue({
    mutate: mockRateMutate,
    isPending: false,
    isSuccess: false,
  });
  // DEFAULT: NO HISTORY. A driver nobody has rated is the state the product
  // actually starts in, so it is the default here — a fixture that hands every
  // test "4.9 · 212 trips" would let the absent-rating rule rot untested.
  m('useDriverSummary').mockReturnValue(ok(null));
  m('useDriverVerification').mockReturnValue(ok(null));

  // 0045. DEFAULT: NO AUCTION ANYWHERE — no prices on any load, no invitation
  // for any driver. A test about bidding sets the one it is about.
  mockPostBidMutate.mockReset();
  mockAcceptBidMutate.mockReset();
  mockPlaceBidMutate.mockReset();
  m('usePostBidLoad').mockReturnValue({ mutate: mockPostBidMutate, isPending: false });
  m('useShipperLoadBids').mockReturnValue(ok([]));
  m('useShipperBidStatus').mockReturnValue(ok(null));
  m('useAcceptDriverBid').mockReturnValue({ mutate: mockAcceptBidMutate, isPending: false });
  m('useCloseBidding').mockReturnValue({ mutate: jest.fn(), isPending: false });
  m('useExtendBidding').mockReturnValue({ mutate: jest.fn(), isPending: false });
  m('useSetBidTarget').mockReturnValue({ mutate: jest.fn(), isPending: false });
  m('useDriverBidInvites').mockReturnValue(ok([]));
  m('useDriverBidInvite').mockReturnValue(ok(null));
  m('useDriverLoadBids').mockReturnValue(ok([]));
  m('usePlaceDriverBid').mockReturnValue({ mutate: mockPlaceBidMutate, isPending: false });
}

/** One bid invitation, as `driver_bid_invites()` composes it. No contact, by design. */
export function bidInvite(over: Partial<BidInvite> = {}): BidInvite {
  return {
    offer_id: OFFER_ID,
    load_id: LOAD_ID,
    bid_deadline: new Date(Date.now() + 40 * 60_000).toISOString(),
    origin_city: 1,
    dest_city: 2,
    pickup_from: '2026-08-01',
    pickup_to: '2026-08-01',
    goods: 'Building materials',
    weight_kg: 8000,
    truck_type_code: '10t',
    own_bid_baisa: null,
    pickup_lat: null,
    pickup_lng: null,
    pickup_name: null,
    pickup_note: null,
    drop_lat: null,
    drop_lng: null,
    drop_name: null,
    drop_note: null,
    ...over,
  };
}

/** One price as the shipper sees it: a total, never the driver's share. */
export function shipperBid(over: Partial<ShipperBid> = {}): ShipperBid {
  return {
    bid_id: 'bid-1',
    driver_name: 'Salim Al Harthy',
    truck_type: '10t',
    total_baisa: 110000,
    submitted_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    selected: false,
    eligible: true,
    ...over,
  };
}
