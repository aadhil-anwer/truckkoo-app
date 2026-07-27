/**
 * Place one load: see it, see the trucks already going that way, offer it.
 *
 * The candidate list is the whole point of the product made visible — these are
 * not "available drivers", they are drivers who *already declared* this exact city
 * pair inside this pickup window. Empty trucks sort first, because a load on an
 * empty leg is the trip that pays twice.
 *
 * The no-match action is not an error path. PRODUCT.md: a shipper never hits a
 * dead end, so "no truck fits" moves the load to `finding_truck` and a human
 * arranges a fresh trip. Before the ops migration that status was unreachable, so
 * this button is the promise finally being keepable.
 */

import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlankNote, FactRow, LedgerRow, NoteBody, NoteFoot, RoutePair } from '@/components/consignment';
import { Masthead } from '@/components/masthead';
import { Body, Button, Field, Input, Note, NoteHead, Stamp, TextButton } from '@/components/primitives';
import { align, directionArrow, getLanguage, localized, t, type StringKey } from '@/i18n';
import { formatWeight, formatWindow, reference } from '@/lib/format';
import { formatMoney, parseMoney } from '@/lib/money';
import { safeText } from '@/lib/safe-text';
import {
  cityIndex,
  useCities,
  useMarkFindingTruck,
  useOpsCandidates,
  useOpsQueue,
  useOpsSetPrice,
  useSendOffer,
  useTruckTypes,
} from '@/lib/queries';
import { color, font, space } from '@/theme/tokens';

