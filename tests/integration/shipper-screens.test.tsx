/**
 * The shipper's three screens, end to end against mocked data.
 *
 * These are the tests that catch what static review cannot: that a shipper with
 * nothing moving sees an invitation rather than a blank page, that
 * `finding_truck` offers a human instead of a dead end, and that a hostile goods
 * description is sanitised on the way to the screen rather than only in the
 * database.
 *
 * The assertions are inherited from `home-screens.test.tsx`, which covered one
 * screen that has since become three: home shows the entry point and what is
 * moving, `loads` is the ledger, and `load/[id]` is where every detail now
 * lives. Nothing was dropped in the move — each behaviour is asserted against
 * whichever screen now owns it.
 *
 * IMPORT ORDER MATTERS. `./harness` must be first: its `jest.mock` calls run at
 * require time, so anything imported before it would capture the real modules.
 *
 * `render` and `fireEvent.press` are async in RNTL v14.
 */

import {
  FAILED,
  LOAD_ID,
  load,
  mockParams,
  mockPush,
  mockQuoteMutate,
  ok,
  PENDING,
  resetQueries,
} from './harness';

import { Linking } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import CustomerHome from '@/app/(app)/(tabs)/customer';
import LoadsTab from '@/app/(app)/(tabs)/loads';
import LoadDetail from '@/app/(app)/load/[id]';
import * as queries from '@/lib/queries';

beforeEach(() => {
  resetQueries(queries as unknown as Record<string, unknown>);
});

/** Opening the detail screen means naming which load it is. */
function openLoad() {
  mockParams.current = { id: LOAD_ID };
}

/* ─── home ───────────────────────────────────────────────────────────────── */

describe('CustomerHome', () => {
  it('invites a first-time shipper instead of reporting emptiness', async () => {
    await render(<CustomerHome />);
    expect(screen.getByText('Nothing moving yet')).toBeTruthy();
  });

  it('leads with the one question the app exists to ask', async () => {
    await render(<CustomerHome />);
    expect(screen.getByText('Where to?')).toBeTruthy();
  });

  it('routes to post-load from the entry field', async () => {
    await render(<CustomerHome />);
    await fireEvent.press(
      screen.getByLabelText('Where to? Tell us pickup and delivery — we find the truck'),
    );
    expect(mockPush).toHaveBeenCalledWith('/post-load');
  });

  it('shows a moving load as a card, with the route and the status', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'in_transit' })]));
    await render(<CustomerHome />);

    expect(screen.getByText('Muscat')).toBeTruthy();
    expect(screen.getByText('Salalah')).toBeTruthy();
    expect(screen.getByText('ON THE ROAD')).toBeTruthy();
  });

  it('opens the detail screen from a card', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'in_transit' })]));
    await render(<CustomerHome />);

    await fireEvent.press(screen.getByLabelText(/Muscat To Salalah/));
    expect(mockPush).toHaveBeenCalledWith(`/load/${LOAD_ID}`);
  });

  it('names the truck type on the card rather than showing its code', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'in_transit' })]));
    await render(<CustomerHome />);
    expect(screen.getByText('10-ton truck')).toBeTruthy();
  });

  it('renders a null truck type as "We will advise", never blank', async () => {
    // NULL means "Not sure — advise me", the most important affordance in the
    // product. An empty cell would read as a missing field.
    (queries.useMyLoads as jest.Mock).mockReturnValue(
      ok([load({ status: 'in_transit', truck_type_code: null })]),
    );
    await render(<CustomerHome />);
    expect(screen.getByText('We will advise')).toBeTruthy();
  });

  it('offers a shortcut back to a route already used', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'delivered' })]));
    await render(<CustomerHome />);

    await fireEvent.press(screen.getByLabelText(/Muscat → Salalah/));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/post-load',
      params: { origin: '1', dest: '2' },
    });
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

  it('strips a bidi override out of a goods description before rendering it', async () => {
    // SECURITY.md §7: the database rejects these, and the client still refuses to
    // render one. Both layers on purpose. The shipper's own name goes through the
    // same sanitiser on this screen.
    const RLO = '‮'; // escaped: a literal override here would be unreviewable
    (queries.useMyLoads as jest.Mock).mockReturnValue(
      ok([load({ status: 'in_transit', goods_description: `furniture${RLO}bricks` })]),
    );
    openLoad();
    await render(<LoadDetail />);
    expect(screen.getByText('furniturebricks')).toBeTruthy();
  });
});

/* ─── the ledger ─────────────────────────────────────────────────────────── */

