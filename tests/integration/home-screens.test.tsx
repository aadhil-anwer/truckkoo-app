/**
 * The two home screens, end to end against mocked data.
 *
 * These are the tests that catch what static review cannot: that a shipper with
 * nothing moving sees an invitation rather than a blank page, that
 * `finding_truck` offers a human instead of a dead end, and that a hostile goods
 * description is sanitised on the way to the screen rather than only in the
 * database.
 *
 * `render` and `fireEvent.press` are async in RNTL v14.
 */

import { Linking } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import CustomerHome from '@/app/(app)/customer';
import DriverHome from '@/app/(app)/driver';
import type { City, Leg, Load, Offer, Trip, TruckType } from '@/lib/queries';

/* ─── harness ────────────────────────────────────────────────────────────── */

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
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRespondMutate = jest.fn();
const mockQuoteMutate = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Redirect: () => null,
}));

jest.mock('@/lib/auth', () => ({ signOut: jest.fn() }));

jest.mock('@/lib/queries', () => {
  const actual = jest.requireActual('@/lib/queries');
  return {
    ...actual,
    useCities: jest.fn(),
    useTruckTypes: jest.fn(),
    useMyLoads: jest.fn(),
    useMyLegs: jest.fn(),
    useMyOffers: jest.fn(),
    useMyTrips: jest.fn(),
    useVisibleLoads: jest.fn(),
    useRespondToOffer: jest.fn(),
    // The shipper's view of who is carrying the load. Mocked like the rest —
    // unmocked they call the real `useQuery`, which needs a QueryClientProvider
    // this harness deliberately does not build.
    useTripCounterpart: jest.fn(),
    useTripTruck: jest.fn(),
    useTripEvents: jest.fn(),
    usePodUrl: jest.fn(),
    // The price. Same reason as the three above: unmocked they reach the real
    // useQuery and need a provider this harness does not build.
    useCurrentQuote: jest.fn(),
    useQuoteLoad: jest.fn(),
  };
});

import * as queries from '@/lib/queries';

/** A resolved react-query result. */
function ok<T>(data: T) {
  return { data, isPending: false, isError: false, isRefetching: false, refetch: jest.fn() };
}
const PENDING = { data: undefined, isPending: true, isError: false, isRefetching: false, refetch: jest.fn() };
const FAILED = { data: undefined, isPending: false, isError: true, isRefetching: false, refetch: jest.fn() };

const MUSCAT: City = { id: 1, name_en: 'Muscat', name_ar: 'مسقط', country: 'OM', corridor: 'Muscat' };
const SALALAH: City = { id: 2, name_en: 'Salalah', name_ar: 'صلالة', country: 'OM', corridor: 'Dhofar' };

const TRUCK = {
  code: '10t',
  name_en: '10-ton truck',
  name_ar: 'شاحنة ١٠ طن',
  description_en: 'Commercial freight',
} as TruckType;

