/**
 * Post a load, as three one-question steps.
 *
 *   1. route    — pickup and delivery
 *   2. details  — when, what, which truck, how heavy
 *   3. review   — the price, before anything is created
 *
 * WHY IT IS STEPPED NOW
 *
 * It used to be a single scroll of six fields with the submit button at the
 * bottom. Every field was necessary and the form was still the wrong shape: for
 * someone with near-zero tech skills, a screen with six unanswered things on it
 * is a screen you close. PRODUCT.md's rule is one decision per screen, and this
 * is finally that — each step asks one thing, the action is pinned where the
 * thumb already is, and the step counter says how much is left so the flow never
 * feels open-ended.
 *
 * The price still arrives *before* the commitment. `quote_route` prices
 * parameters without creating anything, so the shipper sees the number on step 3
 * and can go back. Committing to an unpriced thing is the moment this audience
 * closes the app and phones a person instead — which is the exact loop this
 * product exists to remove.
 *
 * The truck type defaults to "Not sure — advise me" and stays that way unless
 * the shipper actively chooses. That default is the single most important
 * affordance in the product, and it maps to `loads.truck_type_code IS NULL`.
 */

import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Body, Button, Field, Input } from '@/components/primitives';
import { nextDays, PickerField, type PickerOption } from '@/components/picker';
import {
  ActionBar,
  EmptyState,
  FactChips,
  PageTitle,
  RouteLine,
  Screen,
  TopBar,
} from '@/components/ui';
import { align, getLanguage, localized, t, type StringKey } from '@/i18n';
import { formatLongDay, formatWeight } from '@/lib/format';
import { formatMoney, type Currency } from '@/lib/money';
import { safeText } from '@/lib/safe-text';
import { usePostLoad, useCities, useQuoteRoute, useTruckTypes } from '@/lib/queries';
import { color, font, GUTTER, space } from '@/theme/tokens';

/** "Not sure — advise me" is the absence of a truck type, so it needs a sentinel. */
const UNSURE = '__unsure__';

type Step = 'route' | 'details' | 'review';
const STEPS: Step[] = ['route', 'details', 'review'];

