/**
 * N3, interim · the password.
 *
 * Stands where the handoff's code entry will stand. It does not navigate on
 * success: a session appears, and the Gate routes it — home for an account with
 * a profile, the role question for one without. One place decides where a
 * signed-in person goes, so two places cannot disagree about it.
 *
 * The password is this screen's state and nothing else's: it is never put in
 * the shared draft, so there is no copy of it to forget to clear.
 */
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { align, t } from '@/i18n';
import { sendPasswordReset, signInWithEmail, signUpWithEmail } from '@/lib/auth';
import { safeText } from '@/lib/safe-text';
import { getAuthDraft, stepPosition } from '@/lib/auth-draft';
import { color, font } from '@/theme/tokens';

export default function Password() {
  const router = useRouter();
  const draft = getAuthDraft();
  const signingIn = draft.mode === 'signIn';
  const { step, total } = stepPosition(draft, 'password');

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setNotice(null);
    if (!signingIn && password.length < 8) {
      setError(t('error.password.short'));
      return;
    }

    setBusy(true);
    const result = signingIn
      ? await signInWithEmail(draft.email, password)
      : await signUpWithEmail(draft.email, password);

    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    if ('needsConfirmation' in result && result.needsConfirmation) {
      setBusy(false);
      setNotice(t('auth.checkEmail'));
      return;
    }
    // Stay busy: the Gate is about to move this screen.
  }

  async function forgot() {
    setError(null);
    await sendPasswordReset(draft.email);
    // Confirmed whether or not the account exists — see sendPasswordReset.
    setNotice(t('auth.forgot.sent'));
  }

  return (
    <QuestionShell
      step={step}
      total={total}
      question={signingIn ? t('auth.password.q.in') : t('auth.password.q.up')}
      helper={signingIn ? safeText(draft.email) : t('auth.password.help.up')}
      onBack={() => router.back()}
      cta={signingIn ? t('auth.submit.signIn') : t('auth.submit.signUp')}
      ctaDisabled={password.length === 0}
      ctaLoading={busy}
      onCta={submit}
      tertiary={signingIn ? t('auth.forgot') : undefined}
      onTertiary={signingIn ? forgot : undefined}
    >
      <TextField
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          setError(null);
        }}
        error={error}
        placeholder={signingIn ? undefined : t('auth.password.placeholder')}
        accessibilityLabel={t('auth.password')}
        autoFocus
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={signingIn ? 'current-password' : 'new-password'}
        textContentType={signingIn ? 'password' : 'newPassword'}
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {!!notice && (
        <Text style={[arabicIfNeeded(font.body), styles.notice]} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      )}
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  notice: { color: color.inkText, textAlign: align.start },
});
