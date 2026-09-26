/**
 * The bottom tab bar.
 *
 * A floating pill, anchored above the safe area rather than docked to the
 * screen edge — the handoff's skeleton reads depth from soft shadow and filled
 * surfaces, not from a hairline the way the old document-style bar did.
 *
 * ACTIVE IS ACCENT, and it is the one place besides the pinned action that
 * `color.accent` is allowed to appear — never both on a screen at once. The
 * handoff calls this out explicitly: tab bars are otherwise ink.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatNumber } from '@/i18n';
import { face } from '@/theme/faces';
import { alpha, color, elevation, font, hairline, MIN_TARGET, radius, space } from '@/theme/tokens';

import { Icon, type IconName } from './icon';

/** Route name → icon. The five tab screens map onto icon names 1:1. */
const ROUTE_ICON: Record<string, IconName> = {
  customer: 'home',
  driver: 'home',
  loads: 'loads',
  offers: 'offers',
  routes: 'routes',
  past: 'pastTrips',
  account: 'account',
};

/**
 * Whether a screen asked not to appear in the bar.
 *
 * `tabBarItemStyle: { display: 'none' }` is the signal, and it is deliberately
 * the *only* one this bar understands. expo-router's `href: null` shortcut also
 * produces it — but `href` is stripped from `options` before descriptors are
 * built, so a custom bar that checked `options.href` would silently render every
 * hidden tab. That is exactly what shipped for one build: a shipper saw the
 * driver's Offers and Routes tabs, and a second "Home".
 */
function isHidden(style: StyleProp<ViewStyle>): boolean {
  return StyleSheet.flatten(style)?.display === 'none';
}

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.bar, { marginBottom: Math.max(insets.bottom, space.sm) }]}
      accessibilityRole="tablist"
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        // A hidden route still appears in `state.routes` — it stays navigable so
        // a deep link resolves — but it must not render a tab.
        if (isHidden(options.tabBarItemStyle)) return null;

        const label =
          typeof options.tabBarLabel === 'string' ? options.tabBarLabel : route.name;
        const focused = state.index === index;
        const tint = focused ? color.accent : alpha.onInk.label;

        function onPress() {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          // `navigate`, not `push`: tapping a tab returns to that tab's screen
          // rather than stacking another copy of it.
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        }

        // `tabBarBadge` is typed `number | string`; only a count is meaningful
        // here, and a zero must render nothing rather than a "0" pill.
        const badge = typeof options.tabBarBadge === 'number' ? options.tabBarBadge : 0;

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            // The count lives inside the accessible name too, not only in the
            // dot below — a loose "2" with no referent is announced as noise,
            // and `formatNumber` (not raw interpolation) is what keeps it in
            // Eastern Arabic-Indic under `ar`, same as everywhere else a count
            // reaches text in this app.
            accessibilityLabel={badge ? `${label}, ${formatNumber(badge)} new` : label}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
          >
            <View>
              <Icon name={ROUTE_ICON[route.name] ?? 'home'} size={21} tint={tint} />
              {badge > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText} numberOfLines={1}>
                    {formatNumber(badge)}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    insetInlineStart: 15,
    insetInlineEnd: 15,
    bottom: 26,
    height: 66,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.round,
    backgroundColor: 'rgba(30,33,40,.94)',
    borderWidth: 1,
    borderColor: hairline.sheet,
    ...elevation.tabBar,
  },
  tab: {
    flex: 1,
    minHeight: MIN_TARGET,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: space.xs,
  },
  label: { ...font.tabLabel },

  // A badge is a *live state* — an unanswered offer with a clock on it — which
  // is one of the two sanctioned uses of the accent (the other is the pinned
  // action), so this is not a one-accent violation even while another tab is
  // active. `insetInlineEnd`, not the handoff's literal `right: 20px`: this
  // codebase is structurally RTL, and `right` would land the dot on the wrong
  // side of the icon in Arabic.
  badge: {
    position: 'absolute',
    top: -2,
    insetInlineEnd: 20,
    minWidth: 17,
    height: 17,
    borderRadius: radius.round,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  // 10.5px is below the 12.5px body-copy floor by design — that floor is for
  // copy, and this numeral is not copy: it duplicates a count already carried
  // in full by the tab's accessible label. Do not "fix" this to the floor.
  // The family is named explicitly (not `fontWeight: '700'` beside a default
  // face) because React Native does not synthesize weights for custom fonts —
  // a bare `fontWeight` on a custom family is a silent no-op, and at 10.5px
  // this numeral needs its bold face just to stay legible at all.
  badgeText: { fontFamily: face.archivo700, fontSize: 10.5, lineHeight: 13, color: '#fff' },
});
