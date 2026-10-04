/**
 * S8b · What is the most you want to pay? (bidding, 0045)
 *
 * OPTIONAL, like the weight before it, and the skip is a real answer: no limit
 * means the shipper chooses from the prices when bidding closes. With a limit,
 * the server takes the cheapest price at or under it without asking again —
 * which is what lets a shipper post and walk away.
 *
 * NEVER SHOWN TO A DRIVER. The helper says so, because a shipper who thinks
 * drivers can see it will type a low number to bargain, and get no taker.
 *
 * Money is typed as rial and kept as integer baisa (`parseTypedMoney`), with the
 * Arabic keyboard's own digits and decimal mark accepted. Only shown while
 * BIDDING is on — the weight step routes here only then.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { QuestionShell } from '@/components/booking/shells';
import { BookingPending } from '@/components/booking/BookingPending';
import { TextField } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { StatusPill } from '@/components/ui';
import { TOTAL_STEPS, stepNumber, useBookingDraft } from '@/lib/booking';
import { formatAmount, parseTypedMoney } from '@/lib/money';
import { t } from '@/i18n';
import { color, font, space } from '@/theme/tokens';

export default function Target() {
  const router = useRouter();
  const { draft, update, ready } = useBookingDraft();
  // The typed text is kept as typed — "120." is on its way to "120.5", not an
  // error — and only its parse goes into the draft.
  const [text, setText] = useState<string | null>(null);
  if (!ready) return <BookingPending />;

  const shown =
    text ?? (draft.targetTotalBaisa == null ? '' : (formatAmount(draft.targetTotalBaisa, 'OMR', 'en') ?? ''));
  const parsed = shown.trim() === '' ? null : parseTypedMoney(shown);
  // Zero is not a limit anyone means; the server refuses it too.
  const invalid = shown.trim() !== '' && (parsed == null || parsed <= 0);

  function change(next: string) {
    setText(next);
    const value = next.trim() === '' ? null : parseTypedMoney(next);
    update({ targetTotalBaisa: value != null && value > 0 ? value : null });
  }

  return (
    <QuestionShell
      step={stepNumber('target')}
      total={TOTAL_STEPS}
      question={t('book.target.q')}
      helper={t('book.target.help')}
      above={
        <View style={styles.pill}>
          <StatusPill label={t('book.target.optional')} tone="neutral" />
        </View>
      }
      onBack={() => router.back()}
      cta={t('book.target.cta')}
      ctaDisabled={invalid}
      onCta={() => router.push('/book/review')}
      tertiary={t('book.target.skip')}
      onTertiary={() => {
        // Skipping clears a half-typed limit, so "skip" means no limit rather
        // than silently posting one.
        setText('');
        update({ targetTotalBaisa: null });
        router.push('/book/review');
      }}
    >
      <TextField
        value={shown}
        onChangeText={change}
        keyboardType="decimal-pad"
        placeholder="0"
        accessibilityLabel={t('book.target.q')}
        error={invalid ? t('money.invalid') : null}
        style={styles.value}
        maxLength={12}
        trailing={<Text style={styles.unit}>{t('book.target.unit')}</Text>}
      />
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  pill: { marginBottom: space.sm },
  value: { ...font.display, color: color.inkText },
  unit: { ...arabicIfNeeded(font.title), color: color.mutedText },
});
