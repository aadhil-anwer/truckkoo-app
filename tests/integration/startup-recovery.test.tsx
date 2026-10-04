import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';

let mockFontsLoaded = false;
let mockFontError: Error | null = null;

jest.mock('expo-font', () => ({
  useFonts: () => [mockFontsLoaded, mockFontError],
  isLoaded: () => mockFontsLoaded,
}));
jest.mock('expo-observe', () => ({
  Observe: { configure: jest.fn() },
  ObserveRoot: { wrap: (component: unknown) => component },
}));
jest.mock('@/lib/monitoring', () => ({
  initMonitoring: jest.fn(),
  reportError: jest.fn(),
  wrapRoot: (component: unknown) => component,
}));
jest.mock('@/lib/background-location', () => ({}));
jest.mock('expo-router', () => ({
  Stack: () => null,
  useSegments: () => [],
  useRouter: () => ({ replace: jest.fn() }),
}));

import RootLayout from '@/app/_layout';
import { reportError } from '@/lib/monitoring';

beforeEach(() => {
  mockFontsLoaded = false;
  mockFontError = new Error('font file failed');
  (SplashScreen.hideAsync as jest.Mock).mockClear();
});

it('releases the splash and offers retry when bundled fonts fail', async () => {
  await render(<RootLayout />);
  await waitFor(() => expect(screen.getByLabelText('Try again')).toBeTruthy());
  expect(SplashScreen.hideAsync).toHaveBeenCalled();
  expect(reportError).toHaveBeenCalledWith(mockFontError);
});

it('also releases the splash when font loading never settles', async () => {
  mockFontError = null;
  jest.useFakeTimers();
  try {
    await render(<RootLayout />);
    await act(async () => { await jest.advanceTimersByTimeAsync(6_100); });
    expect(screen.getByLabelText('Try again')).toBeTruthy();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
