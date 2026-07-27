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
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '@/components/primitives';
import { ActionBar, EmptyState, Screen } from '@/components/ui';
import { t } from '@/i18n';
import { completeEmailConfirmation } from '@/lib/auth';
import { color, font, space } from '@/theme/tokens';

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

  if (error) {
    return (
      <Screen tone="surface" edges={['top', 'bottom']}>
        <View style={styles.flex}>
          <EmptyState icon="alert" title={t('auth.confirm.title')} explain={error} />
        </View>
        <ActionBar>
          <Button label={t('auth.submit.signIn')} onPress={() => router.replace('/sign-in')} />
        </ActionBar>
      </Screen>
    );
  }

  return (
    <Screen tone="surface" edges={['top', 'bottom']}>
      <View style={styles.busy} accessibilityLiveRegion="polite">
        <ActivityIndicator color={color.orange} />
        <Text style={styles.working}>{t('auth.confirm.working')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'center' },
  busy: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  working: { ...font.body, color: color.inkSoft },
});
