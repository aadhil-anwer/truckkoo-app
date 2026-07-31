/**
 * S9 · Check this before we start.
 *
 * The last screen before a load exists. Two things here are load-bearing:
 *
 * THE ESTIMATE IS A RANGE, AND OFTEN THERE IS NONE. The rate card ships empty,
 * so `estimate_route` returns an outcome rather than numbers on most calls today.
 * That is the EXPECTED path, not an error state — the card then says a person
 * will price it, which is a real commitment the website already makes. A shipper
 * never hits a dead end (CLAUDE.md #6).
 *
 * NOTHING IS CHARGED HERE. Showing a price is fine; taking one is not, ever
 * (#3). The reassurance strip says so out loud.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';

import { PrimaryButton, TertiaryButton } from '@/components/primitives';
import { Card, Notice, RouteRail, SectionLabel } from '@/components/ui';
import { roadKm } from '@/map';
import { supabase } from '@/lib/supabase';
import { clearDraft, truckTypeForPost, useBookingDraft } from '@/lib/booking';
import { cityIndex, useCities } from '@/lib/queries';
import { formatMoney } from '@/lib/money';
import { formatLongDay } from '@/lib/format';
import { align, formatNumber, t } from '@/i18n';
import { arabicIfNeeded } from '@/components/text-direction';
import { alpha, color, font, hairline, space } from '@/theme/tokens';

type Estimate = {
  low_baisa: number | null;
  high_baisa: number | null;
  currency: string;
  outcome: string;
};

export default function Review() {
  const router = useRouter();
  const { draft, ready } = useBookingDraft();
  const { data: cities } = useCities();
  const [error, setError] = useState<string | null>(null);

  const index = cityIndex(cities);
  const origin = draft.originCityId != null ? index.get(draft.originCityId) : undefined;
  const dest = draft.destinationCityId != null ? index.get(draft.destinationCityId) : undefined;

  const estimate = useQuery({
    queryKey: ['estimate', draft.originCityId, draft.destinationCityId, draft.truckPreference, draft.weightKg],
    enabled: ready && draft.originCityId != null && draft.destinationCityId != null,
    queryFn: async (): Promise<Estimate | null> => {
      const { data, error: rpcError } = await supabase.rpc('estimate_route', {
        p_origin_city: draft.originCityId,
        p_dest_city: draft.destinationCityId,
        p_truck_type_code: truckTypeForPost(draft),
        p_weight_kg: draft.weightKg,
      });
      // A failed estimate must not block posting — it is decoration on a
      // decision, not the decision.
      if (rpcError) return null;
      return (data as Estimate[])?.[0] ?? null;
    },
  });

  const post = useMutation({
    mutationFn: async () => {
      const { data, error: rpcError } = await supabase.rpc('post_load', {
        p_origin_city: draft.originCityId,
        p_dest_city: draft.destinationCityId,
        p_pickup_from: draft.collectionDate,
        p_pickup_to: draft.collectionDate,
        p_goods: draft.cargoDescription.trim(),
        p_weight_kg: draft.weightKg,
        // NULL means "advise me". Never a guessed code.
        p_truck_type_code: truckTypeForPost(draft),
      });
      if (rpcError) throw rpcError;
      return data as string;
    },
    onSuccess: async (loadId) => {
      await clearDraft();
      router.replace(`/load/${loadId}`);
    },
    onError: () => setError(t('book.failed')),
  });

  if (!ready || !origin || !dest) return null;

  const est = estimate.data;
  const priced = est?.outcome === 'estimated' && est.low_baisa != null && est.high_baisa != null;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{t('book.review.title')}</Text>

        <Card>
          <RouteRail origin={origin.name_en} destination={dest.name_en} />
          <View style={styles.facts}>
            <Fact label={t('book.review.collect')} value={formatLongDay(draft.collectionDate!)} />
            <Fact label={t('book.review.cargo')} value={draft.cargoDescription} />
            <Fact
              label={t('book.review.truck')}
              value={
                draft.truckPreference === 'auto'
                  ? t('book.review.weWillChoose')
                  : draft.truckPreference
              }
            />
            <Fact
              label={t('book.review.weight')}
              value={
                draft.weightKg == null
                  ? t('book.review.notSaid')
                  : `${formatNumber(draft.weightKg)} ${t('book.weight.unit')}`
              }
              last
            />
          </View>
        </Card>

        <Card tone="raised" style={styles.estimate}>
          <SectionLabel>{t('book.review.estimateLabel')}</SectionLabel>
          {priced ? (
            <>
              <View style={styles.range}>
                <Text style={styles.rangeValue}>
                  {`${formatMoney(est!.low_baisa!, est!.currency as never)} – ${formatMoney(
                    est!.high_baisa!,
                    est!.currency as never,
                  )}`}
                </Text>
              </View>
              <Text style={styles.estimateWhy}>{t('book.review.estimateWhy')}</Text>
            </>
          ) : (
            // The default path today. Not an error, and not empty.
            <Text style={styles.estimateWhy}>{t('book.review.noEstimate')}</Text>
          )}

          <View style={styles.reassure}>
            <Notice icon="info">{t('book.review.nothingCharged')}</Notice>
          </View>
        </Card>

        <Text style={styles.distance}>
          {`${t('book.about')} ${formatNumber(roadKm(origin, dest))} km`}
        </Text>

        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={styles.footer}>
        <TertiaryButton label={t('book.review.change')} onPress={() => router.back()} />
        <PrimaryButton
          label={t('book.review.cta')}
          onPress={() => {
            setError(null);
            post.mutate();
          }}
          loading={post.isPending}
        />
      </View>
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
  scroll: { padding: space.xl, paddingTop: space.huge, gap: space.lg },
  title: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start },
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
  factValue: { ...arabicIfNeeded(font.value), color: color.lightText, flexShrink: 1, textAlign: 'right' },
  estimate: { gap: space.sm },
  range: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
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
