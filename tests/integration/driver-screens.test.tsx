/**
 * The driver's three screens, end to end against mocked data.
 *
 * The driver home used to be one horizontal book holding the trip, the offers
 * and the routes. It is now three tabs, and these assertions moved with the
 * behaviour rather than being dropped: the accept race, the decline that must
 * not fail silently, the pay that must never render blank, and — most
 * importantly — that a driver is never shown a load nobody offered them.
 *
 * IMPORT ORDER MATTERS. `./harness` must be first: its `jest.mock` calls run at
 * require time, so anything imported before it would capture the real modules.
 */

import {
  FAILED,
  mockPostLegMutate,
  LOAD_ID,
  OFFER_ID,
  driverOffer,
  driverTrip,
  mockReporterArgs,
  tripPosition,
  load,
  mockParams,
  mockPush,
  mockRespondMutate,
  ok,
  resetQueries,
} from './harness';

import { render, screen, fireEvent } from '@testing-library/react-native';

import DriverHome from '@/app/(app)/(tabs)/driver';
import OfferDetail from '@/app/(app)/offer/[id]';
import LegRoute from '@/app/(app)/leg/route';
import LegWhen from '@/app/(app)/leg/when';
import TripDetail from '@/app/(app)/trip/[id]';
import OffersTab from '@/app/(app)/(tabs)/offers';
import PastTripsTab from '@/app/(app)/(tabs)/past';
import RoutesTab from '@/app/(app)/(tabs)/routes';
import * as features from '@/lib/features';
import * as queries from '@/lib/queries';
import { clearLegDraft } from '@/lib/leg-draft';
import { flat } from '../helpers/style';
import type { Leg, Offer, Trip } from '@/lib/queries';

const offer: Offer = {
  id: 'off-1',
  load_id: LOAD_ID,
  leg_id: null,
  status: 'pending',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
};

const trip: Trip = {
  id: 'trip-1',
  load_id: LOAD_ID,
  truck_id: null,
  driver_id: null,
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
  free_kg: null,
  status: 'open',
};

beforeEach(() => {
  resetQueries(queries as unknown as Record<string, unknown>);
  // The leg draft lives in module scope, so it survives between tests unless it
  // is cleared — a route chosen in one test would otherwise leak into the next.
  clearLegDraft();
});

/**
 * Turn the unreleased declared-trips feature on for one test. The screens read
 * the flag at render time, so the hidden path stays exercised while it is off.
 */
const withDeclaredTrips = () => {
  jest.replaceProperty(features, 'DECLARED_TRIPS', true);
};
afterEach(() => jest.restoreAllMocks());

/** One composed offer, as `driver_offers()` returns it. */
const withDriverOffer = () => {
  (queries.useDriverOffers as jest.Mock).mockReturnValue(ok([driverOffer()]));
};

/* ─── D1 / D3 · the driver's home ────────────────────────────────────────── */

