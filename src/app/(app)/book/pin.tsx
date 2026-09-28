/**
 * "Put the pin on the gate" — pickup or drop-off, by `?end=`.
 *
 * The shipper arrived here from a search result or their current location. The
 * map moves under a fixed pin; when it settles, the phone names the spot and the
 * SERVER names the city (`city_near`) — the same rule book_load checks, so what
 * is confirmed here cannot be refused later.
 *
 * Confirm stays disabled until the server has answered, and it stays disabled
 * when both ends land in one city: loads_not_circular forbids that, and saying
 * so here beats failing on the review screen.
 */
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PinAdjustMap } from '@/components/booking/PinAdjustMap';
import { BackButton, PrimaryButton, SecondaryButton, TertiaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { Notice, QuestionHeading } from '@/components/ui';
import { align, localized, t } from '@/i18n';
import { useBookingDraft } from '@/lib/booking';
import { cityNear, nameAt } from '@/lib/places';
import { cityIndex, useCities } from '@/lib/queries';
import { safeText, whatsappLink } from '@/lib/safe-text';
import { alpha, color, font, radius, space } from '@/theme/tokens';

const SETTLE_MS = 400;

export default function Pin() {
  const { end } = useLocalSearchParams<{ end: 'pickup' | 'drop' }>();
  const pickup = end !== 'drop';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { draft, update, ready } = useBookingDraft();
  const { data: cities } = useCities();
  const index = cityIndex(cities);

  const place = pickup ? draft.originPlace : draft.destinationPlace;
  const otherCityId = pickup ? draft.destinationCityId : draft.originCityId;

  // Until the map has settled somewhere, the spot is the stored place — derived,
  // not copied into state, so it is right on the first render after the draft loads.
  const [moved, setMoved] = useState<{ lat: number; lng: number } | null>(null);
  // What the server and the geocoder said, and WHERE they said it. An answer
  // counts only for the point it was asked about, so a slow reply for the last
  // drag can never name or place this one — and "checking" is simply "no answer
  // for this point yet", which cannot get stuck when the map re-reports a spot.
  const [checked, setChecked] = useState<{
    lat: number;
    lng: number;
    cityId: number | null;
    name: string | null;
  } | null>(null);
  const centre = moved ?? (place ? { lat: place.lat, lng: place.lng } : null);
  const lat = centre?.lat;
  const lng = centre?.lng;
  const answer = checked && checked.lat === lat && checked.lng === lng ? checked : null;
  const checking = answer == null;
  const cityId = answer?.cityId ?? null;
  // Unmoved, the name is the one the shipper picked (Google's "Lulu Hypermarket"
  // beats the phone's street address). Moved, it is the geocoder's name for the
  // new point or none — never the old name kilometres away.
  const name = moved == null ? (place?.placeName ?? null) : (answer?.name ?? null);

  useEffect(() => {
    if (lat == null || lng == null) return;
    let alive = true;
    const timer = setTimeout(async () => {
      const [city, spot] = await Promise.all([cityNear(lat, lng), nameAt(lat, lng)]);
      if (alive) setChecked({ lat, lng, cityId: city, name: spot || null });
    }, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [lat, lng]);

  if (!ready || !place) return null;

  const city = cityId != null ? index.get(cityId) : undefined;
  const sameCity = cityId != null && cityId === otherCityId;
  const unchecked = !checking && cityId == null;

  function confirm() {
    if (!centre || cityId == null || !place) return;
    const next = { ...place, lat: centre.lat, lng: centre.lng, placeName: name };
    update(
      pickup
        ? { originPlace: next, originCityId: cityId }
        : {
            destinationPlace: next,
            destinationCityId: cityId,
            ...(city ? { destinationCountry: city.country as 'OM' | 'AE' | 'SA' } : {}),
          },
    );
    router.push({ pathname: '/book/place-details', params: { end: pickup ? 'pickup' : 'drop' } });
  }

  return (
    <View style={styles.screen}>
      <PinAdjustMap initial={{ lat: place.lat, lng: place.lng }} onSettle={setMoved} />

      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <BackButton onPress={() => router.back()} />
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <QuestionHeading ground="ink" size="question">{t('places.pin.q')}</QuestionHeading>
        <Text style={styles.help}>{t('places.pin.help')}</Text>

        <Text style={styles.name} numberOfLines={2}>{name ? safeText(name) : t('places.pin.unnamed')}</Text>
        {city && <Text style={styles.near}>{t('places.pin.near', { city: localized(city) })}</Text>}

        {sameCity && city && (
          <View style={styles.gap}>
            <Notice icon="info">{t('places.pin.sameCity', { city: localized(city) })}</Notice>
            <SecondaryButton
              label={t('whatsapp.action')}
              icon="whatsapp"
              onPress={() => Linking.openURL(whatsappLink()).catch(() => {})}
            />
          </View>
        )}
        {unchecked && (
          <View style={styles.gap}>
            <Notice icon="info">{t('places.pin.noCity')}</Notice>
            <TertiaryButton label={t('places.pin.chooseCity')} onPress={() => router.back()} />
          </View>
        )}

        <View style={styles.gap}>
          <PrimaryButton
            label={pickup ? t('places.pin.confirmPickup') : t('places.pin.confirmDrop')}
            onPress={confirm}
            disabled={checking || cityId == null || sameCity}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ink },
  top: { position: 'absolute', top: 0, insetInlineStart: space.lg },
  sheet: {
    position: 'absolute',
    bottom: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    backgroundColor: color.surface,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    borderTopStartRadius: radius.sheet,
    borderTopEndRadius: radius.sheet,
  },
  help: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.tertiary, textAlign: align.start, marginTop: space.xs },
  name: { ...arabicIfNeeded(font.title), color: color.lightText, textAlign: align.start, marginTop: space.md },
  near: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.body, textAlign: align.start, marginTop: 2 },
  gap: { marginTop: space.md, gap: space.sm },
});
