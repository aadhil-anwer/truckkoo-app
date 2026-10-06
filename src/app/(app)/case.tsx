/**
 * A durable report to dispatch, including assigned-load cancellation requests.
 *
 * 0065: the problems offered depend on who is reporting — a shipper reports a
 * driver who asked for more money, a driver reports cargo that was not ready —
 * and a report can carry up to four photos, uploaded privately under the
 * reporter's own folder before the report links them.
 */
import { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { QuestionShell } from '@/components/booking/shells';
import { SecondaryButton, SelectRow, TextField } from '@/components/primitives';
import { t } from '@/i18n';
import { reportFailure } from '@/lib/monitoring';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { MIN_TARGET, radius, space } from '@/theme/tokens';

// What each side can report. The database checks the same lists (0065).
const SHIPPER_KINDS = ['delay', 'breakdown', 'damage', 'delivery_dispute', 'price_demand', 'misconduct',
  'no_show', 'change_request', 'app_problem', 'other'] as const;
const DRIVER_KINDS = ['delay', 'breakdown', 'not_ready', 'cargo_mismatch', 'misconduct', 'unreachable',
  'change_request', 'app_problem', 'other'] as const;
type Kind = typeof SHIPPER_KINDS[number] | typeof DRIVER_KINDS[number];
const MAX_PHOTOS = 4;
const MAX_BYTES = 8 * 1024 * 1024;

function extensionFor(photo: ImagePicker.ImagePickerAsset): { ext: string; mime: string } | null {
  const suffix = (photo.fileName ?? photo.uri).split(/[?#]/)[0].split('.').pop()?.toLowerCase();
  const mime = photo.mimeType ?? (suffix === 'png' ? 'image/png' : suffix === 'webp' ? 'image/webp'
    : suffix === 'jpg' || suffix === 'jpeg' ? 'image/jpeg' : undefined);
  if (mime === 'image/png') return { ext: 'png', mime };
  if (mime === 'image/webp') return { ext: 'webp', mime };
  if (mime === 'image/jpeg') return { ext: 'jpg', mime };
  return null;
}

export default function ShipmentCase() {
  const { loadId, tripId, cancel } = useLocalSearchParams<{
    loadId?: string; tripId?: string; cancel?: string;
  }>();
  const router = useRouter();
  const queries = useQueryClient();
  const { profile } = useSession();
  const isCancel = cancel === '1';
  const kinds: readonly Kind[] = tripId && profile?.role === 'driver' ? DRIVER_KINDS : SHIPPER_KINDS;
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [kind, setKind] = useState<Kind | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPhoto() {
    if (busy || photos.length >= MAX_PHOTOS) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!result.canceled && result.assets[0]) setPhotos((p) => [...p, result.assets[0]!].slice(0, MAX_PHOTOS));
  }

  /** Upload each photo under the reporter's own folder; the report links the paths. */
  async function uploadPhotos(): Promise<string[]> {
    if (photos.length === 0) return [];
    const { data: session } = await supabase.auth.getSession();
    const uid = session.session?.user.id;
    if (!uid) throw new Error('missing session');
    const paths: string[] = [];
    for (const photo of photos) {
      const type = extensionFor(photo);
      if (!type) throw new Error('unsupported photo');
      const bytes = await fetch(photo.uri).then((r) => r.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) throw new Error('photo too large');
      const path = `${uid}/${randomUUID()}.${type.ext}`;
      const { error: e } = await supabase.storage.from('case-evidence')
        .upload(path, bytes, { contentType: type.mime, upsert: false });
      if (e) throw e;
      paths.push(path);
    }
    return paths;
  }

  async function send() {
    if (busy || details.trim().length < 10 || (!isCancel && !kind)) return;
    setBusy(true); setError(null);
    try {
      let evidence: string[] = [];
      if (!isCancel) {
        try { evidence = await uploadPhotos(); }
        catch (e) { reportFailure('case_evidence', e); setError(t('case.photo.error')); return; }
      }
      const result = isCancel
        ? await supabase.rpc('request_load_cancellation', {
            p_load_id: loadId, p_reason: details.trim(),
          })
        : await supabase.rpc('report_problem', {
            p_load_id: loadId ?? null, p_trip_id: tripId ?? null,
            p_kind: kind, p_details: details.trim(),
            p_evidence: evidence.length ? evidence : null,
          });
      if (result.error) throw result.error;
      for (const key of ['loads', 'load', 'trips', 'trip', 'reports']) {
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
      {!isCancel && kinds.map((item) => (
        <SelectRow key={item} title={t(`case.kind.${item}`)}
          selected={kind === item} onPress={() => setKind(item)} />
      ))}
      <TextField value={details} onChangeText={setDetails} multiline
        maxLength={1000} accessibilityLabel={t('case.details')}
        placeholder={t('case.details')} error={error}
        style={{ minHeight: 120, textAlignVertical: 'top' }} />
      {!isCancel && (
        <View style={styles.photos}>
          {photos.map((p, i) => (
            <Pressable key={p.uri + i} accessibilityRole="button"
              accessibilityLabel={t('case.photo.remove', { n: String(i + 1) })}
              onPress={() => setPhotos((all) => all.filter((_, j) => j !== i))} style={styles.thumbWrap}>
              <Image source={{ uri: p.uri }} style={styles.thumb} />
            </Pressable>
          ))}
          {photos.length < MAX_PHOTOS && (
            <SecondaryButton label={t('case.photo.add')} onPress={() => void addPhoto()} />
          )}
        </View>
      )}
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  photos: { gap: space.sm, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  thumbWrap: { minWidth: MIN_TARGET, minHeight: MIN_TARGET },
  thumb: { width: 72, height: 72, borderRadius: radius.tile },
});
