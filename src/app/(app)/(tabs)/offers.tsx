/**
 * Loads offered to this driver.
 *
 * Drivers do **not** browse a load board — `SECURITY.md` and CLAUDE.md are
 * explicit, and it is a business decision before it is a security one: a board
 * would expose every shipper's cargo to anyone who signed up as a driver. What
 * lands here is only what dispatch (or the auto-dispatcher) addressed to this
 * person, and RLS is what makes that true rather than this screen.
 *
 * Each offer is a full card with both answers on it. Accepting is a commitment
 * made in a moving vehicle against a clock, so the pay, the deadline and the
 * decline are all on screen at once — a driver should never have to scroll to
 * find out what they are agreeing to, or tap twice to say no.
 */

import { useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Stamp } from '@/components/primitives';
import { EmptyState, FactChips, PageTitle, RouteLine, Screen } from '@/components/ui';
import { align, getLanguage, localized, t } from '@/i18n';
import { formatDeadline, formatWeight, formatWindow, reference } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import { safeText } from '@/lib/safe-text';
import {
  cityIndex,
  useCities,
  useMyOffers,
  useRespondToOffer,
  useVisibleLoads,
} from '@/lib/queries';
import { color, elevation, font, GUTTER, radius, space } from '@/theme/tokens';

export default function OffersTab() {
  const cities = useCities();
  const offers = useMyOffers();
  const loads = useVisibleLoads();
  const respond = useRespondToOffer();
  const [error, setError] = useState<string | null>(null);

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (id: number) => {
    const c = index.get(id);
    return c ? localized(c) : '—';
  };

  const loadById = useMemo(
    () => new Map((loads.data ?? []).map((l) => [l.id, l])),
    [loads.data],
  );

  /**
   * Answer an offer.
   *
   * The decline path needs the same error handling as the accept path: since
   * 0013 a decline is what returns the shipper's load to the dispatcher, so
   * silently losing one strands the load.
   */
  function answer(offerId: string, accept: boolean) {
    setError(null);
    respond.mutate(
      { offerId, accept },
      {
        onError: (e: unknown) => {
          // The race, made recognisable. 0013 raises a domain error instead of a
          // constraint violation precisely so this line can exist: "something
          // went wrong" reads as a broken app on the one screen where a driver
          // earns.
          const msg = e instanceof Error ? e.message : '';
          setError(
            msg.includes('load already assigned') ? t('driver.offer.taken') : t('error.generic'),
          );
        },
      },
    );
  }

  const pending = offers.data ?? [];
  const busy = offers.isPending || loads.isPending;
  const failed = offers.isError || loads.isError;

  function refetchAll() {
    offers.refetch();
    loads.refetch();
  }

  return (
    <Screen>
      <PageTitle detail={t('offers.hint')}>{t('offers.title')}</PageTitle>

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
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={offers.isRefetching || loads.isRefetching}
              onRefresh={refetchAll}
              tintColor={color.orange}
            />
          }
        >
          {pending.length === 0 ? (
            <EmptyState
              icon="offers"
              title={t('driver.offers.none.title')}
              explain={t('driver.offers.none.explain')}
            />
          ) : (
            pending.map((offer) => {
              const load = loadById.get(offer.load_id);
              if (!load) return null;

              const acceptingThis =
                respond.isPending &&
                respond.variables?.offerId === offer.id &&
                respond.variables?.accept === true;
              const decliningThis =
                respond.isPending &&
                respond.variables?.offerId === offer.id &&
                respond.variables?.accept === false;

              return (
                <View key={offer.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Stamp tone="pending">{t('status.posted')}</Stamp>
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
                        icon: 'calendar',
                        label: t('label.pickup'),
                        value: formatWindow(load.pickup_from, load.pickup_to),
                      },
                      {
                        icon: 'weight',
                        label: t('label.weight'),
                        value: formatWeight(load.weight_kg, t('weight.unset')),
                      },
                      // The offer does not wait. Saying when it stops waiting is
                      // the difference between a decision and a nag.
                      {
                        icon: 'clock',
                        label: t('label.replyBy'),
                        value: formatDeadline(offer.expires_at),
                      },
                    ]}
                  />

                  <View style={styles.pay}>
                    <Text style={styles.payLabel}>{t('driver.pay')}</Text>
                    {load.price_baisa != null ? (
                      <Text style={styles.payAmount}>
                        {formatMoney(load.price_baisa, load.currency as Currency, getLanguage())}
                      </Text>
                    ) : (
                      <Body muted>{t('driver.pay.pending')}</Body>
                    )}
                  </View>

                  <Button
                    label={t('driver.accept')}
                    loading={acceptingThis}
                    disabled={respond.isPending && !acceptingThis}
                    onPress={() => answer(offer.id, true)}
                  />
                  {/* Declining is quiet, never a second orange — but it is a real
                      44pt target, because "no" must be as easy to hit as "yes". */}
                  <Button
                    label={t('driver.decline')}
                    variant="quiet"
                    loading={decliningThis}
                    disabled={respond.isPending && !decliningThis}
                    onPress={() => answer(offer.id, false)}
                  />

                  {!!error && (
                    <Text style={styles.error} accessibilityLiveRegion="polite">
                      {error}
                    </Text>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: GUTTER, paddingBottom: space.xxxl, gap: space.lg },
  center: { paddingVertical: space.huge, alignItems: 'center' },
  emptyAction: { alignSelf: 'stretch', paddingTop: space.md, paddingHorizontal: space.xl },

  card: {
    backgroundColor: color.paper,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
    ...elevation.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  reference: { ...font.micro, color: color.inkFaint },

  pay: { gap: 2, paddingTop: space.xs },
  payLabel: { ...font.label, color: color.inkSoft, textAlign: align.start },
  payAmount: { ...font.hero, color: color.ink, textAlign: align.start },
  error: { ...font.bodySmall, color: color.danger, textAlign: align.start },
});
