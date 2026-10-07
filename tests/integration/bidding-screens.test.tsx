/**
 * Driver bidding (0045), on screen.
 *
 * What is guarded:
 * - a bid load taking prices never reads as "truck found" or "truck confirming";
 * - the shipper chooses one price and accepts it with the amount in the button,
 *   and only totals reach the shipper — never a driver's share;
 * - a stale price is said plainly, not as a broken screen;
 * - the driver sees competing prices as numbered drivers, never names, and the
 *   amounts are what each driver keeps;
 * - the driver's price is typed as rial on any keyboard and sent as baisa;
 * - the shipper's limit is optional, and skipping it clears it.
 *
 * IMPORT ORDER MATTERS: `./harness` first (see driver-screens.test.tsx).
 */
import {
  LOAD_ID,
  OFFER_ID,
  bidInvite,
  load,
  mockAcceptBidMutate,
  mockBack,
  mockParams,
  mockPlaceBidMutate,
  mockPush,
  mockRespondMutate,
  ok,
  resetQueries,
  shipperBid,
} from './harness';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import BidDetail from '@/app/(app)/bid/[id]';
import BidPrice from '@/app/(app)/bid/price';
import Target from '@/app/(app)/book/target';
import LoadsTab from '@/app/(app)/(tabs)/loads';
import OffersTab from '@/app/(app)/(tabs)/offers';
import TrackLoad from '@/app/(app)/load/[id]';
import { initLanguage } from '@/i18n';
import * as queries from '@/lib/queries';

const mockUpdate = jest.fn();
const mockDraft = { current: { targetTotalBaisa: null } as Record<string, unknown> };

jest.mock('@/lib/booking', () => {
  const actual = jest.requireActual('@/lib/booking');
  return {
    ...actual,
    useBookingDraft: () => ({ draft: mockDraft.current, update: mockUpdate, ready: true }),
  };
});

const m = (name: string) => (queries as unknown as Record<string, jest.Mock>)[name];

const bidLoad = (over: Record<string, unknown> = {}) =>
  load({
    pricing_mode: 'bid',
    status: 'matched',
    price_baisa: null,
    bid_deadline: new Date(Date.now() + 40 * 60_000).toISOString(),
    ...over,
  });

beforeEach(() => {
  initLanguage('en');
  resetQueries(queries as unknown as Record<string, unknown>);
  mockUpdate.mockReset();
  mockDraft.current = { targetTotalBaisa: null };
});

/* ─── the shipper ────────────────────────────────────────────────────────── */