export default function OpsLoad() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const cities = useCities();
  const truckTypes = useTruckTypes();
  const queue = useOpsQueue();
  const candidates = useOpsCandidates(id);
  const sendOffer = useSendOffer();
  const noMatch = useMarkFindingTruck();

  const setPrice = useOpsSetPrice();

  const [error, setError] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);
  const [priceText, setPriceText] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [pricedNow, setPricedNow] = useState<number | null>(null);

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

  const load = (queue.data ?? []).find((r) => r.load_id === id);

  if (queue.isPending || candidates.isPending) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={color.orange} />
        </View>
      </SafeAreaView>
    );
  }

  // Not in the queue and not ours to see are the same thing to this screen: the
  // RPC returns no row either way (SECURITY.md §3).
  if (!load) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Masthead title={t('common.error.title')} />
        <View style={styles.form}>
          <Body muted>{t('common.error.explain')}</Body>
          <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const rows = candidates.data ?? [];

  // What the queue says, or what we just sent — the queue refetch may not have
  // landed yet, and a dispatcher who cannot see their own price would send it
  // twice.
  const priced = pricedNow ?? load.price_baisa;

  async function offer(driverId: string, legId: string | null) {
    setError(null);
    try {
      await sendOffer.mutateAsync({ loadId: load!.load_id, driverId, legId });
    } catch {
      setError(t('error.generic'));
    }
  }

  // Sections in tier order, empty ones dropped entirely rather than rendered as
  // an empty heading — "Empty trucks going that way (0)" reads as a failure, and
  // on most loads two of the three will be empty.
  const tiers = ([1, 2, 3] as const)
    .map((tier) => ({
      tier,
      title: t(`ops.tier${tier}.title` as StringKey),
      explain: t(`ops.tier${tier}.explain` as StringKey),
      rows: rows.filter((c) => c.tier === tier),
    }))
    .filter((s) => s.rows.length > 0);

  function metaFor(c: (typeof rows)[number]): string {
    // Tier 3 declared nothing, so there is no window and no route to show. Saying
    // when they last ran the corridor is the only evidence the dispatcher has.
    if (c.leg_id === null) {
      return [
        c.last_run_at ? `${t('ops.tier3.lastRun')} ${c.last_run_at}` : null,
        c.truck_type ? (truckName.get(c.truck_type) ?? c.truck_type) : null,
      ]
        .filter(Boolean)
        .join(' · ');
    }

    return [
      `${cityName(c.leg_origin!)} ${directionArrow()} ${cityName(c.leg_dest!)}`,
      formatWindow(c.depart_from!, c.depart_to!),
      // The grace window is live (0012 passes 2 for a dispatcher), so a row can
      // be a near-miss. Say by how much rather than presenting it as an exact fit.
      c.day_gap && c.day_gap > 0 ? `${c.day_gap} ${t('ops.dayGap')}` : null,
      c.is_empty ? t('ops.empty.truck') : t('ops.part.truck'),
      c.truck_type ? (truckName.get(c.truck_type) ?? c.truck_type) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function trailingFor(c: (typeof rows)[number]) {
    // A live offer is the only state with nothing left to do.
    if (c.offer_status === 'pending') return <Stamp tone="pending">{t('ops.sent')}</Stamp>;
    if (c.offer_status === 'accepted') return <Stamp tone="done">{t('ops.accepted')}</Stamp>;

    // Declined and expired both keep a button. A dispatcher must be able to ask
    // again deliberately — `ops_send_offer` passes allow_resend, which is exactly
    // the override an automated path is denied.
    const label =
      c.offer_status === 'declined' || c.offer_status === 'expired'
        ? t('ops.resend')
        : c.leg_id === null
          ? t('ops.send.corridor')
          : t('ops.send');

    return (
      <View style={styles.rowAction}>
        {c.offer_status === 'declined' && <Stamp tone="stopped">{t('ops.declined')}</Stamp>}
        <Button
          label={label}
          variant="secondary"
          full={false}
          loading={
            sendOffer.isPending &&
            sendOffer.variables?.driverId === c.driver_id &&
            // A driver can appear once per leg, so keying the spinner on the
            // driver alone would spin every one of their rows.
            (sendOffer.variables?.legId ?? null) === c.leg_id
          }
          onPress={() => offer(c.driver_id, c.leg_id)}
        />
      </View>
    );
  }

  /**
   * Turn typed rial into integer baisa and send it.
   *
   * `parseMoney` is the only sanctioned parser: it validates BEFORE stripping
   * separators, which is why "12,,5" is rejected here instead of silently
   * becoming 125 rial. That exact bug was found by the test suite once already
   * (OPEN_ISSUES 8), and this screen is where it would have reached a customer.
   */
  async function submitPrice() {
    setError(null);
    setPriceError(null);

    const baisa = parseMoney(priceText);
    if (baisa == null || baisa <= 0) {
      setPriceError(t('ops.price.invalid'));
      return;
    }

    try {
      await setPrice.mutateAsync({ loadId: load!.load_id, priceBaisa: baisa });
      setPricedNow(baisa);
      setPriceText('');
    } catch {
      // The server bounds the amount too (0010). A rejection here is either that
      // or a lost connection, and the dispatcher needs neither distinction.
      setError(t('error.generic'));
    }
  }

  async function markNoMatch() {
    setError(null);
    try {
      await noMatch.mutateAsync(load!.load_id);
      setMarked(true);
    } catch {
      setError(t('error.generic'));
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Masthead
        title={t('ops.load.title')}
        action={<TextButton label={t('common.back')} onPress={() => router.back()} />}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* The load, as the shipper wrote it. */}
        <View style={styles.block}>
          <Note>
            <NoteHead
              left={t('label.load')}
              right={
                <Stamp tone={load.status === 'posted' ? 'pending' : 'active'}>
                  {t(`status.${load.status}` as StringKey)}
                </Stamp>
              }
            />
            <NoteBody>
              <RoutePair
                from={cityName(load.origin_city)}
                to={cityName(load.dest_city)}
                labelFrom={t('label.from')}
                labelTo={t('label.to')}
              />
              <Body>{safeText(load.goods)}</Body>
              <FactRow
                facts={[
                  {
                    label: t('label.pickup'),
                    value: formatWindow(load.pickup_from, load.pickup_to),
                  },
                  {
                    label: t('label.truck'),
                    // NULL is "Not sure — advise me": the dispatcher decides.
                    value: load.truck_type_code
                      ? (truckName.get(load.truck_type_code) ?? load.truck_type_code)
                      : t('truck.unset'),
                  },
                  {
                    label: t('label.weight'),
                    value: formatWeight(load.weight_kg, t('weight.unset')),
                  },
                ]}
              />
            </NoteBody>
            <NoteFoot reference={reference(load.load_id)} />
          </Note>
        </View>

        {/* What the machine already did. Without this the dispatcher re-sends
            offers that went out automatically the moment the load was posted. */}
        {load.auto_offer_count > 0 && (
          <View style={styles.block}>
            <Note>
              <NoteHead
                left={t('ops.auto.sent')}
                right={<Stamp tone="done">{`${load.auto_offer_count}`}</Stamp>}
              />
            </Note>
          </View>
        )}

        {/* Candidates, best tier first. Tier 1 declared this route empty, tier 2
            declared it part-loaded, tier 3 has only run the corridor before —
            three different propositions, so three sections rather than one list
            a dispatcher has to read the small print of. */}
        <View style={styles.block}>
          {rows.length === 0 ? (
            <BlankNote
              title={t('ops.candidates.none.title')}
              explain={t('ops.candidates.none.explain')}
            />
          ) : (
            tiers.map(({ tier, title, explain, rows: tierRows }) => (
              <View key={tier} style={styles.tier}>
                <Note>
                  <NoteHead
                    left={title}
                    right={<Stamp tone="pending">{`${tierRows.length}`}</Stamp>}
                  />
                  <NoteBody>
                    <Body muted>{explain}</Body>
                  </NoteBody>
                  {tierRows.map((c, i) => (
                    <LedgerRow
                      // Tier 3 has no leg, so leg_id cannot key the row on its own.
                      key={`${c.driver_id}-${c.leg_id ?? 'corridor'}`}
                      route={safeText(c.driver_name)}
                      meta={metaFor(c)}
                      trailing={trailingFor(c)}
                      last={i === tierRows.length - 1}
                    />
                  ))}
                </Note>
              </View>
            ))
          )}
        </View>

        {/* Hand-pricing. While the rate card is empty this is the ONLY thing that
            prices a load, which is the order STACK.md §0 argues for: be the
            algorithm yourself, then let the hand-priced trips teach the card. */}
        <View style={styles.block}>
          <Note>
            <NoteHead
              left={t('ops.price.title')}
              right={
                priced ? (
                  <Stamp tone="done">{`${t('ops.price.current')} ${formatMoney(priced, 'OMR', getLanguage())}`}</Stamp>
                ) : undefined
              }
            />
            <NoteBody gap={space.sm}>
              <Field label={t('ops.price.label')}>
                <Input
                  value={priceText}
                  onChangeText={(v) => {
                    setPriceText(v);
                    setPriceError(null);
                  }}
                  placeholder={t('ops.price.placeholder')}
                  // `decimal-pad` rather than `numeric`: OMR needs a decimal
                  // separator and `numeric` hides it on some Android keyboards.
                  keyboardType="decimal-pad"
                  error={priceError}
                  accessibilityLabel={t('ops.price.label')}
                />
              </Field>
              <Body muted>{t('ops.price.hint')}</Body>
              <Button
                label={t('ops.price.action')}
                variant="secondary"
                loading={setPrice.isPending}
                onPress={submitPrice}
              />
              {pricedNow && <Body muted>{t('ops.price.done')}</Body>}
            </NoteBody>
          </Note>
        </View>

        {/* The promise. 0013 widened this beyond 'posted': the state a stuck load
            actually reaches is 'matched' — every driver declined, or the machine
            offered and nobody answered — and that was previously unrecoverable. */}
        {['posted', 'finding_truck', 'matched'].includes(load.status) && !marked && (
          <View style={styles.form}>
            <Button
              label={t('ops.noMatch')}
              variant="quiet"
              loading={noMatch.isPending}
              onPress={markNoMatch}
            />
          </View>
        )}

        {marked && (
          <View style={styles.form}>
            <Body muted>{t('ops.noMatch.done')}</Body>
          </View>
        )}

        {!!error && (
          <View style={styles.form}>
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper },
  scroll: { paddingBottom: space.huge },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  block: { paddingHorizontal: space.xl, paddingTop: space.xl },
  form: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.md },
  rowAction: { maxWidth: 150, gap: space.xs, alignItems: 'flex-end' },
  tier: { paddingBottom: space.lg },
  error: { ...font.bodySmall, color: color.danger, textAlign: align.start },
});
