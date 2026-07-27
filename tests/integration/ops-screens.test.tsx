/**
 * The dispatcher's two screens, against mocked data.
 *
 * These had no coverage at all, and 0012 made this the most complex surface in
 * the app: three candidate tiers that mean three different things, rows that may
 * or may not have a leg, and a re-send path that exists precisely because an
 * automated one is forbidden it.
 *
 * What matters here is that a dispatcher can tell the tiers apart. A driver who
 * declared an empty run on this exact route and a driver who once drove the
 * corridor are not the same offer, and a list that renders them identically
 * invites the operator to treat them identically.
 *
 * Harness mirrors `home-screens.test.tsx`; the safe-area mock and the `mock`
 * prefix on hoisted variables are load-bearing there for reasons documented in
 * that file.
 */

import { render, screen, fireEvent } from '@testing-library/react-native';

import OpsLoad from '@/app/(app)/ops/[id]';
import OpsQueueScreen from '@/app/(app)/ops/index';
import type { City, OpsCandidate, OpsQueueRow, TruckType } from '@/lib/queries';

/* ─── harness ────────────────────────────────────────────────────────────── */

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

const mockPush = jest.fn();
const mockSendOfferAsync = jest.fn();
const mockMarkFindingTruck = jest.fn();
const mockSweep = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'load-1' }),
  Redirect: () => null,
}));

jest.mock('@/lib/auth', () => ({ signOut: jest.fn() }));

jest.mock('@/lib/queries', () => {
  const actual = jest.requireActual('@/lib/queries');
  return {
    ...actual,
    useCities: jest.fn(),
    useTruckTypes: jest.fn(),
    useOpsQueue: jest.fn(),
    useOpsCandidates: jest.fn(),
    useSendOffer: jest.fn(),
    useMarkFindingTruck: jest.fn(),
    useOpsSetPrice: jest.fn(),
    useSweepExpiredOffers: jest.fn(),
  };
});

import * as queries from '@/lib/queries';

function ok<T>(data: T) {
  return { data, isPending: false, isError: false, isRefetching: false, refetch: jest.fn() };
}

const MUSCAT: City = { id: 1, name_en: 'Muscat', name_ar: 'مسقط', country: 'OM', corridor: 'Muscat' };
const SOHAR: City = { id: 2, name_en: 'Sohar', name_ar: 'صحار', country: 'OM', corridor: 'Batinah' };

const TRUCK = {
  code: '10t',
  name_en: '10-ton truck',
  name_ar: 'شاحنة ١٠ طن',
  description_en: 'Commercial freight',
} as TruckType;

function queueRow(over: Partial<OpsQueueRow> = {}): OpsQueueRow {
  return {
    load_id: 'load-1',
    origin_city: 1,
    dest_city: 2,
    pickup_from: '2026-08-01',
    pickup_to: '2026-08-02',
    goods: 'Building materials',
    weight_kg: 8000,
    truck_type_code: '10t',
    status: 'posted',
    posted_at: '2026-07-27T08:00:00Z',
    offer_count: 0,
    price_baisa: null,
    currency: 'OMR',
    auto_offer_count: 0,
    ...over,
  } as OpsQueueRow;
}

function candidate(over: Partial<OpsCandidate> = {}): OpsCandidate {
  return {
    tier: 1,
    driver_id: 'driver-1',
    driver_name: 'Salim',
    leg_id: 'leg-1',
    leg_origin: 1,
    leg_dest: 2,
    depart_from: '2026-08-01',
    depart_to: '2026-08-01',
    is_empty: true,
    truck_id: 'truck-1',
    truck_type: '10t',
    capacity_kg: 10000,
    day_gap: 0,
    last_run_at: null,
    offer_status: null,
    ...over,
  };
}

function withCandidates(rows: OpsCandidate[], row: OpsQueueRow = queueRow()) {
  (queries.useOpsQueue as jest.Mock).mockReturnValue(ok([row]));
  (queries.useOpsCandidates as jest.Mock).mockReturnValue(ok(rows));
}

