/**
 * S8 · Roughly how heavy?
 *
 * OPTIONAL, and the skip is a real path — it posts NULL and does not hold up a
 * price. The handoff says so in the helper, and a screen that then required a
 * number would be contradicting its own copy.
 *
 * Weight is entered in whole kilograms. It is not money, so it does not go
 * through money.ts — but it is a numeral, so it is rendered through
 * `formatNumber` like every other one.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { QuestionShell } from '@/components/booking/shells';
import { Chip, StatusPill } from '@/components/ui';
import { TOTAL_STEPS, stepNumber, useBookingDraft } from '@/lib/booking';
import { BIDDING } from '@/lib/features';
import { align, formatNumber, t } from '@/i18n';
import { color, elevation, font, radius, space } from '@/theme/tokens';

/** The tonnages Truckkoo actually moves, not a round-number ramp. */
const QUICK = [1000, 3000, 8000, 15000, 20000];

export default function Weight() {
  const router = useRouter();
  const { draft, update, ready } = useBookingDraft();
  if (!ready) return null;

  const value = draft.weightKg;
  // Bid loads ask one more, optional, question: the most the shipper will pay.
  const next = BIDDING ? '/book/target' : '/book/review';

  function setFromText(text: string) {
    const digits = text.replace(/[^0-9]/g, '');
    if (digits === '') return update({ weightKg: null });
    // The column's own bound. Clamping here beats a failed post later.
    update({ weightKg: Math.min(Number(digits), 60000) });
  }

  return (
    <QuestionShell
      step={stepNumber('weight')}
      total={TOTAL_STEPS}
      question={t('book.weight.q')}
      // With "let us choose", the weight is what picks the truck — and so what
      // makes an instant price possible (0036). Skipping stays allowed; it just
      // means a person prices it, and the shipper is told that before choosing.
      // Under bidding there is no instant price for the weight to unlock, so
      // the plain helper is the true one.
      helper={t(
        !BIDDING && draft.truckPreference === 'auto' ? 'book.weight.helpInstant' : 'book.weight.help',
      )}
      above={
        <View style={styles.pill}>
          <StatusPill label={t('book.weight.optional')} tone="neutral" />
        </View>
      }
      onBack={() => router.back()}
      cta={t('book.weight.cta')}
      onCta={() => router.push(next)}
      tertiary={t('book.weight.skip')}
      onTertiary={() => {
        // Skipping CLEARS any typed value, so "skip" means what it says rather
        // than silently posting a half-entered number.
        update({ weightKg: null });
        router.push(next);
      }}
    >
      <View style={styles.card}>
        <TextInput
          value={value == null ? '' : String(value)}
          onChangeText={setFromText}
          keyboardType="number-pad"
          placeholder="0"
          placeholderTextColor={color.mutedText}
          style={styles.value}
          maxLength={5}
        />
        <Text style={styles.unit}>{t('book.weight.unit')}</Text>
      </View>

      <View style={styles.chips}>
        {QUICK.map((kg) => (
          <Chip
            key={kg}
            label={formatNumber(kg)}
            ground="cream"
            selected={value === kg}
            onPress={() => update({ weightKg: kg })}
          />
        ))}
      </View>
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  pill: { marginBottom: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.creamCard,
    borderRadius: radius.input,
    paddingHorizontal: space.xl,
    paddingVertical: space.lg,
    ...elevation.inputCream,
  },
  value: {
    flex: 1,
    ...font.display,
    color: color.inkText,
    textAlign: align.start,
  },
  unit: { ...font.title, color: color.mutedText },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
});
