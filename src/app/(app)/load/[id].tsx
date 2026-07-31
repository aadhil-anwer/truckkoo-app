/**
 * T1–T5 · One load, from the wait to the receipt.
 *
 * THIS IS THE CORE OF THE REDESIGN, and the only flow that did not exist in any
 * form before: a shipper posted a load and then waited with no feedback at all
 * while pricing happened over WhatsApp. Everything between "posted" and
 * "delivered" happened somewhere else.
 *
 * ONE SCREEN, SIX STATES — not six screens. The handoff draws T1…T5 apart
 * because a gallery cannot show state, but a shipper who has one load has one
 * place to look at it, and that place changes under them as the load moves. A
 * separate route per status would mean the app navigating on its own while
 * someone is reading, which is the fastest way to lose a low-tech user.
 *
 *   posted / finding_truck  → T1   the narrated wait
 *   quoted                  → T2   the price, and the decision
 *   accepted / matched      → T1b  the same wait, advanced
 *   assigned                → T3   a named person and their vehicle
 *   in_transit              → T4   ETA, progress, what is owed
 *   delivered / closed      → T5   the receipt, and the rating
 *
 * THE MAP IS THE GROUND, as on home. The corridor is **dashed until a driver
 * actually has the load** — that distinction is load-bearing (DESIGN.md), and
 * drawing it solid at `quoted` would tell a shipper their truck was booked when
 * what is really waiting is their own answer.
 *
 * ONE ACCENT PER STATE, and which thing wears it moves:
 *   T1 / T1b / T4  the live state — pill, timeline ring, progress fill. The
 *                  pinned action is therefore secondary.
 *   T2 / T3        the pinned action — "Accept 42.500 OMR", "Call the driver".
 *                  No accent pill and no timeline on those two, deliberately.
 *   T5             the rating stars, which are the only thing left to do.
 *
 * `color.delivered` appears here on T5 and NOWHERE ELSE IN THE PRODUCT. A second
 * use anywhere means that screen is wrong.
 *
 * Nothing here writes a status directly. The only two mutations are
 * `accept_quote` and `rate_trip`, both definer RPCs that re-check ownership
 * against `auth.uid()` inside.
 */

