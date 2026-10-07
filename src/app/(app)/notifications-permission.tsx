/**
 * "Get a buzz when something happens?" — asked right after sign-up (founder's
 * call, 2026-10-04), and once more if a permission that was on is switched off
 * in Settings.
 *
 * Cream, one question, in our words before the system's — the same shape as the
 * location disclosure. The helper says exactly what will buzz, per role, and
 * "Nothing else", because a low-tech user who fears spam says no.
 *
 * When the phone has stopped offering its own dialog, the button opens Settings
 * (`requestPush`) and the screen says so first, so the jump is not a surprise.
 */
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { QuestionShell } from '@/components/booking/shells';
import { arabicIfNeeded } from '@/components/text-direction';
import { align, t } from '@/i18n';
import { usePush } from '@/lib/push-context';
import { useSession } from '@/lib/session';
import { color, font } from '@/theme/tokens';

export default function NotificationsPermission() {
  const router = useRouter();
  const { profile } = useSession();
  const { access, request, decline, settle } = usePush();

  // Closed by the back gesture: no answer, but done asking for this launch.
  useEffect(() => settle, [settle]);

  return (
    <QuestionShell
      step={1}
      total={1}
      question={t('push.ask.q')}
      helper={t(profile?.role === 'driver' ? 'push.ask.driver' : 'push.ask.shipper')}
      onBack={() => router.back()}
      cta={t('push.ask.cta')}
      onCta={async () => {
        await request();
        router.back();
      }}
      tertiary={t('push.ask.later')}
      onTertiary={async () => {
        await decline();
        router.back();
      }}
    >
      {access === 'denied' && <Text style={styles.hint}>{t('push.ask.settings')}</Text>}
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  hint: { ...arabicIfNeeded(font.body), color: color.inkText, textAlign: align.start },
});
