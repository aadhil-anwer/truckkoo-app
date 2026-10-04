import { render, waitFor, act } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

const mockStart = jest.fn(async (_mode?: unknown) => true);
const mockStop = jest.fn(async () => undefined);
const mockAccess = jest.fn(async () => 'always');
const mockReportOnce = jest.fn(async () => null);
const mockUnregister = jest.fn(async () => true);
const mockRegister = jest.fn(async () => null);
const mockTrackingNow = jest.fn((): string | null => null);
jest.mock('@/lib/background-location', () => ({
  trackingNow: () => mockTrackingNow(),
  startTracking: (mode: unknown) => mockStart(mode),
  stopTracking: () => mockStop(),
  locationAccess: () => mockAccess(),
  requestLocationAccess: jest.fn(),
  reportOnce: () => mockReportOnce(),
}));
jest.mock('@/lib/push', () => ({ unregisterPush: () => mockUnregister(), registerPush: () => mockRegister() }));

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
  mockUnregister.mockResolvedValue(true);
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
    supabase.auth.signOut.mockResolvedValue({ error: null });
    const { signOut } = jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');
    await signOut();
    expect(mockStop.mock.invocationCallOrder[0]).toBeLessThan(
      supabase.auth.signOut.mock.invocationCallOrder[0],
    );
  });

  it('reaches global revocation when tracking shutdown never resolves', async () => {
    mockStop.mockImplementationOnce(() => new Promise(() => {}));
    const { supabase } = jest.requireMock('@/lib/supabase') as { supabase: { auth: { signOut: jest.Mock } } };
    supabase.auth.signOut.mockResolvedValue({ error: null });
    const { signOut } = jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');
    jest.useFakeTimers();
    try {
      const done = signOut();
      await jest.advanceTimersByTimeAsync(4_100);
      await expect(done).resolves.toBeUndefined();
      expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not claim logout when push revocation fails', async () => {
    mockUnregister.mockResolvedValueOnce(false);
    const { supabase } = jest.requireMock('@/lib/supabase') as { supabase: { auth: { signOut: jest.Mock } } };
    const { signOut } = jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');
    await expect(signOut()).rejects.toThrow();
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it('stops waiting when push revocation never answers', async () => {
    mockUnregister.mockImplementationOnce(() => new Promise<boolean>(() => {}));
    const { supabase } = jest.requireMock('@/lib/supabase') as { supabase: { auth: { signOut: jest.Mock } } };
    const { signOut } = jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');
    jest.useFakeTimers();
    try {
      const done = signOut();
      const failure = expect(done).rejects.toThrow('Push token revocation failed');
      await jest.advanceTimersByTimeAsync(4_100);
      await failure;
      expect(supabase.auth.signOut).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('resumes tracking and push when sign-out fails, so a driver mid-trip keeps reporting', async () => {
    mockTrackingNow.mockReturnValueOnce('trip');
    const { supabase } = jest.requireMock('@/lib/supabase') as { supabase: { auth: { signOut: jest.Mock } } };
    supabase.auth.signOut.mockResolvedValue({ error: new Error('offline') });
    const { signOut } = jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');
    await expect(signOut()).rejects.toThrow('offline');
    expect(mockStop).toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalledWith('trip');
    expect(mockRegister).toHaveBeenCalled();
  });

  it('does not resume tracking that was not running', async () => {
    mockUnregister.mockResolvedValueOnce(false);
    const { signOut } = jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');
    await expect(signOut()).rejects.toThrow();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('resumes nothing after a successful sign-out', async () => {
    mockTrackingNow.mockReturnValueOnce('online');
    const { supabase } = jest.requireMock('@/lib/supabase') as { supabase: { auth: { signOut: jest.Mock } } };
    supabase.auth.signOut.mockResolvedValue({ error: null });
    const { signOut } = jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');
    await signOut();
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('reports a failed global revocation', async () => {
    const { supabase } = jest.requireMock('@/lib/supabase') as { supabase: { auth: { signOut: jest.Mock } } };
    supabase.auth.signOut.mockResolvedValue({ error: new Error('offline') });
    const { signOut } = jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');
    await expect(signOut()).rejects.toThrow('offline');
  });

  it('stops waiting when global revocation never answers', async () => {
    const { supabase } = jest.requireMock('@/lib/supabase') as { supabase: { auth: { signOut: jest.Mock } } };
    supabase.auth.signOut.mockImplementationOnce(() => new Promise(() => {}));
    const { signOut } = jest.requireActual('@/lib/auth') as typeof import('@/lib/auth');
    jest.useFakeTimers();
    try {
      const done = signOut();
      const failure = expect(done).rejects.toThrow('Sign-out timed out');
      await jest.advanceTimersByTimeAsync(12_100);
      await failure;
    } finally {
      jest.useRealTimers();
    }
  });
});