beforeEach(() => {
  mockSendOfferAsync.mockReset();
  mockSendOfferAsync.mockResolvedValue('offer-1');

  (queries.useCities as jest.Mock).mockReturnValue(ok([MUSCAT, SOHAR]));
  (queries.useTruckTypes as jest.Mock).mockReturnValue(ok([TRUCK]));
  (queries.useOpsQueue as jest.Mock).mockReturnValue(ok([queueRow()]));
  (queries.useOpsCandidates as jest.Mock).mockReturnValue(ok([]));
  (queries.useSendOffer as jest.Mock).mockReturnValue({
    mutateAsync: mockSendOfferAsync,
    isPending: false,
    variables: undefined,
  });
  (queries.useMarkFindingTruck as jest.Mock).mockReturnValue({
    mutateAsync: mockMarkFindingTruck,
    mutate: mockMarkFindingTruck,
    isPending: false,
  });
  (queries.useOpsSetPrice as jest.Mock).mockReturnValue({
    mutateAsync: jest.fn(),
    isPending: false,
  });
  (queries.useSweepExpiredOffers as jest.Mock).mockReturnValue({
    mutate: mockSweep,
    isPending: false,
    isSuccess: false,
  });
});

/* ─── the candidate tiers ────────────────────────────────────────────────── */

describe('OpsLoad — tiered candidates', () => {
  it('separates the three tiers rather than presenting one list', async () => {
    withCandidates([
      candidate({ tier: 1, driver_id: 'd1', driver_name: 'Salim' }),
      candidate({ tier: 2, driver_id: 'd2', driver_name: 'Nasser', is_empty: false }),
      candidate({
        tier: 3,
        driver_id: 'd3',
        driver_name: 'Khalid',
        leg_id: null,
        leg_origin: null,
        leg_dest: null,
        depart_from: null,
        depart_to: null,
        is_empty: null,
        day_gap: null,
        last_run_at: '2026-06-14',
      }),
    ]);
    await render(<OpsLoad />);

    expect(screen.getByText('EMPTY TRUCKS GOING THAT WAY')).toBeTruthy();
    expect(screen.getByText('PART-LOADED TRUCKS GOING THAT WAY')).toBeTruthy();
    expect(screen.getByText('DRIVERS WHO HAVE RUN THIS CORRIDOR')).toBeTruthy();
  });

  it('omits a tier with nobody in it, rather than showing an empty heading', async () => {
    // On most loads two of three tiers are empty. "Empty trucks going that way (0)"
    // reads as a failure; absence reads as nothing to say.
    withCandidates([candidate({ tier: 1 })]);
    await render(<OpsLoad />);

    expect(screen.getByText('EMPTY TRUCKS GOING THAT WAY')).toBeTruthy();
    expect(screen.queryByText('DRIVERS WHO HAVE RUN THIS CORRIDOR')).toBeNull();
  });

  it('shows a corridor-history driver their last run and no declared window', async () => {
    withCandidates([
      candidate({
        tier: 3,
        leg_id: null,
        leg_origin: null,
        leg_dest: null,
        depart_from: null,
        depart_to: null,
        is_empty: null,
        day_gap: null,
        last_run_at: '2026-06-14',
      }),
    ]);
    await render(<OpsLoad />);

    expect(screen.getByText(/Last ran 2026-06-14/)).toBeTruthy();
    // No leg means no window and no empty/part stamp — claiming either would be
    // inventing a declaration the driver never made.
    expect(screen.queryByText(/Empty ·/)).toBeNull();
  });

  it('asks rather than offers when the driver declared nothing', async () => {
    withCandidates([candidate({ tier: 3, leg_id: null, last_run_at: '2026-06-14' })]);
    await render(<OpsLoad />);

    expect(screen.getByLabelText('Ask this driver')).toBeTruthy();
    expect(screen.queryByLabelText('Offer to this driver')).toBeNull();
  });

  it('sends a tier-3 offer with no leg attached', async () => {
    withCandidates([
      candidate({ tier: 3, driver_id: 'd3', leg_id: null, last_run_at: '2026-06-14' }),
    ]);
    await render(<OpsLoad />);

    await fireEvent.press(screen.getByLabelText('Ask this driver'));
    expect(mockSendOfferAsync).toHaveBeenCalledWith({
      loadId: 'load-1',
      driverId: 'd3',
      legId: null,
    });
  });

  it('warns when a declared window misses the pickup window', async () => {
    // The dispatcher's grace is 2 days, so a row can be a near-miss. Presenting it
    // as an exact fit is how a truck gets promised for a day it cannot make.
    withCandidates([candidate({ day_gap: 2 })]);
    await render(<OpsLoad />);

    expect(screen.getByText(/2 days off the window/)).toBeTruthy();
  });
});