export default function PostLoad() {
  const router = useRouter();
  // Home's "send it again" rows pre-fill the route. Everything else is still
  // answered here, and the price is still shown before anything is created.
  const params = useLocalSearchParams<{ origin?: string; dest?: string }>();

  const cities = useCities();
  const truckTypes = useTruckTypes();
  const postLoad = usePostLoad();
  const quoteRoute = useQuoteRoute();

  const [step, setStep] = useState<Step>('route');
  const [origin, setOrigin] = useState<string | null>(params.origin ?? null);
  const [dest, setDest] = useState<string | null>(params.dest ?? null);
  const [goods, setGoods] = useState('');
  const [truck, setTruck] = useState<string>(UNSURE);
  const [pickup, setPickup] = useState<string | null>(null);
  const [weight, setWeight] = useState('');

  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [done, setDone] = useState(false);

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
  const cityLabel = (v: string | null) => cityOptions.find((c) => c.value === v)?.label ?? '—';

  /* ── moving between steps ────────────────────────────────────────────── */

  function nextFromRoute() {
    const next: Record<string, string | null> = {};
    if (!origin) next.origin = t('error.required');
    if (!dest) next.dest = t('error.required');
    if (origin && dest && origin === dest) next.dest = t('post.load.sameCity');

    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setStep('details');
  }

  async function nextFromDetails() {
    const next: Record<string, string | null> = {};
    if (!pickup) next.pickup = t('error.required');
    if (goods.trim().length === 0) next.goods = t('error.required');

    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    setStep('review');
    try {
      await quoteRoute.mutateAsync({
        originCity: Number(origin),
        destCity: Number(dest),
        truckTypeCode: truck === UNSURE ? null : truck,
        weightKg: parsedWeight && parsedWeight > 0 ? parsedWeight : null,
      });
    } catch {
      // A failed estimate must not block booking — the price is advisory here
      // and the binding quote is issued server-side at post time regardless.
      // Falling through leaves the review step showing the human-backstop copy.
    }
  }

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

  function back() {
    if (step === 'review') return setStep('details');
    if (step === 'details') return setStep('route');
    router.back();
  }

  /* ── posted ──────────────────────────────────────────────────────────── */

  if (done) {
    return (
      <Screen tone="surface" edges={['top', 'bottom']}>
        <TopBar />
        <View style={styles.doneWrap}>
          <EmptyState
            icon="checkCircle"
            title={t('post.load.done.title')}
            explain={t('post.load.done.explain')}
          />
        </View>
        <ActionBar>
          <Button label={t('cust.masthead')} onPress={() => router.replace('/customer')} />
        </ActionBar>
      </Screen>
    );
  }

  const stepNumber = STEPS.indexOf(step) + 1;

  return (
    <Screen tone="surface" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TopBar
          onBack={back}
          action={
            <Text style={styles.stepMark}>{`${stepNumber} ${t('step.of')} ${STEPS.length}`}</Text>
          }
        />

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 'route' && (
            <>
              <PageTitle detail={t('step.route.hint')}>{t('step.route')}</PageTitle>
              <View style={styles.form}>
                <PickerField
                  label={t('load.from')}
                  placeholder={t('load.city.placeholder')}
                  value={origin}
                  options={cityOptions}
                  onChange={setOrigin}
                  searchable
                  error={errors.origin}
                  icon="pickup"
                />
                <PickerField
                  label={t('load.to')}
                  placeholder={t('load.city.placeholder')}
                  value={dest}
                  options={cityOptions}
                  onChange={setDest}
                  searchable
                  error={errors.dest}
                  icon="dropoff"
                />
              </View>
            </>
          )}

          {step === 'details' && (
            <>
              <PageTitle detail={t('step.details.hint')}>{t('step.details')}</PageTitle>
              <View style={styles.form}>
                <PickerField
                  label={t('post.load.date')}
                  placeholder={t('label.pickup')}
                  value={pickup}
                  options={dateOptions}
                  onChange={setPickup}
                  error={errors.pickup}
                  icon="calendar"
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
                  label={t('load.truckType')}
                  placeholder={t('load.truckType.unsure')}
                  value={truck}
                  options={truckOptions}
                  onChange={setTruck}
                  icon="truck"
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
              </View>
            </>
          )}

          {step === 'review' && (
            <>
              <PageTitle>{t('review.title')}</PageTitle>
              <View style={styles.form}>
                <View style={styles.summary}>
                  <RouteLine
                    from={cityLabel(origin)}
                    to={cityLabel(dest)}
                    labelFrom={t('load.from')}
                    labelTo={t('load.to')}
                  />
                  <Body>{safeText(goods.trim())}</Body>
                  <FactChips
                    facts={[
                      {
                        icon: 'calendar',
                        label: t('label.pickup'),
                        value: pickup ? formatLongDay(pickup) : '—',
                      },
                      {
                        icon: 'truck',
                        label: t('label.truck'),
                        value:
                          truck === UNSURE
                            ? t('truck.unset')
                            : (truckOptions.find((o) => o.value === truck)?.label ?? truck),
                      },
                      {
                        icon: 'weight',
                        label: t('label.weight'),
                        value: formatWeight(parsedWeight, t('weight.unset')),
                      },
                    ]}
                  />
                </View>

                {/* The price, before anything is created. An estimate that
                    cannot be produced is not an error — it names the human who
                    will do it, in the same words the shipper sees afterwards. */}
                <View style={styles.priceBlock}>
                  <Text style={styles.priceLabel}>{t('review.priceLabel')}</Text>
                  {quoteRoute.isPending ? (
                    <Body muted>{t('review.checking')}</Body>
                  ) : quoteRoute.data?.outcome === 'quoted' &&
                    quoteRoute.data.price_baisa != null ? (
                    <>
                      <Text style={styles.price}>
                        {formatMoney(
                          quoteRoute.data.price_baisa,
                          quoteRoute.data.currency as Currency,
                          getLanguage(),
                        )}
                      </Text>
                      <Body muted>{t('price.settle')}</Body>
                    </>
                  ) : (
                    <Body muted>
                      {quoteRoute.data
                        ? t(`price.${quoteRoute.data.outcome}` as StringKey)
                        : t('price.no_rate')}
                    </Body>
                  )}
                </View>
              </View>
            </>
          )}

          {!!errors.form && (
            <Text style={styles.formError} accessibilityLiveRegion="polite">
              {errors.form}
            </Text>
          )}
        </ScrollView>

        <ActionBar note={step === 'review' ? undefined : t('whatsapp.promise')}>
          {step === 'route' && <Button label={t('common.next')} onPress={nextFromRoute} />}
          {step === 'details' && (
            <Button
              label={t('post.load.submit')}
              onPress={nextFromDetails}
              loading={quoteRoute.isPending}
            />
          )}
          {step === 'review' && (
            <>
              <Button label={t('review.confirm')} onPress={submit} loading={postLoad.isPending} />
              <Button
                label={t('review.change')}
                variant="quiet"
                onPress={() => setStep('details')}
              />
            </>
          )}
        </ActionBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingBottom: space.xl },
  form: { paddingHorizontal: GUTTER, gap: space.xl },
  doneWrap: { flex: 1, justifyContent: 'center' },

  stepMark: { ...font.label, color: color.inkSoft },
  help: { ...font.smallPrint, color: color.inkSoft, textAlign: align.start, marginTop: -space.md },
  formError: {
    ...font.bodySmall,
    color: color.danger,
    textAlign: align.start,
    paddingHorizontal: GUTTER,
    paddingTop: space.md,
  },

  summary: {
    backgroundColor: color.paperDeep,
    borderRadius: 16,
    padding: space.lg,
    gap: space.md,
  },
  priceBlock: { gap: space.xs },
  priceLabel: { ...font.label, color: color.inkSoft, textAlign: align.start },
  // formatMoney, never toFixed(2) — OMR carries three decimals.
  price: { ...font.display, color: color.ink, textAlign: align.start },
});
