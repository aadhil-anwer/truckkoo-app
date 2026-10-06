/** Disagreeing with a strike (0063): a person reads every appeal. */
import { useState } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { t } from '@/i18n';
import { reportFailure } from '@/lib/monitoring';
import { supabase } from '@/lib/supabase';

export default function Appeal() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const queries = useQueryClient();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = text.trim().length >= 10;

  async function send() {
    if (busy || !ready || !id) return;
    setBusy(true); setError(null);
    try {
      const { error: e } = await supabase.rpc('appeal_incident', { p_incident_id: id, p_text: text.trim() });
      if (e) throw e;
      void queries.invalidateQueries({ queryKey: ['record'] });
      void queries.invalidateQueries({ queryKey: ['reports'] });
      Alert.alert(t('appeal.done'));
      router.back();
    } catch (e) {
      reportFailure('appeal_incident', e);
      setError(t('appeal.error'));
    } finally { setBusy(false); }
  }

  return (
    <QuestionShell step={1} total={1} question={t('appeal.q')} helper={t('appeal.help')}
      onBack={() => { if (!busy) router.back(); }}
      cta={t('appeal.cta')} ctaDisabled={!ready} ctaLoading={busy} onCta={() => void send()}
    >
      <TextField value={text} onChangeText={setText} multiline maxLength={1000}
        accessibilityLabel={t('appeal.details')} placeholder={t('appeal.details')} error={error}
        style={{ minHeight: 140, textAlignVertical: 'top' }} />
    </QuestionShell>
  );
}