/* ─── offer state ────────────────────────────────────────────────────────── */

describe('OpsLoad — what has already been offered', () => {
  it('leaves no button on a live offer', async () => {
    withCandidates([candidate({ offer_status: 'pending' })]);
    await render(<OpsLoad />);

    expect(screen.getByText('ALREADY OFFERED')).toBeTruthy();
    expect(screen.queryByLabelText('Offer to this driver')).toBeNull();
  });

  it('lets a dispatcher deliberately ask a driver who declined', async () => {
    // The override an automated path is denied: create_offer refuses to resurrect
    // a decline unless allow_resend, and only ops_send_offer passes it.
    withCandidates([candidate({ offer_status: 'declined' })]);
    await render(<OpsLoad />);

    expect(screen.getByText('DECLINED')).toBeTruthy();
    expect(screen.getByLabelText('Offer again')).toBeTruthy();
  });

  it('says when the machine already offered this load', async () => {
    // Without this the dispatcher re-sends what auto-dispatch sent at post time.
    withCandidates([candidate({ offer_status: 'pending' })], queueRow({
      offer_count: 2,
      auto_offer_count: 2,
      status: 'matched',
    }));
    await render(<OpsLoad />);

    expect(screen.getByText('OFFERED AUTOMATICALLY WHEN POSTED')).toBeTruthy();
  });

  it('still offers the no-match escape once a load is stuck in matched', async () => {
    // 0013's widening. Every driver declining used to leave the load permanently
    // unreachable: 'matched' with no way back to the queue.
    withCandidates([], queueRow({ status: 'matched', offer_count: 0 }));
    await render(<OpsLoad />);

    expect(screen.getByLabelText('No truck fits — arrange a fresh trip')).toBeTruthy();
  });
});

/* ─── sanitisation ───────────────────────────────────────────────────────── */

describe('OpsLoad — hostile text', () => {
  it('strips bidi overrides from a driver name', async () => {
    // A bilingual RTL UI is a spoofing surface: an override in a name can make it
    // render as another driver's. Sanitised at the output boundary, not only in
    // the database.
    withCandidates([candidate({ driver_name: 'Sal‮im' })]);
    await render(<OpsLoad />);

    expect(screen.queryByText(/‮/)).toBeNull();
  });
});

/* ─── the queue ──────────────────────────────────────────────────────────── */

describe('OpsQueue', () => {
  it('splits work needing a decision from work already out', async () => {
    (queries.useOpsQueue as jest.Mock).mockReturnValue(
      ok([
        queueRow({ load_id: 'a', offer_count: 0 }),
        queueRow({ load_id: 'b', offer_count: 2 }),
      ]),
    );
    await render(<OpsQueueScreen />);

    expect(screen.getByText('NEEDS A DECISION')).toBeTruthy();
    expect(screen.getByText('OFFER OUT')).toBeTruthy();
  });

  it('offers a sweep only where timed-out offers could be hiding', async () => {
    (queries.useOpsQueue as jest.Mock).mockReturnValue(
      ok([queueRow({ load_id: 'b', offer_count: 2 })]),
    );
    await render(<OpsQueueScreen />);

    await fireEvent.press(screen.getByLabelText('Clear timed-out offers'));
    expect(mockSweep).toHaveBeenCalled();
  });
});
