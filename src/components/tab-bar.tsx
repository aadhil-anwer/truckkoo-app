/**
 * The bottom tab bar.
 *
 * Replaces the in-page tab strip the two home screens used to carry. That strip
 * was an index into a horizontal book of sheets — an invented navigation shape,
 * and the kind of thing a user with near-zero tech skills has no prior for. A bar
 * of labelled icons at the bottom of the screen is the one navigation pattern
 * every phone owner in the world has already learned, including from apps they
 * did not choose to learn.
 *
 * ACTIVE IS INK, NOT ORANGE. There is one orange on a screen and it belongs to
 * the action. The only orange permitted here is a badge count, because an
 * unanswered offer is genuinely urgent to a driver — it is money with a clock on
 * it — and that is exactly what an accent is for.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatNumber } from '@/i18n';
import { color, doc, font, MIN_TARGET, radius, space } from '@/theme/tokens';

import { Icon, type IconName } from './icon';

/**
 * A tab's icon, as the standard `tabBarIcon` render prop expects.
 *
 * Screens declare `tabBarIcon: tabIcon('offers', 'offersOn')` rather than
 * inventing their own closure, so the focused/unfocused pairing and the sizing
 * are decided once here instead of five times in the layout.
 */
export function tabIcon(name: IconName, nameOn: IconName) {
  return function TabIcon({ focused }: { focused: boolean }) {
    return (
      <Icon name={focused ? nameOn : name} size={24} color={focused ? color.ink : color.inkFaint} />
    );
  };
}

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
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}
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
            accessibilityLabel={badge > 0 ? `${label}, ${formatNumber(badge)}` : label}
            style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
          >
            <View>
              {options.tabBarIcon?.({
                focused,
                color: focused ? color.ink : color.inkFaint,
                size: 24,
              })}
              {badge > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText} numberOfLines={1}>
                    {formatNumber(badge)}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.label, focused && styles.labelOn]} numberOfLines={1}>
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
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: color.paper,
    borderTopWidth: doc.rule,
    borderTopColor: color.line,
    paddingTop: space.sm,
  },
  tab: {
    flex: 1,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: space.xs,
  },
  label: { ...font.micro, color: color.inkFaint, textAlign: 'center' },
  labelOn: { color: color.ink },

  badge: {
    position: 'absolute',
    top: -4,
    // Logical, so the badge sits on the outer corner in Arabic too.
    insetInlineEnd: -10,
    minWidth: 18,
    height: 18,
    borderRadius: radius.pill,
    backgroundColor: color.orange,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  // White on #f1551f is 3.47:1 and this is a *count*, so it cannot rely on
  // recognition the way a status word can. It is rescued by weight and by never
  // exceeding two digits — and it is never the only place the number appears:
  // the tab's accessible name carries it, and the Offers screen states it in
  // full. Treat this as an ornament on top of real information, not as the
  // information.
  badgeText: { fontSize: 11, lineHeight: 14, fontWeight: '900', color: color.paper },
});
