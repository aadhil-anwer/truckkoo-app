/**
 * S1 / S2 · The shipper's home.
 *
 * THE MAP IS THE HOME SURFACE — not decoration behind a list. The first thing a
 * shipper reads is where their cargo is going, before they read a word. When a
 * load is live its corridor is drawn; when there is none the map is quiet and the
 * screen asks for two cities instead.
 *
 * S1 (a live load) and S2 (first run) are ONE screen with two states. The handoff
 * draws them apart because a gallery cannot show state; the only difference is
 * whether `useMyLoads` returned anything.
 *
 * ONE ACCENT. The orange search block is the pinned action, so the corridor and a
 * single live-state pill are the only other places orange appears. A second
 * orange action on this screen means one of them is wrong.
 *
 * WHAT THIS REPLACED. A vertical list of cards on a white ground, which was
 * itself a deliberate replacement for a horizontal "book" of consignment notes
 * that this audience had no prior for. The list was right about hierarchy and
 * wrong about the medium: it never showed the shipper the one thing they
 * actually want to see, which is the line between two places.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { PressableSurface } from '@/components/primitives';
import {
  Chip,
  QuestionHeading,
  RouteRail,
  SectionLabel,
  Skeleton,
  StatusPill,
} from '@/components/ui';
import { CityPin, Corridor, MapCanvas, Scrim } from '@/map';
import { cityIndex, useCities, useMyLoads, useTruckTypes, type Load } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { formatWeight, formatWindow } from '@/lib/format';
import { align, localized, t, type StringKey } from '@/i18n';
import { arabicIfNeeded } from '@/components/text-direction';
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

/** Still working its way to a truck, rather than already finished. */
const LIVE: Load['status'][] = [
  'posted',
  'finding_truck',
  'quoted',
  'accepted',
  'matched',
  'assigned',
  'in_transit',
];

