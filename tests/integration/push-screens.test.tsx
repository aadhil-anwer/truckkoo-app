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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import DriverHome from '@/app/(app)/(tabs)/driver';
import NotificationsPermission from '@/app/(app)/notifications-permission';
import { initLanguage } from '@/i18n';
import { __resetLocationPrompt } from '@/lib/location-prompt';
import * as pushContext from '@/lib/push-context';
import { PushProvider, __resetPushLaunch } from '@/lib/push-provider';
import { __openAgain } from '@/lib/app-opens';
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
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })}>
      <PushProvider>
        <Text>app</Text>
      </PushProvider>
    </QueryClientProvider>
  );

  it('asks a new account right after sign-up, once per launch', async () => {
    await render(app);
    await settle();
    await render(app);
    await settle();
    expect(mockPush.mock.calls.filter((c) => c[0] === '/notifications-permission')).toHaveLength(1);
  });

  it('asks again on the next opening while notifications are off — never twice in one', async () => {
    await render(app);
    await settle();
    await render(app);
    await settle();
    expect(mockPush.mock.calls.filter((c) => c[0] === '/notifications-permission')).toHaveLength(1);
    await act(async () => __openAgain());
    await settle();
    expect(mockPush.mock.calls.filter((c) => c[0] === '/notifications-permission')).toHaveLength(2);
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

  // 0074: a new job reads like a ride request.
  const OFFER = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
  const job = (actionIdentifier: string) => ({
    actionIdentifier,
    notification: {
      request: { identifier: 'n1', content: { data: { kind: 'driver_new_job', offer_id: OFFER, bid: false } } },
    },
  });

  it('registers Accept and Decline for a job, with Accept opening the app', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm(true, 'granted'));
    await render(app);
    await settle();
    expect(N.setNotificationCategoryAsync).toHaveBeenCalledWith('job_offer', [
      expect.objectContaining({ identifier: 'accept', buttonTitle: 'Accept', options: { opensAppToForeground: true } }),
      expect.objectContaining({ identifier: 'decline', buttonTitle: 'Decline' }),
    ]);
  });

  it('Decline on the notification answers no, and opens nothing', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm(true, 'granted'));
    N.getLastNotificationResponseAsync.mockResolvedValueOnce(job('decline') as never);
    await render(app);
    await settle();
    expect(supabase.rpc).toHaveBeenCalledWith('respond_to_offer', { p_offer_id: OFFER, p_accept: false });
    expect(mockPush).not.toHaveBeenCalledWith(`/offer/${OFFER}`);
  });

  it('Accept on the notification opens the job card — it never takes the job by itself', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm(true, 'granted'));
    N.getLastNotificationResponseAsync.mockResolvedValueOnce(job('accept') as never);
    await render(app);
    await settle();
    expect(mockPush).toHaveBeenCalledWith(`/offer/${OFFER}`);
    expect(supabase.rpc).not.toHaveBeenCalledWith('respond_to_offer', expect.anything());
  });

  it('a job arriving while the app is open goes straight to its card', async () => {
    N.getPermissionsAsync.mockResolvedValue(perm(true, 'granted'));
    await render(app);
    await settle();
    const onReceived = N.addNotificationReceivedListener.mock.calls.at(-1)![0] as (n: unknown) => void;
    await act(async () => onReceived(job('').notification));
    expect(mockPush).toHaveBeenCalledWith(`/offer/${OFFER}`);
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

  // Founder, 2026-10-08: off is asked about again — once each opening, never
  // twice in one sitting. A driver with location off gets no jobs (0076).
  it('asks about location again the next time the app is opened, while it is still off', async () => {
    pushState(true);
    const view = await render(<DriverHome />);
    await view.rerender(<DriverHome />);
    const asks = () => mockPush.mock.calls.filter((c) => c[0] === '/location-permission').length;
    expect(asks()).toBe(1);
    await act(async () => __openAgain());
    expect(asks()).toBe(2);
  });

  it('does not ask once location is allowed all the time', async () => {
    mockLocationAccess.access = 'always';
    pushState(true);
    await render(<DriverHome />);
    await act(async () => __openAgain());
    expect(mockPush).not.toHaveBeenCalledWith('/location-permission');
  });
});