describe('TrackLoad — a bid load taking prices', () => {
  beforeEach(() => {
    mockParams.current = { id: LOAD_ID };
  });

  it('narrates the wait for the first price, and never says a truck was found', async () => {
    m('useMyLoads').mockReturnValue(ok([bidLoad()]));
    await render(<TrackLoad />);
    expect(screen.getByText('TAKING PRICES')).toBeTruthy();
    expect(screen.getByText(/Their prices will appear here/)).toBeTruthy();
    expect(screen.getByText(/Prices close in \d+ min/)).toBeTruthy();
    // `matched` on a bid load is offers out, not a driver saying yes.
    expect(screen.queryByText(/confirming/i)).toBeNull();
    // Nothing to accept yet, so no accept button — the human stays reachable.
    expect(screen.queryByLabelText(/^Accept/)).toBeNull();
    expect(screen.getByLabelText('WhatsApp us')).toBeTruthy();
  });

  it('offers the cheapest price first, with the amount in the button', async () => {
    m('useMyLoads').mockReturnValue(ok([bidLoad()]));
    m('useShipperLoadBids').mockReturnValue(
      ok([
        shipperBid({ bid_id: 'cheap', total_baisa: 99000, driver_name: 'Salim' }),
        shipperBid({ bid_id: 'dear', total_baisa: 110000, driver_name: 'Hamad' }),
      ]),
    );
    await render(<TrackLoad />);
    expect(screen.getByLabelText('99.000 OMR. Salim · 10-ton truck')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Accept 99.000 OMR'));
    expect(mockAcceptBidMutate).toHaveBeenCalledTimes(1);
    expect(mockAcceptBidMutate.mock.calls[0][0]).toEqual({ loadId: LOAD_ID, bidId: 'cheap' });
  });

  it('accepts whichever price the shipper picks', async () => {
    m('useMyLoads').mockReturnValue(ok([bidLoad()]));
    m('useShipperLoadBids').mockReturnValue(
      ok([
        shipperBid({ bid_id: 'cheap', total_baisa: 99000, driver_name: 'Salim' }),
        shipperBid({ bid_id: 'dear', total_baisa: 110000, driver_name: 'Hamad' }),
      ]),
    );
    await render(<TrackLoad />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('110.000 OMR. Hamad · 10-ton truck'));
    });
    fireEvent.press(screen.getByLabelText('Accept 110.000 OMR'));
    expect(mockAcceptBidMutate.mock.calls[0][0]).toEqual({ loadId: LOAD_ID, bidId: 'dear' });
  });

  it('leaves out a price that has gone, rather than offering it', async () => {
    m('useMyLoads').mockReturnValue(ok([bidLoad()]));
    m('useShipperLoadBids').mockReturnValue(
      ok([
        shipperBid({ bid_id: 'gone', total_baisa: 90000, driver_name: 'Offline', eligible: false }),
        shipperBid({ bid_id: 'live', total_baisa: 99000, driver_name: 'Salim' }),
      ]),
    );
    await render(<TrackLoad />);
    expect(screen.queryByText('90.000 OMR')).toBeNull();
    expect(screen.getByLabelText('Accept 99.000 OMR')).toBeTruthy();
  });

  it('says a price went stale in plain words', async () => {
    m('useMyLoads').mockReturnValue(ok([bidLoad()]));
    m('useShipperLoadBids').mockReturnValue(ok([shipperBid()]));
    mockAcceptBidMutate.mockImplementation((_v, opts) =>
      opts.onError(new Error('bid no longer available')),
    );
    await render(<TrackLoad />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Accept 110.000 OMR'));
    });
    expect(screen.getByText('That price is no longer available. Choose another.')).toBeTruthy();
  });

  it('shows the shipper their own limit', async () => {
    m('useMyLoads').mockReturnValue(ok([bidLoad()]));
    m('useShipperBidStatus').mockReturnValue(
      ok({
        bid_deadline: new Date(Date.now() + 40 * 60_000).toISOString(),
        target_total_baisa: 120000,
        selected_bid_id: null,
        selected_total_baisa: null,
        bid_count: 0,
      }),
    );
    await render(<TrackLoad />);
    expect(screen.getByText(/Your limit is 120\.000 OMR/)).toBeTruthy();
  });

  it('puts the proposal up as the price once prices close', async () => {
    m('useMyLoads').mockReturnValue(ok([bidLoad({ status: 'quoted' })]));
    m('useShipperLoadBids').mockReturnValue(
      ok([
        shipperBid({ bid_id: 'a', total_baisa: 99000, driver_name: 'Salim' }),
        shipperBid({ bid_id: 'b', total_baisa: 104500, driver_name: 'Hamad', selected: true }),
      ]),
    );
    m('useShipperBidStatus').mockReturnValue(
      ok({
        bid_deadline: new Date(Date.now() - 60_000).toISOString(),
        target_total_baisa: null,
        selected_bid_id: 'b',
        selected_total_baisa: 104500,
        bid_count: 2,
      }),
    );
    await render(<TrackLoad />);
    expect(screen.getByText('BEST PRICE')).toBeTruthy();
    expect(screen.getByText('From Hamad')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Accept 104.500 OMR'));
    expect(mockAcceptBidMutate.mock.calls[0][0]).toEqual({ loadId: LOAD_ID, bidId: 'b' });
    // Not the fixed-price T2: there is no quote to accept.
    expect(m('useAcceptQuote')().mutate).not.toHaveBeenCalled();
  });
});

describe('Loads tab — a bid load', () => {
  it('reads "Taking prices", not "Truck found"', async () => {
    m('useMyLoads').mockReturnValue(ok([bidLoad()]));
    await render(<LoadsTab />);
    expect(screen.getByText('TAKING PRICES')).toBeTruthy();
    expect(screen.queryByText('TRUCK FOUND')).toBeNull();
  });
});

/* ─── the driver ─────────────────────────────────────────────────────────── */

describe('Offers tab — invitations to name a price', () => {
  it('shows the invitation and opens it by offer id', async () => {
    m('useDriverBidInvites').mockReturnValue(ok([bidInvite()]));
    await render(<OffersTab />);
    expect(screen.getByText('NAME YOUR PRICE')).toBeTruthy();
    expect(screen.getByText('You have not named a price yet')).toBeTruthy();
    expect(screen.queryByText(/Nothing yet|No offers/)).toBeNull();
    fireEvent.press(screen.getByLabelText('Name your price'));
    expect(mockPush).toHaveBeenCalledWith(`/bid/${OFFER_ID}`);
  });

  it('shows the price already sent', async () => {
    m('useDriverBidInvites').mockReturnValue(ok([bidInvite({ own_bid_baisa: 95000 })]));
    await render(<OffersTab />);
    expect(screen.getByText('Your price: 95.000 OMR')).toBeTruthy();
    expect(screen.getByLabelText('Change your price')).toBeTruthy();
  });
});

