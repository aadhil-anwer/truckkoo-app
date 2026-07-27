/**
 * One load, in full — moving or finished.
 *
 * WHY THIS SCREEN EXISTS
 *
 * Two holes used to meet here. A *finished* load had no detail screen at all:
 * `LIVE` excluded `delivered`, so the moment a job completed its sheet stopped
 * rendering and the proof-of-delivery photo, the driver's name, the plate and
 * the price all became unreachable in the same frame. And a *moving* load had
 * its detail inlined on the home screen, which is why home could only ever show
 * one or two loads before it became unreadable.
 *
 * One screen fixes both. A shipper taps any load, live or finished, and gets
 * everything: where it is, who has it, what it costs, and the photograph proving
 * it arrived. They should not have to learn two screens for one noun.
 *
 * Settlement is offline (PRODUCT.md), so the finished version of this screen is
 * the artefact the business actually runs on — it closes an invoice, settles a
 * dispute, and satisfies a cross-border paper trail. That is why it is the one
 * surface that keeps the consignment-note vocabulary the rest of the app shed:
 * here, the document metaphor is not a metaphor.
 *
 * Read-only by construction. Nothing here mutates a load; the only actions are
 * asking for a price and reaching a human.
 */

import { useMemo } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Body, Button, IconButton, Stamp } from '@/components/primitives';
import {
  ActionBar,
  Avatar,
  EmptyState,
  FactChips,
  ListRow,
  PageTitle,
  RouteLine,
  RowGroup,
  Screen,
  Section,
  TopBar,
} from '@/components/ui';
import { align, getLanguage, localized, t, type StringKey } from '@/i18n';
import { formatDeadline, formatWeight, formatWindow, reference } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import { safeText, whatsappLink } from '@/lib/safe-text';
import {
  cityIndex,
  useCities,
  useCurrentQuote,
  useMyLoads,
  useMyTrips,
  usePodUrl,
  useQuoteLoad,
  useTripCounterpart,
  useTripEvents,
  useTripTruck,
  useTruckTypes,
  type Load,
} from '@/lib/queries';
import { color, elevation, font, GUTTER, radius, space } from '@/theme/tokens';

