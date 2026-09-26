/**
 * The last resort. Nothing above this catches a render-time exception, so
 * without it one crashes the whole app to React Native's red screen (dev) or
 * a frozen blank one (release) — for an audience with near-zero tech skills,
 * "force-stop and reopen" is not a debugging step they know exists.
 *
 * Wired in as `_layout.tsx`'s `ErrorBoundary` export, expo-router's own
 * mechanism for this — so `retry()` re-renders the route tree rather than
 * requiring a real relaunch.
 */

import { Text, View, StyleSheet } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';

import { PrimaryButton } from './primitives';
import { arabicIfNeeded } from './text-direction';
import { QuestionHeading } from './ui';
import { align, t } from '@/i18n';
import { color, font, space } from '@/theme/tokens';

export function AppErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  if (__DEV__) console.error(error);

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        <QuestionHeading ground="ink" size="question">
          {t('common.error.title')}
        </QuestionHeading>
        <Text style={styles.explain}>{t('common.error.explain')}</Text>
      </View>
      <View style={styles.action}>
        <PrimaryButton label={t('common.retry')} onPress={retry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.ink,
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.xxl,
  },
  body: { gap: space.sm },
  explain: {
    ...arabicIfNeeded(font.body),
    color: color.lightText,
    textAlign: align.start,
  },
  action: { paddingBottom: space.xxl },
});
