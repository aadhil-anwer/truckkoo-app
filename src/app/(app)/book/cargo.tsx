/**
 * S6 · What are we moving?
 *
 * Free text OR a preset, and the presets are plain nouns rather than freight
 * categories — "A car", "A house move". Validation is deliberately permissive:
 * the helper promises "a rough answer is fine", and a form that then rejects one
 * is a form that lied.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, TextInput, View } from 'react-native';

import { QuestionShell } from '@/components/booking/shells';
import { Chip, SectionLabel } from '@/components/ui';
import { TOTAL_STEPS, stepNumber, useBookingDraft } from '@/lib/booking';
import { align, t } from '@/i18n';
import { color, elevation, font, radius, space } from '@/theme/tokens';

/** Plain nouns, not freight categories. Ordered by how often Truckkoo sees them. */
const PRESETS = [
  'Building materials',
  'Furniture',
  'A car',
  'Cement bags',
  'Livestock',
  'Machinery',
  'Steel or pipe',
  'A house move',
];

export default function Cargo() {
  const router = useRouter();
  const { draft, update, ready } = useBookingDraft();
  if (!ready) return null;

  const value = draft.cargoDescription;

  return (
    <QuestionShell
      step={stepNumber('cargo')}
      total={TOTAL_STEPS}
      question={t('book.cargo.q')}
      helper={t('book.cargo.help')}
      onBack={() => router.back()}
      cta={t('action.continue')}
      ctaDisabled={value.trim().length === 0}
      onCta={() => router.push('/book/truck')}
    >
      <TextInput
        value={value}
        onChangeText={(text) => update({ cargoDescription: text })}
        placeholder={t('book.cargo.placeholder')}
        placeholderTextColor={color.mutedText}
        style={styles.field}
        // 500 is the column's own limit. Enforcing it here means the user finds
        // out while typing rather than when the post fails.
        maxLength={500}
        returnKeyType="done"
      />

      <View style={styles.orLabel}>
        <SectionLabel ground="cream">{t('book.cargo.or')}</SectionLabel>
      </View>

      <View style={styles.chips}>
        {PRESETS.map((preset) => (
          <Chip
            key={preset}
            label={preset}
            ground="cream"
            selected={value === preset}
            onPress={() => update({ cargoDescription: preset })}
          />
        ))}
      </View>
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 64,
    borderRadius: radius.row,
    backgroundColor: color.creamCard,
    paddingHorizontal: space.lg,
    ...font.title,
    color: color.inkText,
    textAlign: align.start,
    ...elevation.inputCream,
  },
  orLabel: { marginTop: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
