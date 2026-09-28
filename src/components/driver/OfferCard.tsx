/**
 * One offer, as the driver has to judge it.
 *
 * THE PAYOUT LEADS. A driver deciding in a cab against a clock has one question
 * — what do I get, and what does it cost me to get it — so the card is ordered
 * as that question: money, then the detour, then the route, then the cargo.
 * Everything below the money is what they already half-know, because they
 * declared the leg it matched.
 *
 * ONE ACCENT, and it belongs to `Take it`. So the `FITS YOUR TRUCK` pill is
 * neutral: a pill and a button both in orange leaves the screen with no primary
 * action, only two loud things.
 *
 * The detour is stated up front and prefixed "about". It is great-circle
 * distance between city centres on roads that are neither straight nor centred,
 * and a number drawn as a fact it is not would be the first thing a driver
 * caught the app lying about.
 */

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { DriverMoney } from './Money';
import { Icon } from '@/components/icon';
import { PressableSurface, PrimaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Chip, RouteRail, StatusPill } from '@/components/ui';
import { align, formatNumber, t } from '@/i18n';
import { formatDeadline, formatWeight } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import type { DriverOffer } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { alpha, color, elevation, font, hairline, radius, space } from '@/theme/tokens';

export function OfferCard({
  offer,
  origin,
  destination,
  compact = false,
  onPress,
  onTake,
  onPass,
  takeBusy = false,
  passBusy = false,
}: {
  offer: DriverOffer;
  origin: string;
  destination: string;
  /** In the offers list, where the card is one of several. */
  compact?: boolean;
  onPress?: () => void;
  onTake: () => void;
  onPass?: () => void;
  /**
   * Which of the two buttons is mid-request. Kept separate — not one
   * `busy` — because a driver who pressed "Pass" must not watch "Take it"
   * spin instead: they are answering the same offer in opposite directions,
   * and the wrong button lighting up reads as having pressed the wrong one.
   */
  takeBusy?: boolean;
  passBusy?: boolean;
}) {
  const amount = formatMoney(offer.payout_baisa, offer.currency as Currency);
  // The label carries the amount, so the thing a driver is agreeing to is in the
  // thing they press — and a screen reader announces it rather than "Take it".
  const takeLabel = amount ? t('drv.offer.take', { amount }) : t('drv.offer.take.bare');

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={styles.head}>
        {/* Neutral. The accent on this card is the button. */}
        <StatusPill label={t('drv.offer.fits')} tone="neutral" />
        <Text style={styles.expiry}>{expiryLabel(offer.expires_at)}</Text>
      </View>

      <DriverMoney
        payout={offer.payout_baisa}
        collect={offer.collect_baisa}
        owed={offer.owed_baisa}
        currency={offer.currency}
        size={compact ? 'row' : 'hero'}
      />

      <View style={styles.route}>
        <RouteRail origin={origin} destination={destination} compact labelled={false} />

        {offer.detour_km != null && (
          <View style={styles.detour}>
            <Icon name="routes" size={16} tint={alpha.onInk.tertiary} />
            <Text style={styles.detourText}>
              {t('drv.offer.detour', { km: formatNumber(Math.round(offer.detour_km)) })}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.chips}>
        <Chip label={safeText(offer.goods)} />
        {offer.weight_kg != null && <Chip label={formatWeight(offer.weight_kg, '')} />}
        {offer.free_after_kg != null && (
          <Chip
            label={t('drv.offer.freeAfter', { weight: formatWeight(offer.free_after_kg, '') })}
          />
        )}
      </View>

      <PrimaryButton label={takeLabel} onPress={onTake} loading={takeBusy} disabled={passBusy} />

      <View style={styles.secondary}>
        {!!onPress && (
          <PressableSurface
            onPress={onPress}
            accessibilityLabel={t('drv.offer.details')}
            disabled={takeBusy || passBusy}
          >
            <Text style={styles.secondaryText}>{t('drv.offer.details')}</Text>
          </PressableSurface>
        )}
        {!!onPass && (
          // Saying no must be as easy to hit as saying yes. A 16pt "no" beside a
          // 44pt "yes" is a design that lies about the choice. And the two
          // buttons never share one loading signal — see takeBusy/passBusy.
          <PressableSurface
            onPress={onPass}
            accessibilityLabel={t('drv.offer.pass')}
            disabled={takeBusy || passBusy}
            style={styles.pass}
          >
            {passBusy ? (
              <ActivityIndicator color={alpha.onInk.body} />
            ) : (
              <Text style={styles.secondaryText}>{t('drv.offer.pass')}</Text>
            )}
          </PressableSurface>
        )}
      </View>
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

  // Hairlines divide rows INSIDE a surface, which is exactly what this is.
  route: {
    gap: space.sm,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: hairline.inner,
  },
  detour: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  detourText: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.secondary, textAlign: align.start },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pass: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md },
  secondaryText: {
    ...arabicIfNeeded(font.buttonSecondary),
    color: alpha.onInk.body,
    textAlign: align.start,
    minHeight: 44,
    lineHeight: 44,
  },
});

/**
 * A wave offer lives five minutes (0036), so "Expires Tue 10:53 AM" hides the
 * one fact that matters — how long is left. Inside the hour it counts minutes;
 * a dispatcher's longer offer keeps its deadline. Refreshed with the offer list
 * every 15 s, which is finer than the minute it shows.
 */
export function expiryLabel(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms > 0 && ms <= 60 * 60 * 1000) {
    return t('drv.offer.minutesLeft', { minutes: formatNumber(Math.max(1, Math.ceil(ms / 60000))) });
  }
  return t('drv.offer.expires', { when: formatDeadline(iso) });
}