describe('DriverHome', () => {
  it('names the consequence, not the empty state — once declared trips ship', async () => {
    // "No offers yet" tells a driver nothing they can act on. The matching
    // engine is worth nothing until drivers declare legs, so the emptiest screen
    // in the app is the one that has to sell the habit hardest. Hidden while
    // unreleased; tested with the flag on so it cannot rot while it waits.
    withDeclaredTrips();
    await render(<DriverHome />);
    expect(screen.getByText('An empty book here means an empty truck.')).toBeTruthy();
    expect(screen.getByLabelText('Add a trip you are making')).toBeTruthy();
  });

  it('leads with the payout, not the route', async () => {
    withDriverOffer();
    await render(<DriverHome />);
    expect(screen.getByText('78.000')).toBeTruthy();
  });

  it('states the detour up front, because it is the driver\u2019s cost', async () => {
    withDriverOffer();
    await render(<DriverHome />);
    expect(screen.getByText(/16 km/)).toBeTruthy();
  });

  it('says the detour is approximate, because it is', async () => {
    // Great-circle distance between city centres, on roads that are neither.
    withDriverOffer();
    await render(<DriverHome />);
    expect(screen.getByText(/^about /)).toBeTruthy();
  });

  it('carries the amount in the take button', async () => {
    withDriverOffer();
    await render(<DriverHome />);
    expect(screen.getByLabelText('Take it — 78.000 OMR')).toBeTruthy();
  });

  it('counts the offers in the greeting, in the right grammar for one', async () => {
    withDriverOffer();
    await render(<DriverHome />);
    expect(screen.getByText('1 load wants your truck')).toBeTruthy();
  });

  it('shows no earnings line before anything has been earned', async () => {
    // Rule #5: absent, never zeroed. "0.000 OMR this week" reads as failure.
    (queries.useDriverEarnings as jest.Mock).mockReturnValue(
      ok({ week_baisa: 0, week_trips: 0, all_time_trips: 0 }),
    );
    await render(<DriverHome />);
    expect(screen.queryByText(/this week/)).toBeNull();
  });

  it('shows the week once there is a week to show', async () => {
    (queries.useDriverEarnings as jest.Mock).mockReturnValue(
      ok({ week_baisa: 78000, week_trips: 1, all_time_trips: 1 }),
    );
    await render(<DriverHome />);
    expect(screen.getByText('78.000 OMR this week')).toBeTruthy();
  });

  it('keeps a delivery in progress one tap away', async () => {
    // There is no jobs tab: home / offers / routes / account. Without this a
    // driver mid-delivery has no route back to D7.
    (queries.useMyTrips as jest.Mock).mockReturnValue(ok([trip]));
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip()));
    await render(<DriverHome />);
    await fireEvent.press(screen.getByText('Open this job'));
    expect(mockPush).toHaveBeenCalledWith('/trip/trip-1');
  });

  it('lets a taken load take over home, and leaves the offers on their tab', async () => {
    // Asked for after the first device run: with a job accepted, home showed the
    // job as a small row and every other offer underneath it at full size.
    withDriverOffer();
    (queries.useMyTrips as jest.Mock).mockReturnValue(ok([trip]));
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip()));
    await render(<DriverHome />);

    expect(screen.getByText('Your job')).toBeTruthy();
    expect(screen.getByText('Muscat')).toBeTruthy();
    expect(screen.getByText('Salalah')).toBeTruthy();
    expect(screen.getByText('78.000')).toBeTruthy();
    // No offer card, and no second accent action competing with the job's.
    expect(screen.queryByLabelText('Take it — 78.000 OMR')).toBeNull();
    expect(screen.queryByText('Add a trip you are making')).toBeNull();
  });

  it('leads with the newest job and keeps a way back to any other', async () => {
    const older: Trip = { ...trip, id: 'trip-0', status: 'in_transit' };
    // useMyTrips orders newest first, as the query does.
    (queries.useMyTrips as jest.Mock).mockReturnValue(ok([trip, older]));
    (queries.useDriverTrip as jest.Mock).mockImplementation((id?: string) =>
      ok(id === 'trip-1' ? driverTrip() : null),
    );
    await render(<DriverHome />);

    expect(queries.useDriverTrip).toHaveBeenCalledWith('trip-1');
    await fireEvent.press(screen.getByLabelText('On the road'));
    expect(mockPush).toHaveBeenCalledWith('/trip/trip-0');
  });

  it('shows the offers again once there is no job', async () => {
    withDriverOffer();
    await render(<DriverHome />);
    expect(screen.getByLabelText('Take it — 78.000 OMR')).toBeTruthy();
    expect(screen.queryByText('Open this job')).toBeNull();
  });

  it('does not sell declaring trips while that feature is unreleased', async () => {
    // DECLARED_TRIPS is off (src/lib/features.ts): no way into the leg flow from
    // home, and an empty state that says what happens instead of asking for legs.
    await render(<DriverHome />);
    expect(screen.queryByText('Add a trip you are making')).toBeNull();
    expect(screen.queryByText('An empty book here means an empty truck.')).toBeNull();
    expect(screen.getByText('No loads for you yet')).toBeTruthy();
  });

  it('opens the offer in full rather than deciding on a card alone', async () => {
    withDriverOffer();
    await render(<DriverHome />);
    await fireEvent.press(screen.getByLabelText('See details'));
    expect(mockPush).toHaveBeenCalledWith(`/offer/${OFFER_ID}`);
  });

  it('takes an offer through the RPC, never by setting a status', async () => {
    withDriverOffer();
    await render(<DriverHome />);
    await fireEvent.press(screen.getByLabelText('Take it — 78.000 OMR'));
    expect(mockRespondMutate).toHaveBeenCalledWith(
      { offerId: OFFER_ID, accept: true },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('makes passing as easy to hit as taking', async () => {
    // "No" on a 16pt target and "yes" on a 44pt one is a design that lies.
    withDriverOffer();
    await render(<DriverHome />);
    await fireEvent.press(screen.getByLabelText('Pass'));
    expect(mockRespondMutate).toHaveBeenCalledWith(
      { offerId: OFFER_ID, accept: false },
      // Declining carries handlers: since 0013 a decline is what returns the
      // shipper's load to the dispatcher, so one that fails silently strands it.
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('says another driver took the load, rather than blaming the app', async () => {
    withDriverOffer();
    mockRespondMutate.mockImplementation((_vars, opts) =>
      opts?.onError?.(new Error('load already assigned')),
    );
    await render(<DriverHome />);
    await fireEvent.press(screen.getByLabelText('Take it — 78.000 OMR'));
    expect(screen.getByText('Another driver took this load.')).toBeTruthy();
  });

  it('offers a retry when a query fails', async () => {
    (queries.useDriverOffers as jest.Mock).mockReturnValue(FAILED);
    await render(<DriverHome />);
    expect(screen.getByText('We could not load that')).toBeTruthy();
  });

  it('never renders a load nobody offered them', async () => {
    // Drivers do not browse a load board. There is no path from this screen to a
    // load that is not in `driver_offers()`, and RLS is what makes that true.
    (queries.useDriverOffers as jest.Mock).mockReturnValue(ok([]));
    await render(<DriverHome />);
    expect(screen.queryByText('Building materials')).toBeNull();
  });
});

/* ─── D2 · the offer in full ─────────────────────────────────────────────── */

describe('OfferDetail', () => {
  beforeEach(() => {
    mockParams.current = { id: OFFER_ID };
  });

  it('draws the detour as a dashed spur, not a committed line', async () => {
    (queries.useDriverOffer as jest.Mock).mockReturnValue(ok(driverOffer()));
    (queries.useMyLegs as jest.Mock).mockReturnValue(ok([leg]));
    const { getByTestId } = await render(<OfferDetail />);
    expect(getByTestId('detour-spur').props.strokeDasharray).toBeTruthy();
  });

  it('says what room is left, so a second load is a decision not a guess', async () => {
    (queries.useDriverOffer as jest.Mock).mockReturnValue(ok(driverOffer()));
    await render(<OfferDetail />);
    expect(screen.getByText(/2,000 kg/)).toBeTruthy();
  });

  it('says nothing about remaining room when capacity is unknown', async () => {
    (queries.useDriverOffer as jest.Mock).mockReturnValue(
      ok(driverOffer({ free_after_kg: null })),
    );
    await render(<OfferDetail />);
    expect(screen.queryByText(/free after/)).toBeNull();
  });

  it('tells a driver plainly when the offer has already gone', async () => {
    // The common case, not an error: offers expire in 48 hours and another
    // driver may have taken it.
    (queries.useDriverOffer as jest.Mock).mockReturnValue(ok(null));
    await render(<OfferDetail />);
    expect(screen.getByText('That offer has gone')).toBeTruthy();
  });

  it('takes the offer through respond_to_offer, by offer id', async () => {
    (queries.useDriverOffer as jest.Mock).mockReturnValue(ok(driverOffer()));
    await render(<OfferDetail />);
    await fireEvent.press(screen.getByLabelText('Take it — 78.000 OMR'));
    expect(mockRespondMutate).toHaveBeenCalledWith(
      { offerId: OFFER_ID, accept: true },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });
});

/* ─── the offers tab ─────────────────────────────────────────────────────── */

describe('OffersTab', () => {
  it('makes the same argument as D3 when there is nothing to answer', async () => {
    withDeclaredTrips();
    await render(<OffersTab />);
    expect(screen.getByText('An empty book here means an empty truck.')).toBeTruthy();
  });

  it('says what happens instead while declared trips are unreleased', async () => {
    await render(<OffersTab />);
    expect(screen.getByText('No loads for you yet')).toBeTruthy();
  });

  it('does not show a driver any load they have no offer for', async () => {
    // Driver legs and shipper cargo are the crown jewels. There is no load board.
    (queries.useDriverOffers as jest.Mock).mockReturnValue(ok([]));
    await render(<OffersTab />);
    expect(screen.queryByText('Building materials')).toBeNull();
  });

  it('gives every offer its own card, each carrying its own amount', async () => {
    (queries.useDriverOffers as jest.Mock).mockReturnValue(
      ok([
        driverOffer(),
        driverOffer({ offer_id: 'off-2' }),
        driverOffer({ offer_id: 'off-3' }),
      ]),
    );
    await render(<OffersTab />);
    expect(screen.getAllByLabelText('Take it — 78.000 OMR')).toHaveLength(3);
  });

  it('tells the driver when a decline failed, instead of nothing at all', async () => {
    (queries.useDriverOffers as jest.Mock).mockReturnValue(ok([driverOffer()]));
    mockRespondMutate.mockImplementation((_vars, opts) => opts?.onError?.(new Error('boom')));
    await render(<OffersTab />);

    await fireEvent.press(screen.getByLabelText('Pass'));
    expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy();
  });
});

/* ─── D4 / D5 · declaring a route ────────────────────────────────────────── */

describe('DeclareRoute', () => {
  it('asks the driver\u2019s question, not the shipper\u2019s', async () => {
    // The booking flow asks where the cargo is. This asks where the truck goes.
    await render(<LegRoute />);
    expect(screen.getByText('Where are you driving?')).toBeTruthy();
  });

  it('says what answering buys, because declaring a leg has no obvious payoff', async () => {
    await render(<LegRoute />);
    expect(screen.getByText('We only send you loads that sit on this line.')).toBeTruthy();
  });

  it('suggests only corridors the driver has actually driven', async () => {
    // Never a fabricated suggestion: the list is their own declared legs.
    (queries.useMyLegs as jest.Mock).mockReturnValue(ok([leg]));
    await render(<LegRoute />);
    expect(screen.getByText('YOU DRIVE THESE OFTEN')).toBeTruthy();
    expect(screen.getByText('Muscat → Salalah')).toBeTruthy();
  });

  it('suggests nothing at all to a driver with no history', async () => {
    await render(<LegRoute />);
    expect(screen.queryByText('YOU DRIVE THESE OFTEN')).toBeNull();
  });

  it('offers a part-loaded truck a way to say how much room is left', async () => {
    await render(<LegWhen />);
    expect(screen.getByText('Part loaded — some space left')).toBeTruthy();
  });

  it('lets a driver skip the amount, because NULL is a real answer', async () => {
    // Same affordance as loads.truck_type_code: not answering must stay possible.
    await render(<LegWhen />);
    await fireEvent.press(screen.getByLabelText('Part loaded — some space left. Tell us roughly how much'));
    await fireEvent.press(screen.getByText('Today'));
    expect(screen.getByLabelText('Add this route')).toBeTruthy();
  });

  it('asks for the room only once the truck is not empty', async () => {
    await render(<LegWhen />);
    expect(screen.queryByLabelText('Tell us roughly how much')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Part loaded — some space left. Tell us roughly how much'));
    expect(screen.getByLabelText('Tell us roughly how much')).toBeTruthy();
  });

  it('posts the leg through post_leg, carrying the room it was told about', async () => {
    await render(<LegWhen />);
    await fireEvent.press(screen.getByText('Today'));
    await fireEvent.press(screen.getByLabelText('Part loaded — some space left. Tell us roughly how much'));
    await fireEvent.changeText(screen.getByLabelText('Tell us roughly how much'), '4000');
    await fireEvent.press(screen.getByLabelText('Add this route'));

    expect(mockPostLegMutate).toHaveBeenCalledWith(
      expect.objectContaining({ isEmpty: false, freeKg: 4000 }),
    );
  });

  it('sends no number at all for an empty truck', async () => {
    // is_empty and a free_kg are two contradictory answers to one question.
    await render(<LegWhen />);
    await fireEvent.press(screen.getByText('Today'));
    await fireEvent.press(screen.getByLabelText('Add this route'));

    expect(mockPostLegMutate).toHaveBeenCalledWith(
      expect.objectContaining({ isEmpty: true, freeKg: null }),
    );
  });
});

/* ─── D6 · the routes ────────────────────────────────────────────────────── */

describe('RoutesTab', () => {
  it('tells a driver with no routes what an empty book costs', async () => {
    await render(<RoutesTab />);
    expect(screen.getByText('An empty book here means an empty truck.')).toBeTruthy();
  });

  it('marks an empty truck as the live, actionable state', async () => {
    (queries.useMyLegs as jest.Mock).mockReturnValue(ok([leg]));
    await render(<RoutesTab />);
    expect(screen.getByText('EMPTY')).toBeTruthy();
  });

  it('says why an empty route costs the driver money', async () => {
    (queries.useMyLegs as jest.Mock).mockReturnValue(ok([leg]));
    await render(<RoutesTab />);
    expect(screen.getByText(/a truck running for nothing/)).toBeTruthy();
  });

  it('states the room left only when the driver actually said', async () => {
    (queries.useMyLegs as jest.Mock).mockReturnValue(
      ok([{ ...leg, is_empty: false, free_kg: null }]),
    );
    await render(<RoutesTab />);
    expect(screen.getByText('PART LOADED')).toBeTruthy();
    expect(screen.queryByText(/free after/)).toBeNull();
  });

  it('shows it when they did', async () => {
    (queries.useMyLegs as jest.Mock).mockReturnValue(
      ok([{ ...leg, is_empty: false, free_kg: 4000 }]),
    );
    await render(<RoutesTab />);
    expect(screen.getByText(/4,000 kg free after this load/)).toBeTruthy();
  });

  it('keeps declaring a route reachable whether the list is empty or full', async () => {
    (queries.useMyLegs as jest.Mock).mockReturnValue(ok([leg]));
    await render(<RoutesTab />);
    await fireEvent.press(screen.getByLabelText('Add a trip you are making'));
    expect(mockPush).toHaveBeenCalledWith('/leg/route');
  });
});

/* ─── Past trips ─────────────────────────────────────────────────────────── */

const pastTrip = (over: Partial<queries.PastTrip> = {}): queries.PastTrip => ({
  trip_id: 'trip-9',
  origin_city: 1,
  dest_city: 2,
  goods: 'Fresh produce crates',
  weight_kg: 5000,
  payout_baisa: 45000,
  currency: 'OMR',
  // 22:30 UTC on the 18th is 02:30 on the 19th in Muscat.
  delivered_at: '2026-09-18T22:30:00Z',
  ...over,
});

describe('PastTrips', () => {
  it('leads with the month, as the database totalled it', async () => {
    (queries.useDriverEarnings as jest.Mock).mockReturnValue(
      ok({ week_baisa: 0, week_trips: 0, all_time_trips: 2, month_baisa: 230000, month_trips: 2 }),
    );
    (queries.useDriverPastTrips as jest.Mock).mockReturnValue(ok([pastTrip()]));
    await render(<PastTripsTab />);
    expect(screen.getByText('THIS MONTH')).toBeTruthy();
    // The screen shows the SQL total, not a sum of the rows it happens to have.
    expect(screen.getByText('230.000 OMR · 2 trips')).toBeTruthy();
  });

  it('says one trip, not one trips', async () => {
    (queries.useDriverEarnings as jest.Mock).mockReturnValue(
      ok({ week_baisa: 0, week_trips: 0, all_time_trips: 1, month_baisa: 45000, month_trips: 1 }),
    );
    await render(<PastTripsTab />);
    expect(screen.getByText('45.000 OMR · 1 trip')).toBeTruthy();
  });

  it('shows no month line before anything was delivered this month', async () => {
    (queries.useDriverEarnings as jest.Mock).mockReturnValue(
      ok({ week_baisa: 0, week_trips: 0, all_time_trips: 3, month_baisa: 0, month_trips: 0 }),
    );
    await render(<PastTripsTab />);
    expect(screen.queryByText('THIS MONTH')).toBeNull();
  });

  it('lists each trip with its route, its day in Oman, and what it paid', async () => {
    (queries.useDriverPastTrips as jest.Mock).mockReturnValue(ok([pastTrip()]));
    await render(<PastTripsTab />);
    expect(screen.getByText('Muscat')).toBeTruthy();
    expect(screen.getByText('Salalah')).toBeTruthy();
    expect(screen.getByText('45.000 OMR')).toBeTruthy();
    // The 19th, because that is the day it was in Muscat — not the 18th of UTC.
    expect(screen.getByText('Sep 19 · Fresh produce crates')).toBeTruthy();
  });

  it('opens the finished job when a row is tapped', async () => {
    (queries.useDriverPastTrips as jest.Mock).mockReturnValue(ok([pastTrip()]));
    await render(<PastTripsTab />);
    await fireEvent.press(
      screen.getByLabelText('Muscat to Salalah, delivered Sep 19, 45.000 OMR'),
    );
    expect(mockPush).toHaveBeenCalledWith('/trip/trip-9');
  });

  it('shows no amount rather than a wrong one when the price is missing', async () => {
    (queries.useDriverPastTrips as jest.Mock).mockReturnValue(
      ok([pastTrip({ payout_baisa: null })]),
    );
    await render(<PastTripsTab />);
    expect(screen.queryByText(/OMR/)).toBeNull();
  });

  it('says plainly when there is nothing yet', async () => {
    await render(<PastTripsTab />);
    expect(screen.getByText('No trips yet')).toBeTruthy();
  });

  it('offers a retry when the history fails to load', async () => {
    (queries.useDriverPastTrips as jest.Mock).mockReturnValue(FAILED);
    await render(<PastTripsTab />);
    expect(screen.getByLabelText(/try again|error/i)).toBeTruthy();
  });
});

/* ─── D7 · on the job ────────────────────────────────────────────────────── */

describe('OnTheJob', () => {
  beforeEach(() => {
    mockParams.current = { id: 'trip-1' };
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip()));
  });

  it('is a record once delivered — nothing left to press', async () => {
    // Opened from Past trips. It used to offer "Yes, it is loaded" on a
    // delivered load, a button the server could only refuse.
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip({ status: 'delivered' })));
    await render(<TripDetail />);
    expect(screen.getByText('DELIVERED')).toBeTruthy();
    expect(screen.getByText('78.000')).toBeTruthy();
    expect(screen.queryByText('Yes, it is loaded')).toBeNull();
    expect(screen.queryByLabelText('I have delivered it')).toBeNull();
    expect(screen.queryByLabelText('Take a photo')).toBeNull();
  });

  it('shows what the driver earns beside where it drops', async () => {
    await render(<TripDetail />);
    expect(screen.getByText('YOU EARN')).toBeTruthy();
    expect(screen.getByText('DROP AT')).toBeTruthy();
    expect(screen.getByText('Salalah')).toBeTruthy();
  });

  it('earns the payout, not the shipper\u2019s price', async () => {
    // The commission is applied in SQL. A screen showing 96.000 here would be
    // telling the driver they keep the margin.
    await render(<TripDetail />);
    expect(screen.getByText('78.000')).toBeTruthy();
  });

  it('gives delivery one large target, for a thumb in a truck cab', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(
      ok(driverTrip({ status: 'in_transit' })),
    );
    await render(<TripDetail />);
    const btn = screen.getByLabelText('I have delivered it');
    expect(flat(btn.props.style).minHeight).toBe(64);
  });

  it('will not deliver without a photo, because the database will not either', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(
      ok(driverTrip({ status: 'in_transit' })),
    );
    await render(<TripDetail />);
    await fireEvent.press(screen.getByLabelText('I have delivered it'));
    expect(
      screen.getByText('A photo is required before you can mark this delivered.'),
    ).toBeTruthy();
  });

  it('tells the driver their position is being shared, while it is', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(
      ok(driverTrip({ status: 'in_transit' })),
    );
    await render(<TripDetail />);
    expect(screen.getByText('Sharing your position with the shipper')).toBeTruthy();
    expect(screen.getByText('Only while you are carrying this load.')).toBeTruthy();
  });

  it('says nothing about sharing before the load is collected', async () => {
    // Nothing is sent on an `assigned` trip — report_position refuses it — so a
    // line claiming otherwise would be false.
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip()));
    await render(<TripDetail />);
    expect(screen.queryByText('Sharing your position with the shipper')).toBeNull();
  });

  it('reports only while the trip is live', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(driverTrip()));
    await render(<TripDetail />);
    // usePositionReporter(tripId, active)
    expect(mockReporterArgs[1]).toBe(false);
  });

  it('draws its own last reported position, never a guess', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(
      ok(driverTrip({ status: 'in_transit' })),
    );
    (queries.useTripPosition as jest.Mock).mockReturnValue(ok(tripPosition()));
    const { getByTestId } = await render(<TripDetail />);
    expect(getByTestId('truck-marker')).toBeTruthy();
  });

  it('draws no truck at all when nothing has been reported', async () => {
    (queries.useDriverTrip as jest.Mock).mockReturnValue(
      ok(driverTrip({ status: 'in_transit' })),
    );
    (queries.useTripPosition as jest.Mock).mockReturnValue(ok(null));
    const { queryByTestId } = await render(<TripDetail />);
    expect(queryByTestId('truck-marker')).toBeNull();
  });

  it('reads nothing for a trip that is not theirs, and says so plainly', async () => {
    // Not found and not-yours are the same answer: `driver_trip` is scoped to
    // the caller inside the definer.
    (queries.useDriverTrip as jest.Mock).mockReturnValue(ok(null));
    await render(<TripDetail />);
    expect(screen.getByText('We could not load that')).toBeTruthy();
  });
});
