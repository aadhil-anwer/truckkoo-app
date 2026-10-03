/**
 * D2c · How much do you want for this trip? (0045)
 *
 * One question, on the asking ground. The amount is what the driver KEEPS, in
 * rial — the same kind of number as every competing price on D2b, so the
 * driver can compare like with like. Truckkoo's fee, when there is one, is
 * added for the shipper and never shown here.
 *
 * A driver can send again until bidding closes; the server keeps the latest.
 * Typed on whatever keyboard the phone has (`parseTypedMoney`).
 */
import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { QuestionShell } from '@/components/booking/shells';
import { TextField } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { align, getLanguage, t } from '@/i18n';
import { formatAmount, formatMoney, parseTypedMoney } from '@/lib/money';
import { useDriverBidInvite, useDriverLoadBids, usePlaceDriverBid } from '@/lib/queries';
import { color, font } from '@/theme/tokens';

function bidErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? '');
  if (msg.includes('bidding closed') || msg.includes('offer not found')) return t('drv.bid.gone');
  if (msg.includes('no longer eligible')) return t('drv.bid.notEligible');
  return t('error.generic');
}

export default function BidPrice() {
  const router = useRouter();
  const { offer } = useLocalSearchParams<{ offer: string }>();
  const invite = useDriverBidInvite(offer);
  const competing = useDriverLoadBids(offer);
  const place = usePlaceDriverBid();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const own = invite.data?.own_bid_baisa ?? null;
  const shown = text ?? (own == null ? '' : (formatAmount(own, 'OMR', 'en') ?? ''));
  const parsed = shown.trim() === '' ? null : parseTypedMoney(shown);
  const invalid = shown.trim() !== '' && (parsed == null || parsed <= 0);
  const amount = parsed != null && parsed > 0 ? formatMoney(parsed, 'OMR', getLanguage()) : null;

  const lowest = (competing.data ?? []).reduce<number | null>(
    (min, b) => (min == null || b.payout_baisa < min ? b.payout_baisa : min),
    null,
  );

  function send() {
    if (parsed == null || parsed <= 0) return;
    setError(null);
    place.mutate(
      { offerId: offer, payoutBaisa: parsed },
      {
        onSuccess: () => router.back(),
        onError: (e: unknown) => setError(bidErrorMessage(e)),
      },
    );
  }

  return (
    <QuestionShell
      step={1}
      total={1}
      question={t('drv.bid.q')}
      helper={t('drv.bid.help')}
      onBack={() => router.back()}
      cta={amount ? t('drv.bid.submit', { amount }) : t('drv.bid.submit.bare')}
      ctaDisabled={parsed == null || parsed <= 0}
      ctaLoading={place.isPending}
      onCta={send}
    >
      <TextField
        value={shown}
        onChangeText={(next) => {
          setText(next);
          setError(null);
        }}
        keyboardType="decimal-pad"
        placeholder="0"
        accessibilityLabel={t('drv.bid.q')}
        error={invalid ? t('money.invalid') : error}
        style={styles.value}
        maxLength={12}
        trailing={<Text style={styles.unit}>{t('book.target.unit')}</Text>}
      />
      {lowest != null && (
        <Text style={styles.hint}>
          {t('drv.bid.lowest', { amount: formatMoney(lowest, 'OMR', getLanguage()) ?? '' })}
        </Text>
      )}
    </QuestionShell>
  );
}

const styles = StyleSheet.create({
  value: { ...font.display, color: color.inkText },
  unit: { ...arabicIfNeeded(font.title), color: color.mutedText },
  hint: { ...arabicIfNeeded(font.body), color: color.mutedText, textAlign: align.start },
});
