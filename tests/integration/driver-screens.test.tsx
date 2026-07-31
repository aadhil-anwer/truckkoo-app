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
  LOAD_ID,
  OFFER_ID,
  driverOffer,
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
import OffersTab from '@/app/(app)/(tabs)/offers';
import RoutesTab from '@/app/(app)/(tabs)/routes';
import * as queries from '@/lib/queries';
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
  status: 'open',
};

beforeEach(() => {
  resetQueries(queries as unknown as Record<string, unknown>);
});

const withOffer = () => {
  (queries.useMyOffers as jest.Mock).mockReturnValue(ok([offer]));
  (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
};

/** One composed offer, as `driver_offers()` returns it. */
const withDriverOffer = () => {
  (queries.useDriverOffers as jest.Mock).mockReturnValue(ok([driverOffer()]));
};

const withTrip = (status: Trip['status'] = 'assigned') => {
  (queries.useMyTrips as jest.Mock).mockReturnValue(ok([{ ...trip, status }]));
  (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
};

/* ─── D1 / D3 · the driver's home ────────────────────────────────────────── */

describe('DriverHome', () => {
  it('names the consequence, not the empty state', async () => {
    // "No offers yet" tells a driver nothing they can act on. The matching
    // engine is worth nothing until drivers declare legs, so the emptiest screen
    // in the app is the one that has to sell the habit hardest.
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
    await render(<DriverHome />);
    await fireEvent.press(screen.getByLabelText('Truck assigned'));
    expect(mockPush).toHaveBeenCalledWith('/trip/trip-1');
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
    (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
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
    await render(<OffersTab />);
    expect(screen.getByText('An empty book here means an empty truck.')).toBeTruthy();
  });

  it('does not show a driver any load they have no offer for', async () => {
    // Driver legs and shipper cargo are the crown jewels. There is no load board.
    (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
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

/* ─── routes ─────────────────────────────────────────────────────────────── */

describe('RoutesTab', () => {
  it('tells a driver with no routes what an empty book costs', async () => {
    await render(<RoutesTab />);
    expect(screen.getByText('No routes declared')).toBeTruthy();
  });

  it('lists declared routes with their load state', async () => {
    (queries.useMyLegs as jest.Mock).mockReturnValue(ok([leg]));
    await render(<RoutesTab />);
    expect(screen.getByText('EMPTY')).toBeTruthy();
  });

  it('keeps declaring a route reachable whether the list is empty or full', async () => {
    (queries.useMyLegs as jest.Mock).mockReturnValue(ok([leg]));
    await render(<RoutesTab />);
    await fireEvent.press(screen.getByLabelText('Add a trip you are making'));
    expect(mockPush).toHaveBeenCalledWith('/post-leg');
  });
});
