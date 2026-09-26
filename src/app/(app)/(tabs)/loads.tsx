/**
 * X1 · Every load this shipper has ever posted, moving and finished.
 *
 * Home shows at most two live loads because home is about the *next* one. This
 * is the ledger: everything, segmented, in one scroll. Settlement is offline, so
 * the finished half is not an archive nobody visits — it is what an invoice gets
 * reconciled against, and it has to be as reachable as the live half.
 *
 * A segmented control rather than two tabs, because these are two views of one
 * list. `SelectRow` is for answering a question; this is not one.
 *
 * A MOVING LOAD IS A CARD, A FINISHED ONE IS A ROW. One is a journey being
 * followed and wants its route drawn; the other is a record being scanned for a
 * particular job and wants to be dense.
 *
 * NO ETA IS INVENTED. The arrival time comes from `trip_position`'s `eta_at`,
 * the same field T4 reads, and a load with no reported fix behind it shows its
 * pickup window instead. P6 deleted `progressOf` and `interpolate` on purpose; a
 * card is just as capable of making a position up as a map marker is.
 */

import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableSurface, PrimaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import {
  Card,
  DetailGroup,
  DetailRow,
  QuestionHeading,
  RouteRail,
  Segmented,
  Skeleton,
  StatusPill,
} from '@/components/ui';
import { align, directionArrow, localized, t, type StringKey } from '@/i18n';
import { formatDeadline, formatWindow } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import {
  cityIndex,
  useCities,
  useMyLoads,
  useMyTrips,
  useTripPosition,
  type Load,
  type LoadStatus,
} from '@/lib/queries';
import { useAnnounceOnError } from '@/lib/use-announce-error';
import {
  GUTTER_INK,
  TABBAR_CLEARANCE_3,
  alpha,
  color,
  font,
  radius,
  space,
} from '@/theme/tokens';

/**
 * Still working its way to a truck, rather than already finished.
 *
 * `quoted` and `accepted` belong here: omitting them would hide a load from the
 * shipper's live list at exactly the moment it is asking them a question.
 */
const LIVE: LoadStatus[] = [
  'posted',
  'finding_truck',
  'quoted',
  'accepted',
  'matched',
  'assigned',
  'in_transit',
];

/**
 * Which statuses read as live.
 *
 * The pill is the only accent on this screen, so there is no pinned accent
 * action competing with it — one accent per screen, and here it is spent on
 * state rather than on a button.
 */
const PILL_TONE: Record<LoadStatus, 'accent' | 'neutral'> = {
  posted: 'neutral',
  finding_truck: 'neutral',
  // A price waiting on the shipper is the most actionable state in the list.
  quoted: 'accent',
  accepted: 'accent',
  matched: 'accent',
  assigned: 'accent',
  in_transit: 'accent',
  delivered: 'neutral',
  closed: 'neutral',
  cancelled: 'neutral',
};

type LoadView = 'live' | 'past';

export default function LoadsTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cities = useCities();
  const loads = useMyLoads();
  const trips = useMyTrips();
  const [view, setView] = useState<LoadView>('live');

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  /** load_id -> trip_id, so a card can ask for its own position. */
  const tripFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const tr of trips.data ?? []) m.set(tr.load_id, tr.id);
    return m;
  }, [trips.data]);

  const all = loads.data ?? [];
  const active = all.filter((l) => LIVE.includes(l.status));
  const past = all.filter((l) => !LIVE.includes(l.status));
  const shown = view === 'live' ? active : past;
  useAnnounceOnError(loads.isError, t('common.error.title'));

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
            refreshing={loads.isRefetching}
            onRefresh={() => {
              loads.refetch();
              cities.refetch();
            }}
            tintColor={color.lightText}
          />
        }
      >
        <Text style={styles.title}>{t('loads.title')}</Text>

        <Segmented
          value={view}
          onChange={(v) => setView(v as LoadView)}
          options={[
            { value: 'live', label: t('loads.seg.live'), count: active.length },
            { value: 'past', label: t('loads.seg.past'), count: past.length },
          ]}
        />

        {/* Skeletons at the final geometry, never a spinner. */}
        {loads.isPending && (
          <View style={styles.skeletons}>
            <Skeleton height={132} round={radius.card} />
            <Skeleton height={132} round={radius.card} />
          </View>
        )}

        {loads.isError && (
          <PressableSurface
            onPress={() => {
              loads.refetch();
            }}
            accessibilityLabel={t('common.error.aria')}
            style={styles.retry}
          >
            <Text style={styles.retryText}>{t('common.error.title')}</Text>
            <Text style={styles.retryAction}>{t('common.retry')}</Text>
          </PressableSurface>
        )}

        {!loads.isPending && !loads.isError && shown.length === 0 && (
          <View style={styles.empty}>
            <QuestionHeading ground="ink" size="question">
              {view === 'live' ? t('cust.empty.title') : t('cust.record.none.title')}
            </QuestionHeading>
            <Text style={styles.body}>
              {view === 'live' ? t('cust.empty.explain') : t('cust.record.none.explain')}
            </Text>
            {view === 'live' && (
              <View style={styles.emptyAction}>
                <PrimaryButton
                  label={t('cust.empty.action')}
                  onPress={() => router.push('/book/origin')}
                />
              </View>
            )}
          </View>
        )}

        {shown.length > 0 &&
          (view === 'live' ? (
            <View style={styles.cards}>
              {shown.map((load) => (
                <MovingCard
                  key={load.id}
                  load={load}
                  tripId={tripFor.get(load.id)}
                  cityName={cityName}
                  onPress={() => router.push(`/load/${load.id}`)}
                />
              ))}
            </View>
          ) : (
            <DetailGroup label={t('cust.record.title')}>
              {shown.map((l) => (
                <DetailRow
                  key={l.id}
                  // Never a hardcoded arrow: it points at the wrong city in Arabic.
                  label={`${cityName(l.origin_city)} ${directionArrow()} ${cityName(l.dest_city)}`}
                  value={formatWindow(l.pickup_from, l.pickup_to)}
                  onPress={() => router.push(`/load/${l.id}`)}
                />
              ))}
            </DetailGroup>
          ))}
      </ScrollView>
    </View>
  );
}

