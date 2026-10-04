/**
 * X2 · Account.
 *
 * One component serves both roles; only the role line and the tab bar differ.
 *
 * WHAT THIS SCREEN MAY SAY is the thing these tests are really guarding. An
 * account screen is exactly where a plausible invented number goes unchallenged,
 * so most of what follows asserts an absence.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { initLanguage } from '@/i18n';
import * as language from '@/lib/language';

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

jest.mock('@/lib/session', () => ({ useSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ signOut: jest.fn() }));

import AccountTab from '@/app/(app)/(tabs)/account';
import * as pushContext from '@/lib/push-context';

const { useSession } = jest.requireMock('@/lib/session');
const { signOut: mockSignOut } = jest.requireMock('@/lib/auth');

const session = (role: 'shipper' | 'driver') => ({
  profile: {
    id: 'p1',
    full_name: 'Nasser Al Hinai',
    phone: '+968 9123 4567',
    role,
    language: 'en',
  },
});

beforeEach(() => initLanguage('en'));

describe('X2 · account', () => {
  it('shows a retryable error when global sign-out fails', async () => {
    useSession.mockReturnValue(session('driver'));
    mockSignOut.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    await render(<AccountTab />);
    await fireEvent.press(screen.getByLabelText('Sign out'));
    await waitFor(() => expect(screen.getByText('Could not sign out. Check your connection and try again.')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Sign out'));
    expect(mockSignOut).toHaveBeenCalledTimes(2);
  });

  it('names the role in the second person', async () => {
    useSession.mockReturnValue(session('driver'));
    await render(<AccountTab />);
    expect(screen.getByText('You drive a truck')).toBeTruthy();
  });

  it('says the other thing for a shipper', async () => {
    useSession.mockReturnValue(session('shipper'));
    await render(<AccountTab />);
    expect(screen.getByText('You send cargo')).toBeTruthy();
  });

  it('shows the initials, not an avatar image', async () => {
    useSession.mockReturnValue(session('shipper'));
    await render(<AccountTab />);
    expect(screen.getByText('NA')).toBeTruthy();
  });

  it('shows no truck row, because profiles carries no truck', async () => {
    // The handoff draws "Truck / 10-ton". There is no such field: profiles holds
    // id, role, full_name, phone and language, and nothing else. A row here
    // would have to invent its value (CLAUDE.md #5).
    useSession.mockReturnValue(session('driver'));
    await render(<AccountTab />);
    expect(screen.queryByText('Truck')).toBeNull();
  });

  it('invents nothing: no rating, no trip count, no member-since', async () => {
    useSession.mockReturnValue(session('driver'));
    await render(<AccountTab />);
    for (const forbidden of [/member since/i, /\d+ trips/i, /\d\.\d ★/]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it('shows the phone it actually has', async () => {
    useSession.mockReturnValue(session('shipper'));
    await render(<AccountTab />);
    expect(screen.getByText('+968 9123 4567')).toBeTruthy();
    expect(screen.getByText('Mobile number')).toBeTruthy();
  });

  it('changes the language through setLanguage, never by mutating i18n directly', async () => {
    const spy = jest.spyOn(language, 'setLanguage').mockResolvedValue();
    useSession.mockReturnValue(session('driver'));
    await render(<AccountTab />);

    await fireEvent.press(screen.getByLabelText('Language, English'));
    await fireEvent.press(screen.getByText('العربية'));
    expect(spy).toHaveBeenCalledWith('ar');
  });

  it('offers a way out of the picker without choosing', async () => {
    useSession.mockReturnValue(session('driver'));
    await render(<AccountTab />);
    await fireEvent.press(screen.getByLabelText('Language, English'));
    expect(screen.getByLabelText('Close')).toBeTruthy();
  });

  /**
   * The two language options previously had no group ancestor at all. This
   * asserts the semantic marker is present — NOT that a screen reader reads
   * it, which needs a real device: `accessible={true}` would make VoiceOver/
   * TalkBack announce the group, but it also merges every child into one
   * opaque node, which would make the two options individually unreachable —
   * a worse regression than the one being fixed. So this stays unverified,
   * same as every other on-device accessibility claim in OPEN_ISSUES.md.
   */
  it('marks the language choice as a group, without merging its options into one node', async () => {
    useSession.mockReturnValue(session('driver'));
    await render(<AccountTab />);
    await fireEvent.press(screen.getByLabelText('Language, English'));

    const group = screen.getByLabelText('Language');
    expect(group.props.accessibilityRole).toBe('radiogroup');
    expect(group.props.accessible).not.toBe(true);

    // Both options must still be their own reachable radios.
    expect(screen.getByRole('radio', { name: 'English' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'العربية' })).toBeTruthy();
  });
});

describe('X2 · notifications', () => {
  afterEach(() => jest.restoreAllMocks());

  const pushState = (access: 'granted' | 'denied') => {
    const request = jest.fn(async () => 'granted' as const);
    jest.spyOn(pushContext, 'usePush').mockReturnValue({
      access,
      settled: true,
      request,
      decline: jest.fn(),
      settle: jest.fn(),
    });
    return request;
  };

  it('keeps a way back to notifications after "Not now"', async () => {
    useSession.mockReturnValue(session('shipper'));
    const request = pushState('denied');
    await render(<AccountTab />);
    fireEvent.press(screen.getByLabelText('Notifications, Off — tap to turn on'));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('says they are on, and offers nothing to press, once they are', async () => {
    useSession.mockReturnValue(session('driver'));
    pushState('granted');
    await render(<AccountTab />);
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.queryByLabelText(/Notifications, /)).toBeNull();
  });
});
