/**
 * A load this driver is invited to name a price for (0045).
 *
 * Shaped like OfferCard so the offers list reads as one book, with one
 * difference at the top: an offer leads with what it pays, and an invitation has
 * no pay yet — the driver says what it is. So the card leads with the driver's
 * own price if they have sent one, and with the question if they have not.
 *
 * ONE ACCENT, the button. The pill is neutral, as on OfferCard.
 */

import { StyleSheet, Text, View } from 'react-native';

import { PressableSurface, PrimaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Chip, RouteRail, StatusPill } from '@/components/ui';
import { align, getLanguage, t } from '@/i18n';
import { formatWeight, formatWindow } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import type { BidInvite } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { alpha, color, elevation, font, hairline, radius, space } from '@/theme/tokens';
import { expiryLabel } from './OfferCard';

export function BidInviteCard({
  invite,
  origin,
  destination,
  compact = false,
  onOpen,
}: {
  invite: BidInvite;
  origin: string;
  destination: string;
  compact?: boolean;
  onOpen: () => void;
}) {
  const own =
    invite.own_bid_baisa == null ? null : formatMoney(invite.own_bid_baisa, 'OMR', getLanguage());

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.head}>
        <StatusPill label={t('drv.bid.pill')} tone="neutral" />
        <Text style={styles.expiry}>{expiryLabel(invite.bid_deadline)}</Text>
      </View>

      <Text style={own ? styles.own : styles.ownNone}>
        {own ? t('drv.bid.yours', { amount: own }) : t('drv.bid.none')}
      </Text>

      <View style={styles.route}>
        <RouteRail origin={origin} destination={destination} compact labelled={false} />
      </View>

      <View style={styles.chips}>
        <Chip label={safeText(invite.goods)} />
        {invite.weight_kg != null && <Chip label={formatWeight(invite.weight_kg, '')} />}
        <Chip label={formatWindow(invite.pickup_from, invite.pickup_to)} />
      </View>

      <PrimaryButton label={own ? t('drv.bid.change') : t('drv.bid.cta')} onPress={onOpen} />

      <PressableSurface onPress={onOpen} accessibilityLabel={t('drv.offer.details')}>
        <Text style={styles.secondaryText}>{t('drv.offer.details')}</Text>
      </PressableSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderRadius: radius.offer,
    borderWidth: 1,
    borderColor: 'rgba(241,85,31,.32)',
    padding: space.xl,
    gap: space.lg,
    ...elevation.cardInk,
  },
  cardCompact: { padding: space.lg, gap: space.md },

  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  expiry: { ...arabicIfNeeded(font.caption), color: alpha.onInk.tertiary },

  own: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start },
  ownNone: { ...arabicIfNeeded(font.body), color: alpha.onInk.body, textAlign: align.start },

  route: {
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: hairline.inner,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  secondaryText: {
    ...arabicIfNeeded(font.buttonSecondary),
    color: alpha.onInk.body,
    textAlign: align.start,
    minHeight: 44,
    lineHeight: 44,
  },
});
