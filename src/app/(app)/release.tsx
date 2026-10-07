/**
 * "Release this job" (0065) — the honest exit for a driver who cannot do a job
 * they accepted. The database cancels the trip the way a staff cancel does,
 * sends the load back to finding a truck, tells the shipper, and records a
 * light strike — heavier on the pickup day. With the cargo aboard the database
 * refuses; the trip screen does not offer it then.
 */
import { useState } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { QuestionShell } from '@/components/booking/shells';
import { SelectRow, TextField } from '@/components/primitives';
import { t } from '@/i18n';
import { reportFailure } from '@/lib/monitoring';
import { supabase } from '@/lib/supabase';

const REASONS = ['breakdown', 'sick', 'family', 'wrong_load', 'too_far', 'other'] as const;
type Reason = typeof REASONS[number];

export default function ReleaseJob() {
  const { tripId } = useLocalSearchParams<{ tripId?: string }>();
  const router = useRouter();
  const queries = useQueryClient();
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function release() {
    if (busy || !reason || !tripId) return;
    setBusy(true); setError(null);
    try {
      const { error: e } = await supabase.rpc('release_trip', {
        p_trip_id: tripId, p_reason_code: reason, p_note: note.trim() || null,
      });
      if (e) throw e;
      for (const key of ['trips', 'driver', 'offers', 'record']) void queries.invalidateQueries({ queryKey: [key] });
      Alert.alert(t('support.release.done'));
      router.replace('/driver');
    } catch (e) {
      reportFailure('release_trip', e);
      setError(t('support.release.error'));
    } finally { setBusy(false); }
  }

  return (
    <QuestionShell step={1} total={1}
      question={t('support.release.q')} helper={t('support.release.help')}
      onBack={() => { if (!busy) router.back(); }}
      cta={t('support.release.cta')} ctaDisabled={!reason} ctaLoading={busy}
      onCta={() => void release()}
    >
      {REASONS.map((r) => (
        <SelectRow key={r} title={t(`support.release.reason.${r}`)} selected={reason === r} onPress={() => setReason(r)} />
      ))}
      <TextField value={note} onChangeText={setNote} multiline maxLength={500}
        accessibilityLabel={t('support.release.note')} placeholder={t('support.release.note')} error={error}
        style={{ minHeight: 90, textAlignVertical: 'top' }} />
    </QuestionShell>
  );
}
