/**
 * Shared test setup.
 *
 * Two rules this file exists to enforce:
 *
 * 1. **No test ever reaches the network.** `src/lib/supabase.ts` is mocked at the
 *    module level everywhere it is reachable. A test that silently hit a real
 *    Supabase project would be slow, flaky, and — since it authenticates — a way
 *    to write to production from CI.
 * 2. **Native modules are stubbed, not skipped.** Stubbing them here rather than
 *    per-file means a component cannot quietly start depending on one without a
 *    deliberate change to this file.
 */

// No `extend-expect` import: @testing-library/react-native has registered its
// matchers automatically since v12.4, and the subpath was removed. Importing it
// fails resolution outright rather than degrading.

/* ─── native module stubs ────────────────────────────────────────────────── */

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  };
});

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-OM', textDirection: 'ltr' }],
}));

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: ({ scheme = 'truckkoo', path = '' }: { scheme?: string; path?: string } = {}) =>
    `${scheme}://${path}`,
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'dismiss' })),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

// jest-expo's automock returns undefined; the booking request id (0047) needs a real one.
jest.mock('expo-crypto', () => ({ randomUUID: () => require('node:crypto').randomUUID() }));

jest.mock('expo-font', () => ({ useFonts: () => [true, null], isLoaded: () => true }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(async () => {}),
  hideAsync: jest.fn(async () => {}),
}));

/* ─── environment ────────────────────────────────────────────────────────── */

// A syntactically real anon key. `src/lib/env.ts` decodes the `role` claim at
// import time, so a placeholder string would not exercise the same path.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test-project.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  Buffer.from(JSON.stringify({ iss: 'supabase', ref: 'test', role: 'anon' })).toString('base64url'),
  'signature',
].join('.');

/* ─── the network is closed ──────────────────────────────────────────────── */

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
      getSession: jest.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
      resetPasswordForEmail: jest.fn(async () => ({ error: null })),
      exchangeCodeForSession: jest.fn(async () => ({ error: null })),
      updateUser: jest.fn(async () => ({ error: null })),
      signInWithOAuth: jest.fn(),
    },
    from: jest.fn(),
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
    storage: { from: jest.fn() },
  },
  signOutEverywhere: jest.fn(),
}));

// Sentry's native module does not exist under jest. `wrap` must stay an
// identity so the root layout still renders its own component.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  wrap: (c: unknown) => c,
}));

// Any escape from the mock above should fail the test, loudly, rather than
// hanging until the suite times out.
global.fetch = jest.fn(() => {
  throw new Error('A test attempted a real network request. Mock it instead.');
}) as unknown as typeof fetch;

/* ─── noise ──────────────────────────────────────────────────────────────── */

// RN logs an act() warning for animations we deliberately do not await. Keep
// every real error visible; silence only that one.
//
// Re-armed per test rather than once per file: `restoreMocks` in jest.config.js
// restores spies before each test, which would otherwise undo this after the
// first test in every file.
const realError = console.error;
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return;
    realError(...(args as Parameters<typeof console.error>));
  });
});

/**
 * AsyncStorage has no native module under jest, and importing it throws before a
 * test body runs. The package ships an in-memory mock for exactly this; using it
 * means the booking-draft tests exercise the real read/write/clear paths rather
 * than a hand-rolled stub that cannot disagree with them.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/* ─── background location (native modules absent under jest) ─────────────── */

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  ActivityType: { AutomotiveNavigation: 2 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ granted: false })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  getCurrentPositionAsync: jest.fn(async () => null),
  getLastKnownPositionAsync: jest.fn(async () => null),
  reverseGeocodeAsync: jest.fn(async () => []),
}));

/* ─── expo-notifications (native, 0046) ──────────────────────────────────── */

// Default: never asked. A test about push sets what it needs.
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'undetermined', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'denied', canAskAgain: true })),
  setNotificationChannelAsync: jest.fn(async () => null),
  getExpoPushTokenAsync: jest.fn(async () => ({ type: 'expo', data: 'ExponentPushToken[testtokenaaaaaaaa]' })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
}));

/* ─── react-native-maps (native; one screen uses it) ─────────────────────── */

jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = (props: Record<string, unknown>) =>
    React.createElement(View, { testID: props.testID, onRegionChangeComplete: props.onRegionChangeComplete });
  return { __esModule: true, default: MapView, PROVIDER_GOOGLE: 'google' };
});
