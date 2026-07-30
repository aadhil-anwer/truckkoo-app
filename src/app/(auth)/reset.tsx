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
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Screen } from '@/components/ui';
import { align, t } from '@/i18n';
import { completePasswordReset } from '@/lib/auth';
import { GUTTER_INK, color, font, space } from '@/theme/tokens';
import { ActionBar, Button, EmptyState, Field, Input, PageTitle } from '@/components/legacy';

export default function ResetPassword() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  async function onSubmit() {
    setFormError(null);
    setPasswordError(null);

    if (password.length < 8) {
      setPasswordError(t('error.password.short'));
      return;
    }

    setBusy(true);
    const result = await completePasswordReset(code!, password);
    setBusy(false);

    if (!result.ok) {
      setFormError(result.message);
      return;
    }

    // Signed in on the new password. Leaving the reset route re-arms the Gate,
    // which sends them to their own side of the app (or to finish signup).
    router.replace('/sign-in');
  }

  if (!code) {
    return (
      <Screen>
        <View style={styles.flex}>
          <EmptyState
            icon="alert"
            title={t('auth.reset.title')}
            explain={t('auth.reset.invalid')}
          />
        </View>
        <ActionBar>
          <Button label={t('auth.submit.signIn')} onPress={() => router.replace('/sign-in')} />
        </ActionBar>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <PageTitle detail={t('auth.reset.explain')}>{t('auth.reset.title')}</PageTitle>

          <View style={styles.form}>
            <Field label={t('auth.reset.password')}>
              <Input
                value={password}
                onChangeText={setPassword}
                placeholder={t('auth.password.placeholder')}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                secureTextEntry
                error={passwordError}
                returnKeyType="go"
                onSubmitEditing={onSubmit}
              />
            </Field>

            {!!formError && (
              <Text style={styles.formError} accessibilityLiveRegion="polite">
                {formError}
              </Text>
            )}
          </View>
        </ScrollView>

        <ActionBar>
          <Button label={t('auth.reset.submit')} onPress={onSubmit} loading={busy} />
        </ActionBar>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: space.xl },
  form: { paddingHorizontal: GUTTER_INK, gap: space.lg },
  formError: { ...font.bodySmall, color: color.danger, textAlign: align.start },
});
