/**
 * S7 · How big a truck?
 *
 * "Let us choose for you" is FIRST and PRESELECTED, and that is not a layout
 * preference. It posts `truck_type_code = NULL`, which is the website's default
 * answer and the single most important affordance for an audience that does not
 * know what a hi-up is (CLAUDE.md #1). The helper legitimises not knowing rather
 * than treating it as a skipped field.
 */
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { QuestionShell } from '@/components/booking/shells';
import { BookingPending } from '@/components/booking/BookingPending';
import { SelectCard, SelectRow } from '@/components/primitives';
import { SectionLabel } from '@/components/ui';
import { TOTAL_STEPS, stepNumber, useBookingDraft } from '@/lib/booking';
import { useTruckTypes } from '@/lib/queries';
import { localized, t } from '@/i18n';
import { space } from '@/theme/tokens';

export default function TruckSize() {
  const router = useRouter();
  const { draft, update, ready } = useBookingDraft();
  const { data: types } = useTruckTypes();

  if (!ready) return <BookingPending />;

  return (
    <QuestionShell
      step={stepNumber('truck')}
      total={TOTAL_STEPS}
      question={t('book.truck.q')}
      helper={t('book.truck.help')}
      onBack={() => router.back()}
      cta={t('action.continue')}
      onCta={() => router.push('/book/weight')}
    >
      <View accessibilityRole="radiogroup" accessibilityLabel={t('book.truck.q')}>
        <SelectCard
          title={t('book.truck.auto')}
          body={t('book.truck.autoBody')}
          icon="question"
          selected={draft.truckPreference === 'auto'}
          onPress={() => update({ truckPreference: 'auto' })}
        />

        <View style={{ marginTop: space.md }}>
          <SectionLabel ground="cream">{t('book.truck.or')}</SectionLabel>
        </View>

        {(types ?? []).map((type) => (
          <SelectRow
            key={type.code}
            title={localized(type)}
            subtitle={type.description_en ?? undefined}
            selected={draft.truckPreference === type.code}
            onPress={() => update({ truckPreference: type.code })}
          />
        ))}
      </View>
    </QuestionShell>
  );
}
