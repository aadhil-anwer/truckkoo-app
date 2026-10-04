/**
 * S9 · Check this before we start.
 *
 * The last screen before a load exists. Three things here are load-bearing:
 *
 * THE PRICE IS THE PRICE (0036). Uber and Porter show the fare before "Book", so
 * booking is agreeing to it. This screen shows the exact `quote_route` price and
 * the button books AT that price: `book_load` accepts and dispatches in the same
 * call only if the server's number is the one shown here. If the price moved in
 * between, the load is still posted and the load screen asks the shipper to
 * accept the real one. "Let us choose" with a weight is priced for the smallest
 * truck that carries it, and the truck row says which, so nothing is hidden.
 *
 * OFTEN THERE IS NO PRICE, AND THAT IS FINE. No weight on "let us choose", or no
 * rate for the corridor, means a person prices it — a commitment the website
 * already makes. Never a dead end (CLAUDE.md #6).
 *
 * NOTHING IS CHARGED HERE. Showing a price is fine; taking one is not, ever
 * (#3). The reassurance strip says so out loud.
 *
 * UNDER BIDDING (0045, `BIDDING`) there is no price yet, by design: drivers name
 * theirs after this screen. The price card becomes how-it-is-priced, the target
 * the shipper gave (or "You choose") is a row in the summary, and the button
 * posts through `post_bid_load`, which takes no price from the client at all.
 * The rate-card lookup is not made — it would spend a rate-limited call on a
 * number this flow never shows.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton, TertiaryButton } from '@/components/primitives';
import { Card, Notice, RouteRail, SectionLabel, Skeleton } from '@/components/ui';
import { roadKm } from '@/map';
import {
  clearDraft,
  normalizePhone,
  toPlacePayload,
  truckTypeForPost,
  useBookingDraft,
  type DraftPlace,
} from '@/lib/booking';
import {
  cityIndex,
  useBookLoad,
  useCities,
  usePostBidLoad,
  useRoutePrice,
  useTruckTypes,
} from '@/lib/queries';
import { BIDDING } from '@/lib/features';
import { formatMoney, type Currency } from '@/lib/money';
import { formatLongDay } from '@/lib/format';
import { align, formatNumber, localized, t } from '@/i18n';
import { arabicIfNeeded } from '@/components/text-direction';
import { ltrIsolate, safeText } from '@/lib/safe-text';
import { useSession } from '@/lib/session';
import { alpha, color, font, hairline, space } from '@/theme/tokens';

export default function Review() {
  const router = useRouter();
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const { draft, ready } = useBookingDraft();
  const citiesQuery = useCities();
  const cities = citiesQuery.data;
  const { data: truckTypes } = useTruckTypes();
  const [error, setError] = useState<string | null>(null);

  const index = cityIndex(cities);
  const origin = draft.originCityId != null ? index.get(draft.originCityId) : undefined;
  const dest = draft.destinationCityId != null ? index.get(draft.destinationCityId) : undefined;
  const truckName = (code: string | null | undefined) => {
    const row = code ? truckTypes?.find((tt) => tt.code === code) : undefined;
    return row ? localized(row) : null;
  };

  const requested = truckTypeForPost(draft);
  const price = useRoutePrice({
    originCity: ready && !BIDDING ? draft.originCityId : null,
    destCity: ready ? draft.destinationCityId : null,
    truckTypeCode: requested,
    weightKg: draft.weightKg,
  });
  const quote = price.data;
  const priced = quote?.outcome === 'quoted' && quote.price_baisa != null;
  const amount = priced ? formatMoney(quote!.price_baisa!, quote!.currency as Currency) : null;

  const book = useBookLoad();
  const postBid = usePostBidLoad();
  const posting = BIDDING ? postBid.isPending : book.isPending;

  if (!ready || (citiesQuery.isPending && !cities)) {
    return (
      <View style={styles.recovery}>
        <Text style={styles.title}>{t('book.review.title')}</Text>
        <Card><Skeleton height={160} /></Card>
      </View>
    );
  }

  if (citiesQuery.isError && !cities) {
    return (
      <View style={styles.recovery}>
        <Text style={styles.title}>{t('common.error.title')}</Text>
        <Notice icon="info">{t('common.error.explain')}</Notice>
        <PrimaryButton label={t('common.retry')} onPress={() => { void citiesQuery.refetch(); }} />
        <TertiaryButton label={t('book.review.home')} onPress={() => router.replace('/customer')} />
      </View>
    );
  }

  if (!origin || !dest || !draft.collectionDate || !draft.cargoDescription.trim()) {
    const repairPath = !origin ? '/book/origin' : !dest ? '/book/destination'
      : !draft.collectionDate ? '/book/date' : '/book/cargo';
    return (
      <View style={styles.recovery}>
        <Text style={styles.title}>{t('book.review.title')}</Text>
        <Notice icon="info">{t('book.review.incomplete')}</Notice>
        <PrimaryButton label={t('book.review.continue')} onPress={() => router.replace(repairPath)} />
        <TertiaryButton label={t('book.review.home')} onPress={() => router.replace('/customer')} />
      </View>
    );
  }

  // What the truck row says. An explicit choice by its name, never its code
  // ("10t" is a database key, not something a shipper reads). "Let us choose"
  // with a price names the truck the price is for.
  const truckValue =
    requested != null
      ? (truckName(requested) ?? requested)
      : priced && quote!.truck_type_code && draft.weightKg != null
        ? t('book.review.chosenFor', {
            truck: truckName(quote!.truck_type_code) ?? quote!.truck_type_code,
            weight: formatNumber(draft.weightKg),
          })
        : t('book.review.weWillChoose');

  const target =
    draft.targetTotalBaisa == null ? t('book.review.noTarget') : formatMoney(draft.targetTotalBaisa, 'OMR')!;

  function submit() {
    setError(null);
    if (BIDDING) {
      postBid.mutate(
        {
          originCity: draft.originCityId!,
          destCity: draft.destinationCityId!,
          collectionDate: draft.collectionDate!,
          goods: draft.cargoDescription.trim(),
          weightKg: draft.weightKg,
          // NULL means "advise me". Never a guessed code.
          truckTypeCode: requested,
          originPlace: toPlacePayload(draft.originPlace),
          destPlace: toPlacePayload(draft.destinationPlace),
          targetTotalBaisa: draft.targetTotalBaisa,
        },
        {
          onSuccess: async ({ loadId }) => {
            await clearDraft(session?.user.id ?? '');
            // The load screen is where the prices arrive.
            router.replace(`/load/${loadId}`);
          },
          onError: () => setError(t('book.failed')),
        },
      );
      return;
    }
    book.mutate(
      {
        originCity: draft.originCityId!,
        destCity: draft.destinationCityId!,
        collectionDate: draft.collectionDate!,
        goods: draft.cargoDescription.trim(),
        weightKg: draft.weightKg,
        // NULL means "advise me". Never a guessed code.
        truckTypeCode: requested,
        seenPriceBaisa: priced ? quote!.price_baisa : null,
        originPlace: toPlacePayload(draft.originPlace),
        destPlace: toPlacePayload(draft.destinationPlace),
      },
      {
        onSuccess: async ({ loadId }) => {
          await clearDraft(session?.user.id ?? '');
          // Matched or not, the load screen shows the truth: a truck being
          // found, or — if the price moved — the real price to accept.
          router.replace(`/load/${loadId}`);
        },
        onError: () => setError(t('book.failed')),
      },
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{t('book.review.title')}</Text>

        <Card>
          <RouteRail origin={localized(origin)} destination={localized(dest)} />
          {/* The exact spots, when the shipper pinned them (0041). */}
          {draft.originPlace && <PlaceLine place={draft.originPlace} pickup />}
          {draft.destinationPlace && <PlaceLine place={draft.destinationPlace} pickup={false} />}
          <View style={styles.facts}>
            <Fact label={t('book.review.collect')} value={formatLongDay(draft.collectionDate!)} />
            <Fact label={t('book.review.cargo')} value={draft.cargoDescription} />
            <Fact label={t('book.review.truck')} value={truckValue} />
            <Fact
              label={t('book.review.weight')}
              value={
                draft.weightKg == null
                  ? t('book.review.notSaid')
                  : t('book.weight.value', { weight: formatNumber(draft.weightKg) })
              }
              last={!BIDDING}
            />
            {BIDDING && <Fact label={t('book.review.target')} value={target} last />}
          </View>
        </Card>

        <Card tone="raised" style={styles.estimate}>
          {BIDDING ? (
            <>
              <SectionLabel>{t('book.review.bidLabel')}</SectionLabel>
              <Text style={styles.estimateWhy}>{t('book.review.bidWhy')}</Text>
            </>
          ) : price.isPending ? (
            <Skeleton height={64} />
          ) : priced ? (
            <>
              <SectionLabel>{t('book.review.priceLabel')}</SectionLabel>
              <Text style={styles.rangeValue}>{amount}</Text>
              <Text style={styles.estimateWhy}>{t('book.review.priceWhy')}</Text>
            </>
          ) : (
            <>
              <SectionLabel>{t('book.review.estimateLabel')}</SectionLabel>
              {/* The human path. Not an error, and not empty. */}
              <Text style={styles.estimateWhy}>{t('book.review.noEstimate')}</Text>
            </>
          )}

          <View style={styles.reassure}>
            <Notice icon="info">{t('book.review.nothingCharged')}</Notice>
          </View>
        </Card>

        <Text style={styles.distance}>
          {t('book.aboutKm', { km: formatNumber(roadKm(origin, dest)) })}
        </Text>

        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      {/* Clear of the system navigation bar: on a 3-button Android phone the
          primary action otherwise sits under Back/Home/Recents. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + space.xl }]}>
        <TertiaryButton label={t('book.review.change')} onPress={() => router.back()} />
        <PrimaryButton
          label={
            BIDDING
              ? t('book.review.bidCta')
              : amount
                ? t('book.review.bookFor', { price: amount })
                : t('book.review.cta')
          }
          onPress={submit}
          // Never book while the price is still arriving: the button would
          // commit to a number the shipper has not seen yet. (No price is
          // fetched under bidding, so there is nothing to wait for.)
          disabled={!BIDDING && price.isPending}
          loading={posting}
        />
      </View>
    </View>
  );
}

/** One pinned end: its name (or "This spot"), the note, and who is there. */
function PlaceLine({ place, pickup }: { place: DraftPlace; pickup: boolean }) {
  const name = place.placeName?.trim() ? safeText(place.placeName) : t('places.pin.unnamed');
  const who = place.contactName.trim() ? safeText(place.contactName.trim()) : null;
  const typed = normalizePhone(place.contactPhone);
  const phone = typed ? ltrIsolate(typed) : null;
  const contact =
    who && phone
      ? t('places.review.contact', { name: who, phone })
      : who
        ? t('places.askFor', { name: who })
        : phone
          ? t('places.review.contactPhone', { phone })
          : null;
  return (
    <View style={styles.place}>
      <Text style={styles.placeName} numberOfLines={2}>
        {pickup ? t('places.review.pickup', { place: name }) : t('places.review.drop', { place: name })}
      </Text>
      {!!place.note.trim() && <Text style={styles.placeNote}>{safeText(place.note)}</Text>}
      {!!contact && <Text style={styles.placeNote}>{contact}</Text>}
    </View>
  );
}

function Fact({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.fact, !last && styles.factDivided]}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  recovery: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.lg,
    backgroundColor: color.ink,
  },
  scroll: { padding: space.xl, paddingTop: space.huge, gap: space.lg },
  title: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start },
  place: { marginTop: space.md, gap: 2 },
  placeName: { ...arabicIfNeeded(font.body), color: color.lightText, textAlign: align.start },
  placeNote: { ...arabicIfNeeded(font.caption), color: alpha.onInk.tertiary, textAlign: align.start },
  facts: { marginTop: space.lg },
  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: space.sm,
  },
  factDivided: { borderBottomWidth: 1, borderBottomColor: hairline.inner },
  factLabel: { ...arabicIfNeeded(font.body), color: alpha.onInk.secondary },
  // The value sits at the trailing edge of its row, which is the LEFT edge in
  // Arabic. `align.end`, never 'right'.
  factValue: {
    ...arabicIfNeeded(font.value),
    color: color.lightText,
    flexShrink: 1,
    textAlign: align.end,
  },
  estimate: { gap: space.sm },
  rangeValue: { ...font.estimate, color: color.lightText },
  estimateWhy: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.body, textAlign: align.start },
  reassure: { marginTop: space.sm },
  distance: { ...arabicIfNeeded(font.caption), color: alpha.onInk.tertiary, textAlign: align.start },
  error: { ...arabicIfNeeded(font.bodySmall), color: color.dangerLight, textAlign: align.start },
  footer: {
    padding: space.xl,
    paddingTop: space.md,
    gap: space.xs,
    borderTopWidth: 1,
    borderTopColor: hairline.inner,
    backgroundColor: color.ink,
  },
});