describe('BidDetail — the other prices, semi-anonymised', () => {
  beforeEach(() => {
    mockParams.current = { id: OFFER_ID };
    m('useDriverBidInvite').mockReturnValue(ok(bidInvite({ own_bid_baisa: 95000 })));
  });

  it('shows each competing price as a numbered driver, and yours as you', async () => {
    m('useDriverLoadBids').mockReturnValue(
      ok([
        { bidder_no: 2, truck_type: '10t', payout_baisa: 90000, updated_at: '', is_you: false },
        { bidder_no: 1, truck_type: '10t', payout_baisa: 95000, updated_at: '', is_you: true },
      ]),
    );
    await render(<BidDetail />);
    expect(screen.getByText('Driver 2 · 10-ton truck')).toBeTruthy();
    expect(screen.getByText('You · 10-ton truck')).toBeTruthy();
    expect(screen.getByText('90.000 OMR')).toBeTruthy();
    expect(screen.getByText(/Names are never shown/)).toBeTruthy();
  });

  it('says so when nobody else has named a price', async () => {
    await render(<BidDetail />);
    expect(screen.getByText('No other prices yet.')).toBeTruthy();
  });

  it('asks for the amount on its own screen', async () => {
    await render(<BidDetail />);
    fireEvent.press(screen.getByLabelText('Change your price'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/bid/price', params: { offer: OFFER_ID } });
  });

  it('lets the driver pass, through the same decline as an offer', async () => {
    await render(<BidDetail />);
    fireEvent.press(screen.getByLabelText('Pass'));
    expect(mockRespondMutate.mock.calls[0][0]).toEqual({ offerId: OFFER_ID, accept: false });
  });

  it('says plainly when prices have closed', async () => {
    m('useDriverBidInvite').mockReturnValue(ok(null));
    await render(<BidDetail />);
    expect(screen.getByText('Prices on this load have closed.')).toBeTruthy();
  });
});

describe('BidPrice — what the driver keeps', () => {
  beforeEach(() => {
    mockParams.current = { offer: OFFER_ID };
    m('useDriverBidInvite').mockReturnValue(ok(bidInvite()));
  });

  it('sends a typed amount as baisa, with the amount in the button', async () => {
    await render(<BidPrice />);
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('How much do you want for this trip?'), '95.5');
    });
    fireEvent.press(screen.getByLabelText('Send 95.500 OMR'));
    expect(mockPlaceBidMutate.mock.calls[0][0]).toEqual({ offerId: OFFER_ID, payoutBaisa: 95500 });
  });

  it('reads what an Arabic keyboard types', async () => {
    await render(<BidPrice />);
    await act(async () => {
      // ٩٥٫٥ — Arabic-Indic digits and the Arabic decimal mark.
      fireEvent.changeText(
        screen.getByLabelText('How much do you want for this trip?'),
        '٩٥٫٥',
      );
    });
    fireEvent.press(screen.getByLabelText('Send 95.500 OMR'));
    expect(mockPlaceBidMutate.mock.calls[0][0]).toEqual({ offerId: OFFER_ID, payoutBaisa: 95500 });
  });

  it('refuses something that is not an amount, and says what to type', async () => {
    await render(<BidPrice />);
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('How much do you want for this trip?'), '12,,5');
    });
    expect(screen.getByText('Type an amount like 120 or 120.500.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Send my price'));
    expect(mockPlaceBidMutate).not.toHaveBeenCalled();
  });

  it('shows the lowest price so far', async () => {
    m('useDriverLoadBids').mockReturnValue(
      ok([{ bidder_no: 1, truck_type: '10t', payout_baisa: 88000, updated_at: '', is_you: false }]),
    );
    await render(<BidPrice />);
    expect(screen.getByText('Lowest so far: 88.000 OMR')).toBeTruthy();
  });

  it('says prices have closed when the server says so', async () => {
    mockPlaceBidMutate.mockImplementation((_v, opts) => opts.onError(new Error('bidding closed')));
    await render(<BidPrice />);
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('How much do you want for this trip?'), '90');
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send 90.000 OMR'));
    });
    expect(screen.getByText('Prices on this load have closed.')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('goes back to the load once the price is in', async () => {
    mockPlaceBidMutate.mockImplementation((_v, opts) => opts.onSuccess());
    await render(<BidPrice />);
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('How much do you want for this trip?'), '90');
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send 90.000 OMR'));
    });
    expect(mockBack).toHaveBeenCalled();
  });
});

/* ─── the shipper's limit, while booking ─────────────────────────────────── */

describe('Target — the most the shipper will pay', () => {
  it('stores a typed limit as baisa', async () => {
    await render(<Target />);
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('What is the most you want to pay?'), '120.5');
    });
    expect(mockUpdate).toHaveBeenLastCalledWith({ targetTotalBaisa: 120500 });
  });

  it('treats skipping as no limit, clearing anything half-typed', async () => {
    mockDraft.current = { targetTotalBaisa: 90000 };
    await render(<Target />);
    fireEvent.press(screen.getByLabelText('Skip — I will choose from the prices'));
    expect(mockUpdate).toHaveBeenLastCalledWith({ targetTotalBaisa: null });
    expect(mockPush).toHaveBeenCalledWith('/book/review');
  });

  it('does not go on with something that is not an amount', async () => {
    await render(<Target />);
    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('What is the most you want to pay?'), 'abc');
    });
    expect(screen.getByText('Type an amount like 120 or 120.500.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('See the summary'));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
