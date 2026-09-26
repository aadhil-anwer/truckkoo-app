/**
 * The job a driver is on, as the lead of their home.
 *
 * Once a driver has taken a load, that load is the only thing home is for. The
 * offers they have not answered are still theirs to answer, but on the Offers
 * tab — putting them under the job turns "where am I going" into "what else
 * could I be doing", which is the wrong question for someone already driving.
 *
 * Built from the offer card's parts on purpose: the same money, the same rail,
 * the same surface. The driver has already read this load once as an offer, and
 * the job should look like the thing they said yes to.
 *
 * ONE ACCENT. The button carries it, so the status pill is neutral — the same
 * rule OfferCard follows.
 */

import { StyleSheet, View } from 'react-native';

import { DriverMoney } from './Money';
import { PrimaryButton } from '@/components/primitives';
import { Chip, RouteRail, StatusPill } from '@/components/ui';
import { t, type StringKey } from '@/i18n';
import { formatWeight } from '@/lib/format';
import type { DriverTrip } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { color, elevation, hairline, radius, space } from '@/theme/tokens';

export function JobCard({
  job,
  origin,
  destination,
  onOpen,
}: {
  job: DriverTrip;
  origin: string;
  destination: string;
  onOpen: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <StatusPill label={t(`status.${job.status}` as StringKey)} tone="neutral" />
      </View>

      <DriverMoney
        payout={job.payout_baisa}
        collect={job.collect_baisa}
        owed={job.owed_baisa}
        currency={job.currency}
        size="hero"
      />

      <View style={styles.route}>
        {/* Labelled: unlike the offer card, nothing else on this card names the
            two cities for a screen reader. */}
        <RouteRail origin={origin} destination={destination} />
      </View>

      <View style={styles.chips}>
        <Chip label={safeText(job.goods)} />
        {job.weight_kg != null && <Chip label={formatWeight(job.weight_kg, '')} />}
      </View>

      <PrimaryButton label={t('drv.job.open')} onPress={onOpen} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.offer,
    borderWidth: 1,
    borderColor: hairline.card,
    padding: space.xl,
    gap: space.lg,
    ...elevation.cardInk,
  },
  head: { flexDirection: 'row', alignItems: 'center' },
  // Hairlines divide rows INSIDE a surface, which is exactly what this is.
  route: {
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: hairline.inner,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
