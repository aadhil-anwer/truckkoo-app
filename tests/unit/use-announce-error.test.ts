import { AccessibilityInfo } from 'react-native';
import { renderHook } from '@testing-library/react-native';

import { useAnnounceOnError } from '@/lib/use-announce-error';

describe('useAnnounceOnError', () => {
  /**
   * A query failing is silent otherwise — the retry banner appears with
   * nothing telling a screen reader user it is there to find. This is the
   * one mechanism that reaches iOS as well as Android; accessibilityLiveRegion
   * (used beside it elsewhere in the app) is Android-only.
   */
  it('announces the moment a query becomes failed', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { rerender } = await renderHook(
      ({ failed }: { failed: boolean }) => useAnnounceOnError(failed, 'We could not load that'),
      { initialProps: { failed: false } },
    );
    expect(spy).not.toHaveBeenCalled();

    await rerender({ failed: true });
    expect(spy).toHaveBeenCalledWith('We could not load that');
  });

  it('does not repeat the announcement on every render while still failed', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { rerender } = await renderHook(
      ({ failed }: { failed: boolean }) => useAnnounceOnError(failed, 'oops'),
      { initialProps: { failed: true } },
    );
    spy.mockClear();

    await rerender({ failed: true });
    await rerender({ failed: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('announces again on a fresh failure after a recovery', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const { rerender } = await renderHook(
      ({ failed }: { failed: boolean }) => useAnnounceOnError(failed, 'oops'),
      { initialProps: { failed: true } },
    );
    await rerender({ failed: false });
    spy.mockClear();

    await rerender({ failed: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
