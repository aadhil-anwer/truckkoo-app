/**
 * The layout vocabulary — Uber's skeleton, in Truckkoo's palette.
 *
 * `primitives.tsx` owns the controls (button, input, pill). This file owns the
 * *placement*: what a screen is made of, what a row looks like, where the action
 * sits. Six pieces, and almost every screen in the app is a composition of them:
 *
 *   Screen     the page, with its safe area and its background
 *   TopBar     a back affordance and nothing else, unless a screen earns more
 *   PageTitle  the one big statement, 32/900
 *   Section    a header with an optional trailing action
 *   ListRow    icon chip, title, subtitle, trailing — the universal row
 *   ActionBar  the pinned CTA at the thumb
 *
 * plus `RouteLine`, which is the signature: a stalk with a dot at the pickup and
 * a square at the delivery, exactly as a ride-hailing app draws a journey.
 * Freight is the same shape as a ride, so it borrows the same drawing.
 *
 * DIRECTION: every inset here is `Start`/`End`, and the route stalk sits on the
 * start edge, so the whole vocabulary mirrors in Arabic without a special case.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { align, t } from '@/i18n';
import {
  CHIP,
  color,
  doc,
  elevation,
  font,
  GUTTER,
  HIT_SLOP,
  MIN_TARGET,
  radius,
  space,
} from '@/theme/tokens';

import { Icon, type IconName } from './icon';

/* ─── the page ───────────────────────────────────────────────────────────── */

export function Screen({
  children,
  edges = ['top'],
  tone = 'page',
}: {
  children: ReactNode;
  edges?: readonly Edge[];
  /** `page` is the near-white app background; `surface` is white. */
  tone?: 'page' | 'surface';
}) {
  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: tone === 'page' ? color.paperDeep : color.paper }]}
      edges={edges}
    >
      {children}
    </SafeAreaView>
  );
}

/**
 * The header, reduced to what a step in a flow actually needs: a way back.
 *
 * The old masthead printed the company name and a 34pt title on every screen,
 * which spent the top fifth of a phone on furniture. Uber's answer — and now
 * ours — is that the title belongs *in* the content as a `PageTitle`, so it can
 * scroll away, and the bar holds only the escape hatch.
 */
export function TopBar({
  onBack,
  title,
  action,
}: {
  onBack?: () => void;
  /** Only for screens with no PageTitle beneath — a detail view, say. */
  title?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.topBar}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={HIT_SLOP}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <Icon name="back" size={24} color={color.ink} />
        </Pressable>
      ) : (
        <View style={styles.backSpacer} />
      )}

      {!!title && (
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {title}
        </Text>
      )}

      <View style={styles.topBarEnd}>{action}</View>
    </View>
  );
}

/** The one big statement per screen. Never two. */
export function PageTitle({ children, detail }: { children: string; detail?: string }) {
  return (
    <View style={styles.pageTitleWrap}>
      <Text style={styles.pageTitle}>{children}</Text>
      {!!detail && <Text style={styles.pageDetail}>{detail}</Text>}
    </View>
  );
}

