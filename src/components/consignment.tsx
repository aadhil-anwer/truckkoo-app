/**
 * The consignment note's own components. See primitives.tsx for the direction
 * contract this serves.
 *
 * The route pair is the signature moment: two city names, large, with a ruled
 * line and a mirroring arrow between them. It is the one thing that must be
 * readable at arm's length in a moving cab, so it gets the largest type on the
 * screen and never truncates to a single line.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { align, directionArrow } from '@/i18n';
import { color, doc, font, space } from '@/theme/tokens';

import { Rule } from './primitives';

/* ─── route pair ─────────────────────────────────────────────────────────── */

export function RoutePair({
  from,
  to,
  labelFrom,
  labelTo,
}: {
  from: string;
  to: string;
  labelFrom: string;
  labelTo: string;
}) {
  return (
    // One accessible sentence, so a screen reader says "Muscat to Salalah"
    // instead of reading four disconnected fragments.
    <View
      style={styles.route}
      accessible
      accessibilityLabel={`${labelFrom} ${from}, ${labelTo} ${to}`}
    >
      <View style={styles.routeSide}>
        <Text style={styles.routeLabel}>{labelFrom.toUpperCase()}</Text>
        <Text style={styles.routeCity} numberOfLines={2}>
          {from}
        </Text>
      </View>

      {/* The arrow mirrors under RTL — a hardcoded → points the wrong way in Arabic. */}
      <Text style={styles.routeArrow} accessibilityElementsHidden>
        {directionArrow()}
      </Text>

      <View style={[styles.routeSide, styles.routeSideEnd]}>
        <Text style={styles.routeLabel}>{labelTo.toUpperCase()}</Text>
        <Text style={[styles.routeCity, { textAlign: align.end }]} numberOfLines={2}>
          {to}
        </Text>
      </View>
    </View>
  );
}

/* ─── note body ──────────────────────────────────────────────────────────── */

/** Padded interior of a note. Keeps the gutter consistent everywhere. */
export function NoteBody({ children, gap = space.md }: { children: ReactNode; gap?: number }) {
  return <View style={[styles.body, { gap }]}>{children}</View>;
}

/**
 * A row of small facts along the foot of a note — dates, truck, weight.
 * Wraps rather than truncating, because a driver needs the date more than we
 * need a tidy single line.
 */
export function FactRow({ facts }: { facts: { label: string; value: string }[] }) {
  return (
    <View style={styles.facts}>
      {facts.map((f) => (
        <View key={f.label} style={styles.fact}>
          <Text style={styles.factLabel}>{f.label.toUpperCase()}</Text>
          <Text style={styles.factValue} numberOfLines={1}>
            {f.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The reference strip at a note's foot. */
export function NoteFoot({ reference, children }: { reference: string; children?: ReactNode }) {
  return (
    <>
      <Rule />
      <View style={styles.foot}>
        <Text style={styles.reference} numberOfLines={1}>
          {reference}
        </Text>
        {children}
      </View>
    </>
  );
}

/* ─── ledger rows ────────────────────────────────────────────────────────── */

/**
 * A ruled line item inside a sheet that lists rather than details — declared
 * routes, finished loads.
 *
 * A route the driver already knows does not need a full note; it needs a line in
 * a book. Rows are separated by the same hairline that rules everything else, so
 * a list sheet is visibly the same document as a detail sheet rather than a
 * different component family.
 */
export function LedgerRow({
  route,
  meta,
  trailing,
  last = false,
  onPress,
}: {
  route: string;
  meta?: string;
  trailing?: ReactNode;
  last?: boolean;
  /** Makes the whole row the target. The row is already ≥60pt tall. */
  onPress?: () => void;
}) {
  const label = meta ? `${route}. ${meta}` : route;

  const body = (
    <View style={styles.rowText}>
      <Text style={styles.rowRoute} numberOfLines={2}>
        {route}
      </Text>
      {!!meta && (
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
      )}
    </View>
  );

  return (
    <>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: color.paperDeep }]}
        >
          {body}
          {trailing}
        </Pressable>
      ) : (
        <View style={styles.row} accessible accessibilityLabel={label}>
          {body}
          {trailing}
        </View>
      )}
      {!last && <Rule />}
    </>
  );
}

/* ─── empty state ────────────────────────────────────────────────────────── */

/**
 * An empty state that teaches the interface rather than reporting absence
 * (craft floor). Rendered as a blank note with a dashed rule: visibly the same
 * document, waiting to be filled in.
 */
export function BlankNote({
  title,
  explain,
  children,
}: {
  title: string;
  explain: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.blank}>
      <Text style={styles.blankTitle}>{title}</Text>
      <Text style={styles.blankExplain}>{explain}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  route: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  routeSide: { flex: 1, gap: 4 },
  routeSideEnd: { alignItems: 'flex-end' },
  routeLabel: { ...doc.fieldLabel, color: color.inkSoft },
  routeCity: { ...doc.endpoint, color: color.ink, textAlign: align.start },
  routeArrow: {
    fontSize: 20,
    lineHeight: 26,
    color: color.orange,
    fontWeight: '800',
    // Optically align the arrow with the city names, not their labels.
    marginTop: 18,
  },

  body: { paddingHorizontal: doc.gutter, paddingVertical: space.md },

  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, rowGap: space.sm },
  fact: { gap: 2, minWidth: 88 },
  factLabel: { ...doc.fieldLabel, color: color.inkSoft },
  factValue: { ...font.label, color: color.ink, textAlign: align.start },

  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: doc.gutter,
    paddingVertical: space.sm,
    backgroundColor: color.paperDeep,
  },
  reference: { ...doc.reference, color: color.inkSoft, flexShrink: 1 },

  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: doc.gutter,
    paddingVertical: space.md,
  },
  rowText: { flex: 1, gap: 3 },
  rowRoute: { ...font.cardTitle, color: color.ink, textAlign: align.start },
  rowMeta: { ...doc.fieldLabel, color: color.inkSoft, textAlign: align.start },

  blank: {
    borderWidth: doc.rule,
    borderColor: color.line,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingHorizontal: doc.gutter,
    paddingVertical: space.xxl,
    gap: space.sm,
    alignItems: 'flex-start',
  },
  blankTitle: { ...font.cardTitle, color: color.ink, textAlign: align.start },
  blankExplain: { ...font.bodySmall, color: color.inkSoft, textAlign: align.start },
});
