/**
 * Declare a route you are already driving.
 *
 * This is the supply-side habit the whole matching engine depends on
 * (PRODUCT.md), so it is deliberately shorter than posting a load: two steps,
 * four answers, and the empty/part-loaded question defaults to the useful one.
 *
 * It is stepped for the same reason post-load is — one question per screen, the
 * action pinned at the thumb — but it stops at two, because a driver declaring a
 * leg is doing it at a fuel stop with the engine running. Three steps here would
 * be one more than the task deserves.
 *
 * Legs are never readable by shippers or other drivers. The screen says nothing
 * about that because it does not need to, but the RLS behind it is why this data
 * is safe to ask for.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { nextDays, PickerField, type PickerOption } from '@/components/picker';
import { Screen } from '@/components/ui';
import { align, localized, t } from '@/i18n';
import { useCities, usePostLeg } from '@/lib/queries';
import { GUTTER_INK, color, font, space } from '@/theme/tokens';
import { ActionBar, Body, Button, Choice, PageTitle, TopBar } from '@/components/legacy';

type Step = 'route' | 'when';
const STEPS: Step[] = ['route', 'when'];

export default function PostLeg() {
  const router = useRouter();
  const cities = useCities();
  const postLeg = usePostLeg();

  const [step, setStep] = useState<Step>('route');
  const [origin, setOrigin] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [depart, setDepart] = useState<string | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const cityOptions: PickerOption[] = useMemo(
    () =>
      (cities.data ?? []).map((c) => ({
        value: String(c.id),
        label: localized(c),
        detail: localized(c) === c.name_en ? c.name_ar : c.name_en,
        group: c.corridor ?? undefined,
      })),
    [cities.data],
  );

  const dateOptions: PickerOption[] = useMemo(() => nextDays(21), []);

  function nextFromRoute() {
    const next: Record<string, string | null> = {};
    if (!origin) next.origin = t('error.required');
    if (!dest) next.dest = t('error.required');
    if (origin && dest && origin === dest) next.dest = t('post.load.sameCity');

    setErrors(next);
    if (Object.values(next).some(Boolean)) return;
    setStep('when');
  }

  async function submit() {
    const next: Record<string, string | null> = {};
    if (!depart) next.depart = t('error.required');

    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    try {
      await postLeg.mutateAsync({
        originCity: Number(origin),
        destCity: Number(dest),
        departFrom: depart!,
        departTo: depart!,
        isEmpty,
      });
      router.replace('/routes');
    } catch {
      setErrors({ form: t('error.generic') });
    }
  }

  function back() {
    if (step === 'when') return setStep('route');
    router.back();
  }

  const stepNumber = STEPS.indexOf(step) + 1;

  return (
    <Screen>
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
        {step === 'route' ? (
          <>
            <PageTitle detail={t('post.leg.help')}>{t('post.leg.title')}</PageTitle>
            <View style={styles.form}>
              <PickerField
                label={t('label.from')}
                placeholder={t('load.city.placeholder')}
                value={origin}
                options={cityOptions}
                onChange={setOrigin}
                searchable
                error={errors.origin}
                icon="pickup"
              />
              <PickerField
                label={t('label.to')}
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
        ) : (
          <>
            <PageTitle>{t('post.leg.date')}</PageTitle>
            <View style={styles.form}>
              <PickerField
                label={t('label.dates')}
                placeholder={t('label.dates')}
                value={depart}
                options={dateOptions}
                onChange={setDepart}
                error={errors.depart}
                icon="calendar"
              />

              <View style={styles.question}>
                <Body>{t('post.leg.empty')}</Body>
                <View style={styles.choices} accessibilityRole="radiogroup">
                  <Choice
                    title={t('post.leg.empty.yes')}
                    icon="truck"
                    selected={isEmpty}
                    onPress={() => setIsEmpty(true)}
                  />
                  <Choice
                    title={t('post.leg.empty.no')}
                    icon="goods"
                    selected={!isEmpty}
                    onPress={() => setIsEmpty(false)}
                  />
                </View>
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

      <ActionBar>
        {step === 'route' ? (
          <Button label={t('common.next')} onPress={nextFromRoute} />
        ) : (
          <Button label={t('post.leg.submit')} onPress={submit} loading={postLeg.isPending} />
        )}
      </ActionBar>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xl },
  form: { paddingHorizontal: GUTTER_INK, gap: space.xl },
  question: { gap: space.md },
  choices: { gap: space.sm },
  stepMark: { ...font.value, color: color.mutedText },
  formError: {
    ...font.bodySmall,
    color: color.danger,
    textAlign: align.start,
    paddingHorizontal: GUTTER_INK,
    paddingTop: space.md,
  },
});
