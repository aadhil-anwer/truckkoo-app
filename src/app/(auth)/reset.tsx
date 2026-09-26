/**
 * Set a new password, reached only from the link in a reset email.
 *
 * The link carries a one-time PKCE `code`. That code — not an email, not a user
 * id in the URL — is the whole authorisation, and it is exchanged server-side
 * (SECURITY.md §2, §4). Arriving here without one is a dead link, and we say so
 * with the one instruction that helps: ask for another email.
 *
 * The Gate in `_layout.tsx` deliberately does not redirect away from this route:
 * the exchange creates a real session, and without the exemption the user would
 * be bounced to their loads mid-reset with the password unchanged.
 *
 * A cream question like every other step of getting in — one field, one action.
 */
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { LinkProblem } from '@/components/auth/link-problem';
import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { t } from '@/i18n';
import { completePasswordReset } from '@/lib/auth';

export default function ResetPassword() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    if (password.length < 8) {
      setError(t('error.password.short'));
      return;
    }

    setBusy(true);
    const result = await completePasswordReset(code!, password);
    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    // Signed in on the new password. Leaving the reset route re-arms the Gate,
    // which sends them to their own side of the app (or to finish setup).
    router.replace('/welcome');
  }

  if (!code) {
    return <LinkProblem title={t('auth.reset.title')} explain={t('auth.reset.invalid')} />;
  }

  return (
    <QuestionShell
      step={1}
      total={1}
      question={t('auth.reset.title')}
      helper={t('auth.reset.explain')}
      onBack={() => router.replace('/welcome')}
      cta={t('auth.reset.submit')}
      ctaDisabled={password.length === 0}
      ctaLoading={busy}
      onCta={onSubmit}
    >
      <TextField
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          setError(null);
        }}
        error={error}
        placeholder={t('auth.password.placeholder')}
        accessibilityLabel={t('auth.reset.password')}
        autoFocus
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
      />
    </QuestionShell>
  );
}
