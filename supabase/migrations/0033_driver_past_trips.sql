-- 0033 — a driver's past trips, and what this month paid.
--
-- The Routes tab becomes Past trips (declared legs are hidden, unreleased — see
-- src/lib/features.ts). It lists delivered trips under a "this month" total.
--
-- Same shape as 0030/0031: a composed answer, scoped to auth.uid() INSIDE the
-- definer, payout from private.payout_for(). Never a payout in TypeScript, and
-- never a total the client adds up — the headline and the rows must come from
-- one calculation, or one day they disagree about money.

-- ═══ 1. when a trip was done ════════════════════════════════════════════════
-- WHEN IT WAS DELIVERED, not when the trip was created — the same rule 0030's
-- week already follows, now in one place so the list, the week and the month
-- cannot bucket the same trip differently. `created_at` is only the fallback for
-- a trip closed without a delivery event.

create or replace function private.trip_done_at(p_trip_id uuid, p_created_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select max(e.occurred_at) from public.trip_events e
      where e.trip_id = p_trip_id and e.type = 'delivered'),
    p_created_at);
$$;

revoke all on function private.trip_done_at(uuid, timestamptz) from public, anon, authenticated;

-- ═══ 2. the list ════════════════════════════════════════════════════════════

create or replace function public.driver_trips()
returns table (
  trip_id       uuid,
  origin_city   bigint,
  dest_city     bigint,
  goods         text,
  weight_kg     integer,
  payout_baisa  bigint,
  currency      char(3),
  delivered_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    t.id, l.origin_city, l.dest_city, l.goods_description, l.weight_kg,
    private.payout_for(l.price_baisa), l.currency,
    private.trip_done_at(t.id, t.created_at) as done_at
  from public.trips t
  join public.loads l on l.id = t.load_id
  where t.driver_id = v_actor
    and t.status in ('delivered'::public.trip_status, 'closed'::public.trip_status)
  order by done_at desc
  -- Bounded (SECURITY.md §6). Two hundred deliveries is years of one truck; a
  -- longer history is a paging feature, not a bigger number here.
  limit 200;
end;
$$;

revoke all on function public.driver_trips() from public, anon;
grant execute on function public.driver_trips() to authenticated;

-- ═══ 3. earnings gain a month ═══════════════════════════════════════════════
-- DROP, not replace: adding output columns changes the return type, which
-- `create or replace` refuses. The new columns go on the END, so an app built
-- before this reads its three fields by name and never notices.
--
-- The month is Oman's calendar month, for the reason 0030 gives about the week:
-- bucketing on UTC puts a 2am delivery on the 1st into the month that just ended.

drop function if exists public.driver_earnings();

create function public.driver_earnings()
returns table (
  week_baisa     bigint,
  week_trips     bigint,
  all_time_trips bigint,
  month_baisa    bigint,
  month_trips    bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date;
  v_week  date;
  v_month date;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  v_today := (now() at time zone 'Asia/Muscat')::date;
  -- THE WEEK STARTS ON SUNDAY — see 0030 for why, and why this arithmetic.
  v_week  := v_today - (extract(isodow from v_today)::int % 7);
  v_month := date_trunc('month', v_today)::date;

  return query
  with delivered as (
    select
      l.price_baisa,
      (private.trip_done_at(t.id, t.created_at) at time zone 'Asia/Muscat')::date as done_on
    from public.trips t
    join public.loads l on l.id = t.load_id
    where t.driver_id = v_actor
      and t.status in ('delivered'::public.trip_status, 'closed'::public.trip_status)
  )
  select
    coalesce(sum(private.payout_for(d.price_baisa)) filter (where d.done_on >= v_week), 0)::bigint,
    count(*) filter (where d.done_on >= v_week)::bigint,
    count(*)::bigint,
    coalesce(sum(private.payout_for(d.price_baisa)) filter (where d.done_on >= v_month), 0)::bigint,
    count(*) filter (where d.done_on >= v_month)::bigint
  from delivered d;
end;
$$;

revoke all on function public.driver_earnings() from public, anon;
grant execute on function public.driver_earnings() to authenticated;
