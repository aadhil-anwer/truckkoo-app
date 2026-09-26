/**
 * Landing point for the signup confirmation email.
 *
 * If email confirmation is on, `signUp` returns no session and a new user cannot
 * reach the setup questions in the same sitting. This screen closes that gap:
 * the emailed link opens the app, the one-time code is exchanged here, and setup
 * carries on at the role question.
 *
 * There is no success state on purpose. Confirming an email is not an
 * accomplishment worth a screen — it is a door, and a door that lingers reads as
 * a step the user has to complete.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { LinkProblem } from '@/components/auth/link-problem';
import { Skeleton } from '@/components/ui';
import { t } from '@/i18n';
import { completeEmailConfirmation } from '@/lib/auth';
import { GUTTER_INK, color, radius, space } from '@/theme/tokens';

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
        router.replace('/role');
      } else {
        setError(result.message);
      }
    });
  }, [code, router]);

  if (error) return <LinkProblem title={t('auth.confirm.title')} explain={error} />;

  // Usually a fraction of a second. Skeletons, never spinners.
  return (
    <View style={styles.screen} accessibilityLabel={t('auth.confirm.working')} accessibilityLiveRegion="polite">
      <Skeleton height={44} width="70%" round={radius.tile} />
      <Skeleton height={18} />
      <Skeleton height={18} width="60%" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: GUTTER_INK,
    backgroundColor: color.ink,
  },
});