/** A section header, optionally with a trailing text action. */
export function Section({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {title}
        </Text>
        {!!actionLabel && !!onAction && (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
            hitSlop={HIT_SLOP}
            style={({ pressed }) => [styles.sectionAction, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.sectionActionText}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

/* ─── the universal row ──────────────────────────────────────────────────── */

/**
 * Icon chip, title, subtitle, trailing.
 *
 * This one component replaced four bespoke list treatments. Uber's entire app is
 * this row: a saved place, a past trip, a payment method, a help topic. The chip
 * is what makes it scannable — you find the row by its icon and only then read
 * it, which matters at a red light.
 */
export function ListRow({
  icon,
  title,
  subtitle,
  trailing,
  onPress,
  chevron = false,
  tone = 'neutral',
  last = false,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Adds the affordance that says "this opens something". */
  chevron?: boolean;
  tone?: 'neutral' | 'orange';
  /** Suppresses the divider on the final row of a group. */
  last?: boolean;
}) {
  const label = subtitle ? `${title}. ${subtitle}` : title;

  const inner = (
    <>
      {!!icon && (
        <View style={[styles.chip, tone === 'orange' && { backgroundColor: color.orangeSoft }]}>
          <Icon
            name={icon}
            size={20}
            color={tone === 'orange' ? color.orangeDeep : color.ink}
          />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
      {chevron && <Icon name="chevron" size={20} color={color.inkFaint} />}
    </>
  );

  return (
    <>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.fill }]}
        >
          {inner}
        </Pressable>
      ) : (
        <View style={styles.row} accessible accessibilityLabel={label}>
          {inner}
        </View>
      )}
      {!last && <View style={styles.rowDivider} />}
    </>
  );
}

/** A group of rows on one white surface. Rows divide; the group does not. */
export function RowGroup({ children, style, ...rest }: ViewProps) {
  return (
    <View style={[styles.rowGroup, style]} {...rest}>
      {children}
    </View>
  );
}

/* ─── the journey ────────────────────────────────────────────────────────── */

/**
 * Pickup above delivery, joined by a stalk: a dot, a dashed line, a square.
 *
 * This is the single most recognisable thing a ride-hailing app draws, and it is
 * a better fit for freight than the side-by-side "MUSCAT → SALALAH" pair it
 * replaced. Two cities side by side compete for the same optical weight and both
 * truncate on a narrow screen; stacked, the order is unambiguous, neither
 * truncates, and long Arabic city names have the full width to sit in.
 */
export function RouteLine({
  from,
  to,
  labelFrom,
  labelTo,
  compact = false,
}: {
  from: string;
  to: string;
  labelFrom: string;
  labelTo: string;
  /** Drops the labels and shrinks the type, for a row inside a card. */
  compact?: boolean;
}) {
  return (
    <View
      style={styles.route}
      accessible
      accessibilityLabel={`${labelFrom} ${from}, ${labelTo} ${to}`}
    >
      <View style={styles.stalk} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={styles.stalkDot} />
        <View style={styles.stalkLine} />
        <View style={styles.stalkSquare} />
      </View>

      <View style={styles.routeText}>
        <View style={compact ? styles.routeStopCompact : styles.routeStop}>
          {!compact && <Text style={styles.routeLabel}>{labelFrom}</Text>}
          <Text style={compact ? styles.routeCityCompact : styles.routeCity} numberOfLines={1}>
            {from}
          </Text>
        </View>
        <View style={compact ? styles.routeStopCompact : styles.routeStop}>
          {!compact && <Text style={styles.routeLabel}>{labelTo}</Text>}
          <Text style={compact ? styles.routeCityCompact : styles.routeCity} numberOfLines={1}>
            {to}
          </Text>
        </View>
      </View>
    </View>
  );
}

/* ─── facts ──────────────────────────────────────────────────────────────── */

/**
 * The small facts under a route — date, truck, weight.
 *
 * Rendered as icon+value chips rather than a label-over-value grid. The label
 * was doing nothing a recognisable icon does not do faster, and dropping it
 * halves the vertical space this block costs.
 */
export function FactChips({ facts }: { facts: { icon: IconName; label: string; value: string }[] }) {
  return (
    <View style={styles.chips}>
      {facts.map((f) => (
        <View key={f.label} style={styles.factChip} accessible accessibilityLabel={`${f.label}: ${f.value}`}>
          <Icon name={f.icon} size={16} color={color.inkSoft} />
          <Text style={styles.factValue} numberOfLines={1}>
            {f.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/* ─── the pinned action ──────────────────────────────────────────────────── */

/**
 * The bar the primary action lives in.
 *
 * Pinned rather than in the scroll, because a CTA below the fold is a CTA that
 * does not exist to someone who has never scrolled a page on purpose. The
 * bottom inset is handled here so no screen has to think about it.
 */
export function ActionBar({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <View style={styles.actionBar}>
      {!!note && <Text style={styles.actionNote}>{note}</Text>}
      {children}
    </View>
  );
}

/* ─── absence ────────────────────────────────────────────────────────────── */

/**
 * An empty state that teaches the interface rather than reporting absence.
 * The icon is the point: an empty screen with no shape on it reads as broken.
 */
export function EmptyState({
  icon,
  title,
  explain,
  children,
}: {
  icon: IconName;
  title: string;
  explain: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={30} color={color.inkSoft} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyExplain}>{explain}</Text>
      {children}
    </View>
  );
}

/* ─── segmented control ──────────────────────────────────────────────────── */

/**
 * Two or three mutually exclusive views of the same list.
 *
 * Only for switching what a list *shows* — never for answering a question. A
 * question gets `Choice` rows, which are bigger, labelled, and readable in a cab.
 */
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.count == null ? o.label : `${o.label}, ${o.count}`}
            style={({ pressed }) => [
              styles.segment,
              on && styles.segmentOn,
              pressed && !on && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
              {o.count ? `${o.label} (${o.count})` : o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── identity ───────────────────────────────────────────────────────────── */

/** Initials in a circle. No photograph exists for a driver, and none is invented. */
export function Avatar({ name, size = 48 }: { name: string; size?: number }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();

  return (
    <View
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: GUTTER - space.sm,
    minHeight: 52,
  },
  backBtn: {
    width: MIN_TARGET,
    height: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backSpacer: { width: space.sm },
  topBarTitle: { ...font.section, color: color.ink, flex: 1, textAlign: align.start },
  topBarEnd: { marginStart: 'auto', flexDirection: 'row', alignItems: 'center', gap: space.sm },

  pageTitleWrap: { paddingHorizontal: GUTTER, paddingTop: space.sm, paddingBottom: space.lg, gap: space.sm },
  pageTitle: { ...font.display, color: color.ink, textAlign: align.start },
  pageDetail: { ...font.body, color: color.inkSoft, textAlign: align.start },

  section: { gap: space.md },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: GUTTER,
  },
  sectionTitle: { ...font.section, color: color.ink, flexShrink: 1, textAlign: align.start },
  sectionAction: { minHeight: MIN_TARGET, justifyContent: 'center' },
  sectionActionText: { ...font.label, color: color.orange },

  rowGroup: {
    backgroundColor: color.paper,
    borderRadius: radius.card,
    overflow: 'hidden',
    ...elevation.card,
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  rowDivider: {
    height: doc.rule,
    backgroundColor: color.line,
    // Indented to clear the chip, so the divider reads as separating rows rather
    // than cutting the card in half.
    marginStart: space.lg + CHIP + space.md,
  },
  chip: {
    width: CHIP,
    height: CHIP,
    borderRadius: radius.pill,
    backgroundColor: color.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...font.rowTitle, color: color.ink, textAlign: align.start },
  rowSubtitle: { ...font.bodySmall, color: color.inkSoft, textAlign: align.start },

  route: { flexDirection: 'row', gap: space.md },
  stalk: { alignItems: 'center', paddingTop: 6 },
  stalkDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: color.ink,
  },
  stalkLine: { flex: 1, width: 2, minHeight: 22, backgroundColor: color.line, marginVertical: 4 },
  stalkSquare: { width: 10, height: 10, backgroundColor: color.orange, borderRadius: 2 },
  routeText: { flex: 1, gap: space.lg },
  routeStop: { gap: 2 },
  routeStopCompact: { justifyContent: 'center', minHeight: 22 },
  routeLabel: { ...font.micro, color: color.inkSoft, textAlign: align.start },
  routeCity: { ...font.title, color: color.ink, textAlign: align.start },
  routeCityCompact: { ...font.rowTitle, color: color.ink, textAlign: align.start },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  factChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: color.fill,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  factValue: { ...font.smallPrint, fontWeight: '700', color: color.ink },

  actionBar: {
    paddingHorizontal: GUTTER,
    paddingTop: space.md,
    paddingBottom: space.md,
    gap: space.sm,
    backgroundColor: color.paper,
    borderTopWidth: doc.rule,
    borderTopColor: color.line,
    ...elevation.raised,
  },
  actionNote: { ...font.smallPrint, color: color.inkSoft, textAlign: 'center' },

  empty: {
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.xxxl,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: color.fill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  emptyTitle: { ...font.section, color: color.ink, textAlign: 'center' },
  emptyExplain: { ...font.bodySmall, color: color.inkSoft, textAlign: 'center' },

  segmented: {
    flexDirection: 'row',
    gap: space.xs,
    backgroundColor: color.fill,
    borderRadius: radius.pill,
    padding: space.xs,
    marginHorizontal: GUTTER,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TARGET - 6,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  segmentOn: { backgroundColor: color.paper, ...elevation.card },
  segmentText: { ...font.label, color: color.inkSoft },
  segmentTextOn: { color: color.ink },

  avatar: {
    backgroundColor: color.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontWeight: '900', color: color.orangeDeep },
});
