-- 0062 · Ops console v2, phase 3: the eagle view's numbers.
--
-- Spec: ~/truckkoo-ops/docs/superpowers/specs/2026-10-05-ops-console-v2-design.md
-- §5.1. Owner-only. Computed here, from the tables of record, so the console
-- never adds money up itself. Integer baisa throughout.
--
-- Windows are (from, to]: `now()` belongs to the current period, and two
-- adjacent periods never count the same row twice.
--
-- DEFINITIONS (the console shows these as tooltips — keep them in step):
--   posted     loads created in the window
--   priced     of those, a price or at least one bid
--   booked     of those, a trip exists
--   delivered  of those, status delivered or closed
--   booked value  Σ price of booked loads
--   margin        Σ (price − payout). Payout is the awarded bid payout for a
--                 bid load, else payout_for(price) at TODAY's commission —
--                 commission is not snapshotted per load, so it is an estimate.
--   time to a truck   median minutes from accepted (or posted) to the first trip
--   bids per bid load median, over bid loads posted in the window
--   bid acceptance    % of closed auctions (deadline passed or a bid chosen)
--                     that chose a bid
--   new        profiles created in the window, by role; staff are not users
--   active     did something recorded in the window. Drivers: a location, a
--              bid, a trip event or position, or an availability change at
--              least a minute after signing up (0038 gives every new driver a
--              default row, which is not activity). Shippers: posted a load or
--              accepted one.

create or replace function private.ops_metrics_window(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with users as (
    select p.id, p.role, p.created_at
      from public.profiles p
     where not exists (select 1 from private.ops_users o where o.profile_id = p.id)
  ),
  posted as (
    select l.* from public.loads l where l.created_at > p_from and l.created_at <= p_to
  ),
  booked as (
    select l.id, l.price_baisa, l.pricing_mode, l.accepted_at, l.created_at,
           (select min(t.created_at) from public.trips t where t.load_id = l.id) as first_trip_at,
           (select b.awarded_payout_baisa from private.bid_loads b where b.load_id = l.id) as awarded_payout
      from posted l
     where exists (select 1 from public.trips t where t.load_id = l.id)
  ),
  bid_loads as (
    select l.id, l.selected_bid_id, l.bid_deadline,
           (select count(*) from private.driver_bids d where d.load_id = l.id) as bids
      from posted l where l.pricing_mode = 'bid'
  ),
  active_drivers as (
    select u.id from users u
     where u.role = 'driver'::public.user_role and (
       exists (select 1 from public.driver_availability a
                where a.driver_id = u.id
                  and ((a.located_at > p_from and a.located_at <= p_to)
                       or (a.updated_at > p_from and a.updated_at <= p_to
                           and a.updated_at > u.created_at + interval '1 minute')))
       or exists (select 1 from private.driver_bids d
                   where d.driver_id = u.id and d.updated_at > p_from and d.updated_at <= p_to)
       or exists (select 1 from public.trip_events e
                   where e.created_by = u.id and e.occurred_at > p_from and e.occurred_at <= p_to)
       or exists (select 1 from public.trip_positions tp
                   where tp.driver_id = u.id and tp.seen_at > p_from and tp.seen_at <= p_to))
  ),
  active_shippers as (
    select u.id from users u
     where u.role = 'shipper'::public.user_role
       and exists (select 1 from public.loads l
                    where l.shipper_id = u.id
                      and ((l.created_at > p_from and l.created_at <= p_to)
                           or (l.accepted_at > p_from and l.accepted_at <= p_to)))
  )
  select jsonb_build_object(
    'posted',    (select count(*) from posted),
    'priced',    (select count(*) from posted l
                   where l.price_baisa is not null
                      or exists (select 1 from private.driver_bids d where d.load_id = l.id)),
    'booked',    (select count(*) from booked),
    'delivered', (select count(*) from posted l
                   where l.status in ('delivered'::public.load_status, 'closed'::public.load_status)),
    'booked_value_baisa', (select coalesce(sum(b.price_baisa), 0) from booked b),
    'margin_baisa', (select coalesce(sum(b.price_baisa - coalesce(b.awarded_payout, private.payout_for(b.price_baisa))), 0)
                       from booked b where b.price_baisa is not null),
    'median_minutes_to_truck', (select percentile_disc(0.5) within group (
                                  order by (extract(epoch from b.first_trip_at - coalesce(b.accepted_at, b.created_at)) / 60)::integer)
                                  from booked b),
    'median_bids_per_bid_load', (select percentile_disc(0.5) within group (order by bl.bids) from bid_loads bl),
    'bid_acceptance_pct', (select case when count(*) = 0 then null
                                       else round(100.0 * count(*) filter (where bl.selected_bid_id is not null) / count(*)) end
                             from bid_loads bl
                            where bl.selected_bid_id is not null or bl.bid_deadline < now()),
    'new_drivers',  (select count(*) from users u where u.role = 'driver'::public.user_role
                      and u.created_at > p_from and u.created_at <= p_to),
    'new_shippers', (select count(*) from users u where u.role = 'shipper'::public.user_role
                      and u.created_at > p_from and u.created_at <= p_to),
    'active_drivers',  (select count(*) from active_drivers),
    'active_shippers', (select count(*) from active_shippers));
$$;
revoke all on function private.ops_metrics_window(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.ops_metrics(p_period text)
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
    raise exception 'period must be today, 7d or 30d' using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'period',   p_period,
    'from',     v_from,
    'to',       v_to,
    'current',  private.ops_metrics_window(v_from, v_to),
    'previous', private.ops_metrics_window(v_prev_from, v_prev_to),
    'totals', jsonb_build_object(
      'drivers',  (select count(*) from public.profiles p where p.role = 'driver'::public.user_role
                    and not exists (select 1 from private.ops_users o where o.profile_id = p.id)),
      'shippers', (select count(*) from public.profiles p where p.role = 'shipper'::public.user_role
                    and not exists (select 1 from private.ops_users o where o.profile_id = p.id)),
      'drivers_online', (select count(*) from public.driver_availability a where a.available)),
    'corridors', coalesce((
      select jsonb_agg(c order by (c ->> 'loads')::integer desc, c ->> 'route')
        from (
          select jsonb_build_object(
                   'route', o.name_en || ' → ' || d.name_en,
                   'loads', count(*),
                   'median_price_baisa', percentile_disc(0.5) within group (order by l.price_baisa)) as c
            from public.loads l
            join public.cities o on o.id = l.origin_city
            join public.cities d on d.id = l.dest_city
           where l.created_at > v_from and l.created_at <= v_to
           group by o.name_en, d.name_en
           order by count(*) desc, o.name_en || ' → ' || d.name_en
           limit 5) top), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_metrics(text) from public, anon;
grant execute on function public.ops_metrics(text) to authenticated;
