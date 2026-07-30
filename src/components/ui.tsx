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
import { PressableSurface } from './primitives';
import {
  GUTTER_CREAM,
  GUTTER_INK,
  GUTTER_SHEET,
  MIN_TARGET,
  alpha,
  color,
  elevation,
  font,
  hairline,
  radius,
  space,
} from '@/theme/tokens';
import { align, arabicIfNeeded } from './text-direction';
import { t } from '@/i18n';

export type Ground = 'ink' | 'cream';

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

/**
 * The pickup → dropoff spine.
 *
 * Origin is a RING, destination is a FILLED SQUARE. The handoff calls this
 * distinction load-bearing and it is: it is the only thing telling a user which
 * end is which before they read a word. Do not collapse it into two dots.
 */
export function RouteRail({
  origin,
  destination,
  compact = false,
}: {
  origin: string;
  destination: string;
  compact?: boolean;
}) {
  const gap = compact ? 24 : 36;
  return (
    <View
      style={styles.rail}
      accessible
      accessibilityLabel={`${origin} ${t('route.ariaTo')} ${destination}`}
    >
      <View style={styles.railSpine}>
        <View testID="rail-origin" style={styles.railOrigin} />
        <View style={[styles.railLine, { height: gap }]} />
        <View testID="rail-destination" style={styles.railDestination} />
      </View>
      <View style={[styles.railLabels, { gap: gap - 6 }]}>
        <Text
          style={StyleSheet.flatten([
            arabicIfNeeded(font.rowTitle),
            { color: color.lightText, textAlign: align.start },
          ])}
        >
          {origin}
        </Text>
        <Text
          style={StyleSheet.flatten([
            arabicIfNeeded(font.rowTitle),
            { color: color.lightText, textAlign: align.start },
          ])}
        >
          {destination}
        </Text>
      </View>
    </View>
  );
}

/**
 * A status pill.
 *
 * `accent` is the live state — and remember the rule: one accent per screen. If
 * the screen already has a pinned accent action, the pill is neutral.
 */
export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'accent' | 'neutral';
}) {
  const accented = tone === 'accent';
  return (
    <View
      style={StyleSheet.flatten([
        styles.pill,
        { backgroundColor: accented ? color.accentWash : color.raised },
      ])}
    >
      {accented ? <View style={styles.pillDot} /> : null}
      <Text
        style={StyleSheet.flatten([
          arabicIfNeeded(font.caption),
          { color: accented ? color.accentLight : alpha.onInk.secondary },
        ])}
      >
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

export function Chip({
  label,
  selected = false,
  ground = 'ink',
  onPress,
}: {
  label: string;
  selected?: boolean;
  ground?: Ground;
  onPress?: () => void;
}) {
  const surface = selected
    ? { backgroundColor: ground === 'ink' ? color.lightText : color.inkText }
    : ground === 'ink'
      ? { backgroundColor: color.surface }
      : { backgroundColor: color.creamCard, ...elevation.inputCream };

  const tint = selected
    ? ground === 'ink'
      ? color.ink
      : color.cream
    : ground === 'ink'
      ? color.lightText
      : color.inkText;

  return (
    <PressableSurface
      onPress={onPress}
      ground={ground}
      accessibilityLabel={label}
      style={StyleSheet.flatten([styles.chip, surface])}
    >
      <Text style={StyleSheet.flatten([arabicIfNeeded(font.caption), { color: tint }])}>
        {label}
      </Text>
    </PressableSurface>
  );
}

/**
 * The narrated wait.
 *
 * A spinner says "the app is busy". This says what has happened, what is
 * happening, and what happens next — which is the difference between a wait a
 * user tolerates and one they abandon. The handoff requires this pattern for any
 * wait longer than ~3 seconds; it is not decoration on top of a loading state.
 *
 * The `active` step's ring is drawn in the accent colour — this is the "live
 * state" use the tokens reserve the accent for, not a second pinned action, so
 * it does not violate the one-accent-per-screen rule as long as the screen has
 * no separate pinned CTA also in accent.
 */
export function Timeline({
  steps,
}: {
  steps: { label: string; detail?: string; state: 'complete' | 'active' | 'future' }[];
}) {
  return (
    <View accessibilityRole="list">
      {steps.map((s, i) => (
        <View key={`${i}-${s.label}`} style={styles.timelineRow} accessibilityRole="text">
          <View style={styles.timelineGutter}>
            <View
              testID={`timeline-mark-${i}`}
              style={StyleSheet.flatten([
                styles.timelineMark,
                s.state === 'complete'
                  ? { backgroundColor: 'rgba(241,85,31,.18)' }
                  : s.state === 'active'
                    ? {
                        borderWidth: 2.5,
                        borderColor: color.accent,
                        shadowColor: color.accent,
                        shadowOpacity: 0.14,
                        shadowRadius: 5,
                        shadowOffset: { width: 0, height: 0 },
                      }
                    : { borderWidth: 2, borderColor: 'rgba(247,245,242,.18)' },
              ])}
            >
              {s.state === 'complete' ? (
                <View testID={`timeline-check-${i}`}>
                  <Icon name="check" size={12} stroke={2.4} tint={color.accent} />
                </View>
              ) : null}
            </View>
            {i < steps.length - 1 ? (
              <View testID={`timeline-connector-${i}`} style={styles.timelineConnector} />
            ) : null}
          </View>
          <View style={styles.timelineText}>
            <Text
              style={StyleSheet.flatten([
                arabicIfNeeded(font.value),
                {
                  color: s.state === 'future' ? alpha.onInk.label : color.lightText,
                  textAlign: align.start,
                },
              ])}
            >
              {s.label}
            </Text>
            {s.detail ? (
              <Text
                style={StyleSheet.flatten([
                  arabicIfNeeded(font.caption),
                  {
                    color: s.state === 'active' ? color.accentLight : alpha.onInk.tertiary,
                    textAlign: align.start,
                  },
                ])}
              >
                {s.detail}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Skeletons, never spinners, for list and card loads.
 *
 * A skeleton at the final geometry tells the user what is arriving and stops the
 * layout jumping when it does. A spinner tells them nothing and then reflows the
 * screen under their thumb.
 */
export function Skeleton({
  width = '100%',
  height = 18,
  round = radius.notice,
}: {
  width?: number | `${number}%`;
  height?: number;
  round?: number;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: round, backgroundColor: color.raised }}
    />
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
  rail: { flexDirection: 'row', gap: space.md },
  railSpine: { alignItems: 'center', paddingTop: 4 },
  railOrigin: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: color.lightText,
  },
  railLine: { width: 1.5, backgroundColor: 'rgba(247,245,242,.2)' },
  railDestination: {
    width: 10,
    height: 10,
    borderRadius: radius.marker,
    backgroundColor: color.accent,
  },
  railLabels: { justifyContent: 'space-between' },
  pill: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.round,
    alignSelf: 'flex-start',
  },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  chip: {
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.round,
  },
  timelineRow: { flexDirection: 'row', gap: space.md },
  timelineGutter: { alignItems: 'center' },
  timelineMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineConnector: {
    width: 1.5,
    height: 26,
    backgroundColor: 'rgba(247,245,242,.14)',
  },
  timelineText: { flex: 1, paddingBottom: space.xl, gap: 2 },
});
