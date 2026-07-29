/**
 * Controls.
 *
 * Every shape the app can make lives here or in `ui.tsx`. A screen that invents
 * a shape is how a design system stops being one.
 *
 * PRESS AND DISABLED STATES are built from the handoff's written description
 * rather than copied from the gallery — the gallery is static and shows one
 * state per screen. Primary press: scale 0.98 at 0.94 brightness over 90ms.
 * Rows lighten ~4% on ink, darken ~3% on cream.
 */

import { useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Icon, type IconName } from './icon';
import {
  CTA_HEIGHT,
  MIN_TARGET,
  alpha,
  color,
  elevation,
  font,
  hairline,
  motion,
  radius,
  space,
} from '@/theme/tokens';

type Ground = 'ink' | 'cream';

/** The press animation, shared by every control. */
function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number, duration: number) =>
    Animated.timing(scale, { toValue: value, duration, useNativeDriver: true }).start();
  return {
    scale,
    onPressIn: () => to(0.98, motion.press),
    onPressOut: () => to(1, motion.release),
  };
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  ground = 'ink',
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  ground?: Ground;
  icon?: IconName;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const inert = disabled || loading;

  // On ink the action is the accent and carries a coloured shadow. On cream it is
  // ink and carries none — the handoff is explicit that cream's primary is flat.
  const surface = inert
    ? { backgroundColor: ground === 'ink' ? 'rgba(247,245,242,.1)' : 'rgba(22,23,26,.1)' }
    : ground === 'ink'
      ? { backgroundColor: color.accent, ...elevation.accentButton }
      : { backgroundColor: color.inkText };

  const tint = inert
    ? ground === 'ink'
      ? 'rgba(247,245,242,.35)'
      : 'rgba(22,23,26,.35)'
    : ground === 'ink'
      ? '#FFFFFF'
      : color.cream;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      accessibilityLabel={label}
      disabled={inert}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View
        testID="primary-surface"
        style={StyleSheet.flatten([styles.cta, surface, { transform: [{ scale }] }])}
      >
        {loading ? (
          <ActivityIndicator color={tint} />
        ) : (
          <>
            {icon ? <Icon name={icon} size={20} tint={tint} /> : null}
            <Text style={StyleSheet.flatten([font.button, { color: tint }])}>{label}</Text>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: IconName;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View
        testID="secondary-surface"
        style={StyleSheet.flatten([styles.cta, styles.secondary, { transform: [{ scale }] }])}
      >
        {icon ? <Icon name={icon} size={19} tint={color.lightText} /> : null}
        <Text style={StyleSheet.flatten([font.buttonSecondary, { color: color.lightText }])}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/** Text only. The escape hatch — "Skip", "No thanks", "Back to home". */
export function TertiaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.tertiary}
    >
      <Text
        style={StyleSheet.flatten([font.buttonSecondary, { color: alpha.onInk.tertiary }])}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A pressable card or row.
 *
 * Reused by the select controls and list rows so the press feedback is identical
 * everywhere. Ink lightens, cream darkens — both by a few percent, enough to
 * register under a thumb and not enough to flash.
 */
export function PressableSurface({
  children,
  onPress,
  ground = 'ink',
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  ground?: Ground;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        style,
        pressed && {
          backgroundColor:
            ground === 'ink' ? 'rgba(247,245,242,.04)' : 'rgba(22,23,26,.03)',
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cta: {
    minHeight: CTA_HEIGHT,
    borderRadius: radius.round,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.xxl,
  },
  secondary: {
    backgroundColor: color.raised,
    borderWidth: 1,
    borderColor: hairline.sheet,
  },
  tertiary: {
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
