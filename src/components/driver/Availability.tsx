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
import type { LocationAccess } from '@/lib/background-location';
import { alpha, color, font, radius, space } from '@/theme/tokens';

export function AvailabilityCard({
  available,
  town,
  pending,
  onToggle,
  location,
  lastSentAge,
  onFixLocation,
}: {
  available: boolean;
  /** Localised town name, or null when it is not known yet. */
  town: string | null;
  pending: boolean;
  onToggle: () => void;
  /** What the phone lets us do (0039); null until known. */
  location: LocationAccess | null;
  /** formatAge(located_at) — null when nothing has been sent yet. */
  lastSentAge: string | null;
  onFixLocation: () => void;
}) {
  // Only while available: offline, nothing is tracked, so there is nothing to say.
  const locationLine =
    !available || location === null
      ? null
      : location === 'always'
        ? lastSentAge
          ? t('loc.card.always', { age: lastSentAge })
          : t('loc.card.waiting')
        : location === 'foreground'
          ? t('loc.card.foreground')
          : t('loc.card.none');
  return (
    <View
      testID="availability-card"
      style={styles.card}
      // One announcement for the whole state: "You are available, Near Muscat".
      accessible
      accessibilityLabel={[
        t(available ? 'drv.avail.on' : 'drv.avail.off'),
        town ? t('drv.avail.near', { city: town }) : t('drv.avail.unknown'),
        ...(locationLine ? [locationLine] : []),
      ].join(', ')}
    >
      <View style={styles.head}>
        <StatusPill label={t(available ? 'drv.avail.on' : 'drv.avail.off')} />
        {/* Wraps rather than truncating: "Your town is not known yet" was cut
            to "Your town is not k…" beside the pill on a 1080-wide phone. */}
        <Text style={styles.town}>
          {town ? t('drv.avail.near', { city: town }) : t('drv.avail.unknown')}
        </Text>
      </View>
      <Text style={styles.help}>{t(available ? 'drv.avail.help' : 'drv.avail.why')}</Text>
      {/* 0076: no live location, no jobs — said as a problem, not a note. */}
      {!!locationLine && (
        <Text style={location === 'none' ? styles.warn : styles.help}>{locationLine}</Text>
      )}
      {!!locationLine && location !== 'always' && (
        <SecondaryButton label={t('loc.card.turnOn')} onPress={onFixLocation} icon="pickup" />
      )}
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
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  town: {
    ...arabicIfNeeded(font.body),
    color: color.lightText,
    flexShrink: 1,
    textAlign: align.start,
  },
  help: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.body, textAlign: align.start },
  warn: { ...arabicIfNeeded(font.bodySmall), color: color.dangerLight, textAlign: align.start },
});
