/**
 * D2b · A load to name a price for (0045).
 *
 * KEYED BY OFFER ID, NEVER BY LOAD ID — the invitation is the driver's key to
 * the load, as on D2, and the server scopes every read to the caller.
 *
 * THE OTHER PRICES ARE ON SCREEN, semi-anonymised: "Driver 2 · 10-ton truck ·
 * 95.000 OMR". The amount is what that driver keeps, which is the same kind of
 * number this driver is about to type — never the shipper's total, which would
 * expose the fee. No name, phone or town, ever (founder's call, 2026-10-04).
 *
 * The contact at the gate is not here. Many drivers are invited; the one who
 * wins gets the contact on the trip screen.
 *
 * Asking for the amount is a question, so it is its own cream screen
 * (`/bid/price`), reached from the one pinned action here.
 */

import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { expiryLabel } from '@/components/driver/OfferCard';
import { DriverPlaceDetails } from '@/components/driver/PlaceDetails';
import { BackButton, PressableSurface, PrimaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import {
  DetailGroup,
  DetailRow,
  RouteRail,
  SectionLabel,
  Sheet,
  Skeleton,
  StatusPill,
} from '@/components/ui';
import { CityPin, Corridor, MapCanvas, Scrim, framingFor, useMapBand } from '@/map';
import { align, formatNumber, getLanguage, localized, t } from '@/i18n';
import { formatWeight, formatWindow } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import {
  cityIndex,
  placeOf,
  useCities,
  useDriverBidInvite,
  useDriverLoadBids,
  useRespondToOffer,
  useTruckTypes,
} from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { GUTTER_SHEET, MIN_TARGET, alpha, color, font, hairline, radius, space } from '@/theme/tokens';

/** The map band. Fixed, because every screen picks a framing and there is no pan. */
const MAP_HEIGHT = 420;

export default function BidDetail() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: cities } = useCities();
  const { data: truckTypes } = useTruckTypes();
  const invite = useDriverBidInvite(id);
  const competing = useDriverLoadBids(invite.data ? id : undefined);
  const respond = useRespondToOffer();
  const [error, setError] = useState<string | null>(null);
  const { width: mapWidth } = useWindowDimensions();

  const index = useMemo(() => cityIndex(cities), [cities]);
  const truckName = useMemo(() => {
    const m = new Map<string, string>();
    for (const tt of truckTypes ?? []) m.set(tt.code, localized(tt));
    return m;
  }, [truckTypes]);

  const data = invite.data;
  const from = data ? index.get(data.origin_city) : undefined;
  const to = data ? index.get(data.dest_city) : undefined;
  const pickupPlace = data ? placeOf(data as unknown as Record<string, unknown>, 'pickup') : null;
  const dropPlace = data ? placeOf(data as unknown as Record<string, unknown>, 'drop') : null;

  const band = useMapBand();
  const framing = framingFor([from, to]);
  const mapFit = { top: insets.top + space.sm + MIN_TARGET, bottom: band.sheetTop };

  function pass() {
    setError(null);
    respond.mutate(
      { offerId: id, accept: false },
      {
        onError: () => setError(t('error.generic')),
        onSuccess: () => router.back(),
      },
    );
  }

  if (invite.isPending) {
    return (
      <View style={styles.screen}>
        <View style={[styles.loading, { paddingTop: insets.top + space.huge }]}>
          <Skeleton height={260} round={radius.card} />
          <Skeleton height={120} round={radius.card} />
        </View>
      </View>
    );
  }

  // Closed, taken, or never this driver's: the same plain sentence.
  if (!data) {
    return (
      <View style={styles.screen}>
        <View style={[styles.gone, { paddingTop: insets.top + space.lg }]}>
          <BackButton onPress={() => router.back()} />
          <Text style={styles.goneText}>{t('drv.bid.gone')}</Text>
        </View>
      </View>
    );
  }

  const lang = getLanguage();
  const own = data.own_bid_baisa == null ? null : formatMoney(data.own_bid_baisa, 'OMR', lang);
  const others = competing.data ?? [];

  return (
    <View style={styles.screen}>
      <View style={styles.mapArea} pointerEvents="none">
        {mapWidth > 0 && (
          <>
            <MapCanvas framing={framing} width={mapWidth} height={MAP_HEIGHT} fit={mapFit}>
              {from && to && (
                <>
                  {/* Nobody has this load yet, so its line is not a commitment. */}
                  <Corridor
                    from={{ lng: from.lng, lat: from.lat }}
                    to={{ lng: to.lng, lat: to.lat }}
                    committed={false}
                  />
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
            <View style={styles.head}>
              <StatusPill label={t('drv.bid.pill')} tone="neutral" />
              <Text style={styles.meta}>{expiryLabel(data.bid_deadline)}</Text>
            </View>
            <Text style={own ? styles.own : styles.ownNone}>
              {own ? t('drv.bid.yours', { amount: own }) : t('drv.bid.none')}
            </Text>

            <View style={styles.block}>
              {!!from && !!to && <RouteRail origin={localized(from)} destination={localized(to)} />}
              {pickupPlace && <DriverPlaceDetails label={t('book.dest.pickup')} place={pickupPlace} />}
              {dropPlace && <DriverPlaceDetails label={t('book.dest.deliver')} place={dropPlace} />}
            </View>

            <View style={styles.facts}>
              <Fact label={t('book.review.cargo')} value={safeText(data.goods)} />
              {data.weight_kg != null && (
                <Fact label={t('book.review.weight')} value={formatWeight(data.weight_kg, '')} />
              )}
              {!!data.truck_type_code && (
                <Fact
                  label={t('book.review.truck')}
                  value={truckName.get(data.truck_type_code) ?? data.truck_type_code}
                />
              )}
              <Fact
                label={t('book.review.collect')}
                value={formatWindow(data.pickup_from, data.pickup_to)}
              />
            </View>

            {others.length === 0 ? (
              <View style={styles.facts}>
                <SectionLabel>{t('drv.bid.others')}</SectionLabel>
                {competing.isPending ? (
                  <Skeleton height={48} round={radius.row} />
                ) : (
                  <Text style={styles.meta}>{t('drv.bid.othersNone')}</Text>
                )}
              </View>
            ) : (
              <DetailGroup label={t('drv.bid.others')}>
                {others.map((b) => (
                  <DetailRow
                    key={b.bidder_no}
                    label={[
                      b.is_you ? t('drv.bid.rowYou') : t('drv.bid.row', { n: formatNumber(b.bidder_no) }),
                      b.truck_type ? (truckName.get(b.truck_type) ?? b.truck_type) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    value={formatMoney(b.payout_baisa, 'OMR', lang) ?? ''}
                  />
                ))}
              </DetailGroup>
            )}
            <Text style={styles.meta}>{t('drv.bid.how')}</Text>

            {!!error && <Text style={styles.error}>{error}</Text>}

            <PrimaryButton
              label={own ? t('drv.bid.change') : t('drv.bid.cta')}
              onPress={() => router.push({ pathname: '/bid/price', params: { offer: id } })}
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

  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  meta: { ...arabicIfNeeded(font.caption), color: alpha.onInk.tertiary, textAlign: align.start },
  own: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start },
  ownNone: { ...arabicIfNeeded(font.body), color: alpha.onInk.body, textAlign: align.start },

  block: {
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: hairline.inner,
  },
  facts: { gap: space.md },
  fact: { gap: 2 },
  factValue: { ...arabicIfNeeded(font.value), color: color.lightText, textAlign: align.start },

  error: { ...arabicIfNeeded(font.body), color: color.dangerLight, textAlign: align.start },

  pass: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  passText: { ...arabicIfNeeded(font.buttonSecondary), color: alpha.onInk.body },
});
