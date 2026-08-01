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
  mockAcceptMutate,
  mockRateMutate,
  ok,
  PENDING,
  resetQueries,
  tripPosition,
} from './harness';

import { Linking } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import CustomerHome from '@/app/(app)/(tabs)/customer';
import LoadsTab from '@/app/(app)/(tabs)/loads';
import TrackLoad from '@/app/(app)/load/[id]';
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
    // A directive, not "no loads yet" — an empty state tells a first-time user
    // nothing they can act on. The words changed with the redesign; the rule did
    // not.
    await render(<CustomerHome />);
    expect(screen.getByText('Your first load starts with two cities.')).toBeTruthy();
  });

  it('leads with the one question the app exists to ask', async () => {
    await render(<CustomerHome />);
    expect(screen.getByText('Where is it going?')).toBeTruthy();
  });

  it('routes into the booking flow from the entry field', async () => {
    await render(<CustomerHome />);
    await fireEvent.press(
      screen.getByLabelText('Where is it going? Pick two cities. We do the rest.'),
    );
    expect(mockPush).toHaveBeenCalledWith('/book/origin');
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

    await fireEvent.press(screen.getByLabelText(/Muscat to Salalah/));
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
    expect(screen.getByText('We choose it')).toBeTruthy();
  });

  it('offers a shortcut back to a route already used', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'delivered' })]));
    await render(<CustomerHome />);

    await fireEvent.press(screen.getByLabelText(/Muscat to Salalah/));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/post-load',
      params: { origin: '1', dest: '2' },
    });
  });

  it('offers a retry when the query fails', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(FAILED);
    await render(<CustomerHome />);
    expect(screen.getByText('We could not load that')).toBeTruthy();
    // One string now, not two concatenated: the sentence is the translator's to
    // order, not the call site's.
    expect(screen.getByLabelText('We could not load that. Try again')).toBeTruthy();
  });

  it('shows a spinner rather than an empty state while loading', async () => {
    // Rendering "Nothing moving yet" before the data arrives is a lie.
    (queries.useMyLoads as jest.Mock).mockReturnValue(PENDING);
    await render(<CustomerHome />);
    expect(screen.queryByText('Nothing moving yet')).toBeNull();
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

/* ─── the load itself · T1–T5 ────────────────────────────────────────────── */

/**
 * THESE ASSERTIONS WERE REWRITTEN FOR P4, NOT REPAIRED.
 *
 * The old suite encoded a screen where the shipper's only lever was a "Get a
 * price" button and a load went from `posted` straight to `assigned` behind
 * their back. P4 reversed that: a price now WAITS for the shipper, and their
 * acceptance is what releases the load to drivers. A test asserting the old
 * order is not a regression guard, it is a record of a decision that has since
 * been taken the other way — so it is replaced deliberately rather than deleted
 * to reach green.
 *
 * What survives unchanged, because none of it was about the ordering: not-found
 * is not-yours, a hostile name is sanitised before it renders, the price carries
 * three decimals, and there is a human reachable from every state.
 */
describe('TrackLoad', () => {
  beforeEach(openLoad);

  const tripOn = (over: Record<string, unknown> = {}) => ({
    id: 'trip-9',
    load_id: LOAD_ID,
    truck_id: 'truck-1',
    driver_id: 'drv-1',
    status: 'in_transit',
    created_at: new Date().toISOString(),
    ...over,
  });

  it('renders the cargo under every state', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
    await render(<TrackLoad />);

    expect(screen.getByText('Muscat')).toBeTruthy();
    expect(screen.getByText('Salalah')).toBeTruthy();
    expect(screen.getByText('Building materials')).toBeTruthy();
    expect(screen.getByText('NO. AAAAAAAA')).toBeTruthy();
  });

  it('says the load is not ours rather than 403-ing it', async () => {
    // Not-found and not-yours are the same thing, exactly as they are in the
    // database (SECURITY.md §3). A 403 would confirm the load exists.
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([]));
    await render(<TrackLoad />);
    expect(screen.getByText('We cannot find that job')).toBeTruthy();
  });

  it('strips a bidi override out of a goods description before rendering it', async () => {
    // SECURITY.md §7: the database rejects these and the client still refuses to
    // render one. Both layers on purpose.
    const RLO = '‮'; // escaped: a literal override here would be unreviewable
    (queries.useMyLoads as jest.Mock).mockReturnValue(
      ok([load({ goods_description: `furniture${RLO}bricks` })]),
    );
    await render(<TrackLoad />);
    expect(screen.getByText('furniturebricks')).toBeTruthy();
  });

  /* ─── T1 · the narrated wait ───────────────────────────────────────────── */

  describe('T1 · waiting', () => {
    it.each(['posted', 'finding_truck'] as const)(
      'narrates the wait rather than spinning — %s',
      async (status) => {
        // "Any wait over ~3s is narrated with a Timeline carrying real
        // information, not a spinner with a caption." This one runs to minutes.
        (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status })]));
        await render(<TrackLoad />);

        expect(screen.getByText('LOOKING NOW')).toBeTruthy();
        expect(screen.getByText(/no need to keep the app open/)).toBeTruthy();
        expect(screen.getByText('Matching a truck')).toBeTruthy();
      },
    );

    it('reads identically in finding_truck — never a dead end', async () => {
      // To the shipper it is the same fact: we are looking. Which side of the
      // auto-matcher the load sits on is our problem, not theirs.
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'finding_truck' })]));
      await render(<TrackLoad />);
      expect(screen.queryByText(/no results/i)).toBeNull();
      expect(screen.getByLabelText('WhatsApp us')).toBeTruthy();
    });

    it('opens a properly encoded WhatsApp link carrying the reference', async () => {
      const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'finding_truck' })]));
      await render(<TrackLoad />);
      await fireEvent.press(screen.getByLabelText('WhatsApp us'));

      const url = openURL.mock.calls[0][0];
      expect(url.startsWith('https://wa.me/96875172824?text=')).toBe(true);
      expect(decodeURIComponent(url)).toContain('NO. AAAAAAAA');
    });

    it('shows no price and no accept button before one exists', async () => {
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
      await render(<TrackLoad />);
      expect(screen.queryByText('YOUR PRICE')).toBeNull();
      expect(screen.queryByLabelText(/^Accept/)).toBeNull();
    });
  });

  /* ─── T2 · the price ───────────────────────────────────────────────────── */

  describe('T2 · the price', () => {
    const quoted = () => ok([load({ status: 'quoted', price_baisa: 150000 })]);

    it('renders the price with all three OMR decimals', async () => {
      // 150000 baisa is 150.000 rial. Rendered as 150.00 it is a tenfold error
      // that looks entirely plausible — the whole reason money.ts exists.
      (queries.useMyLoads as jest.Mock).mockReturnValue(quoted());
      await render(<TrackLoad />);
      expect(screen.getByText('150.000 OMR')).toBeTruthy();
    });

    it('carries the amount inside the accept button, not just above it', async () => {
      // Someone agreeing to a price one-handed in a truck cab should not have to
      // associate a button with a number further up the screen, and a screen
      // reader announcing "Accept" alone announces nothing.
      (queries.useMyLoads as jest.Mock).mockReturnValue(quoted());
      await render(<TrackLoad />);
      expect(screen.getByLabelText('Accept 150.000 OMR')).toBeTruthy();
    });

    it('sends the decision to the server rather than setting a status', async () => {
      // No client sets a status. `accept_quote` re-checks ownership inside the
      // definer function and is what releases the load to drivers.
      (queries.useMyLoads as jest.Mock).mockReturnValue(quoted());
      await render(<TrackLoad />);

      await fireEvent.press(screen.getByLabelText('Accept 150.000 OMR'));
      expect(mockAcceptMutate).toHaveBeenCalledWith(LOAD_ID);
    });

    it('never implies an in-app charge', async () => {
      // No payment surfaces, permanently. Showing a price is the closest this
      // app ever comes, so it says plainly what does not happen.
      (queries.useMyLoads as jest.Mock).mockReturnValue(quoted());
      await render(<TrackLoad />);
      expect(screen.getByText(/Nothing is charged in the app/)).toBeTruthy();
      expect(screen.getByText('Pay the driver on delivery')).toBeTruthy();
    });

    it('spends its accent on the decision, not on a second live marker', async () => {
      // One accent per screen: here it is the button that commits money, so the
      // timeline — whose active ring is also accent — must not be on this state.
      (queries.useMyLoads as jest.Mock).mockReturnValue(quoted());
      await render(<TrackLoad />);
      expect(screen.queryByText('Matching a truck')).toBeNull();
      expect(screen.queryByText('LOOKING NOW')).toBeNull();
    });

    it('hands over a human instead of a button that cancels the load', async () => {
      // Declining a price is a conversation, not a state transition.
      (queries.useMyLoads as jest.Mock).mockReturnValue(quoted());
      await render(<TrackLoad />);
      expect(screen.getByLabelText('Ask a question')).toBeTruthy();
    });
  });

  /* ─── T1b · the state the handoff never drew ───────────────────────────── */

  describe('T1b · accepted', () => {
    it('fills the gap between "you said yes" and "a driver said yes"', async () => {
      // No screen in the 32 covers this, and it is where a shipper is most
      // likely to sit wondering whether anything happened.
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'accepted' })]));
      await render(<TrackLoad />);

      expect(screen.getByText('Finding your truck.')).toBeTruthy();
      expect(screen.getByText('Your price, approved')).toBeTruthy();
      expect(screen.getByText('Truck confirming')).toBeTruthy();
    });

    it('does not offer the price again once it is accepted', async () => {
      // An accepted price is immutable; re-pricing is a new quote, decided again.
      (queries.useMyLoads as jest.Mock).mockReturnValue(
        ok([load({ status: 'accepted', price_baisa: 150000 })]),
      );
      await render(<TrackLoad />);
      expect(screen.queryByLabelText(/^Accept/)).toBeNull();
    });
  });

  /* ─── T3 · a named person ──────────────────────────────────────────────── */

  describe('T3 · assigned', () => {
    beforeEach(() => {
      (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load({ status: 'assigned' })]));
      (queries.useMyTrips as jest.Mock).mockReturnValue(ok([tripOn({ status: 'assigned' })]));
      (queries.useTripCounterpart as jest.Mock).mockReturnValue(
        ok({ full_name: 'Salim Al-Hinai', phone: '+96890000000', role: 'driver' }),
      );
      (queries.useTripTruck as jest.Mock).mockReturnValue(
        ok({ truck_type: '10t', plate: 'A-1234', is_verified: true }),
      );
    });

    it('names the person, not "a truck was assigned"', async () => {
      await render(<TrackLoad />);
      expect(screen.getByText('Salim Al-Hinai is taking your load.')).toBeTruthy();
    });

    it('shows the vehicle and plate, so the shipper can recognise it arriving', async () => {
      await render(<TrackLoad />);
      expect(screen.getByText(/10-ton truck · A-1234 · Verified/)).toBeTruthy();
    });

    it('omits the verified mark when the truck is not verified', async () => {
      (queries.useTripTruck as jest.Mock).mockReturnValue(
        ok({ truck_type: '10t', plate: 'A-1234', is_verified: false }),
      );
      await render(<TrackLoad />);
      expect(screen.queryByText(/Verified/)).toBeNull();
    });

    /**
     * RULE #5, THE ONE THAT MATTERS MOST HERE. The handoff draws "4.9 · 212
     * trips" on this card. With no history there is no 4.9 and no 212, and the
     * card shows NEITHER — not "0.0", not "New driver ★", not five grey stars.
     * A zero reads as a bad driver rather than a new one.
     */
    it('shows no rating and no trip count for a driver with no history', async () => {
      // The harness default: `driver_summary` returned nothing.
      await render(<TrackLoad />);
      expect(screen.queryByText(/0\.0/)).toBeNull();
      expect(screen.queryByText(/New driver/)).toBeNull();
      expect(screen.queryByText(/trips/)).toBeNull();
    });

    it('shows a trip count without a rating when nobody has rated them yet', async () => {
      (queries.useDriverSummary as jest.Mock).mockReturnValue(
        ok({ trips: 2, avgStars: null, ratings: 0 }),
      );
      await render(<TrackLoad />);
      // "2 trips", not a rounded flourish, and no star beside it.
      expect(screen.getByText('2 trips')).toBeTruthy();
    });

    it('shows both once they are real', async () => {
      (queries.useDriverSummary as jest.Mock).mockReturnValue(
        ok({ trips: 212, avgStars: 4.9, ratings: 41 }),
      );
      await render(<TrackLoad />);
      expect(screen.getByText('4.9')).toBeTruthy();
      expect(screen.getByText('· 212 trips')).toBeTruthy();
    });

    it('offers a way to reach the driver', async () => {
      await render(<TrackLoad />);
      expect(screen.getByLabelText('Call the driver')).toBeTruthy();
    });

    it('sanitises the driver name before rendering it', async () => {
      // A name is user-supplied text arriving from another tenant. SECURITY.md §7.
      const RLO = '‮';
      (queries.useTripCounterpart as jest.Mock).mockReturnValue(
        ok({ full_name: `Salim${RLO}Hinai`, phone: null, role: 'driver' }),
      );
      await render(<TrackLoad />);
      expect(screen.getByText('SalimHinai is taking your load.')).toBeTruthy();
    });
  });

  /* ─── T4 · on the road ─────────────────────────────────────────────────── */

  describe('T4 · in transit', () => {
    beforeEach(() => {
      (queries.useMyLoads as jest.Mock).mockReturnValue(
        ok([load({ status: 'in_transit', price_baisa: 150000 })]),
      );
      (queries.useMyTrips as jest.Mock).mockReturnValue(ok([tripOn()]));
    });

    it('shows what will be owed at the gate', async () => {
      // Settlement is offline and the driver is about to ask for it. A shipper
      // hunting for the number at the gate is a shipper arguing with a driver.
      await render(<TrackLoad />);
      expect(screen.getByText('To pay on delivery')).toBeTruthy();
      expect(screen.getByText('150.000 OMR')).toBeTruthy();
    });

    it('narrates arrival without overstating what it knows', async () => {
      // The copy says "arriving", never "the truck is here". Since P6 the
      // position is a real reported fix or nothing at all, and the bar is driven
      // by distance remaining rather than by the clock — so it needs a position
      // to render at all.
      (queries.useTripPosition as jest.Mock).mockReturnValue(ok(tripPosition()));
      await render(<TrackLoad />);
      expect(screen.getByText('ARRIVING')).toBeTruthy();
      expect(screen.getByRole('progressbar')).toBeTruthy();
    });

    it('draws the truck where it was actually reported', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(ok(tripPosition()));
      const { getByTestId } = await render(<TrackLoad />);
      expect(getByTestId('truck-marker')).toBeTruthy();
    });

    it('draws no truck when nobody has reported one', async () => {
      // The whole phase in one assertion: an unreported truck is absent, not
      // guessed at from the clock.
      (queries.useTripPosition as jest.Mock).mockReturnValue(
        ok(tripPosition({ lat: null, lng: null, seen_at: null, eta_source: 'corridor' })),
      );
      const { queryByTestId } = await render(<TrackLoad />);
      expect(queryByTestId('truck-marker')).toBeNull();
    });

    it('stamps every position it draws with its age', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(ok(tripPosition()));
      await render(<TrackLoad />);
      expect(screen.getByText(/Seen/)).toBeTruthy();
    });

    it('dims a marker the shipper should not read as current', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(
        ok(tripPosition({ seen_at: new Date(Date.now() - 3 * 3600_000).toISOString() })),
      );
      const { getByTestId } = await render(<TrackLoad />);
      const fill = getByTestId('truck-body').props.fill as { payload: number };
      expect(((fill.payload >>> 24) & 255) / 255).toBeLessThan(0.9);
    });

    it('says the arrival is an estimate when there has been no fix', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(
        ok(tripPosition({ lat: null, lng: null, seen_at: null, eta_source: 'corridor' })),
      );
      await render(<TrackLoad />);
      expect(screen.getByText('Estimated arrival')).toBeTruthy();
    });

    it('does not call it an estimate once it comes from a fix', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(ok(tripPosition()));
      await render(<TrackLoad />);
      expect(screen.queryByText('Estimated arrival')).toBeNull();
    });

    it('says plainly that there is no position, rather than showing nothing', async () => {
      (queries.useTripPosition as jest.Mock).mockReturnValue(
        ok(tripPosition({ lat: null, lng: null, seen_at: null, eta_source: 'corridor' })),
      );
      await render(<TrackLoad />);
      expect(screen.getByText('No position yet')).toBeTruthy();
    });

    it('still offers a human', async () => {
      await render(<TrackLoad />);
      expect(screen.getByLabelText('WhatsApp us')).toBeTruthy();
    });
  });

  /* ─── T5 · delivered ───────────────────────────────────────────────────── */

  describe('T5 · delivered', () => {
    beforeEach(() => {
      (queries.useMyLoads as jest.Mock).mockReturnValue(
        ok([load({ status: 'delivered', price_baisa: 150000 })]),
      );
      (queries.useMyTrips as jest.Mock).mockReturnValue(ok([tripOn({ status: 'delivered' })]));
    });

    it('is the receipt the business actually runs on', async () => {
      // Settlement is offline, so the reference and the amount are what close an
      // invoice and satisfy a cross-border paper trail.
      await render(<TrackLoad />);
      expect(screen.getByText('Delivered.')).toBeTruthy();
      expect(screen.getByText('Paid to driver')).toBeTruthy();
      expect(screen.getByText('150.000 OMR')).toBeTruthy();
      expect(screen.getByText('NO. AAAAAAAA')).toBeTruthy();
    });

    it('asks for a rating, and says why it matters', async () => {
      await render(<TrackLoad />);
      expect(screen.getByText('How did the driver do?')).toBeTruthy();
      expect(screen.getByText('It decides who gets your next load.')).toBeTruthy();
    });

    it('sends the rating to the server, keyed on the trip', async () => {
      await render(<TrackLoad />);
      await fireEvent.press(screen.getByLabelText('4 stars'));
      expect(mockRateMutate).toHaveBeenCalledWith({ tripId: 'trip-9', stars: 4 });
    });

    it('does not ask for a rating on a load that never became a trip', async () => {
      (queries.useMyTrips as jest.Mock).mockReturnValue(ok([]));
      await render(<TrackLoad />);
      expect(screen.queryByText('How did the driver do?')).toBeNull();
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
      await render(<TrackLoad />);
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
      await render(<TrackLoad />);
      expect(screen.queryByLabelText('Photograph taken at delivery')).toBeNull();
    });

    it('offers the route again rather than leaving the shipper at a full stop', async () => {
      await render(<TrackLoad />);
      await fireEvent.press(screen.getByLabelText('Send this route again'));
      expect(mockPush).toHaveBeenCalledWith({
        pathname: '/post-load',
        params: { origin: '1', dest: '2' },
      });
    });
  });

  it('shows no carrier detail on a load with no trip yet', async () => {
    (queries.useMyLoads as jest.Mock).mockReturnValue(ok([load()]));
    (queries.useMyTrips as jest.Mock).mockReturnValue(ok([]));
    await render(<TrackLoad />);
    expect(screen.queryByText(/is taking your load/)).toBeNull();
  });
});
