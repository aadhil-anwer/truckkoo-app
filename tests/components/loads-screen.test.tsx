/**
 * X1 · the loads list.
 *
 * Two views of one list, and the rule this screen shares with T4: never show an
 * arrival time nobody reported. `progressOf` and `interpolate` were deleted in
 * P6 on purpose, and a card is just as capable of inventing a position as a map
 * marker is.
 */

import { render, screen } from '@testing-library/react-native';

import { initLanguage } from '@/i18n';

const CITIES = [
  { id: 1, name_en: 'Muscat', name_ar: 'مسقط', lat: 23.6, lng: 58.5 },
  { id: 2, name_en: 'Barka', name_ar: 'بركاء', lat: 23.7, lng: 57.9 },
];

const load = (over: Record<string, unknown> = {}) => ({
  id: 'l1',
  origin_city: 1,
  dest_city: 2,
  pickup_from: '2026-08-03',
  pickup_to: '2026-08-03',
  weight_kg: 8000,
  truck_type_code: null,
  goods_description: 'Dates',
  status: 'in_transit',
  price_baisa: 42500,
  currency: 'OMR',
  created_at: '2026-08-01T06:00:00Z',
  ...over,
});

// `mock` prefix required: jest hoists jest.mock() above the file, and only
// variables named this way may be referenced from a module factory.
const mockState = {
  loads: [load(), load({ id: 'l2', status: 'delivered', price_baisa: 30000 })],
  position: null as { eta_at: string | null } | null,
};

/**
 * An explicit safe-area mock rather than the library's shipped one, for the
 * reason `tests/integration/harness.tsx` documents at length: the shipped mock
 * is a default export, so a factory returning it resolves every named import to
 * undefined and React blames the screen rather than the mock.
 *
 * Inline rather than via that harness because this file supplies its own query
 * mocks, and the harness supplies a fixed set of its own.
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

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

jest.mock('@/lib/queries', () => ({
  cityIndex: (rows: { id: number }[] | undefined) =>
    new Map((rows ?? []).map((c) => [c.id, c])),
  useCities: () => ({ data: CITIES }),
  useTruckTypes: () => ({ data: [] }),
  useMyTrips: () => ({ data: [{ id: 't1', load_id: 'l1', status: 'in_transit' }] }),
  useTripPosition: () => ({ data: mockState.position }),
  useMyLoads: () => ({
    isPending: false,
    isError: false,
    isRefetching: false,
    refetch: jest.fn(),
    data: mockState.loads,
  }),
}));

// Imported after the mock so the screen picks it up.
import LoadsTab from '@/app/(app)/(tabs)/loads';

beforeEach(() => {
  initLanguage('en');
  mockState.loads = [load(), load({ id: 'l2', status: 'delivered', price_baisa: 30000 })];
  mockState.position = null;
});

describe('X1 · loads list', () => {
  it('counts each half in the segmented control', async () => {
    await render(<LoadsTab />);
    expect(screen.getByLabelText('Moving, 1')).toBeTruthy();
    expect(screen.getByLabelText('Finished, 1')).toBeTruthy();
  });

  it('shows the route and the price on a moving load', async () => {
    await render(<LoadsTab />);
    expect(screen.getByText('Muscat')).toBeTruthy();
    expect(screen.getByText('Barka')).toBeTruthy();
    expect(screen.getByTestId('load-price')).toBeTruthy();
  });

  it('shows no arrival time when nothing has reported a position', async () => {
    await render(<LoadsTab />);
    expect(screen.queryByTestId('load-eta')).toBeNull();
  });

  it('shows the arrival time once a position exists', async () => {
    mockState.position = { eta_at: '2026-08-04T09:00:00Z' };
    await render(<LoadsTab />);
    expect(screen.getByTestId('load-eta')).toBeTruthy();
  });

  it('shows no price on a load that has none', async () => {
    mockState.loads = [load({ price_baisa: null, status: 'finding_truck' })];
    await render(<LoadsTab />);
    expect(screen.queryByTestId('load-price')).toBeNull();
  });

  it('names the empty half rather than reporting an absence', async () => {
    mockState.loads = [];
    await render(<LoadsTab />);
    expect(screen.queryByText('No results')).toBeNull();
    expect(screen.getByLabelText('Moving, 0')).toBeTruthy();
  });
});
