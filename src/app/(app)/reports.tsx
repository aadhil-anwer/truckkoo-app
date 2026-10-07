/** What the person reported (0065) and where it stands — never staff notes. */
import { InkList, InkRow } from '@/components/support/InkList';
import { Chip } from '@/components/ui';
import { dictionaries, t, type StringKey } from '@/i18n';
import { formatOmanDay } from '@/lib/format';
import { useMyCases } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';

function kindLabel(kind: string): string {
  const own = `reports.kind.${kind}`;
  if (own in dictionaries.en) return t(own as StringKey);
  const asked = `case.kind.${kind}`;
  return asked in dictionaries.en ? t(asked as StringKey) : t('reports.kind.other');
}

export default function MyReports() {
  const cases = useMyCases();
  const rows = cases.data ?? [];
  return (
    <InkList title={t('reports.title')}
      loading={cases.isPending} failed={cases.isError} onRetry={() => void cases.refetch()}
      refreshing={cases.isRefetching} empty={rows.length === 0 ? t('reports.empty') : null}>
      {rows.map((c) => (
        <InkRow key={c.id} title={kindLabel(c.kind)}
          detail={[c.route ? safeText(c.route) : null, formatOmanDay(c.created_at)].filter(Boolean).join(' · ')}
          trailing={<Chip label={t(c.status === 'resolved' ? 'reports.status.resolved' : 'reports.status.open')} />} />
      ))}
    </InkList>
  );
}
