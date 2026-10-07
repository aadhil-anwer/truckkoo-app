/** A plate ties the mulkiya and truck photo to the reviewed vehicle. */
import { useState } from 'react';
import { useRouter, type Href } from 'expo-router';
import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { t } from '@/i18n';
import { finishSetup } from '@/lib/auth';
import { getAuthDraft, stepPosition, updateAuthDraft } from '@/lib/auth-draft';
import { useSession } from '@/lib/session';

export default function Plate() {
  const router = useRouter();
  const { refreshProfile } = useSession();
  const draft = getAuthDraft();
  const [plate, setPlate] = useState(draft.plate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { step, total } = stepPosition(draft, 'plate');
  const valid = plate.trim().length >= 3 && plate.trim().length <= 24;

  async function finish() {
    if (!valid || !draft.truckType || !draft.capacityKg || busy) return;
    setBusy(true);
    setError(null);
    updateAuthDraft({ plate: plate.trim() });
    const result = await finishSetup({
      role: 'driver', fullName: draft.name, omaniMobile: draft.phone || null,
      truckType: draft.truckType, capacityKg: draft.capacityKg, plate: plate.trim(),
    });
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    await refreshProfile();
    router.replace('/verification' as Href);
  }

  return (
    <QuestionShell
      step={step} total={total}
      question={t('auth.plate.q')} helper={t('auth.plate.help')}
      onBack={() => router.back()} cta={t('action.continue')}
      ctaDisabled={!valid} ctaLoading={busy} onCta={finish}
    >
      <TextField value={plate} onChangeText={setPlate} maxLength={24}
        autoCapitalize="characters" accessibilityLabel={t('auth.plate.q')}
        placeholder={t('auth.plate.placeholder')} error={error} />
    </QuestionShell>
  );
}
