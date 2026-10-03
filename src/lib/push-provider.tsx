/**
 * When to ask for notifications, and what a tap opens. Mounted once, in the
 * (app) layout, so it runs for every signed-in screen and for no signed-out one.
 *
 * ONE PERMISSION SCREEN AT A TIME. A new driver would otherwise get the
 * notification screen and the location disclosure stacked on top of each other
 * on first open. `settled` is false until the notification question has been
 * answered (or was not needed) on this launch, and the driver home waits on it
 * before asking about location.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { PushCtx } from '@/lib/push-context';
import { useSession } from '@/lib/session';
import {
  type PushAccess,
  declinePush,
  hrefFor,
  pushStatus,
  registerPush,
  requestPush,
  shouldAskForPush,
} from '@/lib/push';

/** Module state: once per JS runtime, i.e. once per launch. */
let prompted = false;
let coldStartHandled = false;

/** For tests: a fresh launch. */
export function __resetPushLaunch(): void {
  prompted = false;
  coldStartHandled = false;
}

export function PushProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { session, profile } = useSession();
  const [access, setAccess] = useState<PushAccess | null>(null);
  const [settled, setSettled] = useState(false);
  const signedIn = !!session && !!profile;

  // Once per launch, once signed in: register, or decide whether to ask.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    (async () => {
      const now = await pushStatus().catch(() => ({ access: 'denied' as PushAccess, canAskAgain: false }));
      if (!live) return;
      setAccess(now.access);
      if (now.access === 'granted') {
        await registerPush();
        if (live) setSettled(true);
        return;
      }
      const ask = !prompted && (await shouldAskForPush().catch(() => false));
      if (!live) return;
      if (ask) {
        prompted = true;
        router.push('/notifications-permission');
      } else {
        setSettled(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [signedIn, router]);

  // Back from Settings is where a permission changes. Register when it is on.
  useEffect(() => {
    if (!signedIn) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      pushStatus()
        .then((now) => {
          setAccess(now.access);
          if (now.access === 'granted') registerPush();
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, [signedIn]);

  // A tap opens the thing it is about — while running, and from a cold start.
  useEffect(() => {
    if (!signedIn) return;
    const open = (data: unknown) => {
      const href = hrefFor(data);
      if (href) router.push(href as Href);
    };
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      open(r.notification.request.content.data),
    );
    if (!coldStartHandled) {
      coldStartHandled = true;
      Notifications.getLastNotificationResponseAsync()
        .then((r) => {
          if (r) open(r.notification.request.content.data);
        })
        .catch(() => {});
    }
    return () => sub.remove();
  }, [signedIn, router]);

  const request = useCallback(async () => {
    const next = await requestPush().catch(() => 'denied' as PushAccess);
    setAccess(next);
    if (next === 'granted') await registerPush();
    setSettled(true);
    return next;
  }, []);

  const decline = useCallback(async () => {
    await declinePush().catch(() => {});
    setSettled(true);
  }, []);

  const settle = useCallback(() => setSettled(true), []);

  const value = useMemo(
    () => ({ access, settled, request, decline, settle }),
    [access, settled, request, decline, settle],
  );
  return <PushCtx.Provider value={value}>{children}</PushCtx.Provider>;
}
