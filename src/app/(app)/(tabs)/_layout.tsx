/**
 * The tab bar, and which tabs exist for whom.
 *
 * Shippers and drivers share one binary, so both tab sets are declared here and
 * the irrelevant half is hidden. That is deliberately not a conditional render:
 * a hidden route still exists, so a deep link or a stale back-stack entry
 * resolves to a real screen rather than an unmatched route, and the navigator
 * does not remount when the profile finishes loading.
 *
 * Hiding is `tabBarItemStyle: HIDDEN`, not expo-router's `href: null` shortcut.
 * The shortcut is real and it works — but it works by being *consumed*: expo-
 * router strips `href` from the options and rewrites it into `tabBarItemStyle`
 * and a null `tabBarButton`, both of which only the stock tab bar reads. With a
 * custom bar, `options.href` is gone by the time the bar sees the descriptor, so
 * every hidden tab renders. Setting the style directly says the same thing in
 * the vocabulary that actually survives the trip.
 *
 * NOT A PERMISSION BOUNDARY. Hiding a tab hides a tab. Every screen behind one
 * reads through RLS and the guarded RPCs, so a shipper who somehow reached
 * `/offers` sees an empty list rather than someone else's work — the same
 * property that lets `index.tsx` route on `profile.role` without that being a
 * security decision.
 */

import { Tabs } from 'expo-router/tabs';

import { TabBar } from '@/components/tab-bar';
import { t } from '@/i18n';
import { useMyOffers } from '@/lib/queries';
import { DECLARED_TRIPS } from '@/lib/features';
import { useSession } from '@/lib/session';
import { color } from '@/theme/tokens';

/** The one signal `TabBar` understands. See the note above. */
const HIDDEN = { display: 'none' } as const;

export default function TabsLayout() {
  const { profile } = useSession();
  const isDriver = profile?.role === 'driver';

  // The one number worth interrupting someone for. An offer is money with a
  // clock on it, and a driver who misses it loses the load to whoever answered
  // first — so it is the only badge in the app.
  const offers = useMyOffers();
  const pending = isDriver ? (offers.data?.length ?? 0) : 0;

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.cream },
      }}
    >
      {/* ── shipper ─────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="customer"
        options={{
          tabBarLabel: t('tab.home'),
          tabBarItemStyle: isDriver ? HIDDEN : undefined,
        }}
      />
      <Tabs.Screen
        name="loads"
        options={{
          tabBarLabel: t('tab.loads'),
          tabBarItemStyle: isDriver ? HIDDEN : undefined,
        }}
      />

      {/* ── driver ──────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="driver"
        options={{
          tabBarLabel: t('tab.home'),
          tabBarItemStyle: isDriver ? undefined : HIDDEN,
        }}
      />
      <Tabs.Screen
        name="offers"
        options={{
          tabBarLabel: t('tab.offers'),
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarItemStyle: isDriver ? undefined : HIDDEN,
        }}
      />
      {/* Declared trips are hidden while unreleased (src/lib/features.ts), and
          Past trips takes their slot. Exactly one of the two is ever shown. */}
      <Tabs.Screen
        name="routes"
        options={{
          tabBarLabel: t('tab.routes'),
          tabBarItemStyle: isDriver && DECLARED_TRIPS ? undefined : HIDDEN,
        }}
      />
      <Tabs.Screen
        name="past"
        options={{
          tabBarLabel: t('tab.past'),
          tabBarItemStyle: isDriver && !DECLARED_TRIPS ? undefined : HIDDEN,
        }}
      />

      {/* ── both ────────────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="account"
        options={{
          tabBarLabel: t('tab.account'),
        }}
      />
    </Tabs>
  );
}
