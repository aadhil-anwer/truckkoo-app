/**
 * Layout.
 *
 * Screens are one ground or the other — ink where the user reads state, cream
 * where the user answers a question. Never a mix.
 */

import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

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
import { formatNumber, t } from '@/i18n';

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
  testID,
}: {
  children: ReactNode;
  tracking?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
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
  /** `hero` is the 44px screen headline — N1 and N6, where there is no question. */
  size?: 'hero' | 'display' | 'question';
  ground?: Ground;
}) {
  const token =
    size === 'hero' ? font.displayLg : size === 'display' ? font.display : font.question;
  return (
    <Text
      accessibilityRole="header"
      style={StyleSheet.flatten([
        arabicIfNeeded(token),
        { color: ground === 'ink' ? color.lightText : color.inkText, textAlign: align.start },
      ])}
    >
      {children}
    </Text>
  );
}

/**
 * The soft glow an ink screen sits on when there is no map to give it ground —
 * N6, T5, D1. A radial gradient that has faded to nothing by 62% of its radius,
 * per the handoff. A flat tinted ellipse is not a stand-in: its hard edge reads
 * as an object on the screen rather than light behind it.
 */
export function Bloom({
  rgb,
  strength,
  size,
  top,
  start,
}: {
  /** The colour as an `r,g,b` triple, so the stops can fade it without a parse. */
  rgb: string;
  /** Opacity at the centre — the handoff's .16–.28. */
  strength: number;
  size: number;
  top: number;
  start: number;
}) {
  const id = `bloom-${rgb.replace(/,/g, '-')}`;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top, insetInlineStart: start, width: size, height: size }}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={`rgb(${rgb})`} stopOpacity={strength} />
            <Stop offset="0.62" stopColor={`rgb(${rgb})`} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </View>
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
  labelled = true,
}: {
  origin: string;
  destination: string;
  compact?: boolean;
  /**
   * Whether the rail announces itself.
   *
   * `false` when it sits inside a card that already carries the route in its own
   * accessible name — otherwise a screen reader reads the same two cities twice,
   * once for the card and once for the rail inside it.
   */
  labelled?: boolean;
}) {
  const gap = compact ? 24 : 36;
  return (
    <View
      style={styles.rail}
      // `accessible={false}` stops the rail being its OWN element; it does not
      // hide the city names, which the enclosing card still needs to expose.
      accessible={labelled}
      accessibilityLabel={labelled ? t('route.aria', { origin, destination }) : undefined}
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
/**
 * A group of values under a label — X2's `YOUR DETAILS`.
 *
 * Not `ListRow`: these rows are facts, and at most one of them navigates. The
 * dividers are inset inside the card because a rule running to the card's edge
 * reads as a border and makes one card look like three.
 */
export function DetailGroup({ label, children }: { label: string; children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View style={styles.detailGroup}>
      <SectionLabel>{label}</SectionLabel>
      <Card style={styles.detailCard}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {row}
            {i < rows.length - 1 && <View testID="detail-divider" style={styles.detailDivider} />}
          </Fragment>
        ))}
      </Card>
    </View>
  );
}

/**
 * One fact. A chevron appears only when the row actually goes somewhere —
 * otherwise it promises a tap that does nothing.
 */
export function DetailRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.detailRow}>
      <Text
        style={StyleSheet.flatten([
          arabicIfNeeded(font.body),
          { color: alpha.onInk.secondary, textAlign: align.start },
        ])}
      >
        {label}
      </Text>
      <View style={styles.detailValue}>
        <Text
          numberOfLines={1}
          style={StyleSheet.flatten([
            arabicIfNeeded(font.value),
            { color: color.lightText, textAlign: align.end },
          ])}
        >
          {value}
        </Text>
        {!!onPress && (
          <View testID="detail-chevron">
            <Icon name="chevron" size={18} tint={color.iconGreyDim} />
          </View>
        )}
      </View>
    </View>
  );

  if (!onPress) return body;
  // The label and the value together: "English" alone tells a screen reader
  // nothing about what is English.
  return (
    <PressableSurface onPress={onPress} accessibilityLabel={`${label}, ${value}`}>
      {body}
    </PressableSurface>
  );
}

/**
 * Two views of one list — not two tabs, and not a question.
 *
 * The count lives inside the label because that is what makes the control worth
 * having: "Moving (2)" answers the question before the tap. It goes through
 * `formatNumber`, like every other numeral, and into the accessible name with
 * its referent — a bare "2" is announced with nothing to attach it to.
 *
 * `Choice` and `SelectRow` are for answering a question. This is not one, so it
 * carries none of their three-way selection signalling: there is no wrong answer
 * to which half of your own list you are looking at.
 */
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; count: number }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        const count = formatNumber(o.count);
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${o.label}, ${count}`}
            style={StyleSheet.flatten([
              styles.segment,
              on && { backgroundColor: color.lightText },
            ])}
          >
            <Text
              numberOfLines={1}
              style={StyleSheet.flatten([
                arabicIfNeeded(font.rowTitle),
                // 'center' is not a direction literal: centre is centre in both
                // reading directions.
                { color: on ? color.inkText : alpha.onInk.secondary, textAlign: 'center' },
              ])}
            >
              {`${o.label} (${count})`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

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

  // The handoff's numbers: a 5px-padded track holding two 42px segments, which
  // makes the control 52px overall and clears MIN_TARGET as a whole.
  segmented: {
    flexDirection: 'row',
    backgroundColor: color.raised,
    borderRadius: radius.tile,
    padding: 5,
    gap: 5,
  },
  segment: {
    flex: 1,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.tileXs,
  },

  detailGroup: { gap: space.md },
  // No horizontal padding on the card: the rows carry it, so the dividers can
  // be inset within it rather than running edge to edge.
  detailCard: { borderRadius: radius.card, paddingVertical: space.xs, paddingHorizontal: 0 },
  detailDivider: { height: 1, backgroundColor: hairline.inner, marginHorizontal: 18 },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TARGET,
    paddingHorizontal: 18,
    gap: space.md,
  },
  detailValue: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 },
});
