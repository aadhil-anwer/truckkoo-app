/**
 * "Anything the driver should know?" — optional, both ends, by `?end=`.
 *
 * Skip has the same weight as Continue: most shippers will not fill this in, and
 * a screen that makes them feel they should is a screen that loses them.
 * Skip clears what was typed, so an abandoned half-number never travels.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { BookingPending } from '@/components/booking/BookingPending';
import { TextField } from '@/components/primitives';
import { SectionLabel } from '@/components/ui';
import { align, t } from '@/i18n';
import { TOTAL_STEPS, isValidPhone, normalizePhone, stepNumber, useBookingDraft } from '@/lib/booking';
import { color, elevation, font, radius, space } from '@/theme/tokens';

export default function PlaceDetails() {
  const { end } = useLocalSearchParams<{ end: 'pickup' | 'drop' }>();
  const pickup = end !== 'drop';
  const router = useRouter();
  const { draft, update, ready } = useBookingDraft();
  const place = pickup ? draft.originPlace : draft.destinationPlace;
  const [touchedPhone, setTouchedPhone] = useState(false);

  // Opened with nothing to pin (a deep link, a draft cleared by a booking in
  // another tab): back to choosing a place, never a blank page with no Back.
  const missing = ready && !place;
  useEffect(() => {
    if (missing) router.replace(pickup ? '/book/origin' : '/book/destination');
  }, [missing, pickup, router]);

  if (!ready || !place) return <BookingPending />;

  const next = pickup ? '/book/destination' : '/book/date';
  const set = (patch: Partial<typeof place>) =>
    update(pickup ? { originPlace: { ...place, ...patch } } : { destinationPlace: { ...place, ...patch } });
  const phoneOk = isValidPhone(place.contactPhone);

  return (
    <QuestionShell
      step={stepNumber(pickup ? 'origin' : 'destination')}
      total={TOTAL_STEPS}
      question={t('places.details.q')}
      helper={t('places.details.help')}
      onBack={() => router.back()}
      cta={t('action.continue')}
      ctaDisabled={!phoneOk}
      onCta={() => {
        set({ contactPhone: normalizePhone(place.contactPhone) });
        router.push(next);
      }}
      tertiary={t('places.details.skip')}
      onTertiary={() => {
        set({ note: '', contactName: '', contactPhone: '' });
        router.push(next);
      }}
    >
      <TextInput
        value={place.note}
        onChangeText={(note) => set({ note })}
        placeholder={t('places.details.note')}
        accessibilityLabel={t('places.details.note')}
        placeholderTextColor={color.mutedText}
        style={styles.note}
        multiline
        maxLength={300}
      />

      <View style={styles.label}>
        <SectionLabel ground="cream">
          {pickup ? t('places.details.someonePickup') : t('places.details.someoneDrop')}
        </SectionLabel>
      </View>
      <TextField
        value={place.contactName}
        onChangeText={(contactName) => set({ contactName })}
        placeholder={t('places.details.name')}
        accessibilityLabel={t('places.details.name')}
        maxLength={80}
      />
      <TextField
        value={place.contactPhone}
        onChangeText={(contactPhone) => {
          setTouchedPhone(true);
          set({ contactPhone });
        }}
        placeholder={t('places.details.phone')}
        accessibilityLabel={t('places.details.phone')}
        keyboardType="phone-pad"
        maxLength={24}
        error={touchedPhone && !phoneOk ? t('places.details.badPhone') : null}
      />
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  note: {
    minHeight: 96,
    borderRadius: radius.row,
    backgroundColor: color.creamCard,
    padding: space.lg,
    ...font.body,
    color: color.inkText,
    textAlign: align.start,
    textAlignVertical: 'top',
    ...elevation.inputCream,
  },
  label: { marginTop: space.lg },
});