function load(over: Partial<Load> = {}): Load {
  return {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
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

beforeEach(() => {
  // `clearMocks` resets calls but keeps implementations, so a test that makes
  // respond.mutate invoke onError would leak that into every test after it.
  mockRespondMutate.mockReset();
  (queries.useCities as jest.Mock).mockReturnValue(ok([MUSCAT, SALALAH]));
  (queries.useTruckTypes as jest.Mock).mockReturnValue(ok([TRUCK]));
  (queries.useMyLoads as jest.Mock).mockReturnValue(ok([]));
  (queries.useMyLegs as jest.Mock).mockReturnValue(ok([]));
  (queries.useMyOffers as jest.Mock).mockReturnValue(ok([]));
  (queries.useMyTrips as jest.Mock).mockReturnValue(ok([]));
  (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([]));
  (queries.useRespondToOffer as jest.Mock).mockReturnValue({
    mutate: mockRespondMutate,
    isPending: false,
    variables: undefined,
  });

  // Default: no trip yet, so a posted load shows none of the carrier detail.
  (queries.useTripCounterpart as jest.Mock).mockReturnValue(ok(null));
  (queries.useTripTruck as jest.Mock).mockReturnValue(ok(null));
  (queries.useTripEvents as jest.Mock).mockReturnValue(ok([]));
  (queries.usePodUrl as jest.Mock).mockReturnValue(ok(null));

  // Default: no quote yet, which is what a just-posted load looks like.
  (queries.useCurrentQuote as jest.Mock).mockReturnValue(ok(null));
  (queries.useQuoteLoad as jest.Mock).mockReturnValue({
    mutate: mockQuoteMutate,
    isPending: false,
    isError: false,
  });
});

/* ─── shipper ────────────────────────────────────────────────────────────── */

describe('CustomerHome', () => {
  it('invites a first-time shipper instead of reporting emptiness', async () => {
    await render(<CustomerHome />);
    expect(screen.getByText('Nothing moving yet')).toBeTruthy();
    expect(screen.getByLabelText('Post your first load')).toBeTruthy();
  });

  it('shows no tab strip when there is nothing but the live section', async () => {
    // One page, one action. The book only appears once there is a book.
    await render(<CustomerHome />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('renders a live load as a consignment note', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
    await render(<CustomerHome />);

    expect(screen.getByText('Muscat')).toBeTruthy();
    expect(screen.getByText('Salalah')).toBeTruthy();
    expect(screen.getByText('Building materials')).toBeTruthy();
    expect(screen.getByText('NO. AAAAAAAA')).toBeTruthy();
  });

  it('names the truck type rather than showing its code', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
    await render(<CustomerHome />);
    expect(screen.getByText('10-ton truck')).toBeTruthy();
  });

  it('renders a null truck type as "We will advise", never blank', async () => {
    // NULL means "Not sure — advise me", the most important affordance in the
    // product. An empty cell would read as a missing field.
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ truck_type_code: null })]));
    await render(<CustomerHome />);
    expect(screen.getByText('We will advise')).toBeTruthy();
  });

  it('renders an absent weight as "Not given"', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ weight_kg: null })]));
    await render(<CustomerHome />);
    expect(screen.getByText('Not given')).toBeTruthy();
  });

  describe('the price', () => {
    /**
     * `load.submit` has said "Request a quote" since the first screen existed.
     * These assert that the answer arrives, and — more importantly — that the
     * three ways it can arrive without a number all read as "a person is on it"
     * rather than as a broken field.
     */
    const quote = (over: Partial<queries.Quote> = {}): queries.Quote => ({
      quote_id: 'q1',
      price_baisa: 150000,
      currency: 'OMR',
      outcome: 'quoted',
      expires_at: '2026-08-03T09:00:00.000Z',
      ...over,
    });

    it('renders a quoted price with all three OMR decimals', async () => {
      // 150000 baisa is 150.000 rial. Rendered as 150.00 it is a tenfold error
      // that looks entirely plausible — the whole reason money.ts exists.
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ price_baisa: 150000 })]));
      (queries.useCurrentQuote as jest.Mock).mockReturnValue(ok(quote()));
      await render(<CustomerHome />);

      expect(screen.getByText(/150\.000 OMR/)).toBeTruthy();
    });

    it('never implies an in-app charge', async () => {
      // PRODUCT.md: no payment surfaces, permanently. Showing a price is the
      // closest this app ever comes, so it says plainly what does not happen.
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ price_baisa: 150000 })]));
      (queries.useCurrentQuote as jest.Mock).mockReturnValue(ok(quote()));
      await render(<CustomerHome />);

      expect(screen.getByText(/Nothing is charged in the app/)).toBeTruthy();
    });

    it('offers to fetch a price when none exists yet', async () => {
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
      await render(<CustomerHome />);
      expect(screen.getByLabelText('Get a price')).toBeTruthy();
    });

    it('asks the server for the price rather than computing one', async () => {
      // The formula lives only in the database. A client that could price a load
      // would be shipping the rate card — crown jewel #1 — in the app bundle.
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
      await render(<CustomerHome />);

      fireEvent.press(screen.getByLabelText('Get a price'));
      expect(mockQuoteMutate).toHaveBeenCalledWith('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    });

    it.each([
      ['advise_me', /recommend the truck/],
      ['no_rate', /price this route by hand/],
      ['over_capacity', /heavier than the truck you chose/],
    ] as const)('explains a %s outcome instead of showing a blank price', async (outcome, copy) => {
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ price_baisa: null })]));
      (queries.useCurrentQuote as jest.Mock).mockReturnValue(
        ok(quote({ outcome, price_baisa: null })),
      );
      await render(<CustomerHome />);

      expect(screen.getByText(copy)).toBeTruthy();
      // No dash, no empty field, and no retry button dressed up as a fix — a
      // human is already handling it.
      expect(screen.queryByLabelText('Get a price')).toBeNull();
    });

    it('does not offer a price once the load is already on a truck', async () => {
      // quote_load() refuses anything past finding_truck, so the button must not
      // appear where the server would reject it.
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'in_transit' })]));
      await render(<CustomerHome />);
      expect(screen.queryByLabelText('Get a price')).toBeNull();
    });
  });

  describe('a finished load stays reachable', () => {
    /**
     * REGRESSION. `LIVE` excludes `delivered`, so a completed load left the live
     * tab and became a `LedgerRow` with no `onPress` — taking the proof-of-delivery
     * photo, the driver, the plate and the price out of reach in the same frame.
     * Settlement is offline, so that record is precisely what the business needs
     * *after* the job.
     */
    it('opens the completed consignment note from the record row', async () => {
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'delivered' })]));
      await render(<CustomerHome />);

      fireEvent.press(screen.getByText(/Muscat/));
      expect(mockPush).toHaveBeenCalledWith(
        '/load/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      );
    });
  });

  describe('finding_truck — the no-dead-end promise', () => {
    beforeEach(() => {
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'finding_truck' })]));
    });

    it('explains the wait rather than showing a bare status', async () => {
      await render(<CustomerHome />);
      expect(screen.getByText(/We are looking for a truck/)).toBeTruthy();
    });

    it('offers a human', async () => {
      await render(<CustomerHome />);
      expect(screen.getByLabelText('WhatsApp us')).toBeTruthy();
    });

    it('opens a properly encoded WhatsApp link carrying the reference', async () => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      await render(<CustomerHome />);
      await fireEvent.press(screen.getByLabelText('WhatsApp us'));

      const url = openURL.mock.calls[0][0];
      expect(url.startsWith('https://wa.me/96875172824?text=')).toBe(true);
      expect(decodeURIComponent(url)).toContain('NO. AAAAAAAA');
    });
  });

  it('shows no action on a moving load — there is nothing for a shipper to do', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'in_transit' })]));
    await render(<CustomerHome />);
    expect(screen.queryByLabelText('WhatsApp us')).toBeNull();
  });

  it('adds a record tab once loads have finished', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(
      ok([load(), load({ id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', status: 'delivered' })]),
    );
    await render(<CustomerHome />);
    expect(screen.getByText('MOVING NOW')).toBeTruthy();
    expect(screen.getByText('RECORD')).toBeTruthy();
  });

  it('offers a retry when the query fails', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(FAILED);
    await render(<CustomerHome />);
    expect(screen.getByText('We could not load that')).toBeTruthy();
    expect(screen.getByLabelText('Try again')).toBeTruthy();
  });

  it('shows a spinner rather than an empty state while loading', async () => {
    // Rendering "Nothing moving yet" before the data arrives is a lie.
    (queries.useMyLoads as jest.Mock).mockReturnValue(PENDING);
    await render(<CustomerHome />);
    expect(screen.queryByText('Nothing moving yet')).toBeNull();
  });

  it('routes to post-load from the pinned action', async () => {
    await render(<CustomerHome />);
    await fireEvent.press(screen.getByLabelText('Post your first load'));
    expect(mockPush).toHaveBeenCalledWith('/post-load');
  });

  /**
   * PRODUCT.md MVP: "see the assigned truck and driver". Product Principle #4:
   * show the truck and the person. Nothing satisfied either until now, and both
   * cross a tenant boundary through definer functions.
   */
  describe('once a truck is assigned', () => {
    const assignedTrip = {
      id: 'trip-9',
      load_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      truck_id: 'truck-1',
      status: 'in_transit',
      created_at: new Date().toISOString(),
    };

    beforeEach(() => {
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'in_transit' })]));
      (queries.useMyTrips as jest.Mock).mockReturnValue(ok([assignedTrip]));
      (queries.useTripCounterpart as jest.Mock).mockReturnValue(
        ok({ full_name: 'Salim Al-Hinai', phone: '+96890000000', role: 'driver' }),
      );
      (queries.useTripTruck as jest.Mock).mockReturnValue(
        ok({ truck_type: '10t', plate: 'A-1234', is_verified: true }),
      );
    });

    it('names the driver', async () => {
      await render(<CustomerHome />);
      expect(screen.getByText('Salim Al-Hinai')).toBeTruthy();
    });

    it('shows the truck type and plate, so the shipper can recognise it arriving', async () => {
      await render(<CustomerHome />);
      expect(screen.getByText('A-1234')).toBeTruthy();
      expect(screen.getAllByText('10-ton truck').length).toBeGreaterThan(0);
    });

    it('shows the verified stamp — the public claim made concrete', async () => {
      await render(<CustomerHome />);
      expect(screen.getByText('VERIFIED')).toBeTruthy();
    });

    it('omits the verified stamp when the truck is not verified', async () => {
      (queries.useTripTruck as jest.Mock).mockReturnValue(
        ok({ truck_type: '10t', plate: 'A-1234', is_verified: false }),
      );
      await render(<CustomerHome />);
      expect(screen.queryByText('VERIFIED')).toBeNull();
    });

    it('offers a way to reach the driver', async () => {
      await render(<CustomerHome />);
      expect(screen.getByLabelText('Message your driver')).toBeTruthy();
    });

    it('does not offer to reach a driver who gave no phone number', async () => {
      (queries.useTripCounterpart as jest.Mock).mockReturnValue(
        ok({ full_name: 'Salim Al-Hinai', phone: null, role: 'driver' }),
      );
      await render(<CustomerHome />);
      expect(screen.queryByLabelText('Message your driver')).toBeNull();
    });

    it('sanitises the driver name before rendering it', async () => {
      // A name is user-supplied text arriving from another tenant. SECURITY.md §7.
      const RLO = '‮';
      (queries.useTripCounterpart as jest.Mock).mockReturnValue(
        ok({ full_name: `Salim${RLO}Hinai`, phone: null, role: 'driver' }),
      );
      await render(<CustomerHome />);
      expect(screen.getByText('SalimHinai')).toBeTruthy();
    });

    it('shows the milestone trail', async () => {
      (queries.useTripEvents as jest.Mock).mockReturnValue(
        ok([
          { id: 'e1', trip_id: 'trip-9', type: 'en_route', note: null, photo_path: null, occurred_at: new Date().toISOString() },
        ]),
      );
      await render(<CustomerHome />);
      expect(screen.getByText('Progress'.toUpperCase())).toBeTruthy();
      expect(screen.getByText('On the road')).toBeTruthy();
    });

    it('shows the proof photo once one exists', async () => {
      (queries.useTripEvents as jest.Mock).mockReturnValue(
        ok([
          { id: 'e2', trip_id: 'trip-9', type: 'delivered', note: null, photo_path: 'trip-9/1.jpg', occurred_at: new Date().toISOString() },
        ]),
      );
      (queries.usePodUrl as jest.Mock).mockReturnValue(ok('https://signed.example/1.jpg'));
      await render(<CustomerHome />);
      expect(screen.getByLabelText('Proof of delivery')).toBeTruthy();
    });

    it('renders nothing rather than a broken frame when signing fails', async () => {
      (queries.useTripEvents as jest.Mock).mockReturnValue(
        ok([
          { id: 'e2', trip_id: 'trip-9', type: 'delivered', note: null, photo_path: 'trip-9/1.jpg', occurred_at: new Date().toISOString() },
        ]),
      );
      (queries.usePodUrl as jest.Mock).mockReturnValue(ok(null));
      await render(<CustomerHome />);
      expect(screen.queryByLabelText('Proof of delivery')).toBeNull();
    });
  });

  it('shows no carrier detail on a load with no trip yet', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
    (queries.useMyTrips as jest.Mock).mockReturnValue(ok([]));
    await render(<CustomerHome />);
    expect(screen.queryByText('YOUR DRIVER')).toBeNull();
    expect(screen.queryByText('PROGRESS')).toBeNull();
  });

  it('strips a bidi override out of a goods description before rendering it', async () => {
    // SECURITY.md §7: the database rejects these, and the client still refuses to
    // render one. Both layers on purpose.
    const RLO = '‮'; // escaped: a literal override here would be unreviewable
    (queries.useMyLoads as jest.Mock).mockReturnValue(
      ok([load({ goods_description: `furniture${RLO}bricks` })]),
    );
    await render(<CustomerHome />);
    expect(screen.getByText('furniturebricks')).toBeTruthy();
  });
});

