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
 *
 * Two things this audience needs that a stock password field does not give:
 * a way to SEE what was typed (a password typed blind, once, by someone who
 * rarely types one, is the password they cannot repeat), and a way out when
 * "Get started" was the wrong door — the answer is on this screen, keeping the
 * email and the password already typed, not back at the start.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { align, t } from '@/i18n';
import { sendPasswordReset, signInWithEmail, signUpWithEmail } from '@/lib/auth';
import { getAuthDraft, stepPosition, updateAuthDraft, type AuthMode } from '@/lib/auth-draft';
import { safeText } from '@/lib/safe-text';
import { MIN_TARGET, color, font } from '@/theme/tokens';

export default function Password() {
  const router = useRouter();
  const draft = getAuthDraft();
  const [mode, setMode] = useState<AuthMode>(draft.mode);
  const signingIn = mode === 'signIn';
  const { step, total } = stepPosition({ ...draft, mode }, 'password');

  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offerSignIn, setOfferSignIn] = useState(false);

  async function submit() {
    setError(null);
    setNotice(null);
    if (!signingIn && password.length < 8) {
      setError(t('error.password.short'));
      return;
    }

    setBusy(true);
    if (signingIn) {
      const result = await signInWithEmail(draft.email, password);
      if (!result.ok) {
        setBusy(false);
        setError(result.message);
      }
      // Otherwise stay busy: the Gate is about to move this screen.
      return;
    }

    const result = await signUpWithEmail(draft.email, password);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      setOfferSignIn(!!result.existing);
      return;
    }
    if (result.needsConfirmation) {
      setBusy(false);
      setNotice(t('auth.checkEmail'));
    }
  }

  function switchToSignIn() {
    updateAuthDraft({ mode: 'signIn' });
    setMode('signIn');
    setOfferSignIn(false);
    setError(null);
  }

  async function forgot() {
    setError(null);
    await sendPasswordReset(draft.email);
    // Confirmed whether or not the account exists — see sendPasswordReset.
    setNotice(t('auth.forgot.sent'));
  }

  const tertiary = signingIn
    ? { label: t('auth.forgot'), onPress: forgot }
    : offerSignIn
      ? { label: t('auth.signInInstead'), onPress: switchToSignIn }
      : null;

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
      tertiary={tertiary?.label}
      onTertiary={tertiary?.onPress}
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
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={signingIn ? 'current-password' : 'new-password'}
        textContentType={signingIn ? 'password' : 'newPassword'}
        returnKeyType="go"
        onSubmitEditing={submit}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? t('auth.password.hideA11y') : t('auth.password.showA11y')}
            onPress={() => setVisible((v) => !v)}
            style={styles.toggle}
          >
            <Text style={[arabicIfNeeded(font.value), styles.toggleText]}>
              {visible ? t('auth.password.hide') : t('auth.password.show')}
            </Text>
          </Pressable>
        }
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
  toggle: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
  toggleText: { color: color.inkText, textDecorationLine: 'underline' },
  notice: { color: color.inkText, textAlign: align.start },
});
