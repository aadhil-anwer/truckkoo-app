/**
 * A live load, as a card.
 *
 * Route, status, and the two facts a shipper checks: when it goes and what it
 * costs. Everything else is one tap away, which is the whole reason the detail
 * screen exists.
 *
 * TRANSITIONAL. This is the pre-redesign card, lifted out of the shipper home
 * when P3 rebuilt that screen on the map. It still serves the loads tab (X1),
 * which is P7's to rebuild — at which point this file goes with it. It was
 * extracted rather than left in place because a screen importing components
 * from a sibling screen is how two screens quietly become one.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { FactChips, RouteLine, Stamp, type StampTone } from '@/components/legacy';
import { formatMoney, type Currency } from '@/lib/money';
import { formatWindow } from '@/lib/format';
import { align, getLanguage, t, type StringKey } from '@/i18n';
import { color, elevation, font, radius, space } from '@/theme/tokens';
import type { Load, LoadStatus } from '@/lib/queries';

/** Status -> tone. One place, so no screen invents its own mapping. */
export const TONE: Record<LoadStatus, StampTone> = {
  posted: 'pending',
  finding_truck: 'active',
  // A price waiting on the shipper is the most actionable state in the list, so
  // it reads as live rather than pending.
  quoted: 'active',
  accepted: 'active',
  matched: 'active',
  assigned: 'active',
  in_transit: 'active',
  delivered: 'done',
  closed: 'done',
  cancelled: 'stopped',
};

/** Still working its way to a truck, rather than already finished. */
export const LIVE: LoadStatus[] = [
  'posted',
  'finding_truck',
  // Omitting these two would hide a load from the shipper's live list at exactly
  // the moment it is asking them a question.
  'quoted',
  'accepted',
  'matched',
  'assigned',
  'in_transit',
];

/* ─── one live load, as a card ───────────────────────────────────────────── */

/**
 * Route, status, and the two facts a shipper checks: when it goes, what it
 * costs. Everything else is one tap away, which is the whole reason the detail
 * screen exists.
 */
export function LoadCard({
  load,
  cityName,
  truckName,
  onPress,
}: {
  load: Load;
  cityName: (id: number) => string;
  truckName: Map<string, string>;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${cityName(load.origin_city)} ${t('label.to')} ${cityName(load.dest_city)}. ${t(`status.${load.status}` as StringKey)}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      <View style={styles.cardHead}>
        <Stamp tone={TONE[load.status]}>{t(`status.${load.status}` as StringKey)}</Stamp>
        <Icon name="chevron" size={20} tint={color.mutedText} />
      </View>

      <RouteLine
        from={cityName(load.origin_city)}
        to={cityName(load.dest_city)}
        labelFrom={t('label.from')}
        labelTo={t('label.to')}
        compact
      />

      <FactChips
        facts={[
          {
            icon: 'calendar',
            label: t('label.pickup'),
            value: formatWindow(load.pickup_from, load.pickup_to),
          },
          {
            icon: 'truck',
            label: t('label.truck'),
            // A null truck type is "Not sure — advise me", never blank.
            value: load.truck_type_code
              ? (truckName.get(load.truck_type_code) ?? load.truck_type_code)
              : t('truck.unset'),
          },
        ]}
      />

      {load.price_baisa != null && (
        <View style={styles.cardPrice}>
          {/* formatMoney, never toFixed(2) — OMR carries three decimals and a
              two-decimal render is a 10x error that looks plausible. */}
          <Text style={styles.priceAmount}>
            {formatMoney(load.price_baisa, load.currency as Currency, getLanguage())}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.creamCard,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
    ...elevation.cardCream,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardPrice: { flexDirection: 'row', alignItems: 'baseline' },
  priceAmount: { ...font.title, color: color.ink, textAlign: align.start },
});
