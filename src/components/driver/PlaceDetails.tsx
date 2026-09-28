/**
 * One end of a load, as the driver needs it at the gate: where, what to look
 * for, and who to call. Everything the shipper typed is sanitised on the way
 * out — the DB rejects bidi overrides too, both layers on purpose.
 *
 * The phone is dialled with spaces removed; it is shown as a name, not a number,
 * because the Call button is what a driver uses in a cab. After delivery
 * `driver_trip()` nulls the contact, so the same block shows the name alone.
 */
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PressableSurface } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { SectionLabel } from '@/components/ui';
import { align, t } from '@/i18n';
import type { LoadPlace } from '@/lib/queries';
import { oneLine, safeText } from '@/lib/safe-text';
import { alpha, color, font, radius, space } from '@/theme/tokens';

export function DriverPlaceDetails({ label, place }: { label: string; place: LoadPlace }) {
  const phone = place.contactPhone?.replace(/\s+/g, '') || null;
  return (
    <View style={styles.wrap}>
      <SectionLabel>{label}</SectionLabel>
      {!!place.name && <Text style={styles.name}>{oneLine(safeText(place.name))}</Text>}
      {!!place.note && <Text style={styles.note}>{safeText(place.note)}</Text>}
      {!!phone && (
        <View style={styles.contact}>
          <Text style={styles.contactName} numberOfLines={1}>
            {safeText(place.contactName ?? '')}
          </Text>
          <PressableSurface
            onPress={() => Linking.openURL(`tel:${phone}`).catch(() => {})}
            accessibilityLabel={t('places.call', { name: safeText(place.contactName || phone) })}
            style={styles.call}
          >
            <Icon name="phone" size={20} tint={color.ink} />
          </PressableSurface>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2, marginTop: space.md },
  name: { ...arabicIfNeeded(font.body), color: color.lightText, textAlign: align.start },
  note: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.body, textAlign: align.start },
  contact: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  contactName: {
    ...arabicIfNeeded(font.bodySmall),
    color: color.lightText,
    flex: 1,
    textAlign: align.start,
  },
  // D7's circle: 44px, the shipper's call button beside it is the same shape.
  call: {
    width: 44,
    height: 44,
    borderRadius: radius.round,
    backgroundColor: color.lightText,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
