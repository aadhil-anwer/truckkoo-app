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
  View,
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

/**
 * A selectable row.
 *
 * SELECTION IS SIGNALLED THREE WAYS AT ONCE — border, fill, and a filled radio.
 * That is deliberate redundancy, not decoration: this is read one-handed, in
 * direct sun, through a windscreen, on a cheap screen. Reducing it to a single
 * indicator is a legibility regression, and `tests/components/select.test.tsx`
 * will say so.
 */
export function SelectRow({
  title,
  subtitle,
  selected,
  onPress,
  ground = 'cream',
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  ground?: Ground;
}) {
  // The unselected ring must stay visible on whichever ground it lands on:
  // SelectRow renders on both, and a cream-tuned dark ring nearly disappears
  // on ink.
  const unselectedRing = ground === 'cream' ? 'rgba(22,23,26,.18)' : 'rgba(247,245,242,.28)';

  const base =
    ground === 'cream'
      ? { backgroundColor: color.creamCard, borderColor: 'transparent', borderWidth: 2 }
      : { backgroundColor: color.raised, borderColor: hairline.card, borderWidth: 1.5 };

  const chosen =
    ground === 'cream'
      ? { backgroundColor: color.accentTint, borderColor: color.accent, borderWidth: 2 }
      : { backgroundColor: color.raised, borderColor: color.accent, borderWidth: 1.5 };

  const titleTint = ground === 'cream' ? color.inkText : color.lightText;
  const subTint = ground === 'cream' ? color.mutedText : alpha.onInk.body;

  return (
    <Pressable
      testID="select-surface"
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      onPress={onPress}
      style={StyleSheet.flatten([
        styles.selectRow,
        selected ? chosen : base,
        selected && ground === 'cream' ? elevation.selectedCream : null,
      ])}
    >
      <View style={styles.selectText}>
        <Text style={StyleSheet.flatten([font.rowTitle, { color: titleTint }])}>{title}</Text>
        {subtitle ? (
          <Text style={StyleSheet.flatten([font.bodySmall, { color: subTint }])}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View
        style={StyleSheet.flatten([
          styles.radio,
          { borderColor: selected ? color.accent : unselectedRing },
        ])}
      >
        {selected ? <View testID="select-radio-dot" style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

/** The larger two-up choice — N4's role fork, S7's "let us choose for you". */
export function SelectCard({
  title,
  body,
  icon,
  selected,
  onPress,
}: {
  title: string;
  body: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID="select-surface"
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${body}`}
      onPress={onPress}
      style={StyleSheet.flatten([
        styles.selectCard,
        selected
          ? { backgroundColor: color.accentTint, borderColor: color.accent, ...elevation.selectedCream }
          : { backgroundColor: color.creamCard, borderColor: 'transparent', ...elevation.cardCream },
      ])}
    >
      <View
        style={StyleSheet.flatten([
          styles.selectTile,
          { backgroundColor: selected ? color.accentWash : 'rgba(22,23,26,.05)' },
        ])}
      >
        <Icon name={icon} size={27} tint={selected ? color.accent : color.iconGrey} />
      </View>
      <Text style={StyleSheet.flatten([font.title, { color: color.inkText }])}>{title}</Text>
      <Text style={StyleSheet.flatten([font.bodySmall, { color: color.mutedText }])}>
        {body}
      </Text>
      <View
        style={StyleSheet.flatten([
          styles.radio,
          styles.radioCorner,
          // SelectCard is cream-only, so the dark ring never needs the ink variant.
          { borderColor: selected ? color.accent : 'rgba(22,23,26,.18)' },
        ])}
      >
        {selected ? <View testID="select-radio-dot" style={styles.radioDot} /> : null}
      </View>
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
  selectRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.row,
  },
  selectText: { flex: 1, gap: 2 },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCorner: { position: 'absolute', top: space.xl, insetInlineEnd: space.xl },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: color.accent },
  selectCard: {
    borderRadius: radius.card,
    borderWidth: 2,
    padding: space.xl,
    gap: space.sm,
  },
  selectTile: {
    width: 54,
    height: 54,
    borderRadius: radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
});
