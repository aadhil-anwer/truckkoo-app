/**
 * N4b · What should we call you?
 *
 * The step the handoff numbers and never draws: N6 greets the user by name, and
 * nothing before it asks for one (P2 spec §2).
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { t } from '@/i18n';
import { getAuthDraft, stepPosition, updateAuthDraft } from '@/lib/auth-draft';

export default function Name() {
  const router = useRouter();
  const draft = getAuthDraft();
  const [name, setName] = useState(draft.name);
  const { step, total } = stepPosition(draft, 'name');

  function next() {
    if (name.trim().length === 0) return;
    updateAuthDraft({ name: name.trim() });
    router.push('/phone');
  }

  return (
    <QuestionShell
      step={step}
      total={total}
      question={t('auth.name.q')}
      helper={draft.role === 'driver' ? t('auth.name.help.driver') : t('auth.name.help.shipper')}
      onBack={() => router.back()}
      cta={t('action.continue')}
      ctaDisabled={name.trim().length === 0}
      onCta={next}
    >
      <TextField
        value={name}
        onChangeText={setName}
        placeholder={t('auth.name.placeholder')}
        accessibilityLabel={t('auth.name')}
        autoFocus
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        // The column's own limit, enforced while typing rather than on submit.
        maxLength={120}
        returnKeyType="next"
        onSubmitEditing={next}
      />
    </QuestionShell>
  );
}
