/**
 * D5 · When do you leave, and is the truck empty?
 *
 * TWO QUESTIONS ON ONE SCREEN, because they are one decision. A driver saying
 * "Tuesday, empty" is describing a single trip, and splitting it across two
 * cream screens would turn a fuel-stop task into a form.
 *
 * THE AMOUNT IS SKIPPABLE. A part-loaded driver who does not know how much room
 * is left can still add the route: `legs.free_kg` is nullable for the same
 * reason `loads.truck_type_code` is, and not answering must stay possible for
 * this audience (CLAUDE.md #1).
 */

import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { QuestionShell } from '@/components/booking/shells';
import { SelectCard, SelectRow } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { SectionLabel } from '@/components/ui';
import { align, t } from '@/i18n';
import { formatLongDay, isoToday } from '@/lib/format';
import { clearLegDraft, getLegDraft, updateLegDraft } from '@/lib/leg-draft';
import { usePostLeg } from '@/lib/queries';
import { face } from '@/theme/faces';
import { color, font, hairline, radius, space } from '@/theme/tokens';

/** Three weeks out. A leg declared further ahead than that is a guess. */
const DAYS = 14;

export default function LegWhen() {
  const router = useRouter();
  const postLeg = usePostLeg();
  const [draft, setDraft] = useState(getLegDraft());
  const [error, setError] = useState<string | null>(null);

  function set(patch: Parameters<typeof updateLegDraft>[0]) {
    setDraft(updateLegDraft(patch));
  }

  const days = Array.from({ length: DAYS }, (_, i) => isoToday(i));

  function nameFor(iso: string, i: number) {
    if (i === 0) return t('book.date.today');
    if (i === 1) return t('book.date.tomorrow');
    return formatLongDay(iso);
  }

  async function submit() {
    setError(null);
    try {
      await postLeg.mutateAsync({
        originCity: draft.originCityId!,
        destCity: draft.destCityId!,
        departFrom: draft.departFrom!,
        departTo: draft.departFrom!,
        isEmpty: draft.isEmpty,
        // Dropped server-side for an empty truck; sent as null when unknown.
        freeKg: draft.isEmpty ? null : draft.freeKg,
      });
      clearLegDraft();
      router.replace('/routes');
    } catch {
      setError(t('error.generic'));
    }
  }

  return (
    <QuestionShell
      step={2}
      total={2}
      question={t('drv.when.q')}
      onBack={() => router.back()}
      cta={t('drv.when.add')}
      ctaDisabled={!draft.departFrom || postLeg.isPending}
      onCta={submit}
    >
      <View accessibilityRole="radiogroup" accessibilityLabel={t('drv.when.q')}>
        {days.map((iso, i) => (
          <SelectRow
            key={iso}
            title={nameFor(iso, i)}
            subtitle={i < 2 ? formatLongDay(iso) : undefined}
            selected={draft.departFrom === iso}
            onPress={() => set({ departFrom: iso })}
          />
        ))}
      </View>

      <View style={styles.second}>
        <SectionLabel ground="cream">{t('drv.when.empty.q')}</SectionLabel>

        <View accessibilityRole="radiogroup" accessibilityLabel={t('drv.when.empty.q')}>
          <SelectCard
            title={t('drv.when.empty')}
            body={t('drv.when.empty.hint')}
            icon="truck"
            selected={draft.isEmpty}
            onPress={() => set({ isEmpty: true, freeKg: null })}
          />
          <SelectCard
            title={t('drv.when.part')}
            body={t('drv.when.part.hint')}
            icon="goods"
            selected={!draft.isEmpty}
            onPress={() => set({ isEmpty: false })}
          />
        </View>

        {/* Revealed by the choice, never before it: a field asking how much room
            is left on an empty truck is a question with no answer. */}
        {!draft.isEmpty && (
          <View style={styles.field}>
            <TextInput
              style={styles.input}
              value={draft.freeKg == null ? '' : String(draft.freeKg)}
              onChangeText={(v) => {
                const digits = v.replace(/[^0-9]/g, '');
                set({ freeKg: digits === '' ? null : Number(digits) });
              }}
              keyboardType="number-pad"
              placeholder={t('drv.when.part.hint')}
              placeholderTextColor={color.mutedText}
              accessibilityLabel={t('drv.when.part.hint')}
              maxLength={5}
            />
            <Text style={styles.unit}>{t('book.weight.unit')}</Text>
          </View>
        )}
      </View>

      {!!error && <Text style={styles.error}>{error}</Text>}
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  second: { marginTop: space.xl, gap: space.md },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.lg,
    borderRadius: radius.input,
    backgroundColor: color.creamCard,
    borderWidth: 1,
    borderColor: hairline.onCream,
  },
  input: {
    flex: 1,
    fontFamily: face.archivo600,
    fontSize: 18,
    color: color.inkText,
    textAlign: align.start,
  },
  unit: { ...arabicIfNeeded(font.value), color: color.mutedText },
  error: { ...arabicIfNeeded(font.body), color: color.danger, textAlign: align.start },
});
