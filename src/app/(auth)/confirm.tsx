/**
 * Landing point for the signup confirmation email.
 *
 * Email confirmation is on, so `signUp` returns no session and a new user cannot
 * reach the role and truck steps in the same sitting. This screen closes that
 * gap: the emailed link opens the app, the one-time code is exchanged here, and
 * signup carries on where it stopped.
 *
 * It deliberately decides nothing about where the user goes. After the exchange
 * they hold a session with no profile row, and the Gate in `_layout.tsx` already
 * routes exactly that state to `/sign-up`, which derives its own step. Adding a
 * second opinion here is how the two disagree later.
 *
 * There is no success state on purpose. Confirming an email is not an
 * accomplishment worth a screen — it is a door, and a door that lingers reads as
 * a step the user has to complete.
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Masthead } from '@/components/masthead';
import { Body, Button } from '@/components/primitives';
import { t } from '@/i18n';
import { completeEmailConfirmation } from '@/lib/auth';
import { color, space } from '@/theme/tokens';

export default function ConfirmEmail() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code?: string }>();

  const [error, setError] = useState<string | null>(code ? null : t('auth.confirm.invalid'));
  // The code is single-use: a re-render that fired the exchange twice would burn
  // it and fail the second time, reporting an expired link to a user holding a
  // fresh one.
  const started = useRef(false);

  useEffect(() => {
    if (!code || started.current) return;
    started.current = true;

    completeEmailConfirmation(code).then((result) => {
      if (result.ok) {
        // Leaving this route re-arms the Gate, which sends them to finish signup.
        router.replace('/sign-up');
      } else {
        setError(result.message);
      }
    });
  }, [code, router]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Masthead title={t('auth.confirm.title')} />
      <View style={styles.form}>
        {error ? (
          <>
            <Body muted>{error}</Body>
            <Button
              label={t('auth.submit.signIn')}
              variant="secondary"
              onPress={() => router.replace('/sign-in')}
            />
          </>
        ) : (
          <>
            <ActivityIndicator color={color.orange} />
            <Body muted>{t('auth.confirm.working')}</Body>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper },
  form: { paddingHorizontal: space.xl, paddingTop: space.xxl, gap: space.md, alignItems: 'flex-start' },
});