export default function LoadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const cities = useCities();
  const truckTypes = useTruckTypes();
  const loads = useMyLoads();
  const trips = useMyTrips();

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const cityName = (cid: number) => {
    const c = index.get(cid);
    return c ? localized(c) : '—';
  };

  const truckName = useMemo(() => {
    const m = new Map<string, string>();
    for (const tt of truckTypes.data ?? []) {
      m.set(tt.code, localized({ name_en: tt.name_en, name_ar: tt.name_ar }));
    }
    return m;
  }, [truckTypes.data]);

  // RLS already restricts `loads` to this shipper's own rows, so finding it in
  // the list is the whole authorisation check — there is no id here that could
  // reach someone else's load.
  const load = (loads.data ?? []).find((l) => l.id === id);
  const trip = (trips.data ?? []).find((tr) => tr.load_id === id);

  // All three no-op until a trip exists (`enabled: !!tripId`), so a posted load
  // costs nothing extra.
  const counterpart = useTripCounterpart(trip?.id);
  const truck = useTripTruck(trip?.id);
  const events = useTripEvents(trip?.id);

  const proof = (events.data ?? []).find((e) => e.photo_path)?.photo_path ?? null;

  if (loads.isPending) {
    return (
      <Screen tone="surface" edges={['top', 'bottom']}>
        <TopBar onBack={() => router.back()} />
        <View style={styles.center} accessibilityLiveRegion="polite">
          <ActivityIndicator color={color.orange} accessibilityLabel={t('common.loading')} />
        </View>
      </Screen>
    );
  }

  // Not found and not-yours are the same thing here, exactly as they are in the
  // database (SECURITY.md §3): the row simply is not in this shipper's list.
  if (!load) {
    return (
      <Screen tone="surface" edges={['top', 'bottom']}>
        <TopBar onBack={() => router.back()} />
        <EmptyState
          icon="alert"
          title={t('note.missing.title')}
          explain={t('note.missing.explain')}
        />
      </Screen>
    );
  }

  const driver = counterpart.data;
  const finding = load.status === 'finding_truck';
  const finished = load.status === 'delivered' || load.status === 'closed';

  function askHuman(suffix?: string) {
    Linking.openURL(
      whatsappLink(`${t('label.reference')} ${reference(load!.id)}${suffix ? ` — ${suffix}` : ''}`),
    ).catch(() => {});
  }

  return (
    <Screen tone="surface" edges={['top', 'bottom']}>
      {/* No status pill up here. The headline below already says it, and the two
          together read as the app repeating itself — the exact kind of doubling
          that makes a screen look unedited. */}
      <TopBar onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* The status is the headline. It is the answer to the only question a
            shipper opened this screen to ask. */}
        <PageTitle detail={reference(load.id)}>
          {t(`status.${load.status}` as StringKey)}
        </PageTitle>

        <View style={styles.block}>
          <View style={styles.panel}>
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
                  icon: 'truck',
                  label: t('label.truck'),
                  // A null truck type is "Not sure — advise me", never blank.
                  value: load.truck_type_code
                    ? (truckName.get(load.truck_type_code) ?? load.truck_type_code)
                    : t('truck.unset'),
                },
                {
                  icon: 'weight',
                  label: t('label.weight'),
                  value: formatWeight(load.weight_kg, t('weight.unset')),
                },
              ]}
            />
          </View>
        </View>

        <PriceBlock load={load} />

        {/* The one state where a shipper could think they have been forgotten.
            PRODUCT.md: never a dead end — so it explains itself, and the pinned
            action below hands over a human. */}
        {finding && (
          <View style={styles.block}>
            <View style={styles.notice}>
              <Body muted>{t('cust.finding.explain')}</Body>
            </View>
          </View>
        )}

        {/* Who is carrying it. PRODUCT.md Principle #4: show the truck and the
            person. Both come from definer functions that check trip
            participation, because `profiles` and `trucks` are not
            cross-readable. */}
        {!!driver && (
          <Section title={finished ? t('note.carrier') : t('cust.driver.title')}>
            <View style={styles.block}>
              <View style={styles.driver}>
                <Avatar name={safeText(driver.full_name)} />
                <View style={styles.driverText}>
                  <Text style={styles.driverName} numberOfLines={1}>
                    {safeText(driver.full_name)}
                  </Text>
                  {truck.data?.is_verified && (
                    <Stamp tone="done">{t('cust.driver.verified')}</Stamp>
                  )}
                </View>
                {/* Phone is only present because `trip_counterpart` returned it
                    to a participant. Routed through whatsappLink so the number
                    and the reference are both encoded. On a finished job the
                    relationship is with Truckkoo, not the driver — so this
                    disappears rather than becoming a contact card. */}
                {!!driver.phone && !finished && (
                  <IconButton
                    name="whatsapp"
                    label={t('cust.driver.call')}
                    onPress={() => askHuman(safeText(driver.full_name))}
                  />
                )}
              </View>

              {!!truck.data && (
                <View style={styles.driverFacts}>
                  <FactChips
                    facts={[
                      {
                        icon: 'truck',
                        label: t('label.truck'),
                        value: truckName.get(truck.data.truck_type) ?? truck.data.truck_type,
                      },
                      ...(truck.data.plate
                        ? [
                            {
                              icon: 'reference' as const,
                              label: t('label.plate'),
                              value: safeText(truck.data.plate),
                            },
                          ]
                        : []),
                    ]}
                  />
                </View>
              )}
            </View>
          </Section>
        )}

        {/* The trail. Read-only here: the insert grant belongs to the driver, so
            a shipper can follow it but never author it. These are also the
            timestamps an invoice is reconciled against. */}
        {(events.data ?? []).length > 0 && (
          <Section title={t('cust.progress.title')}>
            <View style={styles.block}>
              <RowGroup>
                {(events.data ?? []).map((e, i) => (
                  <ListRow
                    key={e.id}
                    icon={e.type === 'delivered' ? 'checkCircle' : 'clock'}
                    tone={e.type === 'delivered' ? 'orange' : 'neutral'}
                    title={t(`event.${e.type}` as StringKey)}
                    subtitle={formatDeadline(e.occurred_at)}
                    last={i === (events.data ?? []).length - 1}
                  />
                ))}
              </RowGroup>
            </View>
          </Section>
        )}

        {!!proof && <ProofPhoto path={proof} />}
      </ScrollView>

      {/* One pinned action, whichever one this load's state actually needs. */}
      <ActionBar>
        <Button
          label={finished ? t('note.query') : t('whatsapp.action')}
          variant={finding ? 'primary' : 'secondary'}
          icon="whatsapp"
          onPress={() => askHuman()}
        />
      </ActionBar>
    </Screen>
  );
}

