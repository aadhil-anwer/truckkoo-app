/**
 * The driver's past trips — what they have delivered, and what it paid.
 *
 * Replaces Routes as the driver's third tab while declared trips are hidden
 * (src/lib/features.ts). A driver checks this to answer "was this month worth
 * it", so the month leads, then the trips that make it up.
 *
 * THE TOTAL AND THE ROWS COME FROM ONE CALCULATION. `month_baisa` is summed in
 * SQL over the same delivered trips `driver_trips()` lists, bucketed by the day
 * each was delivered in Oman (0033) — the app never adds up money, so the
 * headline cannot disagree with the list under it.
 *
 * No accent. Nothing here is live and nothing here is a decision; a finished
 * job is a record. Each row opens the job's own screen, which knows it is done.
 *
 * No map, for the reason Routes gave: a list of corridors drawn at once orients
 * nobody, and the driver already knows where these roads go.
 */

import { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PressableSurface } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { QuestionHeading, RouteRail, SectionLabel, Skeleton } from '@/components/ui';
import { align, formatNumber, localized, t } from '@/i18n';
import { formatOmanDay } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import { cityIndex, useCities, useDriverEarnings, useDriverPastTrips } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
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

export default function PastTripsTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cities = useCities();
  const trips = useDriverPastTrips();
  const earnings = useDriverEarnings();

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  const rows = trips.data ?? [];
  const month = earnings.data;
  const monthAmount = month ? formatMoney(month.month_baisa, 'OMR') : null;
  useAnnounceOnError(trips.isError, t('common.error.title'));

  function refetchAll() {
    trips.refetch();
    earnings.refetch();
    cities.refetch();
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space.lg, paddingBottom: TABBAR_CLEARANCE_3 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={trips.isRefetching}
            onRefresh={refetchAll}
            tintColor={color.lightText}
          />
        }
      >
        <Text style={styles.title}>{t('drv.past.title')}</Text>

        {/* Only once there is a month to show. "0.000 OMR" reads as failure to
            someone who has not started yet (CLAUDE.md #5) — the same rule home's
            week line follows. */}
        {!!month && month.month_trips > 0 && !!monthAmount && (
          <View style={styles.month}>
            <SectionLabel>{t('drv.past.month')}</SectionLabel>
            <Text style={styles.monthValue}>
              {month.month_trips === 1
                ? t('drv.past.monthTotal.one', { amount: monthAmount })
                : t('drv.past.monthTotal', {
                    amount: monthAmount,
                    count: formatNumber(month.month_trips),
                  })}
            </Text>
          </View>
        )}

        {trips.isPending && (
          <View style={styles.skeletons}>
            <Skeleton height={96} round={radius.card} />
            <Skeleton height={96} round={radius.card} />
          </View>
        )}

        {trips.isError && (
          <PressableSurface
            onPress={refetchAll}
            accessibilityLabel={t('common.error.aria')}
            style={styles.retry}
          >
            <Text style={styles.retryText}>{t('common.error.title')}</Text>
            <Text style={styles.retryAction}>{t('common.retry')}</Text>
          </PressableSurface>
        )}

        {!trips.isPending && !trips.isError && rows.length === 0 && (
          <View style={styles.empty}>
            <QuestionHeading ground="ink" size="question">
              {t('drv.past.none.title')}
            </QuestionHeading>
            <Text style={styles.body}>{t('drv.past.none.body')}</Text>
          </View>
        )}

        {rows.length > 0 && (
          <View style={styles.list}>
            {rows.map((trip, i) => {
              const origin = cityName(trip.origin_city);
              const destination = cityName(trip.dest_city);
              const date = formatOmanDay(trip.delivered_at);
              const amount = formatMoney(trip.payout_baisa, trip.currency as Currency);
              return (
                <PressableSurface
                  key={trip.trip_id}
                  onPress={() => router.push(`/trip/${trip.trip_id}`)}
                  accessibilityLabel={t('drv.past.aria', {
                    origin,
                    destination,
                    date,
                    amount: amount ?? '',
                  })}
                  style={[styles.row, i < rows.length - 1 && styles.rowDivided]}
                >
                  <View style={styles.rowMain}>
                    <RouteRail
                      origin={origin}
                      destination={destination}
                      compact
                      labelled={false}
                    />
                    <Text style={styles.meta} numberOfLines={1}>
                      {t('drv.past.row', { date, goods: safeText(trip.goods) })}
                    </Text>
                  </View>
                  <View style={styles.rowEnd}>
                    {/* Absent rather than blank or zero when a price is missing:
                        a figure the driver was never owed is worse than none. */}
                    {!!amount && <Text style={styles.amount}>{amount}</Text>}
                    <Icon name="chevron" size={18} tint={alpha.onInk.tertiary} />
                  </View>
                </PressableSurface>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  scroll: { paddingHorizontal: GUTTER_INK, gap: space.lg },

  title: { ...arabicIfNeeded(font.statement), color: color.lightText, textAlign: align.start },

  month: { gap: space.xs },
  monthValue: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start },

  // One surface, rows divided inside it — hairlines only ever divide rows
  // INSIDE a surface (CLAUDE.md), never float between cards.
  list: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: hairline.card,
    paddingHorizontal: space.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    minHeight: 64,
  },
  rowDivided: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: hairline.inner },
  rowMain: { flex: 1, gap: space.sm },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  meta: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.secondary, textAlign: align.start },
  amount: { ...arabicIfNeeded(font.rowTitle), color: color.lightText },

  empty: { gap: space.sm, marginTop: space.xl, maxWidth: 320 },
  body: { ...arabicIfNeeded(font.body), color: alpha.onInk.body, textAlign: align.start },

  skeletons: { gap: space.lg },

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