/**
 * One moving load.
 *
 * It asks for its own position rather than being handed one, which costs one RPC
 * per in-transit load at the 60s interval `useTripPosition` already polls at.
 * The list is short by construction — a shipper with more than a handful of
 * trucks in motion is not the audience this screen was drawn for — and the only
 * cheaper option is an ETA computed on the client, which P6 removed on purpose.
 */
function MovingCard({
  load,
  tripId,
  cityName,
  onPress,
}: {
  load: Load;
  tripId: string | undefined;
  cityName: (id: number) => string;
  onPress: () => void;
}) {
  const origin = cityName(load.origin_city);
  const destination = cityName(load.dest_city);

  // Only a load actually on the road can have a fix behind it.
  const position = useTripPosition(load.status === 'in_transit' ? tripId : undefined);
  const eta = position.data?.eta_at ?? null;
  const price =
    load.price_baisa == null ? null : formatMoney(load.price_baisa, load.currency as Currency);

  return (
    <PressableSurface
      onPress={onPress}
      // The card carries the route, so the rail inside it does not repeat it.
      accessibilityLabel={`${t('route.aria', { origin, destination })}. ${t(
        `status.${load.status}` as StringKey,
      )}`}
    >
      <Card>
        <View style={styles.cardHead}>
          <StatusPill
            label={t(`status.${load.status}` as StringKey)}
            tone={PILL_TONE[load.status]}
          />
          {eta ? (
            <Text testID="load-eta" style={styles.when}>
              {formatDeadline(eta)}
            </Text>
          ) : (
            <Text style={styles.when}>{formatWindow(load.pickup_from, load.pickup_to)}</Text>
          )}
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardRail}>
            <RouteRail origin={origin} destination={destination} compact labelled={false} />
          </View>
          {!!price && (
            <Text testID="load-price" style={styles.price} numberOfLines={1}>
              {price}
            </Text>
          )}
        </View>
      </Card>
    </PressableSurface>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  scroll: { paddingHorizontal: GUTTER_INK, gap: space.lg },

  title: { ...arabicIfNeeded(font.statement), color: color.lightText, textAlign: align.start },

  skeletons: { gap: space.md },
  cards: { gap: space.md },

  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  // The price sits vertically centred against the rail rather than under it.
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    marginTop: space.md,
  },
  cardRail: { flex: 1 },
  price: { ...arabicIfNeeded(font.rowTitle), color: color.lightText, flexShrink: 0 },
  when: { ...arabicIfNeeded(font.caption), color: alpha.onInk.tertiary },

  empty: { gap: space.sm, marginTop: space.xl, maxWidth: 320 },
  body: { ...arabicIfNeeded(font.body), color: alpha.onInk.body, textAlign: align.start },
  emptyAction: { alignSelf: 'stretch', marginTop: space.md },

  retry: {
    padding: space.lg,
    borderRadius: radius.row,
    backgroundColor: color.surface,
    gap: 2,
  },
  retryText: { ...arabicIfNeeded(font.body), color: color.lightText, textAlign: align.start },
  retryAction: { ...font.caption, color: color.accentLight, textAlign: align.start },
});
