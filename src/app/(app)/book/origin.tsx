/**
 * S3 · Where is the cargo now?
 *
 * Map plus sheet. The pins are tappable because the helper promises they are —
 * "Tap a city on the map, or search for it" — so a decorative map here would be
 * a screen that lies.
 */
import { useRouter } from 'expo-router';
import { ScrollView, Text, View, StyleSheet } from 'react-native';

import { MapStepShell } from '@/components/booking/shells';
import { CityList } from '@/components/booking/CityList';
import { PrimaryButton } from '@/components/primitives';
import { QuestionHeading } from '@/components/ui';
import { CityPin } from '@/map';
import { TOTAL_STEPS, stepNumber, useBookingDraft } from '@/lib/booking';
import { cityIndex, useCities } from '@/lib/queries';
import { align, t } from '@/i18n';
import { arabicIfNeeded } from '@/components/text-direction';
import { color, font, space } from '@/theme/tokens';

export default function Origin() {
  const router = useRouter();
  const { draft, update, ready } = useBookingDraft();
  const { data: cities } = useCities();

  const index = cityIndex(cities);
  const chosen = draft.originCityId != null ? index.get(draft.originCityId) : undefined;

  if (!ready) return null;

  return (
    <MapStepShell
      step={stepNumber('origin')}
      total={TOTAL_STEPS}
      framing="domestic"
      onBack={() => router.back()}
      overlay={() =>
        (cities ?? []).map((c) => (
          <CityPin
            key={c.id}
            at={{ lng: c.lng, lat: c.lat }}
            state={c.id === draft.originCityId ? 'selected' : 'idle'}
            label={c.name_en}
            onPress={() => update({ originCityId: c.id })}
          />
        ))
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <QuestionHeading ground="ink" size="question">
          {t('book.origin.q')}
        </QuestionHeading>
        <Text style={styles.help}>{t('book.origin.help')}</Text>

        <View style={styles.list}>
          <CityList
            cities={cities ?? []}
            selectedId={draft.originCityId}
            onSelect={(c) => update({ originCityId: c.id })}
            excludeId={draft.destinationCityId}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          // The label restates the choice, so the commit is unambiguous.
          label={chosen ? `${t('book.origin.cta')} — ${chosen.name_en}` : t('action.continue')}
          onPress={() => router.push('/book/destination')}
          disabled={draft.originCityId == null}
        />
      </View>
    </MapStepShell>
  );
}

const styles = StyleSheet.create({
  help: {
    ...arabicIfNeeded(font.body),
    color: 'rgba(247,245,242,.62)',
    textAlign: align.start,
    marginTop: space.xs,
  },
  list: { marginTop: space.lg },
  footer: { paddingTop: space.md, backgroundColor: color.surface },
});
