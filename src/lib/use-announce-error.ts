import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Announces a query failure the moment it happens, so a screen reader user
 * learns a retry banner has appeared without needing to discover it by touch
 * first. `accessibilityLiveRegion` (the usual RN answer to this) is
 * Android-only; `announceForAccessibility` is the one mechanism that also
 * reaches iOS.
 *
 * Fires once per failure, not on every re-render while it stays failed —
 * repeating the same announcement on an unrelated state change would be
 * noise, not information.
 */
export function useAnnounceOnError(failed: boolean, message: string) {
  const was = useRef(false);
  useEffect(() => {
    if (failed && !was.current) AccessibilityInfo.announceForAccessibility(message);
    was.current = failed;
  }, [failed, message]);
}
