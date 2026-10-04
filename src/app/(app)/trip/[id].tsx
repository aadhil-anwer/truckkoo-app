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
 * THE MARKER IS A REPORTED POSITION OR NOTHING. It is the driver's own last
 * fix, sent from this screen while the trip is live, dimmed once it is more than
 * half an hour old. Nothing is interpolated anywhere in the product since P6.
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
import { DriverPlaceDetails } from '@/components/driver/PlaceDetails';
import { Icon } from '@/components/icon';
import { BackButton, PressableSurface, PrimaryButton, SecondaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { SectionLabel, Sheet, Skeleton, StatusPill } from '@/components/ui';
import { CityPin, Corridor, MapCanvas, Scrim, TruckMarker, framingFor, useMapBand } from '@/map';
import { align, localized, t, type StringKey } from '@/i18n';
import { formatAge, formatWeight } from '@/lib/format';
import { cityIndex, placeOf, useAdvanceTrip, useCities, useDriverTrip, useTripPosition } from '@/lib/queries';
import { directionsLink, safeText } from '@/lib/safe-text';
import { reportFailure } from '@/lib/monitoring';
import { supabase } from '@/lib/supabase';
import { face } from '@/theme/faces';
import {
  GUTTER_SHEET,
  MIN_TARGET,
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

  const live = trip?.status === 'in_transit';
  const position = useTripPosition(live ? id : undefined, { live: true });
  // The background task (0039) reports, with the app open or not; D7 only reads
  // what the server holds, so "last sent" is true even after the app was closed.
  const lastSentAt = position.data?.seen_at ?? null;

  const origin = trip ? index.get(trip.origin_city) : undefined;
  const dest = trip ? index.get(trip.dest_city) : undefined;

  // The truck counts toward the framing: one the picture leaves out is a truck
  // the driver cannot see themselves on.
  const band = useMapBand();
  const truckAt =
    position.data?.lat != null && position.data.lng != null
      ? { lng: position.data.lng, lat: position.data.lat }
      : undefined;
  const framing = framingFor([origin, dest, truckAt]);
  const mapFit = { top: insets.top + space.sm + MIN_TARGET, bottom: band.sheetTop };

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
    // Which half failed: the upload is reported here, advance_trip by the
    // mutation cache — never both.
    let uploaded = false;
    try {
      // The path's first segment is the trip id — the storage policies authorise
      // on exactly that, so it is not a naming convention, it is the check.
      const path = `${id}/${Date.now()}.jpg`;
      const bytes = await fetch(photoUri).then((r) => r.arrayBuffer());

      const { error: uploadError } = await supabase.storage
        .from('pod')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });

      if (uploadError) throw uploadError;
      uploaded = true;

      await advance.mutateAsync({ tripId: id, to: 'delivered', photoPath: path });
      router.replace('/driver');
    } catch (e) {
      if (!uploaded) reportFailure('upload_pod', e);
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
  // A finished job is a record, opened from Past trips: nothing left to press.
  // Without this the screen offered "collected" on a delivered load, and the
  // server refused the transition — a button that could only ever fail.
  const done =
    trip.status === 'delivered' || trip.status === 'closed' || trip.status === 'cancelled';
  // Where the driver is headed next: the pickup until the load is on board, then
  // the drop-off. The pinned gate when the shipper gave one (0041), else the
  // city — and the label names whichever it is, promising no more than that.
  const pickupPlace = placeOf(trip as unknown as Record<string, unknown>, 'pickup');
  const dropPlace = placeOf(trip as unknown as Record<string, unknown>, 'drop');
  const nextPlace = done ? null : collected ? dropPlace : pickupPlace;
  const nextStop = done ? undefined : collected ? dest : origin;
  const target = nextPlace ?? nextStop;
  const directions = target ? directionsLink(target.lat, target.lng) : null;
  const directionsName = nextPlace?.name ?? (nextStop ? localized(nextStop) : '');

  return (
    <View style={styles.screen}>
      <View style={styles.mapArea} pointerEvents="none">
        {mapWidth > 0 && (
          <>
            <MapCanvas framing={framing} width={mapWidth} height={MAP_HEIGHT} fit={mapFit}>
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
                  {/* A reported position or nothing. A guess drawn as a fix is
                      the one thing a driver would catch immediately, since they
                      know where they are. */}
                  {position.data?.lat != null && position.data.lng != null && (
                    <TruckMarker
                      at={{ lng: position.data.lng, lat: position.data.lat }}
                      stale={isStale(position.data.seen_at)}
                    />
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
          label={t(`status.${trip.status}` as StringKey)}
          // The accent is the live state. A finished job has none.
          tone={done ? 'neutral' : 'accent'}
        />
      </View>

      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={styles.sheetContent}
        showsVerticalScrollIndicator={false}
        onLayout={band.onScrollLayout}
      >
        <View onLayout={band.onSheetLayout}>
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

          {pickupPlace && <DriverPlaceDetails label={t('book.dest.pickup')} place={pickupPlace} />}
          {dropPlace && <DriverPlaceDetails label={t('book.dest.deliver')} place={dropPlace} />}

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

          {collected && !done && (
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

          {/* Stated while it is happening, and gone when it stops — which is
              also when the database stops accepting fixes. There is no toggle:
              the OS permission is the real control, and a switch would give the
              shipper a truck that vanishes for reasons they cannot see. */}
          {live && (
            <View style={styles.sharing}>
              <Text style={styles.sharingTitle}>{t('pos.sharing')}</Text>
              <Text style={styles.sharingWhy}>{t('pos.sharingWhy')}</Text>
              {!!formatAge(lastSentAt) && (
                <Text style={styles.sharingWhy}>
                  {t('pos.lastSentAgo', { age: formatAge(lastSentAt) ?? '' })}
                </Text>
              )}
            </View>
          )}

          {/* The one target. 64px, and nothing beside it competing for the thumb.
              It is NOT disabled without a photo: a dead button teaches a driver
              the app is broken, where a press that says what is missing teaches
              them what to do next. The guard is in the handler, and in the
              database behind it. */}
          {!done && (
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
              {/* Secondary, and below: the primary keeps the accent and the
                  thumb. Navigating is Google's job — the app hands over. */}
              {directions && !!directionsName && (
                <View style={styles.directions}>
                  <SecondaryButton
                    label={t('drv.trip.directionsTo', { city: safeText(directionsName) })}
                    icon="dropoff"
                    onPress={() => Linking.openURL(directions).catch(() => {})}
                  />
                </View>
              )}
            </View>
          )}
        </Sheet>
        </View>
      </ScrollView>
    </View>
  );
}

/** Older than half an hour. The marker dims; the timestamp says how much older. */
const STALE_MS = 30 * 60_000;

function isStale(seenAt: string | null | undefined): boolean {
  if (!seenAt) return true;
  return Date.now() - new Date(seenAt).getTime() > STALE_MS;
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

  sharing: {
    gap: 2,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: hairline.inner,
  },
  sharingTitle: {
    ...arabicIfNeeded(font.rowTitle),
    color: color.lightText,
    textAlign: align.start,
  },
  sharingWhy: {
    ...arabicIfNeeded(font.bodySmall),
    color: alpha.onInk.secondary,
    textAlign: align.start,
  },

  error: { ...arabicIfNeeded(font.bodySmall), color: color.dangerLight, textAlign: align.start },
  action: { marginTop: space.sm },
  directions: { marginTop: space.md },
});
