/**
 * Driver home, as the docket book. See `waybill-book.tsx` for the direction
 * contract this serves.
 *
 * Three tabs, because a driver's day has exactly three kinds of paper in it: the
 * trip they are on, the loads offered to them, and the routes they have
 * declared. Each offer gets its own full sheet rather than a card in a list —
 * accepting a load is a commitment made in a moving vehicle, and a decision that
 * fills the screen is a decision that was actually read.
 *
 * The routes tab is last but it is the one the business depends on: the matching
 * engine is worth nothing until drivers habitually declare their legs
 * (PRODUCT.md). That is why declaring one is the pinned action on every sheet,
 * and why the empty routes sheet says what an empty book costs.
 */

import { useMemo, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlankNote, FactRow, LedgerRow, NoteBody, NoteFoot, RoutePair } from '@/components/consignment';
import { Masthead } from '@/components/masthead';
import { Body, Button, Note, NoteHead, Rule, Stamp, TextButton } from '@/components/primitives';
import {
  WaybillBook,
  type BookHandle,
  type BookSection,
  type BookSheet,
} from '@/components/waybill-book';
import { align, directionArrow, getLanguage, localized, t } from '@/i18n';
import { signOut } from '@/lib/auth';
import { formatDeadline, formatWeight, formatWindow, reference } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import { safeText } from '@/lib/safe-text';
import {
  cityIndex,
  useCities,
  useMyLegs,
  useMyOffers,
  useMyTrips,
  useRespondToOffer,
  useVisibleLoads,
} from '@/lib/queries';
import { color, doc, font, space } from '@/theme/tokens';