export default function ShipperHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();
  const { data: cities } = useCities();
  const { data: loads, isLoading, isError, refetch, isRefetching } = useMyLoads();
  const { data: truckTypes } = useTruckTypes();
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });

  const index = cityIndex(cities);
  const truckName = new Map((truckTypes ?? []).map((tt) => [tt.code, localized(tt)]));

  const live = useMemo(() => (loads ?? []).filter((l) => LIVE.includes(l.status)), [loads]);
  const finished = useMemo(() => (loads ?? []).filter((l) => !LIVE.includes(l.status)), [loads]);

  // The map draws the newest live corridor. One line, not all of them — a map
  // with four overlapping corridors orients nobody.
  const featured = live[0];
  const from = featured ? index.get(featured.origin_city) : undefined;
  const to = featured ? index.get(featured.dest_city) : undefined;

  const repeat = finished[0];
  const repeatFrom = repeat ? index.get(repeat.origin_city) : undefined;
  const repeatTo = repeat ? index.get(repeat.dest_city) : undefined;

  const firstRun = !isLoading && live.length === 0;

  return (
    <View style={styles.screen}>
      {/* The map sits behind the content. `pointerEvents="none"` because on this
          screen it is orientation, not a control — the pins are tappable inside
          the booking flow, where the helper text promises it. */}
      <View
        style={styles.mapArea}
        onLayout={(e) => setMapSize(e.nativeEvent.layout)}
        pointerEvents="none"
      >
        {mapSize.width > 0 && (
          <>
            <MapCanvas framing="domestic" width={mapSize.width} height={mapSize.height}>
              {from && to && (
                <>
                  <Corridor
                    from={{ lng: from.lng, lat: from.lat }}
                    to={{ lng: to.lng, lat: to.lat }}
                    // Committed only once a driver has it. Drawing a solid line
                    // earlier would tell a shipper their truck was booked.
                    committed={
                      featured.status === 'assigned' || featured.status === 'in_transit'
                    }
                  />
                  <CityPin at={{ lng: from.lng, lat: from.lat }} state="origin" />
                  <CityPin at={{ lng: to.lng, lat: to.lat }} state="destination" />
                </>
              )}
            </MapCanvas>
            <Scrim variant="topHeavy" width={mapSize.width} height={mapSize.height} />
          </>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space.lg, paddingBottom: TABBAR_CLEARANCE_3 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={color.lightText}
          />
        }
      >
        <Text style={styles.greeting} numberOfLines={1}>
          {profile?.full_name
            ? `${t('home.greeting')}, ${profile.full_name.split(' ')[0]}`
            : t('home.greeting')}
        </Text>

        {/* S2. A directive, not an empty state: "no loads yet" tells a
            first-time user nothing they can act on. */}
        {firstRun && (
          <View style={styles.firstRun}>
            <QuestionHeading ground="ink" size="question">
              {t('home.s2.q')}
            </QuestionHeading>
            <Text style={styles.body}>{t('home.s2.body')}</Text>
          </View>
        )}

        {/* Clears the map's busiest area before the content starts. */}
        <View style={firstRun ? styles.spacerShort : styles.spacer} />

        <PressableSurface
          onPress={() => router.push('/book/origin')}
          accessibilityLabel={`${t('home.search.title')} ${t('home.search.hint')}`}
          style={styles.entry}
        >
          <Icon name="search" size={24} tint="#FFFFFF" />
          <View style={styles.entryText}>
            <Text style={styles.entryTitle}>{t('home.search.title')}</Text>
            <Text style={styles.entryHint}>{t('home.search.hint')}</Text>
          </View>
          <Icon name="chevron" size={20} tint="#FFFFFF" />
        </PressableSurface>

        {isError && (
          <PressableSurface
            onPress={() => refetch()}
            accessibilityLabel={`${t('common.error.title')} ${t('common.retry')}`}
            style={styles.retry}
          >
            <Text style={styles.retryText}>{t('common.error.title')}</Text>
            <Text style={styles.retryAction}>{t('common.retry')}</Text>
          </PressableSurface>
        )}

        {isLoading && (
          <View style={styles.skeletons}>
            {/* Skeletons at the final geometry, never a spinner: the layout does
                not jump when the answer arrives. */}
            <Skeleton height={150} round={radius.card} />
            <Skeleton height={72} round={radius.row} />
          </View>
        )}

        {live.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <SectionLabel>{t('home.onTheMove')}</SectionLabel>
              {live.length > 1 && (
                <PressableSurface
                  onPress={() => router.push('/loads')}
                  accessibilityLabel={t('home.seeAll')}
                >
                  <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
                </PressableSurface>
              )}
            </View>

            {live.map((load) => {
              const o = index.get(load.origin_city);
              const d = index.get(load.dest_city);
              if (!o || !d) return null;
              return (
                <PressableSurface
                  key={load.id}
                  onPress={() => router.push(`/load/${load.id}`)}
                  accessibilityLabel={`${localized(o)} ${t('route.ariaTo')} ${localized(d)}. ${t(
                    `status.${load.status}` as StringKey,
                  )}`}
                  style={styles.loadCard}
                >
                  <View style={styles.loadHead}>
                    <StatusPill
                      label={t(`status.${load.status}` as StringKey)}
                      // Accent only while something is genuinely happening.
                      tone={load.status === 'in_transit' ? 'accent' : 'neutral'}
                    />
                    <Text style={styles.timestamp}>
                      {formatWindow(load.pickup_from, load.pickup_to)}
                    </Text>
                  </View>

                  {/* The card already announces the route; the rail must not repeat it. */}
                  <RouteRail origin={localized(o)} destination={localized(d)} compact labelled={false} />

                  <View style={styles.chips}>
                    <Chip label={load.goods_description} />
                    {load.weight_kg != null && <Chip label={formatWeight(load.weight_kg, '')} />}
                    {/* The truck, by NAME not code. A NULL type is "we advise" —
                        the choice the shipper made, and it must read as that
                        rather than as a blank field. */}
                    <Chip
                      label={
                        load.truck_type_code
                          ? (truckName.get(load.truck_type_code) ?? load.truck_type_code)
                          : t('book.review.weWillChoose')
                      }
                    />
                  </View>
                </PressableSurface>
              );
            })}
          </View>
        )}

        {repeat && repeatFrom && repeatTo && (
          <PressableSurface
            onPress={() =>
              router.push({
                pathname: '/post-load',
                params: {
                  origin: String(repeat.origin_city),
                  dest: String(repeat.dest_city),
                },
              })
            }
            accessibilityLabel={`${t('home.again.title')}. ${localized(repeatFrom)} ${t(
              'route.ariaTo',
            )} ${localized(repeatTo)}`}
            style={styles.again}
          >
            <View style={styles.againText}>
              <Text style={styles.againRoute} numberOfLines={1}>
                {`${localized(repeatFrom)} → ${localized(repeatTo)}`}
              </Text>
              <Text style={styles.againHint}>{t('home.again.title')}</Text>
            </View>
            <Icon name="chevron" size={18} tint={alpha.onInk.tertiary} />
          </PressableSurface>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  mapArea: {
    position: 'absolute',
    top: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    height: 470,
  },

  scroll: { paddingHorizontal: GUTTER_INK, gap: space.lg },
  greeting: { ...arabicIfNeeded(font.statement), color: color.lightText, textAlign: align.start },
  firstRun: { gap: space.sm, marginTop: space.xxl, maxWidth: 300 },
  body: { ...arabicIfNeeded(font.body), color: alpha.onInk.body, textAlign: align.start },
  spacer: { height: 150 },
  spacerShort: { height: 40 },

  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 70,
    paddingHorizontal: space.xl,
    borderRadius: radius.card,
    backgroundColor: color.accent,
  },
  entryText: { flex: 1, gap: 1 },
  entryTitle: { ...arabicIfNeeded(font.title), color: '#FFFFFF', textAlign: align.start },
  entryHint: {
    ...arabicIfNeeded(font.bodySmall),
    color: 'rgba(255,255,255,.88)',
    textAlign: align.start,
  },

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
  skeletons: { gap: space.md },
  section: { gap: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seeAll: { ...font.caption, color: color.accentLight },

  loadCard: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: hairline.card,
    padding: space.xl,
    gap: space.md,
  },
  loadHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timestamp: { ...font.caption, color: alpha.onInk.tertiary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  again: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.row,
    backgroundColor: color.surface,
  },
  againText: { flex: 1, gap: 1 },
  againRoute: { ...arabicIfNeeded(font.rowTitle), color: color.lightText, textAlign: align.start },
  againHint: {
    ...arabicIfNeeded(font.bodySmall),
    color: alpha.onInk.tertiary,
    textAlign: align.start,
  },
});
