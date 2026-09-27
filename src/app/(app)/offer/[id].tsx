/**
 * D2 · The offer in full.
 *
 * KEYED BY OFFER ID, NEVER BY LOAD ID. A driver holds no load id, and a screen
 * that took one would re-open the door `driver_offer()` closes: the function is
 * scoped to the caller inside the definer, so somebody else's id returns nothing
 * rather than a refusal.
 *
 * THE MAP ANSWERS THE ONE QUESTION THE LIST CANNOT: how far off my road is this.
 * The load's own journey is drawn as a committed corridor — it is a real
 * movement between two real places — and the turn-off is a dashed spur from the
 * driver's declared leg to the pickup. Dashed because the driver has not agreed
 * to it yet, and that distinction carries meaning everywhere else in the app.
 *
 * An offer that has gone says so plainly. It is the common case — offers expire
 * in 48 hours and another driver may have taken it — so it must not read as a
 * broken screen.
 */

import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DriverMoney } from '@/components/driver/Money';
import { BackButton, PressableSurface, PrimaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { RouteRail, SectionLabel, Sheet, Skeleton } from '@/components/ui';
import { CityPin, Corridor, DetourSpur, MapCanvas, Scrim, framingFor, useMapBand } from '@/map';
import { align, formatNumber, localized, t } from '@/i18n';
import { formatWeight, formatWindow } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import {
  cityIndex,
  useCities,
  useDriverOffer,
  useMyLegs,
  useRespondToOffer,
} from '@/lib/queries';
import { offerErrorMessage } from '@/lib/offer-errors';
import { safeText } from '@/lib/safe-text';
import {
  GUTTER_SHEET,
  MIN_TARGET,
  alpha,
  color,
  font,
  hairline,
  radius,
  space,
} from '@/theme/tokens';

/** The map band. Fixed, because every screen picks a framing and there is no pan. */
const MAP_HEIGHT = 420;

export default function OfferDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: cities } = useCities();
  const { data: legs } = useMyLegs();
  const offer = useDriverOffer(id);
  const respond = useRespondToOffer();
  const [error, setError] = useState<string | null>(null);
  // The map band is a fixed height across the full width, so it takes its size
  // from the window rather than from `onLayout`. One less frame where the
  // coastline is not there yet, and the geometry is assertable in a test.
  const { width: mapWidth } = useWindowDimensions();

  const index = useMemo(() => cityIndex(cities), [cities]);
  const data = offer.data;

  const from = data ? index.get(data.origin_city) : undefined;
  const to = data ? index.get(data.dest_city) : undefined;

  // The turn-off starts where the driver's own leg starts. Their legs are the
  // one thing they may read directly — they declared them.
  const leg = data?.leg_id ? (legs ?? []).find((l) => l.id === data.leg_id) : undefined;
  const legOrigin = leg ? index.get(leg.origin_city) : undefined;

  // The close-up only when the whole picture fits in it (framingFor), fitted to
  // the band between the back button and the sheet (useMapBand).
  const band = useMapBand();
  const framing = framingFor([from, to, legOrigin]);
  const mapFit = { top: insets.top + space.sm + MIN_TARGET, bottom: band.sheetTop };

  function take() {
    setError(null);
    respond.mutate(
      { offerId: id, accept: true },
      {
        // Leave now. The cache refresh re-reads this offer, which stops being
        // pending the moment it is accepted, and the screen would fall through
        // to "That offer has gone" — telling the driver they lost the job they
        // just won. `replace`, so Back from the trip is not a spent offer.
        onSuccess: (tripId) => (tripId ? router.replace(`/trip/${tripId}`) : router.back()),
        // A lost race is normal with waves; offerErrorMessage names it.
        onError: (e: unknown) => setError(offerErrorMessage(e)),
      },
    );
  }

  function pass() {
    setError(null);
    respond.mutate(
      { offerId: id, accept: false },
      {
        // A decline is what returns the shipper's load to the dispatcher (0013),
        // so one that fails silently strands it.
        onError: () => setError(t('error.generic')),
        onSuccess: () => router.back(),
      },
    );
  }

  if (offer.isPending) {
    return (
      <View style={styles.screen}>
        <View style={[styles.loading, { paddingTop: insets.top + space.huge }]}>
          <Skeleton height={260} round={radius.card} />
          <Skeleton height={120} round={radius.card} />
        </View>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.screen}>
        <View style={[styles.gone, { paddingTop: insets.top + space.lg }]}>
          <BackButton onPress={() => router.back()} />
          <Text style={styles.goneText}>{t('drv.offer.gone')}</Text>
        </View>
      </View>
    );
  }

  const amount = formatMoney(data.payout_baisa, data.currency as Currency);

  return (
    <View style={styles.screen}>
      <View style={styles.mapArea} pointerEvents="none">
        {mapWidth > 0 && (
          <>
            <MapCanvas framing={framing} width={mapWidth} height={MAP_HEIGHT} fit={mapFit}>
              {from && to && (
                <>
                  {/* The load's own journey: a real movement, drawn solid. */}
                  <Corridor
                    from={{ lng: from.lng, lat: from.lat }}
                    to={{ lng: to.lng, lat: to.lat }}
                    committed
                  />
                  {/* The turn-off, which the driver has not agreed to. */}
                  {legOrigin && (
                    <DetourSpur
                      from={{ lng: legOrigin.lng, lat: legOrigin.lat }}
                      to={{ lng: from.lng, lat: from.lat }}
                    />
                  )}
                  <CityPin at={{ lng: from.lng, lat: from.lat }} state="origin" />
                  <CityPin at={{ lng: to.lng, lat: to.lat }} state="destination" />
                </>
              )}
            </MapCanvas>
            <Scrim variant="topHeavy" width={mapWidth} height={MAP_HEIGHT} />
          </>
        )}
      </View>

      <View style={[styles.nav, { paddingTop: insets.top + space.sm }]}>
        <BackButton onPress={() => router.back()} />
      </View>

      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={styles.sheetContent}
        showsVerticalScrollIndicator={false}
        onLayout={band.onScrollLayout}
      >
        <View onLayout={band.onSheetLayout}>
          <Sheet style={{ paddingBottom: insets.bottom + space.xl }}>
            <DriverMoney
              payout={data.payout_baisa}
              collect={data.collect_baisa}
              owed={data.owed_baisa}
              currency={data.currency}
            />

            <View style={styles.block}>
              {!!from && !!to && <RouteRail origin={localized(from)} destination={localized(to)} />}
            </View>

            <View style={styles.facts}>
              {data.detour_km != null && (
                <Fact
                  label={t('drv.offer.detourLabel')}
                  value={t('drv.offer.detour', { km: formatNumber(Math.round(data.detour_km)) })}
                />
              )}
              <Fact label={t('book.review.cargo')} value={safeText(data.goods)} />
              {data.weight_kg != null && (
                <Fact label={t('book.review.weight')} value={formatWeight(data.weight_kg, '')} />
              )}
              <Fact
                label={t('book.review.collect')}
                value={formatWindow(data.pickup_from, data.pickup_to)}
              />
            </View>

            {/* Absent when either number is unknown — a driver planning a second
              load on a guess is worse off than one told nothing. */}
            {data.free_after_kg != null && (
              <Text style={styles.capacity}>
                {t('drv.offer.freeAfter', { weight: formatWeight(data.free_after_kg, '') })}
              </Text>
            )}

            {!!error && <Text style={styles.error}>{error}</Text>}

            <PrimaryButton
              label={amount ? t('drv.offer.take', { amount }) : t('drv.offer.take.bare')}
              onPress={take}
              loading={respond.isPending && respond.variables?.accept === true}
            />

            <PressableSurface
              onPress={pass}
              accessibilityLabel={t('drv.offer.pass')}
              style={styles.pass}
            >
              <Text style={styles.passText}>{t('drv.offer.pass')}</Text>
            </PressableSurface>
          </Sheet>
        </View>
      </ScrollView>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <SectionLabel>{label}</SectionLabel>
      <Text style={styles.factValue}>{value}</Text>
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
    height: MAP_HEIGHT,
  },
  nav: { paddingHorizontal: GUTTER_SHEET, alignItems: 'flex-start' },

  loading: { paddingHorizontal: GUTTER_SHEET, gap: space.lg },
  gone: { paddingHorizontal: GUTTER_SHEET, gap: space.xxl },
  goneText: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start },

  sheetScroll: { flex: 1 },
  sheetContent: { flexGrow: 1, justifyContent: 'flex-end' },

  block: {
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: hairline.inner,
  },
  facts: { gap: space.md },
  fact: { gap: 2 },
  factValue: { ...arabicIfNeeded(font.value), color: color.lightText, textAlign: align.start },

  capacity: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.body, textAlign: align.start },
  error: { ...arabicIfNeeded(font.body), color: color.dangerLight, textAlign: align.start },

  pass: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  passText: { ...arabicIfNeeded(font.buttonSecondary), color: alpha.onInk.body },
});