import { useMemo, useState } from 'react';
import { Image, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import {
  BackButton,
  PressableSurface,
  PrimaryButton,
  ProgressBar,
  SecondaryButton,
  TertiaryButton,
} from '@/components/primitives';
import {
  Chip,
  Notice,
  QuestionHeading,
  RouteRail,
  SectionLabel,
  Skeleton,
  StatusPill,
  Timeline,
} from '@/components/ui';
import { arabicIfNeeded } from '@/components/text-direction';
import { CityPin, Corridor, MapCanvas, Scrim, TruckMarker, roadHours } from '@/map';
import { align, formatNumber, getLanguage, localized, t } from '@/i18n';
import { formatDeadline, formatWeight, formatWindow, reference } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import { safeText, whatsappLink } from '@/lib/safe-text';
import {
  cityIndex,
  useAcceptQuote,
  useCities,
  useCurrentQuote,
  useDriverSummary,
  useMyLoads,
  useMyTrips,
  usePodUrl,
  useRateTrip,
  useTripCounterpart,
  useTripEvents,
  useTripTruck,
  useTruckTypes,
  type City,
  type DriverSummary,
  type Load,
  type Trip,
  type TripCounterpart,
  type TripTruck,
} from '@/lib/queries';
import { GUTTER_INK, alpha, color, elevation, font, hairline, radius, space } from '@/theme/tokens';

/** A driver has it, so the line is a commitment rather than an intention. */
const COMMITTED: Load['status'][] = ['assigned', 'in_transit', 'delivered', 'closed'];

export default function TrackLoad() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: cities } = useCities();
  const { data: truckTypes } = useTruckTypes();
  const loads = useMyLoads();
  const { data: trips } = useMyTrips();
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });

  const index = useMemo(() => cityIndex(cities), [cities]);

  // RLS already restricts `loads` to this shipper's own rows, so finding it in
  // the list IS the authorisation check — there is no id here that could reach
  // someone else's load, and a miss is "not found" rather than "forbidden".
  const load = (loads.data ?? []).find((l) => l.id === id);
  const trip = (trips ?? []).find((tr) => tr.load_id === id);

  // Every one of these no-ops until a trip exists, so T1 and T2 cost nothing.
  const counterpart = useTripCounterpart(trip?.id);
  const truck = useTripTruck(trip?.id);
  const events = useTripEvents(trip?.id);
  const summary = useDriverSummary(trip?.driver_id);

  const origin = load ? index.get(load.origin_city) : undefined;
  const dest = load ? index.get(load.dest_city) : undefined;

  const truckName = useMemo(() => {
    const m = new Map<string, string>();
    for (const tt of truckTypes ?? []) m.set(tt.code, localized(tt));
    return m;
  }, [truckTypes]);

  function askHuman(suffix?: string) {
    if (!load) return;
    Linking.openURL(
      whatsappLink(`${t('label.reference')} ${reference(load.id)}${suffix ? ` — ${suffix}` : ''}`),
    ).catch(() => {});
  }

  if (loads.isPending) {
    return (
      <View style={styles.screen}>
        <View style={[styles.loading, { paddingTop: insets.top + space.xxl }]}>
          {/* Skeletons at the final geometry. A spinner here would tell someone
              waiting on a price precisely nothing. */}
          <Skeleton height={28} width="40%" round={radius.notice} />
          <Skeleton height={150} round={radius.card} />
          <Skeleton height={72} round={radius.row} />
        </View>
      </View>
    );
  }

  if (!load || !origin || !dest) {
    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + space.md }]}>
          <BackButton onPress={() => router.back()} />
          <View style={styles.missing}>
            <QuestionHeading ground="ink" size="question">
              {t('note.missing.title')}
            </QuestionHeading>
            <Text style={styles.body}>{t('note.missing.explain')}</Text>
          </View>
        </ScrollView>
        <View style={[styles.dock, { paddingBottom: insets.bottom + space.lg }]}>
          <SecondaryButton label={t('track.home')} onPress={() => router.replace('/customer')} />
        </View>
      </View>
    );
  }

  const status = load.status;
  const committed = COMMITTED.includes(status);
  const delivered = status === 'delivered' || status === 'closed';

  // One road duration for the screen. The marker and the progress bar are both
  // derived from it, so they cannot disagree with each other.
  const hours = roadHours(
    { lng: origin.lng, lat: origin.lat },
    { lng: dest.lng, lat: dest.lat },
  );

  return (
    <View style={styles.screen}>
      {/* Orientation, not a control — the shipper cannot pan or zoom, and every
          screen picks its framing. `pointerEvents="none"` so the scroll under a
          thumb belongs to the content. */}
      <View
        style={styles.mapArea}
        onLayout={(e) => setMapSize(e.nativeEvent.layout)}
        pointerEvents="none"
      >
        {mapSize.width > 0 && (
          <>
            <MapCanvas framing="domestic" width={mapSize.width} height={mapSize.height}>
              <Corridor
                from={{ lng: origin.lng, lat: origin.lat }}
                to={{ lng: dest.lng, lat: dest.lat }}
                committed={committed}
              />
              <CityPin at={{ lng: origin.lng, lat: origin.lat }} state="origin" />
              <CityPin at={{ lng: dest.lng, lat: dest.lat }} state="destination" />
              {status === 'in_transit' && (
                <TruckMarker at={interpolate(origin, dest, progressOf(trip, events.data, hours))} />
              )}
            </MapCanvas>
            <Scrim variant="topHeavy" width={mapSize.width} height={mapSize.height} />
          </>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + 140 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loads.isRefetching}
            onRefresh={loads.refetch}
            tintColor={color.lightText}
          />
        }
      >
        <View style={styles.topRow}>
          <BackButton onPress={() => router.back()} />
          {/* T5's receipt states the reference with a label, so repeating it up
              here would be the app saying the same thing twice in one frame. */}
          {!delivered && <Text style={styles.reference}>{reference(load.id)}</Text>}
        </View>

        <View style={styles.spacer} />

        {(status === 'posted' || status === 'finding_truck') && <Waiting />}
        {status === 'quoted' && <Priced load={load} />}
        {(status === 'accepted' || status === 'matched') && <Accepted />}
        {status === 'assigned' && (
          <Assigned driver={counterpart.data} truck={truck.data} summary={summary.data} names={truckName} />
        )}
        {status === 'in_transit' && (
          <InTransit load={load} dest={dest} trip={trip} events={events.data} hours={hours} />
        )}
        {delivered && <Delivered load={load} />}
        {status === 'cancelled' && (
          <View style={styles.block}>
            <QuestionHeading ground="ink" size="question">
              {t('status.cancelled')}
            </QuestionHeading>
          </View>
        )}

        {/* The cargo itself, under every state. It is the thing being tracked and
            it does not change, so it reads the same in all six. */}
        <View style={styles.card}>
          <RouteRail origin={localized(origin)} destination={localized(dest)} compact />
          <View style={styles.chips}>
            <Chip label={safeText(load.goods_description)} />
            {load.weight_kg != null && <Chip label={formatWeight(load.weight_kg, '')} />}
            {/* A NULL truck type is the shipper's choice — "we advise" — and must
                read as a choice rather than a blank field. */}
            <Chip
              label={
                load.truck_type_code
                  ? (truckName.get(load.truck_type_code) ?? load.truck_type_code)
                  : t('book.review.weWillChoose')
              }
            />
            <Chip label={formatWindow(load.pickup_from, load.pickup_to)} />
          </View>
        </View>

        {delivered && <Rating trip={trip} />}
        {delivered && <Proof events={events.data} />}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + space.lg }]}>
        {status === 'quoted' ? (
          <AcceptBar load={load} onAsk={() => askHuman()} />
        ) : status === 'assigned' ? (
          <PrimaryButton
            label={t('track.assigned.call')}
            icon="phone"
            onPress={() => askHuman(counterpart.data ? safeText(counterpart.data.full_name) : undefined)}
          />
        ) : delivered ? (
          <>
            <SecondaryButton
              label={t('track.again')}
              onPress={() =>
                router.push({
                  pathname: '/post-load',
                  params: { origin: String(load.origin_city), dest: String(load.dest_city) },
                })
              }
            />
            <TertiaryButton label={t('track.home')} onPress={() => router.replace('/customer')} />
          </>
        ) : (
          // T1, T1b and T4 spend their accent on the live state, so the human
          // backstop is secondary here — never absent, though. A shipper reaches
          // a person from every state of this screen.
          <SecondaryButton label={t('whatsapp.action')} icon="whatsapp" onPress={() => askHuman()} />
        )}
      </View>
    </View>
  );
}

