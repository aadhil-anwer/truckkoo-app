/**
 * "Go available" — the driver's switch, Uber's "go online" (0036).
 *
 * While it is on, loads near the truck are offered to this driver in waves; off,
 * nothing is. The town beside it is where the dispatcher thinks the truck is —
 * snapped server-side from one GPS reading, or taken from where the last
 * delivery ended. Saying which town, out loud, is what lets a driver notice it
 * is wrong.
 *
 * Neutral on purpose: an offer card's "Take it" is this screen's one accent, and
 * a switch competing with it would make two things shout at once.
 */
import { StyleSheet, Text, View } from 'react-native';

import { SecondaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { StatusPill } from '@/components/ui';
import { align, t } from '@/i18n';
import { alpha, color, font, radius, space } from '@/theme/tokens';

export function AvailabilityCard({
  available,
  town,
  pending,
  onToggle,
}: {
  available: boolean;
  /** Localised town name, or null when it is not known yet. */
  town: string | null;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <View
      testID="availability-card"
      style={styles.card}
      // One announcement for the whole state: "You are available, Near Muscat".
      accessible
      accessibilityLabel={[
        t(available ? 'drv.avail.on' : 'drv.avail.off'),
        town ? t('drv.avail.near', { city: town }) : t('drv.avail.unknown'),
      ].join(', ')}
    >
      <View style={styles.head}>
        <StatusPill label={t(available ? 'drv.avail.on' : 'drv.avail.off')} />
        <Text style={styles.town} numberOfLines={1}>
          {town ? t('drv.avail.near', { city: town }) : t('drv.avail.unknown')}
        </Text>
      </View>
      <Text style={styles.help}>{t(available ? 'drv.avail.help' : 'drv.avail.why')}</Text>
      <SecondaryButton
        label={t(available ? 'drv.avail.goOff' : 'drv.avail.goOn')}
        onPress={onToggle}
        disabled={pending}
        icon="truck"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  town: {
    ...arabicIfNeeded(font.body),
    color: color.lightText,
    flexShrink: 1,
    textAlign: align.start,
  },
  help: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.body, textAlign: align.start },
});