export default function DriverHome() {
  const router = useRouter();
  const cities = useCities();
  const legs = useMyLegs();
  const offers = useMyOffers();
  const trips = useMyTrips();
  const loads = useVisibleLoads();
  const respond = useRespondToOffer();
  const book = useRef<BookHandle>(null);

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const loadById = useMemo(
    () => new Map((loads.data ?? []).map((l) => [l.id, l])),
    [loads.data],
  );

  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  const activeTrip = (trips.data ?? []).find(
    (tr) => tr.status === 'assigned' || tr.status === 'in_transit',
  );
  const activeLoad = activeTrip ? loadById.get(activeTrip.load_id) : undefined;

  const pending = offers.data ?? [];
  const upcomingLegs = (legs.data ?? []).filter((l) => l.status === 'open');

  // Legs are in here too: without them the routes tab would flash a count of 0
  // and then correct itself, which reads as "you have no routes" to the exact
  // person we most need to keep declaring them.
  const busy = trips.isPending || offers.isPending || loads.isPending || legs.isPending;
  const failed = trips.isError || offers.isError || loads.isError || legs.isError;
  const refreshing =
    trips.isRefetching || offers.isRefetching || loads.isRefetching || legs.isRefetching;

  function refetchAll() {
    trips.refetch();
    offers.refetch();
    loads.refetch();
    legs.refetch();
  }

  /* ── the book ──────────────────────────────────────────────────────────── */

  const sections: BookSection[] = [
    { key: 'trip', label: t('book.tab.trip') },
    { key: 'offers', label: t('book.tab.offers'), count: pending.length },
    { key: 'routes', label: t('book.tab.routes'), count: upcomingLegs.length },
  ];

  const sheets: BookSheet[] = [];

  // Sheet 1 — the trip. A driver mid-delivery opens to exactly one thing.
  sheets.push({
    key: 'trip',
    sectionKey: 'trip',
    hasPrimary: !!activeTrip,
    render: () =>
      activeTrip && activeLoad ? (
        <Note>
          <NoteHead
            left={t('label.trip')}
            right={
              <Stamp tone="active">
                {activeTrip.status === 'in_transit'
                  ? t('status.in_transit')
                  : t('status.assigned')}
              </Stamp>
            }
          />
          <NoteBody>
            <RoutePair
              from={cityName(activeLoad.origin_city)}
              to={cityName(activeLoad.dest_city)}
              labelFrom={t('label.from')}
              labelTo={t('label.to')}
            />
            <Body>{safeText(activeLoad.goods_description)}</Body>

            {/* Delivery needs a photo, so both transitions route to the trip
                screen rather than firing a state change from here. */}
            <Button
              label={
                activeTrip.status === 'assigned'
                  ? t('driver.advance.pickedUp')
                  : t('driver.advance.delivered')
              }
              onPress={() => router.push(`/trip/${activeTrip.id}`)}
            />
          </NoteBody>
          <NoteFoot reference={reference(activeLoad.id)} />
        </Note>
      ) : (
        <BlankNote
          title={t('driver.trip.none.title')}
          explain={t('driver.trip.none.explain')}
        />
      ),
  });

  // Sheets 2..n — one offer per sheet.
  if (pending.length === 0) {
    sheets.push({
      key: 'offers-none',
      sectionKey: 'offers',
      render: () => (
        <BlankNote
          title={t('driver.offers.none.title')}
          explain={t('driver.offers.none.explain')}
        />
      ),
    });
  } else {
    for (const offer of pending) {
      const load = loadById.get(offer.load_id);
      if (!load) continue;
      sheets.push({
        key: offer.id,
        sectionKey: 'offers',
        hasPrimary: true,
        render: () => (
          <Note>
            <NoteHead
              left={t('driver.offer.sheet')}
              right={<Stamp tone="pending">{t('status.posted')}</Stamp>}
            />
            <NoteBody>
              <RoutePair
                from={cityName(load.origin_city)}
                to={cityName(load.dest_city)}
                labelFrom={t('label.from')}
                labelTo={t('label.to')}
              />
              <Body>{safeText(load.goods_description)}</Body>
              <FactRow
                facts={[
                  {
                    label: t('label.pickup'),
                    value: formatWindow(load.pickup_from, load.pickup_to),
                  },
                  {
                    label: t('label.weight'),
                    value: formatWeight(load.weight_kg, t('weight.unset')),
                  },
                  // The offer does not wait. Saying when it stops waiting is the
                  // difference between a decision and a nag.
                  { label: t('label.replyBy'), value: formatDeadline(offer.expires_at) },
                ]}
              />

              {/* What the trip pays.
                  This sheet showed route, goods, dates and weight — everything the
                  driver already knew, because they declared the leg — and withheld
                  the only variable. `price_baisa` was fetched and dropped. Asking an
                  owner-driver to commit a truck against an unknown return, in a cab,
                  against a deadline, invites the one answer the supply side cannot
                  afford: no. CLAUDE.md permits this explicitly — showing a price is
                  fine, taking one is not. */}
              <Rule />
              <View style={styles.pay}>
                <Text style={styles.payLabel}>{t('driver.pay').toUpperCase()}</Text>
                {load.price_baisa != null ? (
                  <Text style={styles.payAmount}>
                    {formatMoney(load.price_baisa, load.currency as Currency, getLanguage())}
                  </Text>
                ) : (
                  // The normal case until the rate card is loaded (OPEN_ISSUES 13).
                  // A blank here reads as "the app is broken"; a sentence reads as
                  // "a person is handling it", which is also what is true.
                  <Body muted>{t('driver.pay.pending')}</Body>
                )}
              </View>

              <Button
                label={t('driver.accept')}
                loading={respond.isPending && respond.variables?.offerId === offer.id}
                onPress={() =>
                  respond.mutate(
                    { offerId: offer.id, accept: true },
                    // This sheet is about to stop existing. Turn to the trip the
                    // driver just took, rather than leaving them wherever the
                    // book happens to collapse to.
                    { onSuccess: () => book.current?.goToSection('trip') },
                  )
                }
              />
              {/* Declining is quiet, never a second orange — but it is a real
                  44pt button, because "no" must be as easy to hit as "yes". */}
              <Button
                label={t('driver.decline')}
                variant="quiet"
                disabled={respond.isPending}
                onPress={() => respond.mutate({ offerId: offer.id, accept: false })}
              />
            </NoteBody>
            <NoteFoot reference={reference(load.id)} />
          </Note>
        ),
      });
    }
  }

  // Last sheet — the route book. A list, so it is ruled rows, not notes.
  sheets.push({
    key: 'routes',
    sectionKey: 'routes',
    render: () =>
      upcomingLegs.length === 0 ? (
        <BlankNote
          title={t('driver.routes.none.title')}
          explain={t('driver.routes.none.explain')}
        />
      ) : (
        <Note>
          <NoteHead left={t('driver.routes.title')} />
          {upcomingLegs.map((leg, i) => (
            <LedgerRow
              key={leg.id}
              // Never a hardcoded arrow: it points the wrong way in Arabic.
              route={`${cityName(leg.origin_city)} ${directionArrow()} ${cityName(leg.dest_city)}`}
              meta={formatWindow(leg.depart_from, leg.depart_to)}
              trailing={
                <Stamp tone={leg.is_empty ? 'active' : 'pending'}>
                  {leg.is_empty ? t('leg.stamp.empty') : t('leg.stamp.part')}
                </Stamp>
              }
              last={i === upcomingLegs.length - 1}
            />
          ))}
        </Note>
      ),
  });

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Masthead
        title={t('driver.masthead')}
        action={<TextButton label={t('auth.signOut')} tone="muted" onPress={signOut} />}
      />

      {busy ? (
        <View style={styles.center}>
          <ActivityIndicator color={color.orange} />
        </View>
      ) : failed ? (
        <View style={styles.block}>
          <BlankNote title={t('common.error.title')} explain={t('common.error.explain')}>
            <View style={styles.blankAction}>
              <Button label={t('common.retry')} variant="secondary" onPress={refetchAll} />
            </View>
          </BlankNote>
        </View>
      ) : (
        <WaybillBook
          ref={book}
          sections={sections}
          sheets={sheets}
          refreshing={refreshing}
          onRefresh={refetchAll}
          footer={({ sheetHasPrimary }) => (
            <View style={styles.pinned}>
              {/* Declaring a route is always reachable, and it is the orange one
                  whenever the visible sheet is not already asking for a decision.
                  Never two oranges on screen. */}
              <Button
                label={t('driver.postLeg')}
                variant={sheetHasPrimary ? 'secondary' : 'primary'}
                onPress={() => router.push('/post-leg')}
              />
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  block: { paddingHorizontal: space.xl, paddingTop: space.xl },
  blankAction: { alignSelf: 'stretch', paddingTop: space.sm },

  // More room above the label than below it, so the pay reads as its own section
  // rather than a trailing note on the fact row above.
  pay: { paddingTop: space.md, gap: 4 },
  payLabel: { ...doc.fieldLabel, color: color.inkSoft, textAlign: align.start },
  // The one number the driver does not already know, at the same weight the route
  // gets. Ink, not orange — Accept is the only orange on this sheet.
  payAmount: { ...font.title, color: color.ink, textAlign: align.start },
  pinned: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    paddingBottom: space.md,
    backgroundColor: color.paper,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
});