/* ─── T1 · the narrated wait ──────────────────────────────────────────────── */

/**
 * The wait, with words.
 *
 * "Any wait over ~3s is narrated with a Timeline carrying real information" —
 * and this one is measured in minutes, not seconds. The body promises the app
 * does not need to stay open, because the alternative is someone holding a phone
 * and watching a spinner, which is how a load quietly becomes a phone call.
 *
 * `finding_truck` renders identically on purpose. To the shipper it is the same
 * fact — we are looking — and the difference is which side of the auto-matcher
 * the load is on, which is our problem rather than theirs. Never a dead end.
 *
 * THE "GET A PRICE" BUTTON THAT USED TO LIVE HERE IS GONE. In the P4 order a
 * price is not something the shipper asks for — it arrives, and this is the wait
 * while it does. `quote_load` still exists and is still granted; its callers are
 * now `post_load` and the ops console. The failure mode to watch is a load that
 * never gets priced, which now has only the WhatsApp backstop below. Filed in
 * `OPEN_ISSUES.md`.
 */
function Waiting() {
  return (
    <View style={styles.block}>
      <StatusPill label={t('track.looking.pill')} tone="accent" />
      <View style={styles.lede}>
        <Text style={styles.body}>{t('track.looking.body')}</Text>
      </View>
      <View style={styles.timeline}>
        <Timeline
          steps={[
            { label: t('track.step.received'), state: 'complete' },
            { label: t('track.step.matching'), detail: t('track.step.matchingHint'), state: 'active' },
            { label: t('track.step.price'), state: 'future' },
            { label: t('track.step.truck'), state: 'future' },
          ]}
        />
      </View>
    </View>
  );
}

/**
 * T1b · the state the handoff never drew.
 *
 * Between "you accepted the price" and "a driver said yes" there is a gap that
 * no screen in the 32 covers, and it is the gap a shipper is most likely to sit
 * in wondering whether anything happened. Same shell, timeline advanced, and the
 * corridor still dashed — nobody has committed to carrying it yet.
 */
