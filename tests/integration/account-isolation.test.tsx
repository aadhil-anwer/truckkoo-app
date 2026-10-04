import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AccountQueryProvider } from '@/lib/account-query-provider';
import { useBookingDraft } from '@/lib/booking';
import { SessionProvider, useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

type AuthEvent = (event: string, session: Session | null) => void;
let authEvent: AuthEvent;

function sessionFor(id: string): Session {
  return {
    access_token: `access-${id}`,
    refresh_token: `refresh-${id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 1800000000,
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email: `${id}@example.com`,
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-10-04T00:00:00Z',
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const profile = (id: string) => ({ id, role: 'shipper', full_name: id, phone: null, language: 'en' });

function Shell({ children }: { children: ReactNode }) {
  return <SessionProvider><AccountQueryProvider>{children}</AccountQueryProvider></SessionProvider>;
}

function PrivateLoad({ read }: { read: (id: string) => Promise<string> }) {
  const { session, profile } = useSession();
  const id = session?.user.id;
  const query = useQuery({
    queryKey: ['loads', 'mine'],
    queryFn: () => read(id!),
    enabled: !!id && !!profile,
    staleTime: Infinity,
  });
  return <Text>{`${id ?? 'signed-out'}:${query.data ?? 'waiting'}`}</Text>;
}

beforeEach(() => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null }, error: null });
  (supabase.auth.onAuthStateChange as jest.Mock).mockImplementation((callback: AuthEvent) => {
    authEvent = callback;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
  (supabase.from as jest.Mock).mockImplementation(() => ({
    select: () => ({ eq: (_column: string, id: string) => ({
      maybeSingle: async () => ({ data: profile(id), error: null }),
    }) }),
  }));
});

it('never serves A cached loads to B on a shared phone', async () => {
  const read = jest.fn(async (id: string) => `${id}-load`);
  await render(<Shell><PrivateLoad read={read} /></Shell>);
  await act(async () => { authEvent('SIGNED_IN', sessionFor('A')); });
  await waitFor(() => expect(screen.getByText('A:A-load')).toBeTruthy());

  await act(async () => { authEvent('SIGNED_OUT', null); });
  await waitFor(() => expect(screen.getByText('signed-out:waiting')).toBeTruthy());
  await act(async () => { authEvent('SIGNED_IN', sessionFor('B')); });
  await waitFor(() => expect(screen.getByText('B:B-load')).toBeTruthy());
  expect(read.mock.calls.map(([id]) => id)).toEqual(['A', 'B']);
});

it('ignores A profile response after B signs in and after sign-out', async () => {
  const slowA = deferred<{ data: ReturnType<typeof profile>; error: null }>();
  (supabase.from as jest.Mock).mockImplementation(() => ({
    select: () => ({ eq: (_column: string, id: string) => ({
      maybeSingle: () => id === 'A' ? slowA.promise : Promise.resolve({ data: profile(id), error: null }),
    }) }),
  }));
  function Identity() {
    const { session, profile: current } = useSession();
    return <Text>{`${session?.user.id ?? 'out'}:${current?.id ?? 'none'}`}</Text>;
  }
  await render(<SessionProvider><Identity /></SessionProvider>);
  await act(async () => { authEvent('SIGNED_IN', sessionFor('A')); });
  await act(async () => { authEvent('SIGNED_IN', sessionFor('B')); });
  await waitFor(() => expect(screen.getByText('B:B')).toBeTruthy());
  await act(async () => { slowA.resolve({ data: profile('A'), error: null }); });
  expect(screen.getByText('B:B')).toBeTruthy();
  await act(async () => { authEvent('SIGNED_OUT', null); });
  expect(screen.getByText('out:none')).toBeTruthy();
});

it('keeps a late A query result away from B', async () => {
  const slowA = deferred<string>();
  const read = jest.fn((id: string) => id === 'A' ? slowA.promise : Promise.resolve('B-load'));
  await render(<Shell><PrivateLoad read={read} /></Shell>);
  await act(async () => { authEvent('SIGNED_IN', sessionFor('A')); });
  await waitFor(() => expect(screen.getByText('A:waiting')).toBeTruthy());
  await act(async () => { authEvent('SIGNED_IN', sessionFor('B')); });
  await waitFor(() => expect(screen.getByText('B:B-load')).toBeTruthy());
  await act(async () => { slowA.resolve('A-load'); });
  expect(screen.getByText('B:B-load')).toBeTruthy();
});

it('shows a recoverable profile error instead of sending an existing user to setup', async () => {
  (supabase.from as jest.Mock).mockImplementation(() => ({
    select: () => ({ eq: (_column: string, id: string) => ({
      maybeSingle: async () => ({ data: null, error: new Error(`offline-${id}`) }),
    }) }),
  }));
  function Identity() {
    const { session, profile: current, error, retry } = useSession();
    return <><Text>{`${session?.user.id ?? 'out'}:${current?.id ?? 'none'}:${error ? 'error' : 'ready'}`}</Text>
      <Pressable onPress={retry}><Text>Retry</Text></Pressable></>;
  }
  await render(<SessionProvider><Identity /></SessionProvider>);
  await act(async () => { authEvent('SIGNED_IN', sessionFor('A')); });
  await waitFor(() => expect(screen.getByText('A:none:error')).toBeTruthy());
  (supabase.from as jest.Mock).mockImplementation(() => ({
    select: () => ({ eq: (_column: string, id: string) => ({
      maybeSingle: async () => ({ data: profile(id), error: null }),
    }) }),
  }));
  await fireEvent.press(screen.getByText('Retry'));
  await waitFor(() => expect(screen.getByText('A:A:ready')).toBeTruthy());
});

it('recovers from a rejected session bootstrap', async () => {
  (supabase.auth.getSession as jest.Mock)
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockResolvedValueOnce({ data: { session: sessionFor('B') }, error: null });
  function Identity() {
    const { session, profile: current, error, retry } = useSession();
    return <><Text>{`${session?.user.id ?? 'out'}:${current?.id ?? 'none'}:${error ? 'error' : 'ready'}`}</Text>
      <Pressable onPress={retry}><Text>Retry</Text></Pressable></>;
  }
  await render(<SessionProvider><Identity /></SessionProvider>);
  await waitFor(() => expect(screen.getByText('out:none:error')).toBeTruthy());
  await fireEvent.press(screen.getByText('Retry'));
  await waitFor(() => expect(screen.getByText('B:B:ready')).toBeTruthy());
});

it('does not let an old retry response sign out a newly authenticated account', async () => {
  const staleRetry = deferred<{ data: { session: Session | null }; error: null }>();
  (supabase.auth.getSession as jest.Mock)
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockReturnValueOnce(staleRetry.promise);
  function Identity() {
    const { session, profile: current, retry } = useSession();
    return <><Text>{`${session?.user.id ?? 'out'}:${current?.id ?? 'none'}`}</Text>
      <Pressable onPress={retry}><Text>Retry</Text></Pressable></>;
  }
  await render(<SessionProvider><Identity /></SessionProvider>);
  await fireEvent.press(screen.getByText('Retry'));
  await act(async () => { authEvent('SIGNED_IN', sessionFor('B')); });
  await waitFor(() => expect(screen.getByText('B:B')).toBeTruthy());
  await act(async () => { staleRetry.resolve({ data: { session: null }, error: null }); });
  expect(screen.getByText('B:B')).toBeTruthy();
});

it('does not restore A booking answers after B draft has loaded', async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('truckkoo.booking.draft.v2.B', JSON.stringify({ cargoDescription: 'B cargo' }));
  const read = AsyncStorage.getItem as jest.Mock;
  const original = read.getMockImplementation()!;
  const slowA = deferred<string>();
  read.mockImplementation((key: string) => key.endsWith('.A') ? slowA.promise : original(key));
  function DraftProbe() {
    const { draft, ready } = useBookingDraft();
    return <Text>{ready ? draft.cargoDescription : 'waiting'}</Text>;
  }
  try {
    await render(<Shell><DraftProbe /></Shell>);
    await act(async () => { authEvent('SIGNED_IN', sessionFor('A')); });
    await waitFor(() => expect(read).toHaveBeenCalledWith('truckkoo.booking.draft.v2.A'));
    await act(async () => { authEvent('SIGNED_IN', sessionFor('B')); });
    await waitFor(() => expect(screen.getByText('B cargo')).toBeTruthy());
    await act(async () => { slowA.resolve(JSON.stringify({ cargoDescription: 'A cargo' })); });
    expect(screen.getByText('B cargo')).toBeTruthy();
  } finally {
    read.mockImplementation(original);
  }
});
