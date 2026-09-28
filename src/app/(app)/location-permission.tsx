/**
 * The disclosure before the OS asks (spec §5.3). Google Play's background
 * location policy requires it, and it is what its reviewers look for: what is
 * collected, why, and that it happens with the app closed — in our words, before
 * the system's.
 *
 * Cream, one question: this is the asking ground. The OS prompt follows only on
 * Continue; "Not now" asks nothing.
 */
import { useRouter } from 'expo-router';
import { Platform, StyleSheet, Text } from 'react-native';

import { QuestionShell } from '@/components/booking/shells';
import { arabicIfNeeded } from '@/components/text-direction';
import { align, t } from '@/i18n';
import { useLocationAccess } from '@/lib/location-tracking';
import { color, font } from '@/theme/tokens';

export default function LocationPermission() {
  const router = useRouter();
  const { request } = useLocationAccess();
  return (
    <QuestionShell
      step={1}
      total={1}
      question={t('loc.ask.q')}
      helper={t('loc.ask.body')}
      onBack={() => router.back()}
      cta={t('action.continue')}
      onCta={async () => {
        await request().catch(() => 'none');
        router.back();
      }}
      tertiary={t('loc.ask.later')}
      onTertiary={() => router.back()}
    >
      {/* Android 11+ cannot grant "all the time" from a dialog — it opens
          Settings, and a driver there needs to know which row to tap. */}
      {Platform.OS === 'android' && <Text style={styles.hint}>{t('loc.ask.android')}</Text>}
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  hint: { ...arabicIfNeeded(font.body), color: color.inkText, textAlign: align.start },
});
