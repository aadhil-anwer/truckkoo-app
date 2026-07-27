/**
 * Advance a trip. Two transitions live here: collected, and delivered.
 *
 * Delivery requires a photo, and the database enforces that too — `advance_trip`
 * raises if `p_photo_path` is empty on the delivering transition. The upload goes
 * to a private bucket under `<trip_id>/…`, which is exactly what the storage
 * policies authorise against, and there is no update or delete policy: proof of
 * delivery is append-only, because a trail that can be edited is not a trail.
 *
 * The two transitions are separate confirmations rather than one screen with a
 * toggle. A driver tapping the wrong thing here creates a dispute with a customer.
 */

import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { FactRow, NoteBody, NoteFoot, RoutePair } from '@/components/consignment';
import { Masthead } from '@/components/masthead';
import { Body, Button, Note, NoteHead, Stamp, TextButton } from '@/components/primitives';
import { align, localized, t } from '@/i18n';
import { formatWeight, reference } from '@/lib/format';
import { cityIndex, useAdvanceTrip, useCities, useMyTrips, useVisibleLoads } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { supabase } from '@/lib/supabase';
import { color, font, space } from '@/theme/tokens';

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const cities = useCities();
  const trips = useMyTrips();
  const loads = useVisibleLoads();
  const advance = useAdvanceTrip();

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const trip = (trips.data ?? []).find((tr) => tr.id === id);
  const load = trip ? (loads.data ?? []).find((l) => l.id === trip.load_id) : undefined;

  const cityName = (cid: number) => {
    const c = index.get(cid);
    return c ? localized(c) : '—';
  };

  if (trips.isPending || loads.isPending) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={color.orange} />
        </View>
      </SafeAreaView>
    );
  }

  // Not found and not-yours are the same thing to the client, because RLS returns
  // no row either way (SECURITY.md §3).
  if (!trip || !load) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Masthead title={t('common.error.title')} />
        <View style={styles.form}>
          <Body muted>{t('common.error.explain')}</Body>
          <Button label={t('common.back')} variant="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  async function takePhoto() {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError(t('trip.photo.denied'));
      return;
    }

    const shot = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      // Drivers are on bad signal; a 4000px original helps nobody.
      allowsEditing: false,
      mediaTypes: ['images'],
    });

    if (!shot.canceled && shot.assets[0]) setPhotoUri(shot.assets[0].uri);
  }

  async function confirmCollected() {
    setError(null);
    try {
      await advance.mutateAsync({ tripId: trip!.id, to: 'in_transit' });
      router.replace('/driver');
    } catch {
      setError(t('error.generic'));
    }
  }

  async function confirmDelivered() {
    setError(null);
    if (!photoUri) {
      setError(t('trip.deliver.needPhoto'));
      return;
    }

    setUploading(true);
    try {
      // Path's first segment is the trip id — the storage policies authorise on
      // exactly that, so it is not a naming convention, it is the check.
      const path = `${trip!.id}/${Date.now()}.jpg`;
      const bytes = await fetch(photoUri).then((r) => r.arrayBuffer());

      const { error: uploadError } = await supabase.storage
        .from('pod')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });

      if (uploadError) throw uploadError;

      await advance.mutateAsync({ tripId: trip!.id, to: 'delivered', photoPath: path });
      router.replace('/driver');
    } catch {
      setError(t('error.generic'));
    } finally {
      setUploading(false);
    }
  }

  const collected = trip.status === 'in_transit';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Masthead
        title={t('trip.title')}
        action={<TextButton label={t('common.back')} onPress={() => router.back()} />}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.block}>
          <Note>
            <NoteHead
              left={t('label.load')}
              right={
                <Stamp tone="active">
                  {collected ? t('status.in_transit') : t('status.assigned')}
                </Stamp>
              }
            />
            <NoteBody>
              <RoutePair
                from={cityName(load.origin_city)}
                to={cityName(load.dest_city)}
                labelFrom={t('label.from')}
                labelTo={t('label.to')}
              />
              <Body>{safeText(load.goods_description)}</Body>
              <FactRow
                facts={[
                  {
                    label: t('label.weight'),
                    value: formatWeight(load.weight_kg, t('weight.unset')),
                  },
                ]}
              />
            </NoteBody>
            <NoteFoot reference={reference(load.id)} />
          </Note>
        </View>

        <View style={styles.form}>
          {!collected ? (
            <>
              <Text style={styles.stepTitle}>{t('trip.collect.title')}</Text>
              <Body muted>{t('trip.collect.explain')}</Body>
              <Button
                label={t('trip.collect.action')}
                onPress={confirmCollected}
                loading={advance.isPending}
              />
            </>
          ) : (
            <>
              <Text style={styles.stepTitle}>{t('trip.deliver.title')}</Text>
              <Body muted>{t('trip.deliver.explain')}</Body>

              {photoUri && (
                <Image
                  source={{ uri: photoUri }}
                  style={styles.preview}
                  accessibilityLabel={t('trip.deliver.photo')}
                />
              )}

              <Button
                label={photoUri ? t('trip.deliver.retake') : t('trip.deliver.photo')}
                variant="secondary"
                onPress={takePhoto}
                disabled={uploading}
              />

              <Button
                label={uploading ? t('trip.uploading') : t('trip.deliver.action')}
                onPress={confirmDelivered}
                loading={uploading || advance.isPending}
                disabled={!photoUri}
              />
            </>
          )}

          {!!error && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.paper },
  scroll: { paddingBottom: space.huge },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  block: { paddingHorizontal: space.xl, paddingTop: space.xl },
  form: { paddingHorizontal: space.xl, paddingTop: space.xxl, gap: space.md },
  stepTitle: { ...font.title, color: color.ink, textAlign: align.start },
  preview: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.paperDeep,
  },
  error: { ...font.bodySmall, color: color.danger, textAlign: align.start },
});
