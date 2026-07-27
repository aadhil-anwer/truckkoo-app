/**
 * Driver home — the trip they are on, and nothing else.
 *
 * A driver mid-delivery has exactly one thing to do, and this screen is that one
 * thing at full size with the action pinned under the thumb. Offers and routes
 * moved out to their own tabs, which is what freed this screen to stop being a
 * list of three equally-weighted sections.
 *
 * With no trip, the screen inverts: the empty state becomes an argument for
 * declaring a route. That is not filler. The matching engine is worth nothing
 * until drivers habitually declare their legs (PRODUCT.md), so the emptiest
 * screen in the app is the one that has to sell the habit hardest.
 *
 * Both transitions route to `trip/[id]` rather than firing a state change from
 * here: delivery needs a photo, and a confirmation that a driver can trigger by
 * brushing the screen in a moving cab is a dispute with a customer.
 */

import { useMemo } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Body, Button, Stamp } from '@/components/primitives';
import {
  ActionBar,
  EmptyState,
  FactChips,
  PageTitle,
  RouteLine,
  Screen,
  Section,
} from '@/components/ui';
import { align, getLanguage, localized, t } from '@/i18n';
import { formatWeight, reference } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import { safeText } from '@/lib/safe-text';
import { cityIndex, useCities, useMyTrips, useVisibleLoads } from '@/lib/queries';
import { color, elevation, font, GUTTER, radius, space } from '@/theme/tokens';

export default function DriverHome() {
  const router = useRouter();
  const cities = useCities();
  const trips = useMyTrips();
  const loads = useVisibleLoads();

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  const loadById = useMemo(
    () => new Map((loads.data ?? []).map((l) => [l.id, l])),
    [loads.data],
  );

  const trip = (trips.data ?? []).find(
    (tr) => tr.status === 'assigned' || tr.status === 'in_transit',
  );
  const load = trip ? loadById.get(trip.load_id) : undefined;

  const busy = trips.isPending || loads.isPending;
  const failed = trips.isError || loads.isError;
  const refreshing = trips.isRefetching || loads.isRefetching;

  function refetchAll() {
    trips.refetch();
    loads.refetch();
  }

  const collected = trip?.status === 'in_transit';

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refetchAll} tintColor={color.orange} />
        }
      >
        <PageTitle>{t('driver.masthead')}</PageTitle>

        {busy ? (
          <View style={styles.center}>
            <ActivityIndicator color={color.orange} accessibilityLabel={t('common.loading')} />
          </View>
        ) : failed ? (
          <EmptyState icon="alert" title={t('common.error.title')} explain={t('common.error.explain')}>
            <View style={styles.emptyAction}>
              <Button label={t('common.retry')} variant="secondary" onPress={refetchAll} />
            </View>
          </EmptyState>
        ) : trip && load ? (
          <Section title={t('driver.trip.title')}>
            <View style={styles.cardWrap}>
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Stamp tone="active">
                    {collected ? t('status.in_transit') : t('status.assigned')}
                  </Stamp>
                  <Text style={styles.reference}>{reference(load.id)}</Text>
                </View>

                <RouteLine
                  from={cityName(load.origin_city)}
                  to={cityName(load.dest_city)}
                  labelFrom={t('label.from')}
                  labelTo={t('label.to')}
                />

                <Body>{safeText(load.goods_description)}</Body>

                <FactChips
                  facts={[
                    {
                      icon: 'weight',
                      label: t('label.weight'),
                      value: formatWeight(load.weight_kg, t('weight.unset')),
                    },
                  ]}
                />

                {/* What the trip pays. CLAUDE.md permits this explicitly —
                    showing a price is fine, taking one is not. Asking an
                    owner-driver to commit a truck against an unknown return is
                    how the supply side learns to ignore the app. */}
                <View style={styles.pay}>
                  <Text style={styles.payLabel}>{t('driver.pay')}</Text>
                  {load.price_baisa != null ? (
                    <Text style={styles.payAmount}>
                      {formatMoney(load.price_baisa, load.currency as Currency, getLanguage())}
                    </Text>
                  ) : (
                    // The normal case until the rate card is loaded. A blank here
                    // reads as "the app is broken"; a sentence reads as "a person
                    // is handling it", which is also what is true.
                    <Body muted>{t('driver.pay.pending')}</Body>
                  )}
                </View>
              </View>
            </View>
          </Section>
        ) : (
          <EmptyState
            icon="truck"
            title={t('driver.trip.none.title')}
            explain={t('driver.trip.none.explain')}
          />
        )}
      </ScrollView>

      {/* One action, always the same place. On a trip it advances the trip; off
          one it declares a route — which is the thing that produces trips. */}
      {!busy && !failed && (
        <ActionBar>
          {trip ? (
            <Button
              label={collected ? t('driver.advance.delivered') : t('driver.advance.pickedUp')}
              onPress={() => router.push(`/trip/${trip.id}`)}
            />
          ) : (
            <Button
              label={t('driver.postLeg')}
              icon="plus"
              onPress={() => router.push('/post-leg')}
            />
          )}
        </ActionBar>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xxl, gap: space.xxl },
  center: { paddingVertical: space.huge, alignItems: 'center' },
  emptyAction: { alignSelf: 'stretch', paddingTop: space.md, paddingHorizontal: space.xl },

  cardWrap: { paddingHorizontal: GUTTER },
  card: {
    backgroundColor: color.paper,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.lg,
    ...elevation.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  reference: { ...font.micro, color: color.inkFaint },

  pay: { gap: 2 },
  payLabel: { ...font.label, color: color.inkSoft, textAlign: align.start },
  // The one number the driver does not already know, at the largest weight on
  // the card. Ink, not orange — the pinned action is the only orange here.
  payAmount: { ...font.hero, color: color.ink, textAlign: align.start },
});
