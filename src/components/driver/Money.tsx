/**
 * The driver's money, in one place.
 *
 * Three numbers, and the order is the point. A driver keeps `payout`, collects
 * `collect` from the shipper in cash at the gate, and remits `owed` to Truckkoo.
 * The payout leads because it is what they are deciding on; the other two follow
 * as one supporting line because they are what happens at the gate.
 *
 * **The supporting line disappears entirely when nothing is owed.** That is the
 * state the product ships in — commission is 0 until a dispatcher sets it — and
 * "Collect 96.000 · To Truckkoo 0.000" is two numbers of noise on the screen a
 * driver reads one-handed, in a cab, in sunlight.
 *
 * No amount is ever zeroed into existence: an unpriced load renders nothing at
 * all rather than 0.000 (CLAUDE.md #5).
 */

import { StyleSheet, Text, View } from 'react-native';

import { arabicIfNeeded } from '@/components/text-direction';
import { align, getLanguage, t } from '@/i18n';
import { formatAmount, type Currency } from '@/lib/money';
import { alpha, color, font, space } from '@/theme/tokens';

export function DriverMoney({
  payout,
  collect,
  owed,
  currency,
  size = 'hero',
}: {
  payout: number | null;
  collect: number | null;
  owed: number | null;
  currency: string;
  /** `hero` on D1/D2, `row` in the compressed offers list. */
  size?: 'hero' | 'row';
}) {
  const lang = getLanguage();
  const cur = currency as Currency;

  const keep = formatAmount(payout, cur, lang);
  if (keep == null) return null;

  const take = formatAmount(collect, cur, lang);
  const remit = owed ? formatAmount(owed, cur, lang) : null;

  return (
    <View>
      <Text style={styles.label}>{t('drv.money.keep')}</Text>
      <View style={styles.amountRow}>
        <Text
          style={size === 'hero' ? styles.heroAmount : styles.rowAmount}
          accessibilityRole="header"
          // One label, so the number is never announced without its unit or its
          // meaning — a bare "78" tells a driver nothing.
          accessibilityLabel={`${t('drv.money.keep')} ${keep} ${currency}`}
        >
          {keep}
        </Text>
        <Text style={styles.unit}>{currency}</Text>
      </View>

      {!!remit && !!take && (
        <Text style={styles.supporting}>
          {`${t('drv.money.collect')} ${take} ${currency} · ${t('drv.money.owe')} ${remit} ${currency}`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...arabicIfNeeded(font.groupLabel),
    color: alpha.onInk.label,
    textAlign: align.start,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    marginTop: space.xs,
  },
  // Instrument Serif, and the ONE display statement on the screen it sits on.
  heroAmount: { ...font.payoutHero, color: color.lightText, textAlign: align.start },
  rowAmount: { ...font.payout, color: color.lightText, textAlign: align.start },
  unit: {
    ...arabicIfNeeded(font.value),
    color: alpha.onInk.tertiary,
    textAlign: align.start,
  },
  supporting: {
    ...arabicIfNeeded(font.bodySmall),
    color: alpha.onInk.secondary,
    textAlign: align.start,
    marginTop: space.sm,
  },
});
