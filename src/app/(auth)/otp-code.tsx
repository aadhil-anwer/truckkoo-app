/** N3. The OTP stays in screen state; only the Gate routes a new session. */
import { useEffect, useState } from 'react';
import { Redirect, useRouter, type Href } from 'expo-router';
import { QuestionShell } from '@/components/booking/shells';
import { SecondaryButton, TextField } from '@/components/primitives';
import { formatNumber, t } from '@/i18n';
import { getAuthDraft, isOmaniMobile, OMAN_DIAL, stepPosition } from '@/lib/auth-draft';
import { WHATSAPP_AUTH } from '@/lib/features';
import { asciiDigits } from '@/lib/numerals';
import { sendWhatsAppCode, verifyWhatsAppCode } from '@/lib/whatsapp-otp';

export default function WhatsAppCode() {
  if (!WHATSAPP_AUTH) return <Redirect href="/welcome" />;
  return isOmaniMobile(getAuthDraft().phone) ? <CodeForm /> : <Redirect href={'/otp-phone' as Href} />;
}

function CodeForm() {
  const router = useRouter();
  const draft = getAuthDraft();
  const phone = `${OMAN_DIAL}${draft.phone}`;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(() => Date.now() + 60_000);
  const [now, setNow] = useState(() => Date.now());
  const { step, total } = stepPosition(draft, 'otp-code');
  const seconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function verify() {
    if (busy || sending || !/^\d{6}$/.test(code)) return;
    setBusy(true); setError(null);
    if (!await verifyWhatsAppCode(phone, code)) {
      setError(t('auth.otp.codeError'));
      setBusy(false);
    }
    // A successful session is routed by Gate, after the profile read completes.
  }

  async function resend() {
    if (seconds > 0 || busy || sending) return;
    setSending(true); setError(null); setCode('');
    setResendAt(Date.now() + 60_000); setNow(Date.now());
    if (!await sendWhatsAppCode(phone, draft.mode === 'signUp')) setError(t('auth.otp.sendError'));
    setSending(false);
  }

  return <QuestionShell step={step} total={total} question={t('auth.otp.code.q')}
    helper={busy ? t('auth.otp.verifying') : sending ? t('auth.otp.sending') : t('auth.otp.code.help', { phone })}
    onBack={() => { if (!busy && !sending) router.back(); }} cta={t('auth.otp.verify')}
    ctaLoading={busy} ctaDisabled={sending || !/^\d{6}$/.test(code)} onCta={() => void verify()}
    tertiary={t('auth.otp.change')} onTertiary={busy || sending ? undefined : () => router.replace('/otp-phone' as Href)}
  >
    <TextField value={code} error={error} accessibilityLabel={t('auth.otp.code.label')}
      onChangeText={(value) => { setCode(asciiDigits(value).replace(/\D/g, '').slice(0, 6)); setError(null); }}
      keyboardType="number-pad" autoComplete="sms-otp" textContentType="oneTimeCode"
      autoFocus maxLength={6} returnKeyType="done" onSubmitEditing={() => void verify()} />
    <SecondaryButton
      label={seconds > 0 ? t('auth.otp.resendWait', { seconds: formatNumber(seconds) }) : t('auth.otp.resend')}
      disabled={seconds > 0 || busy || sending} onPress={() => void resend()} />
  </QuestionShell>;
}
