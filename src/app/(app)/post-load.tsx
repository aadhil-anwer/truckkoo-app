/**
 * Post a load.
 *
 * This is the website's own quote form, unchanged in shape: pickup, delivery,
 * goods, truck type. It was already validated on a live bilingual site and it is
 * four fields — designing a longer one would be a regression, not an upgrade.
 *
 * The truck type defaults to "Not sure — advise me" and stays that way unless the
 * shipper actively chooses. That default is the single most important affordance
 * in the product for a low-tech audience (PRODUCT.md), and it maps to
 * `loads.truck_type_code IS NULL`.
 */

import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlankNote, FactRow, NoteBody, RoutePair } from '@/components/consignment';
import { Masthead } from '@/components/masthead';
import { nextDays, PickerField, type PickerOption } from '@/components/picker';
import { Body, Button, Field, Input, Note, NoteHead, Rule, TextButton } from '@/components/primitives';
import { align, getLanguage, localized, t, type StringKey } from '@/i18n';
import { formatLongDay, formatWeight } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import { safeText } from '@/lib/safe-text';
import { usePostLoad, useCities, useQuoteRoute, useTruckTypes } from '@/lib/queries';
import { color, doc, font, space } from '@/theme/tokens';

/** "Not sure — advise me" is the absence of a truck type, so it needs a sentinel. */
const UNSURE = '__unsure__';