/**
 * The price, or what is happening instead of one.
 *
 * The three no-price outcomes each get a full sentence rather than a dash or an
 * empty field. A blank price to someone with near-zero tech skills reads as "the
 * app is broken"; the truth is that a person is working on it, so it says that.
 *
 * "Get a price" is a secondary button even though it is often the most useful
 * thing on the screen, because the pinned human backstop below already owns the
 * primary weight and two competing primaries is the loud-aggregator look
 * DESIGN.md lists as an anti-reference.
 */
function PriceBlock({ load }: { load: Load }) {
  const quote = useCurrentQuote(load.id);
  const ask = useQuoteLoad();

  // Quoting is only permitted while the load is still open (0010 enforces it),
  // so the ask never appears where the server would refuse it.
  const askable = load.status === 'posted' || load.status === 'finding_truck';

  const priced = quote.data?.outcome === 'quoted' ? quote.data : null;
  // An expired quote leaves the price on the load. Showing it without a
  // "held until" is honest: it is still the price, it is just no longer promised.
  const amount = priced?.price_baisa ?? load.price_baisa;
  const currency = (priced?.currency ?? load.currency) as Currency;

  if (quote.isPending) return null;

  return (
    <Section title={t('price.title')}>
      <View style={styles.block}>
        <View style={styles.priceBlock}>
          {amount != null ? (
            <>
              {/* formatMoney, never toFixed(2) — OMR carries three decimals and
                  a two-decimal render is a 10x error that looks plausible. */}
              <Text style={styles.price}>{formatMoney(amount, currency, getLanguage())}</Text>
              {!!priced && (
                <Text style={styles.priceMeta}>
                  {`${t('price.heldUntil')} ${formatDeadline(priced.expires_at)}`}
                </Text>
              )}
              <Body muted>{t('price.settle')}</Body>
            </>
          ) : quote.data ? (
            // A quote exists and carries no price: say which of the three cases
            // it is, in the shipper's language.
            <Body muted>{t(`price.${quote.data.outcome}` as StringKey)}</Body>
          ) : (
            <>
              <Body muted>{t('price.none.explain')}</Body>
              {askable && (
                <Button
                  label={ask.isError ? t('price.retry') : t('price.action')}
                  variant="secondary"
                  loading={ask.isPending}
                  onPress={() => ask.mutate(load.id)}
                />
              )}
            </>
          )}
        </View>
      </View>
    </Section>
  );
}

/**
 * Proof of delivery, behind a short-lived signed URL.
 *
 * Its own component so the signing query only mounts once a photo path exists,
 * and so a failed signature degrades to nothing rather than a broken frame.
 */
function ProofPhoto({ path }: { path: string }) {
  const url = usePodUrl(path);
  if (!url.data) return null;

  return (
    <Section title={t('cust.pod.title')}>
      <View style={styles.block}>
        <Image
          source={{ uri: url.data }}
          style={styles.proof}
          accessibilityRole="image"
          accessibilityLabel={t('note.pod.alt')}
        />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xl, gap: space.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  block: { paddingHorizontal: GUTTER },

  panel: {
    backgroundColor: color.paperDeep,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
  },
  notice: {
    backgroundColor: color.orangeSoft,
    borderRadius: radius.card,
    padding: space.lg,
  },

  priceBlock: { gap: space.sm },
  price: { ...font.display, color: color.ink, textAlign: align.start },
  priceMeta: { ...font.smallPrint, color: color.inkSoft, textAlign: align.start },

  driver: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.paper,
    borderRadius: radius.card,
    padding: space.lg,
    ...elevation.card,
  },
  driverText: { flex: 1, gap: space.xs, alignItems: 'flex-start' },
  driverName: { ...font.section, color: color.ink, textAlign: align.start },
  driverFacts: { paddingTop: space.md },

  proof: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.card,
    backgroundColor: color.paperDeep,
  },
});
