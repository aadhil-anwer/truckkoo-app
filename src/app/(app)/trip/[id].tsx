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
 * toggle. A driver tapping the wrong thing here creates a dispute with a
 * customer, so the screen asks one question at a time, states it as a question,
 * and puts the answer under the thumb.
 */

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';

import { Icon } from '@/components/icon';
import { Screen } from '@/components/ui';
import { align, localized, t } from '@/i18n';
import { formatWeight, reference } from '@/lib/format';
import { cityIndex, useAdvanceTrip, useCities, useMyTrips, useVisibleLoads } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { supabase } from '@/lib/supabase';
import { GUTTER_INK, color, font, radius, space } from '@/theme/tokens';
import { ActionBar, Body, Button, EmptyState, FactChips, PageTitle, RouteLine, Stamp, TopBar } from '@/components/legacy';
import { face } from '@/theme/faces';

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
      <Screen>
        <TopBar onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={color.accent} accessibilityLabel={t('common.loading')} />
        </View>
      </Screen>
    );
  }

  // Not found and not-yours are the same thing to the client, because RLS
  // returns no row either way (SECURITY.md §3).
  if (!trip || !load) {
    return (
      <Screen>
        <TopBar onBack={() => router.back()} />
        <EmptyState
          icon="alert"
          title={t('common.error.title')}
          explain={t('common.error.explain')}
        />
      </Screen>
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
    <Screen>
      <TopBar
        onBack={() => router.back()}
        action={
          <Stamp tone="active">
            {collected ? t('status.in_transit') : t('status.assigned')}
          </Stamp>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* The question is the headline. A driver reads one line here and knows
            what the screen wants. */}
        <PageTitle detail={collected ? t('trip.deliver.explain') : t('trip.collect.explain')}>
          {collected ? t('trip.deliver.title') : t('trip.collect.title')}
        </PageTitle>

        <View style={styles.block}>
          <View style={styles.panel}>
            <RouteLine
              from={cityName(load.origin_city)}
              to={cityName(load.dest_city)}
              labelFrom={t('label.from')}
              labelTo={t('label.to')}
              compact
            />
            <Body>{safeText(load.goods_description)}</Body>
            <FactChips
              facts={[
                {
                  icon: 'weight',
                  label: t('label.weight'),
                  value: formatWeight(load.weight_kg, t('weight.unset')),
                },
                { icon: 'reference', label: t('label.reference'), value: reference(load.id) },
              ]}
            />
          </View>
        </View>

        {/* The photo, as a real target rather than a button labelled "photo".
            A tappable frame is what a camera affordance looks like everywhere
            else on the phone, and it doubles as the preview. */}
        {collected && (
          <View style={styles.block}>
            <Pressable
              onPress={takePhoto}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel={photoUri ? t('trip.deliver.retake') : t('trip.deliver.photo')}
              style={({ pressed }) => [styles.shot, pressed && { opacity: 0.8 }]}
            >
              {photoUri ? (
                <>
                  <Image
                    source={{ uri: photoUri }}
                    style={styles.preview}
                    accessibilityElementsHidden
                  />
                  <View style={styles.retake}>
                    <Icon name="camera" size={18} tint={color.creamCard} />
                    <Text style={styles.retakeText}>{t('trip.deliver.retake')}</Text>
                  </View>
                </>
              ) : (
                <View style={styles.shotEmpty}>
                  <View style={styles.shotIcon}>
                    <Icon name="camera" size={28} tint={color.creamCard} />
                  </View>
                  <Text style={styles.shotLabel}>{t('trip.deliver.photo')}</Text>
                </View>
              )}
            </Pressable>
          </View>
        )}

        {!!error && (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        )}
      </ScrollView>

      <ActionBar>
        {!collected ? (
          <Button
            label={t('trip.collect.action')}
            onPress={confirmCollected}
            loading={advance.isPending}
          />
        ) : (
          <Button
            label={uploading ? t('trip.uploading') : t('trip.deliver.action')}
            onPress={confirmDelivered}
            loading={uploading || advance.isPending}
            disabled={!photoUri}
          />
        )}
      </ActionBar>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.xl, gap: space.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  block: { paddingHorizontal: GUTTER_INK },

  panel: {
    backgroundColor: color.cream,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
  },

  shot: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.card,
    backgroundColor: color.cream,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  shotEmpty: { alignItems: 'center', gap: space.md },
  shotIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.round,
    backgroundColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shotLabel: { ...font.title, color: color.ink },
  preview: { width: '100%', height: '100%' },
  retake: {
    position: 'absolute',
    bottom: space.md,
    insetInlineStart: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(11,11,11,0.78)',
    borderRadius: radius.round,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  retakeText: { ...font.caption, fontFamily: face.archivo700, color: color.creamCard },

  error: {
    ...font.bodySmall,
    color: color.danger,
    textAlign: align.start,
    paddingHorizontal: GUTTER_INK,
  },
});