/* ─── driver ─────────────────────────────────────────────────────────────── */

describe('DriverHome', () => {
  const offer: Offer = {
    id: 'off-1',
    load_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    leg_id: null,
    status: 'pending',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  };

  const trip: Trip = {
    id: 'trip-1',
    load_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    truck_id: null,
    status: 'assigned',
    created_at: new Date().toISOString(),
  };

  const leg: Leg = {
    id: 'leg-1',
    origin_city: 1,
    dest_city: 2,
    depart_from: '2026-08-01',
    depart_to: '2026-08-01',
    is_empty: true,
    status: 'open',
  };

  const withOffer = () => {
    (queries.useMyOffers as jest.Mock).mockReturnValue(ok([offer]));
    (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
  };

  it('always offers all three kinds of paper, even when empty', async () => {
    // An empty book still teaches the shape of the job.
    await render(<DriverHome />);
    expect(screen.getByText('TRIP')).toBeTruthy();
    expect(screen.getByText('OFFERS')).toBeTruthy();
    expect(screen.getByText('ROUTES')).toBeTruthy();
  });

  it('tells a driver with no routes what an empty book costs', async () => {
    await render(<DriverHome />);
    expect(screen.getByText('No routes declared')).toBeTruthy();
  });

  it('makes declaring a route reachable from every sheet', async () => {
    await render(<DriverHome />);
    expect(screen.getByLabelText('Add a trip you are making')).toBeTruthy();
  });

  it('shows the active trip with its one action', async () => {
    (queries.useMyTrips as jest.Mock).mockReturnValue(ok([trip]));
    (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
    await render(<DriverHome />);

    expect(screen.getByLabelText('I have collected it')).toBeTruthy();
  });

  it('switches the trip action once the load is collected', async () => {
    (queries.useMyTrips as jest.Mock).mockReturnValue(ok([{ ...trip, status: 'in_transit' }]));
    (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
    await render(<DriverHome />);
    expect(screen.getByLabelText('Mark delivered')).toBeTruthy();
  });

  it('routes both transitions to the trip screen, never firing a state change inline', async () => {
    // Delivery needs a photo, so neither transition may complete from here.
    (queries.useMyTrips as jest.Mock).mockReturnValue(ok([trip]));
    (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
    await render(<DriverHome />);
    await fireEvent.press(screen.getByLabelText('I have collected it'));
    expect(mockPush).toHaveBeenCalledWith('/trip/trip-1');
  });

  describe('the pay on an offer', () => {
    /**
     * REGRESSION. The offer sheet showed route, goods, dates and weight —
     * everything the driver already knew, because they declared the leg — and
     * withheld the one variable. `price_baisa` was fetched by `useVisibleLoads`,
     * held in `loadById`, and never rendered.
     *
     * PRODUCT.md's entire supply-side thesis is that the driver earns more on a
     * trip they were already making. Asking an owner-driver to commit a truck
     * against an unknown return, in a cab, against a deadline, invites the one
     * answer the supply side cannot afford.
     */
    it('shows what the trip pays, in full OMR decimals', async () => {
      (queries.useMyOffers as jest.Mock).mockReturnValue(ok([offer]));
      (queries.useVisibleLoads as jest.Mock).mockReturnValue(
        ok([load({ price_baisa: 150000, currency: 'OMR' })]),
      );
      await render(<DriverHome />);

      expect(screen.getByText(/150\.000 OMR/)).toBeTruthy();
      expect(screen.getByText('YOU WILL BE PAID')).toBeTruthy();
    });

    it('never shows a blank where the pay goes', async () => {
      // No rate is the normal case until the card is loaded (OPEN_ISSUES 13). A
      // blank reads as "the app is broken"; this names who owns the next step.
      (queries.useMyOffers as jest.Mock).mockReturnValue(ok([offer]));
      (queries.useVisibleLoads as jest.Mock).mockReturnValue(
        ok([load({ price_baisa: null })]),
      );
      await render(<DriverHome />);

      expect(screen.getByText(/confirm the rate with you before pickup/)).toBeTruthy();
    });
  });

  it('gives each offer its own sheet and counts them on the tab', async () => {
    (queries.useMyOffers as jest.Mock).mockReturnValue(
      ok([offer, { ...offer, id: 'off-2' }, { ...offer, id: 'off-3' }]),
    );
    (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
    await render(<DriverHome />);
    expect(screen.getByLabelText('Offers, 3')).toBeTruthy();
  });

  it('shows when an offer stops waiting', async () => {
    withOffer();
    await render(<DriverHome />);
    expect(screen.getByText('REPLY BY')).toBeTruthy();
  });

  it('accepts an offer and turns to the trip it just took', async () => {
    withOffer();
    await render(<DriverHome />);

    await fireEvent.press(screen.getByLabelText('Accept this load'));
    expect(mockRespondMutate).toHaveBeenCalledWith(
      { offerId: 'off-1', accept: true },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('declines an offer', async () => {
    withOffer();
    await render(<DriverHome />);

    await fireEvent.press(screen.getByLabelText('Not this one'));
    expect(mockRespondMutate).toHaveBeenCalledWith(
      { offerId: 'off-1', accept: false },
      // Declining carries handlers now: since 0013 a decline is what returns the
      // shipper's load to the dispatcher, so one that fails silently strands it.
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('tells the driver when a decline failed, instead of nothing at all', async () => {
    withOffer();
    mockRespondMutate.mockImplementation((_vars, opts) => opts?.onError?.(new Error('boom')));
    await render(<DriverHome />);

    await fireEvent.press(screen.getByLabelText('Not this one'));
    expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy();
  });

  it('says another driver took the load, rather than blaming the app', async () => {
    // The payoff for 0013 locking the load row: the loser of the accept race gets
    // a domain error, so this screen can say what actually happened.
    withOffer();
    mockRespondMutate.mockImplementation((_vars, opts) =>
      opts?.onError?.(new Error('load already assigned')),
    );
    await render(<DriverHome />);

    await fireEvent.press(screen.getByLabelText('Accept this load'));
    expect(screen.getByText('Another driver took this load.')).toBeTruthy();
  });

  it('makes declining as easy to hit as accepting', async () => {
    // "No" on a 16pt target and "yes" on a 44pt one is a design that lies.
    withOffer();
    await render(<DriverHome />);

    const decline = screen.getByLabelText('Not this one');
    const raw = decline.props.style;
    const flat = Object.assign(
      {},
      ...(Array.isArray(raw) ? (raw as unknown[]).flat(Infinity) : [raw]).filter(Boolean),
    );
    expect(Number(flat.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('lists declared routes as ruled rows with their load state', async () => {
    (queries.useMyLegs as jest.Mock).mockReturnValue(ok([leg]));
    await render(<DriverHome />);
    expect(screen.getByText('EMPTY')).toBeTruthy();
  });

  it('does not show a driver any load they have no offer for', async () => {
    // Driver legs and shipper cargo are the crown jewels. There is no load board.
    (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
    (queries.useMyOffers as jest.Mock).mockReturnValue(ok([]));
    (queries.useMyTrips as jest.Mock).mockReturnValue(ok([]));
    await render(<DriverHome />);
    expect(screen.queryByText('Building materials')).toBeNull();
  });

  it('offers a retry when a query fails', async () => {
    (queries.useMyOffers as jest.Mock).mockReturnValue(FAILED);
    await render(<DriverHome />);
    expect(screen.getByText('We could not load that')).toBeTruthy();
  });
});
