/**
 * A driver's own record (0063): each decided strike in plain words, how long it
 * counts, and "Disagree". Never the internal reason text — a shipper's words
 * are not handed to the driver. Suspicions nobody has decided do not appear.
 */
import { useRouter } from 'expo-router';
import { formatOmanDay } from '@/lib/format';
import { InkList, InkRow } from '@/components/support/InkList';
import { SecondaryButton } from '@/components/primitives';
import { Chip } from '@/components/ui';
import { t, type StringKey } from '@/i18n';
import { useMyRecord } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';

const DAY = 24 * 60 * 60 * 1000;

export default function MyRecord() {
  const router = useRouter();
  const record = useMyRecord();
  const rows = record.data ?? [];
  return (
    <InkList title={t('record.title')} help={t('record.help')}
      loading={record.isPending} failed={record.isError} onRetry={() => void record.refetch()}
      refreshing={record.isRefetching} empty={rows.length === 0 ? t('record.empty') : null}>
      {rows.map((s) => {
        const until = new Date(new Date(s.decided_at ?? s.created_at).getTime() + 30 * DAY).toISOString();
        return (
          <InkRow key={s.id} title={t(`record.kind.${s.kind}` as StringKey)}
            detail={[s.trip_route ? safeText(s.trip_route) : null, formatOmanDay(s.created_at)].filter(Boolean).join(' · ')}
            trailing={s.state === 'voided' ? <Chip label={t('record.voided')} /> : undefined}>
            {s.state === 'confirmed' ? (
              <>
                <Chip label={t('record.counts', { date: formatOmanDay(until) })} />
                {s.appeal_open
                  ? <Chip label={t('record.appeal.open')} />
                  : <SecondaryButton label={t('record.appeal')} onPress={() => router.push(`/appeal?id=${s.id}`)} />}
              </>
            ) : null}
          </InkRow>
        );
      })}
    </InkList>
  );
}