export default function PostLoad() {
  const router = useRouter();
  const cities = useCities();
  const truckTypes = useTruckTypes();
  const postLoad = usePostLoad();
  const quoteRoute = useQuoteRoute();

  const [origin, setOrigin] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [goods, setGoods] = useState('');
  const [truck, setTruck] = useState<string>(UNSURE);
  const [pickup, setPickup] = useState<string | null>(null);
  const [weight, setWeight] = useState('');

  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [done, setDone] = useState(false);
  /** `form` → `review` → posted. One decision per screen (PRODUCT.md). */
  const [stage, setStage] = useState<'form' | 'review'>('form');

  const cityOptions: PickerOption[] = useMemo(
    () =>
      (cities.data ?? []).map((c) => ({
        value: String(c.id),
        label: localized(c),
        // The other script as the detail line, so searching either finds the row.
        detail: localized(c) === c.name_en ? c.name_ar : c.name_en,
        group: c.corridor ?? undefined,
      })),
    [cities.data],
  );

  const truckOptions: PickerOption[] = useMemo(
    () => [
      { value: UNSURE, label: t('load.truckType.unsure') },
      ...(truckTypes.data ?? []).map((tt) => ({
        value: tt.code,
        label: localized({ name_en: tt.name_en, name_ar: tt.name_ar }),
        detail: tt.description_en ?? undefined,
      })),
    ],
    [truckTypes.data],
  );

  const dateOptions: PickerOption[] = useMemo(() => nextDays(21), []);

  const parsedWeight = weight.trim() ? Number(weight.replace(/[^\d]/g, '')) : null;

  /**
   * Step 1 of 2 — validate, then price what they described.
   *
   * The price used to arrive *after* the shipper had committed: post, wait, then
   * tap "Get a price". For someone with near-zero tech skills, committing to an
   * unpriced thing is the moment they close the app and phone a person instead —
   * which is the exact loop this product exists to remove. So the form now ends
   * on a review, and `quote_route` prices parameters without creating anything.
   */
  async function review() {
    const next: Record<string, string | null> = {};
    if (!origin) next.origin = t('error.required');
    if (!dest) next.dest = t('error.required');
    if (!pickup) next.pickup = t('error.required');
    if (goods.trim().length === 0) next.goods = t('error.required');
    if (origin && dest && origin === dest) next.dest = t('post.load.sameCity');

    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    setStage('review');
    try {
      await quoteRoute.mutateAsync({
        originCity: Number(origin),
        destCity: Number(dest),
        truckTypeCode: truck === UNSURE ? null : truck,
        weightKg: parsedWeight && parsedWeight > 0 ? parsedWeight : null,
      });
    } catch {
      // A failed estimate must not block booking — the price is advisory here and
      // the binding quote is issued server-side at post time regardless.
      // Falling through leaves the review step showing the human-backstop copy.
    }
  }

  /** Step 2 of 2 — actually post it. */
  async function submit() {
    try {
      await postLoad.mutateAsync({
        originCity: Number(origin),
        destCity: Number(dest),
        pickupFrom: pickup!,
        pickupTo: pickup!,
        goods: goods.trim(),
        weightKg: parsedWeight && parsedWeight > 0 ? parsedWeight : null,
        // The sentinel becomes a real null — never a default truck type.
        truckTypeCode: truck === UNSURE ? null : truck,
      });
      setDone(true);
    } catch {
      setErrors({ form: t('error.generic') });
    }
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Masthead title={t('post.load.done.title')} />
        <View style={styles.block}>
          <BlankNote title={t('status.finding_truck')} explain={t('post.load.done.explain')}>
            <View style={styles.blankAction}>
              <Button label={t('cust.masthead')} onPress={() => router.replace('/customer')} />
            </View>
          </BlankNote>
        </View>
      </SafeAreaView>
    );
  }

  /* ── step 2: the price, before the commitment ──────────────────────────── */

  if (stage === 'review') {
    const quote = quoteRoute.data;
    const cityLabel = (v: string | null) =>
      cityOptions.find((c) => c.value === v)?.label ?? '—';

    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Masthead
          title={t('review.title')}
          action={<TextButton label={t('common.back')} onPress={() => setStage('form')} />}
        />

        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.block}>
            <Note>
              <NoteHead left={t('label.load')} />
              <NoteBody>
                <RoutePair
                  from={cityLabel(origin)}
                  to={cityLabel(dest)}
                  labelFrom={t('load.from')}
                  labelTo={t('load.to')}
                />
                <Body>{safeText(goods.trim())}</Body>
                <FactRow
                  facts={[
                    { label: t('label.pickup'), value: pickup ? formatLongDay(pickup) : '—' },
                    {
                      label: t('label.truck'),
                      value:
                        truck === UNSURE
                          ? t('truck.unset')
                          : (truckOptions.find((o) => o.value === truck)?.label ?? truck),
                    },
                    {
                      label: t('label.weight'),
                      value: formatWeight(parsedWeight, t('weight.unset')),
                    },
                  ]}
                />
              </NoteBody>

              <Rule />

              {/* The price, before anything is created. An estimate that cannot
                  be produced is not an error — it names the human who will do it,
                  in the same words the shipper will see afterwards on the load. */}
              <NoteBody gap={space.sm}>
                <Text style={styles.priceLabel}>{t('review.priceLabel').toUpperCase()}</Text>

                {quoteRoute.isPending ? (
                  <Body muted>{t('review.checking')}</Body>
                ) : quote?.outcome === 'quoted' && quote.price_baisa != null ? (
                  <>
                    <Text style={styles.price}>
                      {formatMoney(quote.price_baisa, quote.currency as Currency, getLanguage())}
                    </Text>
                    <Body muted>{t('price.settle')}</Body>
                  </>
                ) : (
                  <Body muted>
                    {quote ? t(`price.${quote.outcome}` as StringKey) : t('price.no_rate')}
                  </Body>
                )}
              </NoteBody>
            </Note>

            {!!errors.form && (
              <Text style={styles.formError} accessibilityLiveRegion="polite">
                {errors.form}
              </Text>
            )}

            <Button
              label={t('review.confirm')}
              onPress={submit}
              loading={postLoad.isPending}
            />
            <Button
              label={t('review.change')}
              variant="secondary"
              onPress={() => setStage('form')}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  /* ── step 1: the form ──────────────────────────────────────────────────── */

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Masthead
          title={t('post.load.title')}
          action={<TextButton label={t('common.back')} onPress={() => router.back()} />}
        />

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            <PickerField
              label={t('load.from')}
              placeholder={t('load.city.placeholder')}
              value={origin}
              options={cityOptions}
              onChange={setOrigin}
              searchable
              error={errors.origin}
            />

            <PickerField
              label={t('load.to')}
              placeholder={t('load.city.placeholder')}
              value={dest}
              options={cityOptions}
              onChange={setDest}
              searchable
              error={errors.dest}
            />

            <Field label={t('load.goods')}>
              <Input
                value={goods}
                onChangeText={setGoods}
                placeholder={t('load.goods.placeholder')}
                error={errors.goods}
                multiline
                maxLength={500}
              />
            </Field>

            <PickerField
              label={t('post.load.date')}
              placeholder={t('label.pickup')}
              value={pickup}
              options={dateOptions}
              onChange={setPickup}
              error={errors.pickup}
            />

            <View style={styles.sectionRule}>
              <Rule />
            </View>

            <PickerField
              label={t('load.truckType')}
              placeholder={t('load.truckType.unsure')}
              value={truck}
              options={truckOptions}
              onChange={setTruck}
            />

            <Field label={t('post.load.weight')}>
              <Input
                value={weight}
                onChangeText={setWeight}
                placeholder={t('post.load.weight.placeholder')}
                keyboardType="number-pad"
              />
            </Field>
            <Text style={styles.help}>{t('post.load.weight.unit')}</Text>

            {!!errors.form && (
              <Text style={styles.formError} accessibilityLiveRegion="polite">
                {errors.form}
              </Text>
            )}

            <Body muted>{t('whatsapp.promise')}</Body>

            <Button
              label={t('post.load.submit')}
              onPress={review}
              loading={quoteRoute.isPending}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper },
  flex: { flex: 1 },
  scroll: { paddingBottom: space.huge },
  form: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.lg },
  sectionRule: { paddingVertical: space.xs },
  help: { ...font.smallPrint, color: color.inkSoft, textAlign: align.start, marginTop: -space.sm },
  formError: { ...font.bodySmall, color: color.danger, textAlign: align.start },
  priceLabel: { ...doc.fieldLabel, color: color.inkSoft, textAlign: align.start },
  price: { ...font.title, color: color.ink, textAlign: align.start },
  block: { paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.md },
  blankAction: { alignSelf: 'stretch', paddingTop: space.sm },
});
