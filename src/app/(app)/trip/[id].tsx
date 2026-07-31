/**
 * D7 · On the job.
 *
 * ONE SCREEN, ONE ACTION, SIZED FOR A CAB. The primary is 64px because it is
 * pressed by a thumb, one-handed, in sunlight, by someone who has just climbed
 * out of a truck. Everything else on this screen is reading material.
 *
 * `DROP AT` and `YOU EARN` sit together because they are the two facts a driver
 * checks at the gate: where this ends, and what it pays. The payout comes from
 * `driver_trip()` — the commission is applied in SQL, next to the price it
 * derives from, and never here.
 *
 * DELIVERY REQUIRES A PHOTO, and the database enforces that too: `advance_trip`
 * raises if `p_photo_path` is empty on the delivering transition. The upload
 * goes to a private bucket under `<trip_id>/…`, which is exactly what the
 * storage policies authorise against, and there is no update or delete policy —
 * proof of delivery is append-only, because a trail that can be edited is not a
 * trail.
 *
 * THE MAP CLAIMS NO LIVE FIX. T4 interpolates the truck on elapsed time because
 * a shipper has no other signal; a driver knows exactly where they are, so the
 * marker here says only "in transit" and sits at the midpoint. P6 owns GPS.
 */

import { useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';

import { DriverMoney } from '@/components/driver/Money';
import { Icon } from '@/components/icon';
import { BackButton, PressableSurface, PrimaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { SectionLabel, Sheet, Skeleton, StatusPill } from '@/components/ui';
import { CityPin, Corridor, MapCanvas, Scrim, TruckMarker } from '@/map';
import { align, localized, t } from '@/i18n';
import { formatWeight } from '@/lib/format';
import { cityIndex, useAdvanceTrip, useCities, useDriverTrip, type City } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { supabase } from '@/lib/supabase';
import { face } from '@/theme/faces';
import {
  GUTTER_SHEET,
  alpha,
  color,
  font,
  hairline,
  radius,
  space,
} from '@/theme/tokens';

const MAP_HEIGHT = 380;

export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: mapWidth } = useWindowDimensions();

  const cities = useCities();
  const job = useDriverTrip(id);
  const advance = useAdvanceTrip();

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const index = useMemo(() => cityIndex(cities.data), [cities.data]);
  const trip = job.data;

  const origin = trip ? index.get(trip.origin_city) : undefined;
  const dest = trip ? index.get(trip.dest_city) : undefined;

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
      await advance.mutateAsync({ tripId: id, to: 'in_transit' });
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
      // The path's first segment is the trip id — the storage policies authorise
      // on exactly that, so it is not a naming convention, it is the check.
      const path = `${id}/${Date.now()}.jpg`;
      const bytes = await fetch(photoUri).then((r) => r.arrayBuffer());

      const { error: uploadError } = await supabase.storage
        .from('pod')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });

      if (uploadError) throw uploadError;

      await advance.mutateAsync({ tripId: id, to: 'delivered', photoPath: path });
      router.replace('/driver');
    } catch {
      setError(t('error.generic'));
    } finally {
      setUploading(false);
    }
  }

  if (job.isPending) {
    return (
      <View style={styles.screen}>
        <View style={[styles.loading, { paddingTop: insets.top + space.huge }]}>
          <Skeleton height={240} round={radius.card} />
          <Skeleton height={140} round={radius.card} />
        </View>
      </View>
    );
  }

  // Not found and not-yours are the same thing to the client, because the
  // function returns no row either way (SECURITY.md §3).
  if (!trip) {
    return (
      <View style={styles.screen}>
        <View style={[styles.gone, { paddingTop: insets.top + space.lg }]}>
          <BackButton onPress={() => router.back()} />
          <Text style={styles.goneText}>{t('common.error.title')}</Text>
        </View>
      </View>
    );
  }

  const collected = trip.status === 'in_transit';

  return (
    <View style={styles.screen}>
      <View style={styles.mapArea} pointerEvents="none">
        {mapWidth > 0 && (
          <>
            <MapCanvas framing="domestic" width={mapWidth} height={MAP_HEIGHT}>
              {origin && dest && (
                <>
                  {/* Committed: the driver has this load. */}
                  <Corridor
                    from={{ lng: origin.lng, lat: origin.lat }}
                    to={{ lng: dest.lng, lat: dest.lat }}
                    committed
                  />
                  <CityPin at={{ lng: origin.lng, lat: origin.lat }} state="origin" />
                  <CityPin at={{ lng: dest.lng, lat: dest.lat }} state="destination" />
                  {/* No GPS. A guess drawn as a fix is the one thing a driver
                      would catch immediately, since they know where they are. */}
                  {collected && (
                    <TruckMarker at={midpoint(origin, dest)} />
                  )}
                </>
              )}
            </MapCanvas>
            <Scrim variant="topHeavy" width={mapWidth} height={MAP_HEIGHT} />
          </>
        )}
      </View>

      <View style={[styles.nav, { paddingTop: insets.top + space.sm }]}>
        <BackButton onPress={() => router.back()} />
        <StatusPill
          label={collected ? t('status.in_transit') : t('status.assigned')}
          tone="accent"
        />
      </View>

      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={styles.sheetContent}
        showsVerticalScrollIndicator={false}
      >
        <Sheet style={{ paddingBottom: insets.bottom + space.xl }}>
          <View style={styles.factRow}>
            <View style={styles.fact}>
              <SectionLabel>{t('drv.job.dropAt')}</SectionLabel>
              <Text style={styles.factValue}>{dest ? localized(dest) : '—'}</Text>
            </View>
            <View style={styles.fact}>
              <SectionLabel>{t('drv.job.youEarn')}</SectionLabel>
              <DriverMoney
                payout={trip.payout_baisa}
                collect={trip.collect_baisa}
                owed={trip.owed_baisa}
                currency={trip.currency}
                size="row"
              />
            </View>
          </View>

          <View style={styles.cargo}>
            <Text style={styles.cargoLabel}>{t('drv.job.carrying')}</Text>
            <Text style={styles.cargoValue}>
              {`${safeText(trip.goods)}${
                trip.weight_kg != null ? ` · ${formatWeight(trip.weight_kg, '')}` : ''
              }`}
            </Text>
          </View>

          {/* One 44px circle. The shipper is a contact here, not a profile. */}
          {!!trip.shipper_phone && (
            <View style={styles.contact}>
              <View style={styles.contactText}>
                <Text style={styles.contactName} numberOfLines={1}>
                  {trip.shipper_name ?? ''}
                </Text>
              </View>
              <PressableSurface
                onPress={() => Linking.openURL(`tel:${trip.shipper_phone}`)}
                accessibilityLabel={t('drv.job.call')}
                style={styles.call}
              >
                <Icon name="phone" size={20} tint={color.ink} />
              </PressableSurface>
            </View>
          )}

          {collected && (
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
          )}

          {!!error && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}

          {/* The one target. 64px, and nothing beside it competing for the thumb.
              It is NOT disabled without a photo: a dead button teaches a driver
              the app is broken, where a press that says what is missing teaches
              them what to do next. The guard is in the handler, and in the
              database behind it. */}
          <View style={styles.action}>
            {collected ? (
              <PrimaryButton
                label={uploading ? t('trip.uploading') : t('drv.job.delivered')}
                tall
                onPress={confirmDelivered}
                loading={uploading || advance.isPending}
              />
            ) : (
              <PrimaryButton
                label={t('trip.collect.action')}
                tall
                onPress={confirmCollected}
                loading={advance.isPending}
              />
            )}
          </View>
        </Sheet>
      </ScrollView>
    </View>
  );
}

