/** N2, ready for activation once Meta and account-linking gates pass. */
import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { Redirect, useRouter, type Href } from 'expo-router';
import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { t } from '@/i18n';
import { getAuthDraft, isOmaniMobile, OMAN_DIAL, startAuthDraft, stepPosition, updateAuthDraft } from '@/lib/auth-draft';
import { WHATSAPP_AUTH } from '@/lib/features';
import { asciiDigits } from '@/lib/numerals';
import { sendWhatsAppCode } from '@/lib/whatsapp-otp';
import { color, font } from '@/theme/tokens';

export default function WhatsAppPhone() {
  return WHATSAPP_AUTH ? <PhoneForm /> : <Redirect href="/welcome" />;
}

function PhoneForm() {
  const router = useRouter();
  const draft = getAuthDraft();
  const [digits, setDigits] = useState(draft.phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const { step, total } = stepPosition(draft, 'otp-phone');

  async function send() {
    if (busy || !isOmaniMobile(digits)) return;
    setBusy(true); setError(null);
    const sent = await sendWhatsAppCode(`${OMAN_DIAL}${digits}`, draft.mode === 'signUp');
    if (!mounted.current) return;
    setBusy(false);
    if (!sent) { setError(t('auth.otp.sendError')); return; }
    updateAuthDraft({ phone: digits, viaWhatsApp: true, viaEmail: false });
    router.push('/otp-code' as Href);
  }

  function email() {
    startAuthDraft(draft.mode);
    router.replace('/email');
  }

  return <QuestionShell step={step} total={total}
    question={t('auth.otp.phone.q')}
    helper={t(busy ? 'auth.otp.sending' : 'auth.otp.phone.help')}
    onBack={() => { if (!busy) router.back(); }} cta={t('auth.otp.send')}
    ctaDisabled={!isOmaniMobile(digits)} ctaLoading={busy} onCta={() => void send()}
    tertiary={t('auth.otp.email')} onTertiary={busy ? undefined : email}
  >
    <TextField value={digits} error={error} accessibilityLabel={t('auth.phone')}
      onChangeText={(value) => {
        setDigits(asciiDigits(value).replace(/\D/g, '').replace(/^968(?=\d{8}$)/, '').slice(0, 8));
        setError(null);
      }}
      keyboardType="number-pad" autoComplete="tel-national" textContentType="telephoneNumber"
      maxLength={12} autoFocus returnKeyType="next" onSubmitEditing={() => void send()}
      leading={<Text style={{ ...font.title, color: color.inkText, writingDirection: 'ltr' }}>{OMAN_DIAL}</Text>}
    />
  </QuestionShell>;
}
