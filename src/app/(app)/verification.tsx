/** Four private photos, one question at a time, then an ops review. */
import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';

import { QuestionShell } from '@/components/booking/shells';
import { SecondaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Notice, Skeleton } from '@/components/ui';
import { align, t } from '@/i18n';
import { getAuthDraft } from '@/lib/auth-draft';
import { reportFailure } from '@/lib/monitoring';
import { looksBlank } from '@/lib/photo-check';
import { useDriverVerification } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { supabase } from '@/lib/supabase';
import { color, font, radius, space } from '@/theme/tokens';

async function bounded<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(operation), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('verification timeout')), 30_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

const KINDS = ['id_front', 'id_back', 'mulkiya', 'truck_photo'] as const;

export default function Verification() {
  const router = useRouter();
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  const docs = useDriverVerification();
  const documents = docs.data?.documents;

  const kind = KINDS[index];
  const existing = documents?.find((d) => d.kind === kind);
  const allSubmitted = KINDS.every((k) => documents?.some((d) => d.kind === k && d.status !== 'rejected'));

  async function pick(camera: boolean) {
    if (busy) return;
    setError(null);
    if (camera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) { setError(t('trip.photo.denied')); return; }
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!result.canceled && result.assets[0]) setPhoto(result.assets[0]);
  }

  async function upload() {
    if (!kind || !photo || busy) return;
    setBusy(true); setError(null);
    try {
      if (photo.fileSize != null && photo.fileSize > 8 * 1024 * 1024) {
        setError(t('auth.verify.size')); return;
      }
      const suffix = (photo.fileName ?? photo.uri).split(/[?#]/)[0].split('.').pop()?.toLowerCase();
      const mime = photo.mimeType ?? (suffix === 'png' ? 'image/png' : suffix === 'webp' ? 'image/webp'
        : suffix === 'jpg' || suffix === 'jpeg' ? 'image/jpeg' : undefined);
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : null;
      if (!ext) { setError(t('auth.verify.format')); return; }
      const { data: session } = await bounded(supabase.auth.getSession());
      const uid = session.session?.user.id;
      if (!uid) throw new Error('missing session');
      const path = `${uid}/${kind}/${randomUUID()}.${ext}`;
      const bytes = await bounded(fetch(photo.uri).then((r) => r.arrayBuffer()));
      if (bytes.byteLength > 8 * 1024 * 1024) { setError(t('auth.verify.size')); return; }
      if (looksBlank({ mime, bytes: bytes.byteLength, width: photo.width, height: photo.height })) {
        setError(t('auth.verify.blank')); return;
      }
      const { error: uploadError } = await bounded(supabase.storage.from('driver-verification')
        .upload(path, bytes, { contentType: mime, upsert: false }));
      if (uploadError) throw uploadError;
      const { error: submitError } = await bounded(supabase.rpc('submit_driver_document', {
        p_kind: kind, p_object_path: path,
      }));
      if (submitError) throw submitError;
      setPhoto(null);
      void docs.refetch();
      if (index < KINDS.length - 1) setIndex(index + 1);
    } catch (e) {
      reportFailure('submit_driver_document', e);
      setError(t('auth.verify.unavailable'));
    } finally { setBusy(false); }
  }

  function finish() {
    router.replace(getAuthDraft().role === 'driver' ? '/done' : '/driver');
  }

  if (!documents) return <View style={styles.loading}>{docs.isPending
    ? <Skeleton height={180} round={radius.review} />
    : <SecondaryButton label={t('common.retry')} onPress={() => { void docs.refetch(); }} />}</View>;
  return (
    <QuestionShell
      step={index + 1} total={KINDS.length}
      question={t(`auth.verify.${kind}`)} helper={t('auth.verify.help')}
      onBack={() => { if (!busy) { setPhoto(null); setError(null); if (index > 0) setIndex(index - 1); else finish(); } }}
      cta={photo ? t('auth.verify.upload') : existing && existing.status !== 'rejected' ? t('action.continue') : t('auth.verify.camera')}
      ctaLoading={busy}
      onCta={() => photo ? void upload() : existing && existing.status !== 'rejected'
        ? index < KINDS.length - 1 ? setIndex(index + 1) : finish()
        : void pick(true)}
      tertiary={busy ? undefined : photo ? t('auth.verify.change') : t('auth.verify.gallery')}
      onTertiary={() => void pick(false)}
    >
      <View style={styles.body}>
        {photo && <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="contain" />}
        {existing && <Notice icon="info">{t(`auth.verify.status.${existing.status}`)}</Notice>}
        {existing?.status === 'rejected' && !!existing.review_note &&
          <Text style={[arabicIfNeeded(font.bodySmall), styles.note]}>{safeText(existing.review_note)}</Text>}
        {!!error && <Text style={[arabicIfNeeded(font.bodySmall), styles.error]}>{error}</Text>}
        {allSubmitted && !busy && <SecondaryButton label={t('auth.verify.done')} onPress={finish} />}
      </View>
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', backgroundColor: color.cream, padding: space.lg },
  body: { gap: space.md },
  preview: { width: '100%', height: 220, backgroundColor: color.creamCard, borderRadius: radius.review },
  note: { color: color.inkText, textAlign: align.start },
  error: { color: color.danger, textAlign: align.start },
});
