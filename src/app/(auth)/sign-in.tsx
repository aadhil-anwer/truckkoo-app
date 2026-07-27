/**
 * Sign in. Email and password, plus Google and Apple.
 *
 * The screen leads with the brand and one sentence, then two fields, then the
 * action pinned at the thumb — the shape every consumer app opens with, because
 * it is the shape people have already learned. The old version put the submit
 * button in the middle of a scroll between the password field and the OAuth
 * pair, where it competed with two identical-looking buttons beneath it.
 *
 * The OAuth buttons call the real `signInWithOAuth` flow — they are not stubs.
 * If the provider is not yet enabled in the Supabase dashboard, Supabase returns
 * an error and we say so in plain words rather than failing silently.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Body, Button, Field, Input, TextButton } from '@/components/primitives';
import { PageTitle, Screen } from '@/components/ui';
import { align, t } from '@/i18n';
import { sendPasswordReset, signInWithEmail, signInWithProvider } from '@/lib/auth';
import { color, font, GUTTER, space } from '@/theme/tokens';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'email' | 'google' | 'apple'>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  async function onSubmit() {
    setFormError(null);
    setEmailError(null);

    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setEmailError(t('error.email.invalid'));
      return;
    }

    setBusy('email');
    const result = await signInWithEmail(email.trim(), password);
    setBusy(null);
    if (!result.ok) setFormError(result.message);
  }

  /**
   * A forgotten password is a dead end on an email+password app, and this
   * audience will not go hunting for a web form. The address already typed above
   * is reused so there is nothing extra to fill in.
   */
  async function onForgot() {
    setFormError(null);
    setResetSent(false);

    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setEmailError(t('auth.forgot.needEmail'));
      return;
    }

    setEmailError(null);
    await sendPasswordReset(email.trim());
    // Confirmed regardless of whether the account exists — see sendPasswordReset.
    setResetSent(true);
  }

  async function onProvider(provider: 'google' | 'apple') {
    setFormError(null);
    setBusy(provider);
    const result = await signInWithProvider(provider);
    setBusy(null);
    if (!result.ok) setFormError(result.message);
  }

  return (
    <Screen tone="surface" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandWrap}>
            <Text style={styles.brand}>{t('app.name').toUpperCase()}</Text>
          </View>

          <PageTitle detail={t('app.positioning')}>{t('auth.signIn.title')}</PageTitle>

          <View style={styles.form}>
            <Field label={t('auth.email')}>
              <Input
                value={email}
                onChangeText={setEmail}
                placeholder={t('auth.email.placeholder')}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                error={emailError}
                returnKeyType="next"
              />
            </Field>

            <Field label={t('auth.password')}>
              <Input
                value={password}
                onChangeText={setPassword}
                placeholder={t('auth.password.placeholder')}
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={onSubmit}
              />
            </Field>

            <TextButton label={t('auth.forgot')} tone="muted" onPress={onForgot} />

            {resetSent && (
              <Text style={styles.notice} accessibilityLiveRegion="polite">
                {t('auth.forgot.sent')}
              </Text>
            )}

            {!!formError && (
              <Text style={styles.formError} accessibilityLiveRegion="polite">
                {formError}
              </Text>
            )}

            <Button
              label={t('auth.submit.signIn')}
              onPress={onSubmit}
              loading={busy === 'email'}
              disabled={!!busy && busy !== 'email'}
            />

            <View style={styles.orRow}>
              <View style={styles.orRule} />
              <Text style={styles.orText}>{t('auth.or').toUpperCase()}</Text>
              <View style={styles.orRule} />
            </View>

            <Button
              label={t('auth.google')}
              variant="secondary"
              onPress={() => onProvider('google')}
              loading={busy === 'google'}
              disabled={!!busy && busy !== 'google'}
            />

            {/* Apple sign-in is mandatory once Google is offered (App Store 4.8),
                so it is never conditionally hidden on iOS. */}
            <Button
              label={t('auth.apple')}
              variant="secondary"
              onPress={() => onProvider('apple')}
              loading={busy === 'apple'}
              disabled={!!busy && busy !== 'apple'}
            />

            <View style={styles.switch}>
              <Body muted>{t('auth.toSignUp')}</Body>
              <TextButton
                label={t('auth.submit.signUp')}
                align="center"
                onPress={() => router.push('/sign-up')}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: space.xxxl },
  brandWrap: { paddingHorizontal: GUTTER, paddingTop: space.lg },
  brand: { fontSize: 13, fontWeight: '900', letterSpacing: 3, color: color.orange },
  form: { paddingHorizontal: GUTTER, gap: space.lg },
  formError: { ...font.bodySmall, color: color.danger, textAlign: align.start },
  notice: { ...font.bodySmall, color: color.inkSoft, textAlign: align.start },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  orRule: { flex: 1, height: 1, backgroundColor: color.line },
  orText: { ...font.smallPrint, color: color.inkSoft, letterSpacing: 1.6 },
  switch: { alignItems: 'center', paddingTop: space.sm },
});
