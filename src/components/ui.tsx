/**
 * Layout.
 *
 * Screens are one ground or the other — ink where the user reads state, cream
 * where the user answers a question. Never a mix.
 */

import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, type IconName } from './icon';
import {
  GUTTER_CREAM,
  GUTTER_INK,
  GUTTER_SHEET,
  alpha,
  color,
  elevation,
  font,
  hairline,
  radius,
  space,
} from '@/theme/tokens';
import { align, arabicIfNeeded } from './text-direction';

type Ground = 'ink' | 'cream';

export function Screen({
  ground = 'ink',
  children,
  style,
}: {
  ground?: Ground;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView
      style={StyleSheet.flatten([
        styles.screen,
        { backgroundColor: ground === 'ink' ? color.ink : color.cream },
        style,
      ])}
    >
      {children}
    </SafeAreaView>
  );
}

/** The screen gutter for a ground. Ink is 22, cream question screens are 28. */
export function gutterFor(ground: Ground): number {
  return ground === 'ink' ? GUTTER_INK : GUTTER_CREAM;
}

/**
 * The bottom sheet. Holds one job at a time.
 *
 * Tracking screens use a slightly larger top radius (32 vs 30) — small, but it
 * is what makes the map feel like it continues behind the sheet rather than
 * stopping at it.
 */
export function Sheet({
  children,
  tracking = false,
  style,
}: {
  children: ReactNode;
  tracking?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={StyleSheet.flatten([
        styles.sheet,
        {
          borderTopStartRadius: tracking ? radius.sheetTrack : radius.sheet,
          borderTopEndRadius: tracking ? radius.sheetTrack : radius.sheet,
        },
        style,
      ])}
    >
      <View style={styles.grab} />
      {children}
    </View>
  );
}

export function Card({
  children,
  ground = 'ink',
  tone = 'surface',
  style,
}: {
  children: ReactNode;
  ground?: Ground;
  tone?: 'surface' | 'raised';
  style?: StyleProp<ViewStyle>;
}) {
  const inkStyle = {
    backgroundColor: tone === 'raised' ? color.raised : color.surface,
    borderWidth: 1,
    borderColor: hairline.card,
  };
  const creamStyle = { backgroundColor: color.creamCard, ...elevation.cardCream };

  return (
    <View
      style={StyleSheet.flatten([
        styles.card,
        ground === 'ink' ? inkStyle : creamStyle,
        style,
      ])}
    >
      {children}
    </View>
  );
}

/** `ON THE MOVE`, `YOUR DETAILS`, `OR PICK ONE`. Uppercase, tracked, small. */
export function SectionLabel({
  children,
  ground = 'ink',
  accent = false,
}: {
  children: string;
  ground?: Ground;
  accent?: boolean;
}) {
  const tint = accent
    ? color.accentLight
    : ground === 'ink'
      ? alpha.onInk.label
      : alpha.onCream.label;
  return (
    <Text
      style={StyleSheet.flatten([
        arabicIfNeeded(font.groupLabel),
        { color: tint, textAlign: align.start },
      ])}
    >
      {children.toUpperCase()}
    </Text>
  );
}

/**
 * The one display statement on a screen.
 *
 * Instrument Serif is reserved for this and for hero numbers. Two of these on one
 * screen is a bug — the handoff's whole asking pattern is one question, alone.
 */
export function QuestionHeading({
  children,
  size = 'display',
  ground = 'cream',
}: {
  children: string;
  size?: 'display' | 'question';
  ground?: Ground;
}) {
  return (
    <Text
      accessibilityRole="header"
      style={StyleSheet.flatten([
        arabicIfNeeded(size === 'display' ? font.display : font.question),
        { color: ground === 'ink' ? color.lightText : color.inkText, textAlign: align.start },
      ])}
    >
      {children}
    </Text>
  );
}

/** The reassurance strip — "Nothing is charged now." */
export function Notice({ icon, children }: { icon: IconName; children: string }) {
  return (
    <View style={styles.notice}>
      <Icon name={icon} size={16} tint={alpha.onInk.tertiary} />
      <Text
        style={StyleSheet.flatten([
          arabicIfNeeded(font.bodySmall),
          { color: alpha.onInk.body, textAlign: align.start, flex: 1 },
        ])}
      >
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  sheet: {
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: hairline.sheet,
    paddingHorizontal: GUTTER_SHEET,
    paddingTop: space.md,
    ...elevation.sheet,
  },
  grab: {
    width: 40,
    height: 4,
    borderRadius: radius.round,
    backgroundColor: 'rgba(247,245,242,.18)',
    alignSelf: 'center',
    marginBottom: space.lg,
  },
  card: { borderRadius: radius.card, padding: space.xl },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: 'rgba(247,245,242,.05)',
    borderRadius: radius.notice,
    padding: space.md,
  },
});
