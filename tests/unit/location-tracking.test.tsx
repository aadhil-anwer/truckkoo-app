import { render, waitFor, act } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

const mockStart = jest.fn(async (_mode?: unknown) => true);
const mockStop = jest.fn(async () => undefined);
const mockAccess = jest.fn(async () => 'always');
const mockReportOnce = jest.fn(async () => null);
jest.mock('@/lib/background-location', () => ({
  startTracking: (mode: unknown) => mockStart(mode),
  stopTracking: () => mockStop(),
  locationAccess: () => mockAccess(),
  requestLocationAccess: jest.fn(),
  reportOnce: () => mockReportOnce(),
}));

// auth.ts calls this at module scope; the global mock does not provide it.
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn(), openAuthSessionAsync: jest.fn() }));

let mockRole: 'driver' | 'shipper' | undefined = 'driver';
let mockAvailable = true;
let mockTrips: { status: string }[] = [];
jest.mock('@/lib/session', () => ({ useSession: () => ({ profile: mockRole ? { role: mockRole } : null }) }));
jest.mock('@/lib/queries', () => ({
  useMyAvailability: () => ({ data: { available: mockAvailable } }),
  useMyTrips: () => ({ data: mockTrips }),
}));

import { LocationTrackingProvider, trackingMode, useLocationAccess } from '@/lib/location-tracking';

function Probe() {
  const { access } = useLocationAccess();
  return <Text>{access ?? 'unknown'}</Text>;
}
const mount = () => render(<LocationTrackingProvider><Probe /></LocationTrackingProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'driver'; mockAvailable = true; mockTrips = [];
  mockAccess.mockResolvedValue('always');
});

describe('trackingMode', () => {
  it('trip beats the switch; off and shippers get nothing', () => {
    expect(trackingMode('driver', false, [{ status: 'in_transit' }])).toBe('trip');
    expect(trackingMode('driver', true, [{ status: 'assigned' }])).toBe('online');
    expect(trackingMode('driver', false, [])).toBeNull();
    expect(trackingMode('shipper', true, [])).toBeNull();
    expect(trackingMode(undefined, true, [])).toBeNull();
  });
});

it('an online driver with Always is tracked at the online cadence', async () => {
  await mount();
  await waitFor(() => expect(mockStart).toHaveBeenCalledWith('online'));
});

it('a driver carrying a load is tracked at the trip cadence, switch or not', async () => {
  mockAvailable = false; mockTrips = [{ status: 'in_transit' }];
  await mount();
  await waitFor(() => expect(mockStart).toHaveBeenCalledWith('trip'));
});

it('off: stopped', async () => {
  mockAvailable = false;
  await mount();
  await waitFor(() => expect(mockStop).toHaveBeenCalled());
  expect(mockStart).not.toHaveBeenCalled();
});

it('a shipper is never tracked', async () => {
  mockRole = 'shipper';
  await mount();
  await waitFor(() => expect(mockStop).toHaveBeenCalled());
  expect(mockStart).not.toHaveBeenCalled();
});

it('while-using only: one fix now, none in the background', async () => {
  mockAccess.mockResolvedValue('foreground');
  await mount();
  await waitFor(() => expect(mockReportOnce).toHaveBeenCalledTimes(1));
  expect(mockStart).not.toHaveBeenCalled();
});

it('re-reads permission when the driver comes back from Settings', async () => {
  const listeners: ((s: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, fn) => {
    listeners.push(fn as (s: string) => void);
    return { remove: jest.fn() } as never;
  });
  mockAccess.mockResolvedValueOnce('foreground').mockResolvedValue('always');
  const { findByText } = await mount();
  await findByText('foreground');
  await act(async () => listeners.forEach((l) => l('active')));
  await findByText('always');
});
describe('signOut', () => {
  it('stops tracking before the session is cleared', async () => {
    // auth.ts imports the mocked background-location above, so mockStop is its stopTracking.
    const { supabase } = jest.requireMock('@/lib/supabase') as { supabase: { auth: { signOut: jest.Mock } } };
    const { signOut } = jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');
    await signOut();
    expect(mockStop.mock.invocationCallOrder[0]).toBeLessThan(
      supabase.auth.signOut.mock.invocationCallOrder[0],
    );
  });
});
