/** A durable report to dispatch, including assigned-load cancellation requests. */
import { useState } from 'react';
import { Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { QuestionShell } from '@/components/booking/shells';
import { SelectRow, TextField } from '@/components/primitives';
import { t } from '@/i18n';
import { reportFailure } from '@/lib/monitoring';
import { supabase } from '@/lib/supabase';

const KINDS = ['delay', 'breakdown', 'damage', 'other'] as const;
type Kind = typeof KINDS[number];

export default function ShipmentCase() {
  const { loadId, tripId, cancel } = useLocalSearchParams<{
    loadId?: string; tripId?: string; cancel?: string;
  }>();
  const router = useRouter();
  const queries = useQueryClient();
  const isCancel = cancel === '1';
  const [kind, setKind] = useState<Kind | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (busy || details.trim().length < 10 || (!isCancel && !kind)) return;
    setBusy(true); setError(null);
    try {
      const result = isCancel
        ? await supabase.rpc('request_load_cancellation', {
            p_load_id: loadId, p_reason: details.trim(),
          })
        : await supabase.rpc('report_shipment_problem', {
            p_load_id: loadId ?? null, p_trip_id: tripId ?? null,
            p_kind: kind, p_details: details.trim(),
          });
      if (result.error) throw result.error;
      for (const key of ['loads', 'load', 'trips', 'trip']) {
        void queries.invalidateQueries({ queryKey: [key] });
      }
      Alert.alert(isCancel
        ? result.data === true ? t('case.cancel.done') : t('case.cancel.queued')
        : t('case.sent'));
      router.back();
    } catch (e) {
      reportFailure('shipment_case', e);
      setError(t('case.error'));
    } finally { setBusy(false); }
  }

  return (
    <QuestionShell step={1} total={1}
      question={isCancel ? t('case.cancel.q') : t('case.q')}
      helper={isCancel ? t('case.cancel.help') : t('case.help')}
      onBack={() => { if (!busy) router.back(); }}
      cta={isCancel ? t('case.cancel.cta') : t('case.cta')}
      ctaDisabled={details.trim().length < 10 || (!isCancel && !kind)}
      ctaLoading={busy} onCta={() => void send()}
    >
      {!isCancel && KINDS.map((item) => (
        <SelectRow key={item} title={t(`case.kind.${item}`)}
          selected={kind === item} onPress={() => setKind(item)} />
      ))}
      <TextField value={details} onChangeText={setDetails} multiline
        maxLength={1000} accessibilityLabel={t('case.details')}
        placeholder={t('case.details')} error={error}
        style={{ minHeight: 120, textAlignVertical: 'top' }} />
    </QuestionShell>
  );
}
