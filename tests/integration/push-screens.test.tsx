/**
 * Push notifications on screen (0046).
 *
 * What is guarded:
 * - a new account is asked right after sign-up, once per launch, and a phone
 *   that already allows it is registered rather than asked;
 * - a tapped notification opens the thing it is about, from a cold start too;
 * - the ask says what will buzz, and "Not now" is a real answer;
 * - a new driver gets one permission screen at a time: location waits for the
 *   notification question;
 * - the account screen keeps a way back to notifications.
 *
 * IMPORT ORDER MATTERS: `./harness` first (see driver-screens.test.tsx).
 */
import { MUSCAT, mockBack, mockLocationAccess, mockPush, ok, resetQueries } from './harness';

import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import DriverHome from '@/app/(app)/(tabs)/driver';
import NotificationsPermission from '@/app/(app)/notifications-permission';
import { initLanguage } from '@/i18n';
import { __resetLocationPrompt } from '@/lib/location-prompt';
import * as pushContext from '@/lib/push-context';
import { PushProvider, __resetPushLaunch } from '@/lib/push-provider';
import * as queries from '@/lib/queries';
import { supabase } from '@/lib/supabase';

const N = Notifications as jest.Mocked<typeof Notifications>;
const perm = (granted: boolean, status: string, canAskAgain = true) =>
  ({ granted, status, canAskAgain }) as never;
const m = (name: string) => (queries as unknown as Record<string, jest.Mock>)[name];

/** Lets the provider's async launch work finish. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  initLanguage('en');
  resetQueries(queries as unknown as Record<string, unknown>);
  __resetPushLaunch();
  __resetLocationPrompt();
  await AsyncStorage.clear();
  N.getPermissionsAsync.mockReset().mockResolvedValue(perm(false, 'undetermined'));
  N.getLastNotificationResponseAsync.mockReset().mockResolvedValue(null);
  (supabase.rpc as jest.Mock).mockReset().mockResolvedValue({ data: null, error: null });
  mockPush.mockReset();
  mockBack.mockReset();
});

describe('PushProvider', () => {
  const app = (
    <PushProvider>
      <Text>app</Text>
    </PushProvider>
  );

  it('asks a new account right after sign-up, once per launch', async () => {
    await render(app);
    await settle();
    await render(app);
    await settle();
    expect(mockPush.mock.calls.filter((c) => c[0] === '/notifications-permission')).toHaveLength(1);
  });

  it('registers a phone that already allows it, and asks nothing', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm(true, 'granted'));
    await render(app);
    await settle();
    expect(mockPush).not.toHaveBeenCalledWith('/notifications-permission');
    expect(supabase.rpc).toHaveBeenCalledWith('register_push_token', expect.anything());
  });

  it('opens what a notification is about when the app was started by tapping it', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm(true, 'granted'));
    N.getLastNotificationResponseAsync.mockResolvedValueOnce({
      notification: {
        request: {
          content: { data: { kind: 'shipper_load', load_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } },
        },
      },
    } as never);
    await render(app);
    await settle();
    expect(mockPush).toHaveBeenCalledWith('/load/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });
});

describe('NotificationsPermission', () => {
  const ctx = (over: Partial<ReturnType<typeof pushContext.usePush>> = {}) => {
    const value = {
      access: 'undetermined' as const,
      settled: false,
      request: jest.fn(async () => 'granted' as const),
      decline: jest.fn(async () => {}),
      settle: jest.fn(),
      ...over,
    };
    jest.spyOn(pushContext, 'usePush').mockReturnValue(value);
    return value;
  };
  afterEach(() => jest.restoreAllMocks());

  it('says exactly what will buzz, and nothing else', async () => {
    ctx();
    await render(<NotificationsPermission />);
    expect(screen.getByText('Get a buzz when something happens?')).toBeTruthy();
    expect(screen.getByText(/names a price, takes your load, picks it up and delivers it/)).toBeTruthy();
  });

  it('asks, then goes back', async () => {
    const c = ctx();
    await render(<NotificationsPermission />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Turn on notifications'));
    });
    expect(c.request).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalled();
  });

  it('takes "Not now" as an answer', async () => {
    const c = ctx();
    await render(<NotificationsPermission />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Not now'));
    });
    expect(c.decline).toHaveBeenCalledTimes(1);
    expect(c.request).not.toHaveBeenCalled();
  });

  it('warns that Settings will open when the phone has stopped asking', async () => {
    ctx({ access: 'denied' });
    await render(<NotificationsPermission />);
    expect(screen.getByText(/Your phone will open Settings/)).toBeTruthy();
  });
});

describe('DriverHome — one permission screen at a time', () => {
  beforeEach(() => {
    mockLocationAccess.access = 'foreground';
    m('useMyAvailability').mockReturnValue(
      ok({
        available: true,
        city_id: MUSCAT.id,
        source: 'gps',
        updated_at: new Date().toISOString(),
        located_at: null,
      }),
    );
  });
  afterEach(() => jest.restoreAllMocks());

  const pushState = (settled: boolean) =>
    jest.spyOn(pushContext, 'usePush').mockReturnValue({
      access: 'undetermined',
      settled,
      request: jest.fn(),
      decline: jest.fn(),
      settle: jest.fn(),
    });

  it('does not ask about location while the notification question is open', async () => {
    pushState(false);
    await render(<DriverHome />);
    expect(mockPush).not.toHaveBeenCalledWith('/location-permission');
  });

  it('asks about location once the notification question is done', async () => {
    pushState(true);
    await render(<DriverHome />);
    expect(mockPush).toHaveBeenCalledWith('/location-permission');
  });
});