/**
 * Halfway. Not a position — a placeholder for one.
 *
 * T4 interpolates on elapsed time because a shipper has no other signal. A
 * driver knows exactly where they are, so animating a fake progress at them
 * would be the app telling them something they can disprove out of the
 * windscreen. The marker says "in transit", nothing more, until P6 brings GPS.
 */
function midpoint(a: City, b: City) {
  return { lng: (a.lng + b.lng) / 2, lat: (a.lat + b.lat) / 2 };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  mapArea: {
    position: 'absolute',
    top: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    height: MAP_HEIGHT,
  },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GUTTER_SHEET,
  },

  loading: { paddingHorizontal: GUTTER_SHEET, gap: space.lg },
  gone: { paddingHorizontal: GUTTER_SHEET, gap: space.xxl },
  goneText: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start },

  sheetScroll: { flex: 1 },
  sheetContent: { flexGrow: 1, justifyContent: 'flex-end' },

  factRow: { flexDirection: 'row', gap: space.xl, flexWrap: 'wrap' },
  fact: { gap: 2, minWidth: 120 },
  factValue: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start },

  cargo: {
    gap: 2,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: hairline.inner,
  },
  cargoLabel: { ...arabicIfNeeded(font.caption), color: alpha.onInk.label, textAlign: align.start },
  cargoValue: { ...arabicIfNeeded(font.body), color: color.lightText, textAlign: align.start },

  contact: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  contactText: { flex: 1 },
  contactName: { ...arabicIfNeeded(font.rowTitle), color: color.lightText, textAlign: align.start },
  call: {
    width: 44,
    height: 44,
    borderRadius: radius.round,
    backgroundColor: color.lightText,
    alignItems: 'center',
    justifyContent: 'center',
  },

  shot: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.card,
    backgroundColor: color.raised,
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
  shotLabel: { ...font.title, color: color.lightText },
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

  error: { ...arabicIfNeeded(font.bodySmall), color: color.dangerLight, textAlign: align.start },
  action: { marginTop: space.sm },
});
