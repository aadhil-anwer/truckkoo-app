/**
 * N5 · What do you drive? — drivers only, and their last question.
 *
 * Does NOT auto-advance, unlike N4. This tap writes the account, and a choice
 * that commits on its own 180 ms after a thumb brushes a row is not a choice.
 *
 * The plate is not asked. The handoff never draws it, it was always optional,
 * and dispatch can add it the first time it matters.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { SecondaryButton, SelectRow } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Skeleton } from '@/components/ui';
import { align, getLanguage, localized, t } from '@/i18n';
import { getAuthDraft, stepPosition, updateAuthDraft } from '@/lib/auth-draft';
import { useTruckTypes } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { color, font, radius, space } from '@/theme/tokens';

/** The plain-language line under a size — Arabic where the website has it. */
function subtitleOf(type: { description_en: string | null; description_ar: string | null }) {
  return (getLanguage() === 'ar' && type.description_ar) || type.description_en || undefined;
}

export default function TruckClass() {
  const router = useRouter();
  const draft = getAuthDraft();
  const { data: types, isPending, isFetching, refetch } = useTruckTypes();
  const [truck, setTruck] = useState<string | null>(draft.truckType);
  const { step, total } = stepPosition(draft, 'truck');

  function finish() {
    if (!truck) return;
    updateAuthDraft({ truckType: truck });
    router.push('/capacity' as Href);
  }

  return (
    <QuestionShell
      step={step}
      total={total}
      question={t('auth.truck.q', { name: safeText(draft.name) })}
      helper={t('auth.truck.help.fit')}
      onBack={() => router.back()}
      cta={t('action.continue')}
      ctaDisabled={!truck}
      onCta={finish}
    >
      {isPending ? (
        // At the final geometry, so nothing jumps under the thumb on arrival.
        <View style={styles.list}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={72} round={radius.row} />
          ))}
        </View>
      ) : (types ?? []).length === 0 ? (
        // Never a question with nothing to pick from — the last step of making an
        // account is the worst place in the product to strand someone.
        <View style={styles.list}>
          <Text style={[arabicIfNeeded(font.body), styles.muted]}>{t('auth.truck.unavailable')}</Text>
          <SecondaryButton
            label={t('common.retry')}
            disabled={isFetching}
            onPress={() => {
              refetch();
            }}
          />
        </View>
      ) : (
        <View style={styles.list} accessibilityRole="radiogroup" accessibilityLabel={t('auth.truck.help.fit')}>
          {(types ?? []).map((type) => (
            <SelectRow
              key={type.code}
              title={localized(type)}
              subtitle={subtitleOf(type)}
              selected={truck === type.code}
              onPress={() => {
                setTruck(type.code);
                updateAuthDraft({ truckType: type.code });
              }}
            />
          ))}
        </View>
      )}
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  muted: { color: color.mutedText, textAlign: align.start },
});
