/**
 * The offers tab — every load addressed to this driver.
 *
 * Drivers do **not** browse a load board. `SECURITY.md` and CLAUDE.md are
 * explicit, and it is a business decision before it is a security one: a board
 * would expose every shipper's cargo to anyone who signed up as a driver. What
 * lands here is only what dispatch (or the auto-dispatcher) addressed to this
 * person, and `driver_offers()` is what makes that true rather than this screen.
 *
 * Same card as D1, compressed. The home screen leads with one offer at hero
 * size; this is the full book, so the payout drops a size and everything else
 * stays — both answers on every card, because accepting is a commitment made in
 * a moving vehicle against a clock and nobody should have to scroll to find out
 * what they are agreeing to, or tap twice to say no.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfferCard } from '@/components/driver/OfferCard';
import { PressableSurface } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { QuestionHeading, SectionLabel, Skeleton } from '@/components/ui';
import { align, localized, t } from '@/i18n';
import { DECLARED_TRIPS } from '@/lib/features';
import { cityIndex, useCities, useDriverOffers, useRespondToOffer } from '@/lib/queries';
import { useAnnounceOnError } from '@/lib/use-announce-error';
import {
  GUTTER_INK,
  TABBAR_CLEARANCE_3,
  alpha,
  color,
  font,
  hairline,
  radius,
  space,
} from '@/theme/tokens';

export default function OffersTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cities = useCities();
  const offers = useDriverOffers();
  const respond = useRespondToOffer();
  const [error, setError] = useState<string | null>(null);

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  const pending = offers.data ?? [];
  useAnnounceOnError(offers.isError, t('common.error.title'));

  function refetchAll() {
    offers.refetch();
    cities.refetch();
  }

  /**
   * Answer an offer. The decline path carries the same error handling as the
   * accept path: since 0013 a decline is what returns the shipper's load to the
   * dispatcher, so one that fails silently strands it.
   */
  function answer(offerId: string, accept: boolean) {
    setError(null);
    respond.mutate(
      { offerId, accept },
      {
        onError: (e: unknown) => {
          const msg = e instanceof Error ? e.message : '';
          setError(
            msg.includes('load already assigned') ? t('driver.offer.taken') : t('error.generic'),
          );
        },
      },
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        testID="offers-scroll"
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space.lg, paddingBottom: TABBAR_CLEARANCE_3 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={offers.isRefetching}
            onRefresh={refetchAll}
            tintColor={color.lightText}
          />
        }
      >
        <SectionLabel>{t('tab.offers')}</SectionLabel>

        {!!error && <Text style={styles.error}>{error}</Text>}

        {offers.isPending && (
          <View style={styles.skeletons}>
            <Skeleton height={220} round={radius.offer} />
            <Skeleton height={220} round={radius.offer} />
          </View>
        )}

        {offers.isError && (
          <PressableSurface
            onPress={() => offers.refetch()}
            accessibilityLabel={t('common.error.aria')}
            style={styles.retry}
          >
            <Text style={styles.retryText}>{t('common.error.title')}</Text>
            <Text style={styles.retryAction}>{t('common.retry')}</Text>
          </PressableSurface>
        )}

        {!offers.isPending && !offers.isError && pending.length === 0 && (
          <View style={styles.empty}>
            {/* The same argument D3 makes, because it is the same problem: an
                empty book is an empty truck, and only a declared route fills it. */}
            <QuestionHeading ground="ink" size="question">
              {DECLARED_TRIPS ? t('drv.none.title') : t('drv.waiting.title')}
            </QuestionHeading>
            <Text style={styles.body}>
              {DECLARED_TRIPS ? t('drv.none.body') : t('drv.waiting.body')}
            </Text>
          </View>
        )}

        {pending.map((offer) => (
          <OfferCard
            key={offer.offer_id}
            offer={offer}
            origin={cityName(offer.origin_city)}
            destination={cityName(offer.dest_city)}
            compact
            onPress={() => router.push(`/offer/${offer.offer_id}`)}
            onTake={() => answer(offer.offer_id, true)}
            onPass={() => answer(offer.offer_id, false)}
            takeBusy={
              respond.isPending &&
              respond.variables?.offerId === offer.offer_id &&
              respond.variables.accept
            }
            passBusy={
              respond.isPending &&
              respond.variables?.offerId === offer.offer_id &&
              !respond.variables.accept
            }
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  scroll: { paddingHorizontal: GUTTER_INK, gap: space.lg },

  empty: { gap: space.sm, marginTop: space.xl, maxWidth: 320 },
  body: { ...arabicIfNeeded(font.body), color: alpha.onInk.body, textAlign: align.start },

  skeletons: { gap: space.lg },
  error: { ...arabicIfNeeded(font.body), color: color.dangerLight, textAlign: align.start },

  retry: {
    padding: space.lg,
    borderRadius: radius.row,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: hairline.card,
    gap: 2,
  },
  retryText: { ...arabicIfNeeded(font.body), color: color.lightText, textAlign: align.start },
  retryAction: { ...font.caption, color: color.accentLight, textAlign: align.start },
});
