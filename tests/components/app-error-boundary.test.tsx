import * as Sentry from '@sentry/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { AppErrorBoundary } from '@/components/app-error-boundary';

describe('AppErrorBoundary', () => {
  /**
   * This is the screen a zero-tech-skill user sees the moment ANY uncaught
   * render exception happens anywhere in the app — the alternative, with
   * nothing wired up, is React Native's own red screen (dev) or a
   * permanently frozen blank one (release), with no path back in.
   */
  it('shows a plain-language message and a retry action, never a stack trace', async () => {
    await render(<AppErrorBoundary error={new Error('boom')} retry={jest.fn()} />);
    expect(screen.getByText('We could not load that')).toBeTruthy();
    expect(screen.queryByText(/boom/)).toBeNull();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('reports the crash — expo-router catches it before Sentry would', async () => {
    const error = new Error('boom');
    await render(<AppErrorBoundary error={error} retry={jest.fn()} />);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });

  it('calls retry rather than requiring a real relaunch', async () => {
    const retry = jest.fn();
    await render(<AppErrorBoundary error={new Error('boom')} retry={retry} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