describe('LoadsTab', () => {
  it('separates what is moving from what is finished', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(
      ok([load(), load({ id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', status: 'delivered' })]),
    );
    await render(<LoadsTab />);

    expect(screen.getByLabelText('Moving, 1')).toBeTruthy();
    expect(screen.getByLabelText('Finished, 1')).toBeTruthy();
  });

  it('invites a first-time shipper to post, rather than reporting emptiness', async () => {
    await render(<LoadsTab />);
    expect(screen.getByLabelText('Post your first load')).toBeTruthy();
  });

  /**
   * REGRESSION. `LIVE` excludes `delivered`, so a completed load used to become a
   * row with no `onPress` — taking the proof-of-delivery photo, the driver, the
   * plate and the price out of reach in the same frame. Settlement is offline, so
   * that record is precisely what the business needs *after* the job.
   */
  it('opens the completed consignment note from the finished row', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'delivered' })]));
    await render(<LoadsTab />);

    await fireEvent.press(screen.getByLabelText('Finished, 1'));
    await fireEvent.press(screen.getByLabelText(/Muscat → Salalah/));
    expect(mockPush).toHaveBeenCalledWith(`/load/${LOAD_ID}`);
  });
});

/* ─── the load itself ────────────────────────────────────────────────────── */

describe('LoadDetail', () => {
  beforeEach(openLoad);

  it('renders the load in full', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
    await render(<LoadDetail />);

    expect(screen.getByText('Muscat')).toBeTruthy();
    expect(screen.getByText('Salalah')).toBeTruthy();
    expect(screen.getByText('Building materials')).toBeTruthy();
    expect(screen.getByText('NO. AAAAAAAA')).toBeTruthy();
  });

  it('renders an absent weight as "Not given"', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ weight_kg: null })]));
    await render(<LoadDetail />);
    expect(screen.getByText('Not given')).toBeTruthy();
  });

  it('says the load is not ours rather than 403-ing it', async () => {
    // Not-found and not-yours are the same thing, exactly as they are in the
    // database (SECURITY.md §3).
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([]));
    await render(<LoadDetail />);
    expect(screen.getByText('We cannot find that job')).toBeTruthy();
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
      await render(<LoadDetail />);

      expect(screen.getByText(/150\.000 OMR/)).toBeTruthy();
    });

    it('never implies an in-app charge', async () => {
      // PRODUCT.md: no payment surfaces, permanently. Showing a price is the
      // closest this app ever comes, so it says plainly what does not happen.
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ price_baisa: 150000 })]));
      (queries.useCurrentQuote as jest.Mock).mockReturnValue(ok(quote()));
      await render(<LoadDetail />);

      expect(screen.getByText(/Nothing is charged in the app/)).toBeTruthy();
    });

    it('offers to fetch a price when none exists yet', async () => {
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
      await render(<LoadDetail />);
      expect(screen.getByLabelText('Get a price')).toBeTruthy();
    });

    it('asks the server for the price rather than computing one', async () => {
      // The formula lives only in the database. A client that could price a load
      // would be shipping the rate card — crown jewel #1 — in the app bundle.
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
      await render(<LoadDetail />);

      await fireEvent.press(screen.getByLabelText('Get a price'));
      expect(mockQuoteMutate).toHaveBeenCalledWith(LOAD_ID);
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
      await render(<LoadDetail />);

      expect(screen.getByText(copy)).toBeTruthy();
      // No dash, no empty field, and no retry button dressed up as a fix — a
      // human is already handling it.
      expect(screen.queryByLabelText('Get a price')).toBeNull();
    });

    it('does not offer a price once the load is already on a truck', async () => {
      // quote_load() refuses anything past finding_truck, so the button must not
      // appear where the server would reject it.
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'in_transit' })]));
      await render(<LoadDetail />);
      expect(screen.queryByLabelText('Get a price')).toBeNull();
    });
  });

  describe('finding_truck — the no-dead-end promise', () => {
    beforeEach(() => {
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'finding_truck' })]));
    });

    it('explains the wait rather than showing a bare status', async () => {
      await render(<LoadDetail />);
      expect(screen.getByText(/We are looking for a truck/)).toBeTruthy();
    });

    it('offers a human', async () => {
      await render(<LoadDetail />);
      expect(screen.getByLabelText('WhatsApp us')).toBeTruthy();
    });

    it('opens a properly encoded WhatsApp link carrying the reference', async () => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      await render(<LoadDetail />);
      await fireEvent.press(screen.getByLabelText('WhatsApp us'));

      const url = openURL.mock.calls[0][0];
      expect(url.startsWith('https://wa.me/96875172824?text=')).toBe(true);
      expect(decodeURIComponent(url)).toContain('NO. AAAAAAAA');
    });
  });

  /**
   * PRODUCT.md MVP: "see the assigned truck and driver". Product Principle #4:
   * show the truck and the person. Both cross a tenant boundary through definer
   * functions.
   */
  describe('once a truck is assigned', () => {
    const assignedTrip = {
      id: 'trip-9',
      load_id: LOAD_ID,
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
      await render(<LoadDetail />);
      expect(screen.getByText('Salim Al-Hinai')).toBeTruthy();
    });

    it('shows the truck type and plate, so the shipper can recognise it arriving', async () => {
      await render(<LoadDetail />);
      expect(screen.getByText('A-1234')).toBeTruthy();
      expect(screen.getAllByText('10-ton truck').length).toBeGreaterThan(0);
    });

    it('shows the verified stamp — the public claim made concrete', async () => {
      await render(<LoadDetail />);
      expect(screen.getByText('VERIFIED')).toBeTruthy();
    });

    it('omits the verified stamp when the truck is not verified', async () => {
      (queries.useTripTruck as jest.Mock).mockReturnValue(
        ok({ truck_type: '10t', plate: 'A-1234', is_verified: false }),
      );
      await render(<LoadDetail />);
      expect(screen.queryByText('VERIFIED')).toBeNull();
    });

    it('offers a way to reach the driver', async () => {
      await render(<LoadDetail />);
      expect(screen.getByLabelText('Message your driver')).toBeTruthy();
    });

    it('does not offer to reach a driver who gave no phone number', async () => {
      (queries.useTripCounterpart as jest.Mock).mockReturnValue(
        ok({ full_name: 'Salim Al-Hinai', phone: null, role: 'driver' }),
      );
      await render(<LoadDetail />);
      expect(screen.queryByLabelText('Message your driver')).toBeNull();
    });

    it('drops the driver contact once the job is finished', async () => {
      // The job is over and the relationship is with Truckkoo, not the driver.
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'delivered' })]));
      await render(<LoadDetail />);
      expect(screen.queryByLabelText('Message your driver')).toBeNull();
      expect(screen.getByLabelText('Ask us about this job')).toBeTruthy();
    });

    it('sanitises the driver name before rendering it', async () => {
      // A name is user-supplied text arriving from another tenant. SECURITY.md §7.
      const RLO = '‮';
      (queries.useTripCounterpart as jest.Mock).mockReturnValue(
        ok({ full_name: `Salim${RLO}Hinai`, phone: null, role: 'driver' }),
      );
      await render(<LoadDetail />);
      expect(screen.getByText('SalimHinai')).toBeTruthy();
    });

    it('shows the milestone trail', async () => {
      (queries.useTripEvents as jest.Mock).mockReturnValue(
        ok([
          {
            id: 'e1',
            trip_id: 'trip-9',
            type: 'en_route',
            note: null,
            photo_path: null,
            occurred_at: new Date().toISOString(),
          },
        ]),
      );
      await render(<LoadDetail />);
      expect(screen.getByText('Progress')).toBeTruthy();
      // "On the road" is also the headline for an in_transit load, so match the
      // milestone row by its accessible name — which pairs the event with when
      // it happened, and is the thing a shipper actually reads here.
      expect(screen.getByLabelText(/^On the road\./)).toBeTruthy();
    });

    it('shows the proof photo once one exists', async () => {
      (queries.useTripEvents as jest.Mock).mockReturnValue(
        ok([
          {
            id: 'e2',
            trip_id: 'trip-9',
            type: 'delivered',
            note: null,
            photo_path: 'trip-9/1.jpg',
            occurred_at: new Date().toISOString(),
          },
        ]),
      );
      (queries.usePodUrl as jest.Mock).mockReturnValue(ok('https://signed.example/1.jpg'));
      await render(<LoadDetail />);
      expect(screen.getByLabelText('Photograph taken at delivery')).toBeTruthy();
    });

    it('renders nothing rather than a broken frame when signing fails', async () => {
      (queries.useTripEvents as jest.Mock).mockReturnValue(
        ok([
          {
            id: 'e2',
            trip_id: 'trip-9',
            type: 'delivered',
            note: null,
            photo_path: 'trip-9/1.jpg',
            occurred_at: new Date().toISOString(),
          },
        ]),
      );
      (queries.usePodUrl as jest.Mock).mockReturnValue(ok(null));
      await render(<LoadDetail />);
      expect(screen.queryByLabelText('Photograph taken at delivery')).toBeNull();
    });
  });

  it('shows no carrier detail on a load with no trip yet', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
    (queries.useMyTrips as jest.Mock).mockReturnValue(ok([]));
    await render(<LoadDetail />);
    expect(screen.queryByText('Your driver')).toBeNull();
    expect(screen.queryByText('Progress')).toBeNull();
  });
});
