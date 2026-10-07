/** Change the shipper's private maximum while bidding is open. */
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { t } from '@/i18n';
import { parseTypedMoney } from '@/lib/money';
import { useSetBidTarget } from '@/lib/queries';
import { color, font } from '@/theme/tokens';

export default function BidLimit() {
  const { loadId } = useLocalSearchParams<{ loadId: string }>();
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useSetBidTarget();
  const parsed = value.trim() ? parseTypedMoney(value) : null;
  const invalid = value.trim() !== '' && (parsed == null || parsed <= 0);

  function submit(target: number | null) {
    if (!loadId || save.isPending || (target !== null && invalid)) return;
    setError(null);
    save.mutate({ loadId, targetBaisa: target }, {
      onSuccess: () => router.back(),
      onError: () => setError(t('bid.manage.unavailable')),
    });
  }

  return (
    <QuestionShell
      step={1}
      total={1}
      question={t('book.target.q')}
      helper={t('book.target.help')}
      onBack={() => router.back()}
      cta={t('bid.manage.saveLimit')}
      ctaDisabled={invalid || !loadId}
      ctaLoading={save.isPending}
      onCta={() => submit(parsed)}
      tertiary={t('bid.manage.clearLimit')}
      onTertiary={() => submit(null)}
    >
      <TextField
        value={value}
        onChangeText={(next) => { setValue(next); setError(null); }}
        keyboardType="decimal-pad"
        placeholder="0"
        accessibilityLabel={t('book.target.q')}
        error={invalid ? t('money.invalid') : error}
        maxLength={12}
        style={styles.value}
        trailing={<Text style={styles.unit}>{t('book.target.unit')}</Text>}
      />
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  value: { ...font.display, color: color.inkText },
  unit: { ...arabicIfNeeded(font.title), color: color.mutedText },
});