function Accepted() {
  return (
    <View style={styles.block}>
      <QuestionHeading ground="ink" size="question">
        {t('track.accepted.q')}
      </QuestionHeading>
      <View style={styles.lede}>
        <Text style={styles.body}>{t('track.accepted.body')}</Text>
      </View>
      <View style={styles.timeline}>
        <Timeline
          steps={[
            { label: t('track.step.received'), state: 'complete' },
            { label: t('track.step.matching'), state: 'complete' },
            { label: t('track.step.priceDone'), state: 'complete' },
            { label: t('track.step.truck'), state: 'active' },
          ]}
        />
      </View>
    </View>
  );
}

/* ─── T2 · the price ──────────────────────────────────────────────────────── */

/**
 * The price IS the screen.
 *
 * One number in Instrument Serif at 76px and almost nothing else. No timeline
 * here — its active ring is accent, and the accent on this screen belongs to the
 * button that commits money. Two accents would make the shipper hunt for which
 * thing is the decision.
 *
 * The amount comes off the load, which is where `ops_set_price` and the SQL
 * formula both put it. There is deliberately no `src/lib/pricing.ts` to consult:
 * a second implementation of a price disagrees with the first eventually, and a
 * client-side one ships the rate card's shape in the app bundle.
 */
function Priced({ load }: { load: Load }) {
  const quote = useCurrentQuote(load.id);
  const held = quote.data?.outcome === 'quoted' ? quote.data : null;

  return (
    <View style={styles.block}>
      <SectionLabel>{t('track.price.label')}</SectionLabel>
      <Text style={styles.priceHero} accessibilityRole="header">
        {/* formatMoney, never toFixed(2): OMR carries THREE decimals, and a
            two-decimal render is a 10x error that looks entirely plausible. */}
        {load.price_baisa == null
          ? '—'
          : formatMoney(load.price_baisa, load.currency as Currency, getLanguage())}
      </Text>
      {!!held && (
        <Text style={styles.priceMeta}>
          {`${t('price.heldUntil')} ${formatDeadline(held.expires_at)}`}
        </Text>
      )}
      <View style={styles.lede}>
        <Notice icon="pay">{t('price.settle')}</Notice>
      </View>
    </View>
  );
}

/**
 * The committing action, and the two ways out of it.
 *
 * The amount is IN THE LABEL — "Accept 42.500 OMR", not "Accept". Someone
 * agreeing to a price one-handed in a truck cab should not have to associate a
 * button with a number further up the screen, and a screen reader announcing
 * "Accept" alone announces nothing.
 *
 * `accept_quote` is idempotent server-side, so a double tap on flaky signal is
 * safe by construction rather than by a guard here. There is no payment surface:
 * accepting agrees a price, and settlement stays offline, permanently.
 */
function AcceptBar({ load, onAsk }: { load: Load; onAsk: () => void }) {
  const accept = useAcceptQuote();
  const money =
    load.price_baisa == null
      ? ''
      : ` ${formatMoney(load.price_baisa, load.currency as Currency, getLanguage())}`;

  return (
    <>
      <PrimaryButton
        label={`${t('track.price.accept')}${money}`}
        loading={accept.isPending}
        disabled={load.price_baisa == null}
        onPress={() => accept.mutate(load.id)}
      />
      <Text style={styles.dockNote}>{t('track.price.pay')}</Text>
      {/* "No thanks" is not a button that cancels a load — declining a price is a
          conversation, and there is a person on the other end of it. */}
      <TertiaryButton label={t('track.price.ask')} onPress={onAsk} />
    </>
  );
}

/* ─── T3 · a named person ─────────────────────────────────────────────────── */

/**
 * Who has your cargo.
 *
 * A name, a face's worth of initial, a vehicle — the handoff's point is that the
 * abstraction "a truck was assigned" becomes a person you could ring.
 *
 * THE RATING IS ABSENT, NOT ZERO. With no history this card shows the name and
 * the vehicle and nothing else: not "0.0", not "New driver ★", not a placeholder
 * five stars. A zero reads as a *bad* driver rather than a new one, and inventing
 * either is fabricating proof. `driver_summary` returns NULL for exactly this
 * reason, and that null is carried all the way here rather than defaulted at any
 * layer in between.
 */
