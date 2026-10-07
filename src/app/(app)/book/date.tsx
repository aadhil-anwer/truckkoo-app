/**
 * S5 · When should we collect it?
 *
 * Dates are NAMED, not gridded. A calendar grid asks a low-tech user to navigate
 * a month; "Tomorrow · Thursday" asks them to recognise a word.
 *
 * The handoff's fifth row is "A different day" behind a calendar icon. That is a
 * platform date picker, which is a native dependency and a modal a user has to
 * learn — so it expands the same named list instead. Same escape hatch, same
 * vocabulary, nothing new to understand, and it keeps working in Expo Go.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { BookingPending } from '@/components/booking/BookingPending';
import { SelectRow, TertiaryButton } from '@/components/primitives';
import { TOTAL_STEPS, stepNumber, useBookingDraft } from '@/lib/booking';
import { formatLongDay, isoToday } from '@/lib/format';
import { t } from '@/i18n';

/** Four named days, matching the handoff, then two more weeks on request. */
const NEAR = 4;
const FAR = 18;

export default function CollectionDate() {
  const router = useRouter();
  const { draft, update, ready } = useBookingDraft();
  const [expanded, setExpanded] = useState(false);

  if (!ready) return <BookingPending />;

  const count = expanded ? FAR : NEAR;
  const days = Array.from({ length: count }, (_, i) => isoToday(i));
  const chosen = draft.collectionDate;

  // If a previously-chosen date is outside the short list, show the long one so
  // the user's own answer is never invisible.
  const chosenHidden = !!chosen && !days.includes(chosen);

  function nameFor(iso: string, index: number): string {
    if (index === 0) return t('book.date.today');
    if (index === 1) return t('book.date.tomorrow');
    return formatLongDay(iso);
  }

  return (
    <QuestionShell
      step={stepNumber('date')}
      total={TOTAL_STEPS}
      question={t('book.date.q')}
      onBack={() => router.back()}
      cta={t('action.continue')}
      ctaDisabled={!chosen}
      onCta={() => router.push('/book/cargo')}
    >
      <View accessibilityRole="radiogroup" accessibilityLabel={t('book.date.q')}>
        {(chosenHidden ? Array.from({ length: FAR }, (_, i) => isoToday(i)) : days).map(
          (iso, i) => (
            <SelectRow
              key={iso}
              title={nameFor(iso, i)}
              subtitle={i < 2 ? formatLongDay(iso) : undefined}
              selected={chosen === iso}
              onPress={() => update({ collectionDate: iso })}
            />
          ),
        )}
      </View>

      {!expanded && !chosenHidden && (
        <TertiaryButton label={t('book.date.more')} onPress={() => setExpanded(true)} ground="cream" />
      )}
    </QuestionShell>
  );
}
