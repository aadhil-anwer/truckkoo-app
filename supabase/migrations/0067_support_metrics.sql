-- 0067 · Support desk S4: the owner's support numbers.
--
-- For Eagle view, the same periods as ops_metrics (0056): today against the
-- same span yesterday, or the last 7 / 30 days against the ones before. Its own
-- function rather than more keys in ops_metrics: the money read stays as tested.
create or replace function private.support_window(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'opened', (select count(*) from public.shipment_cases c where c.created_at > p_from and c.created_at <= p_to),
    'resolved', (select count(*) from public.shipment_cases c where c.resolved_at > p_from and c.resolved_at <= p_to),
    'median_first_response_minutes', (
      select round(extract(epoch from percentile_cont(0.5) within group (order by c.responded_at - c.created_at)) / 60)
        from public.shipment_cases c
       where c.created_at > p_from and c.created_at <= p_to and c.responded_at is not null),
    'median_minutes_to_resolve', (
      select round(extract(epoch from percentile_cont(0.5) within group (order by c.resolved_at - c.created_at)) / 60)
        from public.shipment_cases c
       where c.resolved_at > p_from and c.resolved_at <= p_to),
    'strikes_confirmed', (select count(*) from private.incidents i
                           where i.state = 'confirmed'
                             and i.confirmed_at > p_from and i.confirmed_at <= p_to),
    'releases', (select count(*) from private.incidents i
                  where i.kind = 'release' and i.created_at > p_from and i.created_at <= p_to),
    'no_shows_flagged', (select count(*) from private.incidents i
                          where i.kind = 'no_show' and i.source = 'detector'
                            and i.created_at > p_from and i.created_at <= p_to));
$$;
revoke all on function private.support_window(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.ops_support_metrics(p_period text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to        timestamptz := now();
  v_from      timestamptz;
  v_prev_from timestamptz;
  v_prev_to   timestamptz;
begin
  perform private.require_owner();
  if p_period = 'today' then
    v_from := (date_trunc('day', now() at time zone 'Asia/Muscat')) at time zone 'Asia/Muscat';
    v_prev_from := v_from - interval '1 day';
    v_prev_to := v_to - interval '1 day';
  elsif p_period in ('7d', '30d') then
    v_from := v_to - make_interval(days => case p_period when '7d' then 7 else 30 end);
    v_prev_to := v_from;
    v_prev_from := v_from - (v_to - v_from);
  else
    raise exception 'period is today, 7d or 30d' using errcode = 'check_violation';
  end if;
  return jsonb_build_object(
    'period', p_period,
    'current', private.support_window(v_from, v_to),
    'previous', private.support_window(v_prev_from, v_prev_to),
    'now', jsonb_build_object(
      'open', (select count(*) from public.shipment_cases c where c.status <> 'resolved'),
      'overdue', (select count(*) from public.shipment_cases c
                   where c.status <> 'resolved' and c.responded_at is null and c.due_at < now()),
      'to_review', (select count(*) from private.incidents i where i.state = 'suspected')),
    'by_kind', (select coalesce(jsonb_agg(jsonb_build_object('kind', x.kind, 'cases', x.n) order by x.n desc, x.kind), '[]'::jsonb)
                  from (select c.kind, count(*) n from public.shipment_cases c
                         where c.created_at > v_from and c.created_at <= v_to
                         group by c.kind order by count(*) desc limit 8) x));
end;
$$;
revoke all on function public.ops_support_metrics(text) from public, anon;
grant execute on function public.ops_support_metrics(text) to authenticated;
