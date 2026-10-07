/** A declared maximum is required before a driver's truck is registered. */
import { useState } from 'react';
import { useRouter, type Href } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { SecondaryButton, TextField } from '@/components/primitives';
import { t } from '@/i18n';
import { getAuthDraft, stepPosition, updateAuthDraft } from '@/lib/auth-draft';
import { useTruckTypes } from '@/lib/queries';
import { asciiDigits } from '@/lib/numerals';

export default function Capacity() {
  const router = useRouter();
  const draft = getAuthDraft();
  const { data: truckTypes, refetch } = useTruckTypes();
  const [value, setValue] = useState(draft.capacityKg ? String(draft.capacityKg) : '');
  const { step, total } = stepPosition(draft, 'capacity');
  const kg = Number(value);
  const classMax = truckTypes?.find((type) => type.code === draft.truckType)?.capacity_kg;
  const valid = /^\d+$/.test(value) && Number.isSafeInteger(kg) && kg > 0 &&
    classMax != null && kg <= classMax;

  function finish() {
    if (!valid || !draft.truckType) return;
    updateAuthDraft({ capacityKg: kg });
    router.push('/plate' as Href);
  }

  return (
    <QuestionShell
      step={step}
      total={total}
      question={t('auth.capacity.q')}
      helper={t('auth.capacity.help')}
      onBack={() => router.back()}
      cta={t('action.continue')}
      ctaDisabled={!valid || !draft.truckType}
      onCta={finish}
    >
      <TextField
        value={value}
        onChangeText={(next) => setValue(asciiDigits(next).replace(/\D/g, '').slice(0, 5))}
        keyboardType="number-pad"
        accessibilityLabel={t('auth.capacity.q')}
        placeholder={t('auth.capacity.placeholder')}
        maxLength={5}
      />
      {classMax == null && <SecondaryButton label={t('common.retry')}
        onPress={() => { void refetch(); }} />}
    </QuestionShell>
  );
}