function Assigned({
  driver,
  truck,
  summary,
  names,
}: {
  driver: TripCounterpart | null | undefined;
  truck: TripTruck | null | undefined;
  summary: DriverSummary | null | undefined;
  names: Map<string, string>;
}) {
  const name = driver ? safeText(driver.full_name) : null;

  return (
    <View style={styles.block}>
      <StatusPill label={t('track.assigned.label')} />
      {name ? (
        <QuestionHeading ground="ink" size="question">
          {`${name} ${t('track.assigned.taking')}`}
        </QuestionHeading>
      ) : (
        <Skeleton height={35} width="70%" round={radius.notice} />
      )}

      {!!driver && (
        <View style={styles.driver}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial(name ?? '')}</Text>
          </View>
          <View style={styles.driverText}>
            <Text style={styles.driverName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.driverMeta} numberOfLines={1}>
              {[
                truck ? (names.get(truck.truck_type) ?? truck.truck_type) : null,
                truck?.plate ? safeText(truck.plate) : null,
                truck?.is_verified ? t('cust.driver.verified') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <Credentials summary={summary} />
          </View>
        </View>
      )}

      <View style={styles.lede}>
        <Text style={styles.body}>{t('track.assigned.prep')}</Text>
      </View>
    </View>
  );
}

/**
 * "4.9 · 212 trips", or as much of it as is true.
 *
 * Three outcomes, and two of them render something honest rather than nothing:
 * a rated driver shows both, an unrated driver with completed trips shows only
 * the count, and a driver with neither shows no row at all. The star only ever
 * appears beside a real average.
 */
function Credentials({ summary }: { summary: DriverSummary | null | undefined }) {
  if (!summary) return null;
  const rated = summary.avgStars != null && summary.ratings > 0;
  if (!rated && summary.trips === 0) return null;

  return (
    <View style={styles.credentials}>
      {rated && (
        <>
          <Icon name="star" size={13} tint={color.accentLight} />
          <Text style={styles.credentialText}>{formatNumber(summary.avgStars!)}</Text>
        </>
      )}
      {summary.trips > 0 && (
        <Text style={styles.credentialText}>
          {`${rated ? '· ' : ''}${formatNumber(summary.trips)} ${t('track.trips')}`}
        </Text>
      )}
    </View>
  );
}

/* ─── T4 · on the road ────────────────────────────────────────────────────── */

/**
 * Where it is, when it lands, what is owed.
 *
 * THE POSITION IS NOT LIVE, and the copy is careful never to claim it is. GPS is
 * P6; until then the marker sits at a point interpolated from the collection
 * time and the road duration, which is an honest estimate and reads as one. The
 * screen says "arriving", never "the truck is here".
 *
 * The amount is shown because settlement is offline and the driver is about to
 * ask for it — a shipper who has to go hunting for the number at the gate is a
 * shipper arguing with a driver. Showing a price is expected; taking one here
 * would be a payment surface, and there are none.
 */
function InTransit({
  load,
  dest,
  trip,
  events,
  hours,
}: {
  load: Load;
  dest: City;
  trip: Trip | undefined;
  events: { type: string; occurred_at: string }[] | undefined;
  hours: number;
}) {
  const from = collectedAt(trip, events);
  const eta = from ? new Date(new Date(from).getTime() + hours * 3600_000).toISOString() : null;
  const done = progressOf(trip, events, hours);

  return (
    <View style={styles.block}>
      <StatusPill label={t('track.transit.arriving')} tone="accent" />
      <Text style={styles.eta} accessibilityRole="header">
        {eta ? formatDeadline(eta) : localized(dest)}
      </Text>

      <View style={styles.progress}>
        {/* Whole minutes rather than a fraction: `ProgressBar` announces its own
            value to a screen reader, and "62 of 100" is a number a person can
            hold, where 0.6187 is not. */}
        <ProgressBar step={Math.round(done * 100)} total={100} ground="ink" />
      </View>

      {load.price_baisa != null && (
        <View style={styles.owed}>
          <Text style={styles.owedLabel}>{t('track.transit.toPay')}</Text>
          <Text style={styles.owedAmount}>
            {formatMoney(load.price_baisa, load.currency as Currency, getLanguage())}
          </Text>
        </View>
      )}
    </View>
  );
}

/* ─── T5 · delivered ──────────────────────────────────────────────────────── */

/**
 * The one green in the product.
 *
 * `color.delivered` is spent here and nowhere else, which is what makes it mean
 * something: a shipper sees this colour exactly once per load, at the only
 * moment that is unambiguously finished. If it turns up on a second screen, that
 * screen is wrong — not this one.
 *
 * This is also the artefact the business runs on. Settlement is offline, so the
 * reference, the amount and the photograph are what close an invoice, settle a
 * dispute and satisfy a cross-border paper trail.
 */
function Delivered({ load }: { load: Load }) {
  return (
    <View style={styles.block}>
      <View style={styles.deliveredMark}>
        <Icon name="check" size={22} stroke={2.4} tint={color.delivered} />
      </View>
      <Text style={styles.deliveredTitle} accessibilityRole="header">
        {t('track.delivered.title')}
      </Text>

      <View style={styles.receipt}>
        <View style={styles.receiptRow}>
          <Text style={styles.receiptLabel}>{t('track.delivered.ref')}</Text>
          <Text style={styles.receiptRef}>{reference(load.id)}</Text>
        </View>
        {load.price_baisa != null && (
          <View style={[styles.receiptRow, styles.receiptRowLast]}>
            <Text style={styles.receiptLabel}>{t('track.delivered.paid')}</Text>
            <Text style={styles.receiptValue}>
              {formatMoney(load.price_baisa, load.currency as Currency, getLanguage())}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * One rating, once, and only if it is real.
 *
 * `rate_trip` is insert-once server-side, so a submitted rating is final — which
 * is why this shows thanks rather than a filled-in form afterwards. A rating that
 * can be revised is a note, not a rating.
 *
 * The stars are this screen's accent use. They are also its only remaining
 * action, which is the point: everything else here is a record.
 */
function Rating({ trip }: { trip: Trip | undefined }) {
  const rate = useRateTrip();
  const [chosen, setChosen] = useState<number | null>(null);
  if (!trip) return null;

  const submitted = rate.isSuccess;

  return (
    <View style={styles.card}>
      <Text style={styles.rateQ}>{submitted ? t('track.rate.thanks') : t('track.rate.q')}</Text>
      {!submitted && <Text style={styles.rateWhy}>{t('track.rate.why')}</Text>}

      {!submitted && (
        <View style={styles.stars} accessibilityRole="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <PressableSurface
              key={n}
              onPress={() => {
                setChosen(n);
                rate.mutate({ tripId: trip.id, stars: n });
              }}
              accessibilityLabel={`${formatNumber(n)} ${t('track.rate.star')}`}
              style={styles.star}
            >
              <Icon
                name={chosen != null && n <= chosen ? 'star' : 'starOutline'}
                size={30}
                tint={chosen != null && n <= chosen ? color.accent : alpha.onInk.tertiary}
              />
            </PressableSurface>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Proof of delivery, behind a short-lived signed URL.
 *
 * Its own component so the signing query only mounts once a path exists, and so
 * a failed signature degrades to nothing rather than a broken frame. The bucket
 * is private and the policy authorises on the trip id in the first path segment.
 */
function Proof({ events }: { events: { photo_path: string | null }[] | undefined }) {
  const path = (events ?? []).find((e) => e.photo_path)?.photo_path ?? null;
  const url = usePodUrl(path);
  if (!url.data) return null;

  return (
    <View style={styles.block}>
      <SectionLabel>{t('cust.pod.title')}</SectionLabel>
      <Image
        source={{ uri: url.data }}
        style={styles.proof}
        accessibilityRole="image"
        accessibilityLabel={t('note.pod.alt')}
      />
    </View>
  );
}

/* ─── estimates ───────────────────────────────────────────────────────────── */

/** When the driver picked it up, or the best stand-in we have. */
function collectedAt(
  trip: Trip | undefined,
  events: { type: string; occurred_at: string }[] | undefined,
): string | null {
  const pickup = (events ?? []).find((e) => e.type === 'picked_up');
  return pickup?.occurred_at ?? trip?.created_at ?? null;
}

/**
 * How far along, as a fraction — an ESTIMATE, never a fix.
 *
 * `hours` is the road duration for this specific corridor, passed in rather than
 * assumed, so the marker on the map and the bar under the ETA are computed from
 * the same number. Two independent guesses at "how far along" would drift apart
 * on screen, and a truck ahead of its own progress bar is worse than neither.
 *
 * Clamped away from both ends because a marker sitting exactly on the origin pin
 * reads as "it has not moved" and one on the destination reads as "it arrived",
 * and neither is something this function knows. P6 owns GPS; until then nothing
 * here claims a live fix.
 */
function progressOf(
  trip: Trip | undefined,
  events: { type: string; occurred_at: string }[] | undefined,
  hours: number,
): number {
  const from = trip ? collectedAt(trip, events) : null;
  if (!from || hours <= 0) return 0.05;
  const elapsedH = (Date.now() - new Date(from).getTime()) / 3600_000;
  return Math.min(0.95, Math.max(0.05, elapsedH / hours));
}

/** A point on the line between two cities. Not a road, and not pretending to be. */
function interpolate(a: City, b: City, fraction: number) {
  return {
    lng: a.lng + (b.lng - a.lng) * fraction,
    lat: a.lat + (b.lat - a.lat) * fraction,
  };
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '·';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  mapArea: {
    position: 'absolute',
    top: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    height: 420,
  },

  scroll: { paddingHorizontal: GUTTER_INK, gap: space.lg },
  loading: { paddingHorizontal: GUTTER_INK, gap: space.lg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reference: { ...font.reference, color: alpha.onInk.tertiary },
  spacer: { height: 130 },
  missing: { gap: space.sm, marginTop: space.xxl, maxWidth: 320 },

  block: { gap: space.md, alignItems: 'flex-start' },
  lede: { maxWidth: 340 },
  body: { ...arabicIfNeeded(font.body), color: alpha.onInk.body, textAlign: align.start },
  timeline: { alignSelf: 'stretch', paddingTop: space.sm },

  card: {
    alignSelf: 'stretch',
    backgroundColor: color.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: hairline.card,
    padding: space.xl,
    gap: space.md,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  // T2
  priceHero: { ...font.priceHero, color: color.lightText, textAlign: align.start },
  priceMeta: { ...font.caption, color: alpha.onInk.tertiary, textAlign: align.start },

  // T3
  driver: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.raised,
    borderRadius: radius.card,
    padding: space.lg,
    ...elevation.cardInk,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: color.accentWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...font.title, color: color.accentLight },
  driverText: { flex: 1, gap: 2 },
  driverName: { ...arabicIfNeeded(font.rowTitle), color: color.lightText, textAlign: align.start },
  driverMeta: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.tertiary, textAlign: align.start },
  credentials: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 2 },
  credentialText: { ...font.caption, color: alpha.onInk.secondary },

  // T4
  eta: { ...font.estimate, color: color.lightText, textAlign: align.start },
  progress: { alignSelf: 'stretch', paddingVertical: space.sm },
  owed: { gap: 2 },
  owedLabel: { ...arabicIfNeeded(font.caption), color: alpha.onInk.tertiary, textAlign: align.start },
  owedAmount: { ...font.statement, color: color.lightText, textAlign: align.start },

  // T5
  deliveredMark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(121,224,175,.16)',
  },
  deliveredTitle: { ...arabicIfNeeded(font.display), color: color.delivered, textAlign: align.start },
  receipt: {
    alignSelf: 'stretch',
    backgroundColor: color.surface,
    borderRadius: radius.card,
    paddingHorizontal: space.xl,
  },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.lg,
    borderBottomWidth: 1,
    borderBottomColor: hairline.inner,
  },
  receiptRowLast: { borderBottomWidth: 0 },
  receiptLabel: { ...arabicIfNeeded(font.body), color: alpha.onInk.tertiary },
  receiptValue: { ...font.value, color: color.lightText },
  receiptRef: { ...font.reference, color: color.lightText },

  rateQ: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start },
  rateWhy: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.tertiary, textAlign: align.start },
  stars: { flexDirection: 'row', gap: space.xs, paddingTop: space.xs },
  star: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },

  proof: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.card,
    backgroundColor: color.surface,
  },

  dock: {
    paddingHorizontal: GUTTER_INK,
    paddingTop: space.md,
    gap: space.sm,
    backgroundColor: color.ink,
  },
  dockNote: {
    ...arabicIfNeeded(font.bodySmall),
    color: alpha.onInk.tertiary,
    textAlign: 'center',
  },
});
