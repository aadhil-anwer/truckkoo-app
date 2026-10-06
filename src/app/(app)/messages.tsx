/**
 * Messages from Truckkoo staff (0065). The push only said one exists; the words
 * are here. Opening the screen marks the unread ones read.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { InkList, InkRow } from '@/components/support/InkList';
import { Chip } from '@/components/ui';
import { t } from '@/i18n';
import { formatOmanDay } from '@/lib/format';
import { useMyMessages } from '@/lib/queries';
import { safeText } from '@/lib/safe-text';
import { supabase } from '@/lib/supabase';

export default function Messages() {
  const messages = useMyMessages();
  const queries = useQueryClient();
  const rows = messages.data ?? [];
  const unread = rows.filter((m) => !m.read_at).map((m) => m.id).join(',');

  useEffect(() => {
    if (!unread) return;
    void Promise.all(unread.split(',').map((id) => supabase.rpc('mark_message_read', { p_id: id })))
      .finally(() => { void queries.invalidateQueries({ queryKey: ['messages'] }); });
  }, [unread, queries]);

  return (
    <InkList title={t('messages.title')}
      loading={messages.isPending} failed={messages.isError} onRetry={() => void messages.refetch()}
      refreshing={messages.isRefetching} empty={rows.length === 0 ? t('messages.empty') : null}>
      {rows.map((m) => (
        <InkRow key={m.id} title={safeText(m.body)} detail={formatOmanDay(m.created_at)}
          trailing={m.read_at ? undefined : <Chip label={t('messages.new')} />} />
      ))}
    </InkList>
  );
}
