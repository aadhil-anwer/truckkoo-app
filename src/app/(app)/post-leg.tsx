/**
 * Declare a route you are already driving.
 *
 * This is the supply-side habit the whole matching engine depends on
 * (PRODUCT.md), so it is deliberately shorter than posting a load: three
 * questions, and the empty/part-loaded answer defaults to the useful one.
 *
 * Legs are never readable by shippers or other drivers — the screen says nothing
 * about that because it does not need to, but the RLS behind it is why this data
 * is safe to ask for.
 */

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Masthead } from '@/components/masthead';
import { nextDays, PickerField, type PickerOption } from '@/components/picker';
import { Body, Button, Choice, TextButton } from '@/components/primitives';
import { localized, t } from '@/i18n';
import { useCities, usePostLeg } from '@/lib/queries';
import { color, font, space } from '@/theme/tokens';

export default function PostLeg() {
  const router = useRouter();
  const cities = useCities();
  const postLeg = usePostLeg();

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

  async function submit() {
    const next: Record<string, string | null> = {};
    if (!origin) next.origin = t('error.required');
    if (!dest) next.dest = t('error.required');
    if (!depart) next.depart = t('error.required');
    if (origin && dest && origin === dest) next.dest = t('post.load.sameCity');

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
      router.replace('/driver');
    } catch {
      setErrors({ form: t('error.generic') });
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Masthead
        title={t('post.leg.title')}
        action={<TextButton label={t('common.back')} onPress={() => router.back()} />}
      />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.form}>
          <Body muted>{t('post.leg.help')}</Body>

          <PickerField
            label={t('label.from')}
            placeholder={t('load.city.placeholder')}
            value={origin}
            options={cityOptions}
            onChange={setOrigin}
            searchable
            error={errors.origin}
          />

          <PickerField
            label={t('label.to')}
            placeholder={t('load.city.placeholder')}
            value={dest}
            options={cityOptions}
            onChange={setDest}
            searchable
            error={errors.dest}
          />

          <PickerField
            label={t('post.leg.date')}
            placeholder={t('label.dates')}
            value={depart}
            options={dateOptions}
            onChange={setDepart}
            error={errors.depart}
          />

          <View style={styles.choices} accessibilityRole="radiogroup">
            <Choice
              title={t('post.leg.empty.yes')}
              selected={isEmpty}
              onPress={() => setIsEmpty(true)}
            />
            <Choice
              title={t('post.leg.empty.no')}
              selected={!isEmpty}
              onPress={() => setIsEmpty(false)}
            />
          </View>

          {!!errors.form && (
            <Text style={styles.formError} accessibilityLiveRegion="polite">
              {errors.form}
            </Text>
          )}

          <Button label={t('post.leg.submit')} onPress={submit} loading={postLeg.isPending} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper },
  scroll: { paddingBottom: space.huge },
  form: { paddingHorizontal: space.xl, paddingTop: space.lg, gap: space.lg },
  choices: { gap: space.sm },
  formError: { ...font.bodySmall, color: color.danger },
});
