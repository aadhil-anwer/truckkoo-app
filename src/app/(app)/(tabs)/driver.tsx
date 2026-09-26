/**
 * D1 / D3 · The driver's home.
 *
 * ONE SCREEN, TWO STATES, like the shipper's. The difference is whether
 * `driver_offers()` returned anything — the handoff draws them apart because a
 * gallery cannot show state.
 *
 * D1 OPENS ON MONEY. The offer card is the screen: what the driver keeps, in
 * Instrument Serif, before the route or the cargo. A driver reading this at a
 * fuel stop is answering one question, and the layout is that question.
 *
 * D3 NAMES THE CONSEQUENCE, NOT THE STATE. "No offers yet" tells a driver
 * nothing they can act on. An empty book here means an empty truck — and the
 * only thing that fills it is a declared route, which is why the empty state's
 * action is exactly that. The matching engine is worth nothing until drivers
 * habitually declare their legs (PRODUCT.md), so the emptiest screen in the app
 * is the one that has to sell the habit hardest.
 *
 * NO MAP. There is nothing to orient: the offers are not places yet, they are a
 * decision. An orange bloom gives the screen its ground instead.
 *
 * EARNINGS ARE ABSENT, NEVER ZEROED. "0.000 OMR this week" reads as failure to
 * the person who has not started yet (CLAUDE.md #5).
 *
 * The live trip keeps a home here even though D7 owns the job: the driver tabs
 * are home / offers / routes / account, so with no jobs tab this is the only
 * route to a delivery in progress.
 *
 * A TAKEN LOAD TAKES OVER HOME. Once a driver has said yes, the newest job leads
 * the screen as a full card and pending offers leave it — they stay on the
 * Offers tab, whose badge still counts them. A driver on the road is answering
 * "where am I going", not "what else could I carry". Any other job still open
 * keeps the compact row, so none is left without a way back to it.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { JobCard } from '@/components/driver/JobCard';
import { OfferCard } from '@/components/driver/OfferCard';
import { PressableSurface, PrimaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { QuestionHeading, Skeleton, StatusPill } from '@/components/ui';
import { align, formatNumber, localized, t, type StringKey } from '@/i18n';
import { formatMoney } from '@/lib/money';
import { DECLARED_TRIPS } from '@/lib/features';
import {
  cityIndex,
  useCities,
  useDriverEarnings,
  useDriverOffers,
  useDriverTrip,
  useMyTrips,
  useRespondToOffer,
} from '@/lib/queries';
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

export default function DriverHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cities = useCities();
  const offers = useDriverOffers();
  const earnings = useDriverEarnings();
  const trips = useMyTrips();
  const respond = useRespondToOffer();
  const [error, setError] = useState<string | null>(null);

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  const pending = offers.data ?? [];
  const week = earnings.data;
  const weekAmount = week ? formatMoney(week.week_baisa, 'OMR') : null;
  // Newest first — `useMyTrips` orders by created_at desc — so the job just
  // taken is the one that leads.
  const active = (trips.data ?? []).filter(
    (tr) => tr.status === 'assigned' || tr.status === 'in_transit',
  );
  const lead = active[0];
  const others = active.slice(1);
  const job = useDriverTrip(lead?.id);

  const busy = offers.isPending || trips.isPending;
  const failed = offers.isError || trips.isError;

  function refetchAll() {
    offers.refetch();
    earnings.refetch();
    trips.refetch();
  }

  /**
   * Answer an offer.
   *
   * The decline path carries the same error handling as the accept path: since
   * 0013 a decline is what returns the shipper's load to the dispatcher, so one
   * that fails silently strands the load.
   */
  function answer(offerId: string, accept: boolean) {
    setError(null);
    respond.mutate(
      { offerId, accept },
      {
        onError: (e: unknown) => {
          // The race, made recognisable. 0013 raises a domain error rather than a
          // constraint violation precisely so this line can exist.
          const msg = e instanceof Error ? e.message : '';
          setError(
            msg.includes('load already assigned') ? t('driver.offer.taken') : t('error.generic'),
          );
        },
      },
    );
  }

  const greeting = lead
    ? t('drv.home.onJob')
    : pending.length === 0
      ? t('drv.home.greeting.none')
      : `${formatNumber(pending.length)} ${
          pending.length === 1 ? t('drv.home.greeting.one') : t('drv.home.greeting.some')
        }`;

  return (
    <View style={styles.screen}>
      {/* The ground. A bloom rather than a map: there is nothing to orient yet. */}
      <View style={styles.bloom} pointerEvents="none" />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space.lg, paddingBottom: TABBAR_CLEARANCE_3 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={offers.isRefetching || trips.isRefetching}
            onRefresh={refetchAll}
            tintColor={color.lightText}
          />
        }
      >
        <Text style={styles.greeting} numberOfLines={2}>
          {greeting}
        </Text>

        {/* Only once it is real, and only once it formats. `formatMoney` returns
            null for a currency it does not know, and a week's earnings rendered
            as "null this week" is worse than no line at all. */}
        {!!week && week.week_baisa > 0 && !!weekAmount && (
          <Text style={styles.week}>{t('drv.home.week', { amount: weekAmount })}</Text>
        )}

        {/* The job just taken, in full. */}
        {!!lead &&
          (job.data ? (
            <JobCard
              job={job.data}
              origin={cityName(job.data.origin_city)}
              destination={cityName(job.data.dest_city)}
              onOpen={() => router.push(`/trip/${lead.id}`)}
            />
          ) : (
            <Skeleton height={300} round={radius.offer} />
          ))}

        {/* Any other open job, compact: a way back to D7, never lost. Neutral,
            because the lead card's button already holds the one accent. */}
        {others.map((tr) => (
          <PressableSurface
            key={tr.id}
            onPress={() => router.push(`/trip/${tr.id}`)}
            accessibilityLabel={t(`status.${tr.status}` as StringKey)}
            style={styles.job}
          >
            <Icon name="truck" size={22} tint={color.lightText} />
            <View style={styles.jobText}>
              <StatusPill label={t(`status.${tr.status}` as StringKey)} tone="neutral" />
            </View>
            <Icon name="chevron" size={18} tint={alpha.onInk.tertiary} />
          </PressableSurface>
        ))}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {busy && (
          <View style={styles.skeletons}>
            {/* Skeletons at the final geometry, never a spinner. */}
            <Skeleton height={300} round={radius.offer} />
          </View>
        )}

        {failed && (
          <PressableSurface
            onPress={refetchAll}
            accessibilityLabel={t('common.error.aria')}
            style={styles.retry}
          >
            <Text style={styles.retryText}>{t('common.error.title')}</Text>
            <Text style={styles.retryAction}>{t('common.retry')}</Text>
          </PressableSurface>
        )}

        {!busy && !failed && !lead && pending.length === 0 && (
          <View style={styles.empty}>
            <QuestionHeading ground="ink" size="question">
              {DECLARED_TRIPS ? t('drv.none.title') : t('drv.waiting.title')}
            </QuestionHeading>
            <Text style={styles.body}>
              {DECLARED_TRIPS ? t('drv.none.body') : t('drv.waiting.body')}
            </Text>
          </View>
        )}

        {!lead &&
          pending.map((offer) => (
            <OfferCard
              key={offer.offer_id}
              offer={offer}
              origin={cityName(offer.origin_city)}
              destination={cityName(offer.dest_city)}
              onPress={() => router.push(`/offer/${offer.offer_id}`)}
              onTake={() => answer(offer.offer_id, true)}
              onPass={() => answer(offer.offer_id, false)}
              busy={respond.isPending && respond.variables?.offerId === offer.offer_id}
            />
          ))}

        {/* Declaring a route is what produces offers, so it is reachable whether
            the book is empty or full. It sits in the flow rather than pinned:
            the tab bar already floats at the thumb, and a second floating bar
            above it is two things competing for the same 80pt. */}
        {/* Hidden on a job: the job card's button is the screen's one accent.
            Hidden entirely while declared trips are unreleased. */}
        {DECLARED_TRIPS && !busy && !failed && !lead && (
          <View style={styles.add}>
            <PrimaryButton
              label={t('drv.none.add')}
              icon="plus"
              onPress={() => router.push('/leg/route')}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  // Positioned off-canvas so only the falloff is on screen — the handoff's
  // bloom, not a gradient band.
  bloom: {
    position: 'absolute',
    top: -70,
    insetInlineStart: -90,
    width: 520,
    height: 420,
    borderRadius: 260,
    backgroundColor: 'rgba(241,85,31,.18)',
  },

  scroll: { paddingHorizontal: GUTTER_INK, gap: space.lg },
  greeting: { ...arabicIfNeeded(font.statement), color: color.lightText, textAlign: align.start },
  week: { ...arabicIfNeeded(font.body), color: alpha.onInk.body, textAlign: align.start },

  job: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 64,
    paddingHorizontal: space.lg,
    borderRadius: radius.row,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: hairline.card,
  },
  jobText: { flex: 1, alignItems: 'flex-start' },

  empty: { gap: space.sm, marginTop: space.xl, maxWidth: 320 },
  body: { ...arabicIfNeeded(font.body), color: alpha.onInk.body, textAlign: align.start },

  skeletons: { gap: space.md, marginTop: space.lg },
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

  add: { marginTop: space.md },
});
