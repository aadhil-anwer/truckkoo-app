/**
 * N2, interim · What is your email?
 *
 * Stands where the handoff's phone-number question will stand once WhatsApp codes
 * land — same position, same cream shape, same single field. Only the field
 * changes then. See `src/lib/auth-draft.ts`.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { t } from '@/i18n';
import { getAuthDraft, stepPosition, updateAuthDraft } from '@/lib/auth-draft';

const EMAIL = /^\S+@\S+\.\S+$/;

export default function Email() {
  const router = useRouter();
  const draft = getAuthDraft();
  const [email, setEmail] = useState(draft.email);
  const [error, setError] = useState<string | null>(null);
  const { step, total } = stepPosition(draft, 'email');

  function next() {
    const value = email.trim();
    if (!EMAIL.test(value)) {
      setError(t('error.email.invalid'));
      return;
    }
    updateAuthDraft({ email: value });
    router.push('/password');
  }

  return (
    <QuestionShell
      step={step}
      total={total}
      question={t('auth.email.q')}
      helper={draft.mode === 'signIn' ? t('auth.email.help.in') : t('auth.email.help.up')}
      onBack={() => router.back()}
      cta={t('action.continue')}
      ctaDisabled={email.trim().length === 0}
      onCta={next}
    >
      <TextField
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          setError(null);
        }}
        error={error}
        placeholder={t('auth.email.placeholder')}
        accessibilityLabel={t('auth.email')}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={next}
      />
    </QuestionShell>
  );
}
