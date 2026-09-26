/**
 * The number — drawn as the handoff's N2: `+968`, a divider, then the digits.
 *
 * INTERIM: optional, as it always was, because it is not yet how anyone signs
 * in. When WhatsApp codes land this field moves to the front of the flow as the
 * real N2 and stops being skippable; nothing about its shape changes.
 *
 * Omani mobiles only for now — the dial code is drawn, not chosen. The P2 spec's
 * six GCC prefixes arrive with the codes, which is where they are enforced.
 *
 * The last question for a shipper, so for them this is where the profile is
 * written. A driver has one more: the truck.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { t } from '@/i18n';
import { finishSetup } from '@/lib/auth';
import { OMAN_DIAL, getAuthDraft, isOmaniMobile, stepPosition, updateAuthDraft } from '@/lib/auth-draft';
import { font } from '@/theme/tokens';

export default function Phone() {
  const router = useRouter();
  const draft = getAuthDraft();
  const [digits, setDigits] = useState(draft.phone);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { step, total } = stepPosition(draft, 'phone');
  const isLast = draft.role !== 'driver';

  async function go(phone: string | null) {
    if (phone !== null && !isOmaniMobile(phone)) {
      setError(t('error.phone.oman'));
      return;
    }
    updateAuthDraft({ phone: phone ?? '' });
    if (!isLast) {
      router.push('/truck');
      return;
    }

    setBusy(true);
    const result = await finishSetup({
      role: 'shipper',
      fullName: draft.name,
      omaniMobile: phone,
      truckType: null,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.replace('/done');
  }

  return (
    <QuestionShell
      step={step}
      total={total}
      question={t('auth.phone.q')}
      helper={t('auth.phone.help')}
      onBack={() => router.back()}
      cta={isLast ? t('auth.truck.finish') : t('action.continue')}
      ctaDisabled={digits.length === 0}
      ctaLoading={busy}
      onCta={() => go(digits)}
      tertiary={t('auth.phone.skip')}
      onTertiary={() => go(null)}
    >
      <TextField
        value={digits}
        onChangeText={(v) => {
          // Digits only: a pasted "+968 9123 4567" keeps its last eight.
          setDigits(v.replace(/\D/g, '').replace(/^968(?=\d{8}$)/, '').slice(0, 8));
          setError(null);
        }}
        error={error}
        accessibilityLabel={t('auth.phone')}
        autoFocus
        keyboardType="number-pad"
        autoComplete="tel-national"
        textContentType="telephoneNumber"
        maxLength={12}
        style={styles.digits}
        leading={
          <View style={styles.dial}>
            <Text style={styles.dialCode}>{OMAN_DIAL}</Text>
            <View style={styles.divider} />
          </View>
        }
      />
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  dial: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  // The dial code reads left-to-right in both languages: it is a number, not a word.
  dialCode: { ...font.title, fontSize: 22, lineHeight: 28, color: 'rgba(22,23,26,.62)', writingDirection: 'ltr' },
  divider: { width: 1, height: 32, backgroundColor: 'rgba(22,23,26,.12)' },
  digits: { fontSize: 24, lineHeight: 30, letterSpacing: 0.5, writingDirection: 'ltr' },
});
