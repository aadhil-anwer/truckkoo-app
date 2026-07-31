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
  load,
  mockPush,
  mockRespondMutate,
  ok,
  resetQueries,
} from './harness';

import { render, screen, fireEvent } from '@testing-library/react-native';

import DriverHome from '@/app/(app)/(tabs)/driver';
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

const withTrip = (status: Trip['status'] = 'assigned') => {
  (queries.useMyTrips as jest.Mock).mockReturnValue(ok([{ ...trip, status }]));
  (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
};

/* ─── the trip ───────────────────────────────────────────────────────────── */

describe('DriverHome', () => {
  it('makes declaring a route the action when there is no trip', async () => {
    // The matching engine is worth nothing until drivers declare legs, so the
    // emptiest screen in the app is the one that has to sell the habit hardest.
    await render(<DriverHome />);
    expect(screen.getByText('No trip right now')).toBeTruthy();
    expect(screen.getByLabelText('Add a trip you are making')).toBeTruthy();
  });

  it('routes to post-leg from that action', async () => {
    await render(<DriverHome />);
    await fireEvent.press(screen.getByLabelText('Add a trip you are making'));
    expect(mockPush).toHaveBeenCalledWith('/post-leg');
  });

  it('shows the active trip with its one action', async () => {
    withTrip();
    await render(<DriverHome />);
    expect(screen.getByLabelText('I have collected it')).toBeTruthy();
  });

  it('switches the trip action once the load is collected', async () => {
    withTrip('in_transit');
    await render(<DriverHome />);
    expect(screen.getByLabelText('Mark delivered')).toBeTruthy();
  });

  it('routes both transitions to the trip screen, never firing a state change inline', async () => {
    // Delivery needs a photo, so neither transition may complete from here.
    withTrip();
    await render(<DriverHome />);
    await fireEvent.press(screen.getByLabelText('I have collected it'));
    expect(mockPush).toHaveBeenCalledWith('/trip/trip-1');
  });

  it('shows what the trip pays, in full OMR decimals', async () => {
    (queries.useMyTrips as jest.Mock).mockReturnValue(ok([trip]));
    (queries.useVisibleLoads as jest.Mock).mockReturnValue(
      ok([load({ price_baisa: 150000, currency: 'OMR' })]),
    );
    await render(<DriverHome />);
    expect(screen.getByText(/150\.000 OMR/)).toBeTruthy();
  });

  it('offers a retry when a query fails', async () => {
    (queries.useMyTrips as jest.Mock).mockReturnValue(FAILED);
    await render(<DriverHome />);
    expect(screen.getByText('We could not load that')).toBeTruthy();
  });
});

/* ─── offers ─────────────────────────────────────────────────────────────── */

describe('OffersTab', () => {
  it('tells a driver with no offers how to get some', async () => {
    await render(<OffersTab />);
    expect(screen.getByText('No offers yet')).toBeTruthy();
  });

  it('does not show a driver any load they have no offer for', async () => {
    // Driver legs and shipper cargo are the crown jewels. There is no load board.
    (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
    (queries.useMyOffers as jest.Mock).mockReturnValue(ok([]));
    await render(<OffersTab />);
    expect(screen.queryByText('Building materials')).toBeNull();
  });

  it('gives every pending offer its own card', async () => {
    (queries.useMyOffers as jest.Mock).mockReturnValue(
      ok([offer, { ...offer, id: 'off-2' }, { ...offer, id: 'off-3' }]),
    );
    (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load()]));
    await render(<OffersTab />);
    expect(screen.getAllByLabelText('Accept this load')).toHaveLength(3);
  });

  it('shows when an offer stops waiting', async () => {
    withOffer();
    await render(<OffersTab />);
    // The deadline rides in the chip's accessible name, since the visible text
    // is a formatted date the test should not pin.
    expect(screen.getByLabelText(/^Reply by:/)).toBeTruthy();
  });

  describe('the pay on an offer', () => {
    /**
     * REGRESSION. The offer sheet showed route, goods, dates and weight —
     * everything the driver already knew, because they declared the leg — and
     * withheld the one variable. `price_baisa` was fetched, held in `loadById`,
     * and never rendered.
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
      await render(<OffersTab />);

      expect(screen.getByText(/150\.000 OMR/)).toBeTruthy();
      expect(screen.getByText('You will be paid')).toBeTruthy();
    });

    it('never shows a blank where the pay goes', async () => {
      // No rate is the normal case until the card is loaded (OPEN_ISSUES 13). A
      // blank reads as "the app is broken"; this names who owns the next step.
      (queries.useMyOffers as jest.Mock).mockReturnValue(ok([offer]));
      (queries.useVisibleLoads as jest.Mock).mockReturnValue(ok([load({ price_baisa: null })]));
      await render(<OffersTab />);

      expect(screen.getByText(/confirm the rate with you before pickup/)).toBeTruthy();
    });
  });

  it('accepts an offer', async () => {
    withOffer();
    await render(<OffersTab />);

    await fireEvent.press(screen.getByLabelText('Accept this load'));
    expect(mockRespondMutate).toHaveBeenCalledWith(
      { offerId: 'off-1', accept: true },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('declines an offer', async () => {
    withOffer();
    await render(<OffersTab />);

    await fireEvent.press(screen.getByLabelText('Not this one'));
    expect(mockRespondMutate).toHaveBeenCalledWith(
      { offerId: 'off-1', accept: false },
      // Declining carries handlers: since 0013 a decline is what returns the
      // shipper's load to the dispatcher, so one that fails silently strands it.
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it('tells the driver when a decline failed, instead of nothing at all', async () => {
    withOffer();
    mockRespondMutate.mockImplementation((_vars, opts) => opts?.onError?.(new Error('boom')));
    await render(<OffersTab />);

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
    await render(<OffersTab />);

    await fireEvent.press(screen.getByLabelText('Accept this load'));
    expect(screen.getByText('Another driver took this load.')).toBeTruthy();
  });

  it('makes declining as easy to hit as accepting', async () => {
    // "No" on a 16pt target and "yes" on a 44pt one is a design that lies.
    withOffer();
    await render(<OffersTab />);

    const decline = screen.getByLabelText('Not this one');
    const raw = decline.props.style;
    const flat = Object.assign(
      {},
      ...(Array.isArray(raw) ? (raw as unknown[]).flat(Infinity) : [raw]).filter(Boolean),
    );
    expect(Number(flat.minHeight)).toBeGreaterThanOrEqual(44);
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
