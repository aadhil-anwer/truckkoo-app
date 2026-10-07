/**
 * Waiting at a stop (0069), as the database computed it — this component adds
 * nothing up. The driver is told they will be checked in automatically and
 * then sees the clock and the total to collect; the shipper sees the same
 * clock, what they will pay, and — while a stop's clock runs — "Driver isn't
 * here", which holds that stop's charge until a person at Truckkoo checks.
 *
 * Ink ground, like the trip and load screens it sits on. No accent: the
 * screen's one accent is its primary action.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SecondaryButton } from '@/components/primitives';
import { arabicIfNeeded } from '@/components/text-direction';
import { align, formatNumber, t } from '@/i18n';
import { formatMoney, type Currency } from '@/lib/money';
import { reportFailure } from '@/lib/monitoring';
import type { TripWaiting, WaitStop } from '@/lib/queries';
import { supabase } from '@/lib/supabase';
import { alpha, color, font, hairline, space } from '@/theme/tokens';

const money = (baisa: number | null | undefined) => formatMoney(baisa ?? 0, 'OMR' as Currency) ?? '';

export function WaitingCard({
  waiting,
  side,
  tripId,
  nextStop,
  onChanged,
}: {
  waiting: TripWaiting | null | undefined;
  side: 'driver' | 'shipper';
  tripId?: string;
  /** Driver only: the stop they are heading to and whether it has a pin. */
  nextStop?: { stop: 'pickup' | 'drop'; pinned: boolean } | null;
  /** Called after the shipper holds a stop, so the screen can refetch. */
  onChanged?: () => void;
}) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!waiting?.terms) return null;
  const terms = waiting.terms;
  const arrived = waiting.stops.filter((s) => s.arrived_at);
  const awaiting = side === 'driver' && nextStop?.pinned
    && !waiting.stops.some((s) => s.stop === nextStop.stop && s.arrived_at);

  async function notHere(stop: WaitStop['stop']) {
    if (!tripId) return;
    setError(null);
    const { error: e } = await supabase.rpc('report_driver_absent', { p_trip_id: tripId, p_stop: stop });
    if (e) { reportFailure('report_driver_absent', e); setError(t('wait.notHere.error')); return; }
    setSent(true);
    onChanged?.();
  }

  if (!awaiting && arrived.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.why}>
        {t('wait.terms', { free: formatNumber(terms.free_minutes), rate: money(terms.per_15min_baisa) })}
      </Text>
      {awaiting && nextStop && (
        <Text style={styles.title}>{t(nextStop.stop === 'pickup' ? 'wait.auto.pickup' : 'wait.auto.drop')}</Text>
      )}
      {arrived.map((s) => (
        <View key={s.stop} style={styles.stop}>
          <Text style={styles.title}>
            {t(s.stop === 'pickup' ? 'wait.title.pickup' : 'wait.title.drop', { minutes: formatNumber(s.minutes) })}
          </Text>
          {s.waived ? (
            <Text style={styles.why}>{t('wait.waived')}</Text>
          ) : s.held ? (
            <Text style={styles.why}>{t('wait.held')}</Text>
          ) : (
            <Text style={styles.why}>{t('wait.charge', { amount: money(s.charge_baisa) })}</Text>
          )}
          {s.capped && !s.waived && (
            <Text style={styles.why}>{t('wait.capped', { cap: formatNumber(s.cap_minutes) })}</Text>
          )}
          {side === 'shipper' && s.running && !s.held && !s.waived && !sent && (
            <SecondaryButton label={t('wait.notHere')} onPress={() => void notHere(s.stop)} />
          )}
        </View>
      ))}
      {sent && <Text style={styles.why} accessibilityLiveRegion="polite">{t('wait.notHere.done')}</Text>}
      {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
      {waiting.waiting_baisa > 0 && waiting.total_baisa != null && (
        <Text style={styles.total}>
          {t(side === 'driver' ? 'wait.collectTotal' : 'wait.payTotal', { amount: money(waiting.total_baisa) })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.xs,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: hairline.inner,
  },
  stop: { gap: 2, marginTop: space.xs },
  title: { ...arabicIfNeeded(font.rowTitle), color: color.lightText, textAlign: align.start },
  why: { ...arabicIfNeeded(font.bodySmall), color: alpha.onInk.secondary, textAlign: align.start },
  total: { ...arabicIfNeeded(font.value), color: color.lightText, textAlign: align.start, marginTop: space.xs },
  error: { ...arabicIfNeeded(font.bodySmall), color: color.dangerLight, textAlign: align.start },
});
