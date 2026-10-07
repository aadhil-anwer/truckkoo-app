-- 0068 · A trip keeps the commission it was accepted at.
--
-- Until now a fixed-price payout was worked out on every read from today's
-- commission (payout_for, 0028). Changing the rate rewrote every past trip:
-- ending the launch's 0% (founder, 2026-10-06) would have shown each driver
-- owing commission on months of jobs already settled in cash, and a driver who
-- accepted at 0% and delivered after the change would owe on that job too.
--
-- Now each trip records the rate when it is created, which is when a driver
-- accepts (or staff reassign: a new trip, the new driver's terms). Payouts on a
-- trip read that record. Offers not yet accepted still show today's rate,
-- because that is the rate the driver will get by accepting. Bid loads were
-- already a snapshot (bid_loads.awarded_payout_baisa) and are unchanged.
--
-- Private and ungranted, like the rest of the money: a trip row is readable by
-- its shipper, and the commission is the margin (CLAUDE.md, bidding keeps the
-- fee off client-readable rows for the same reason).

create table private.trip_commission (
  trip_id        uuid primary key references public.trips(id) on delete cascade,
  commission_pct numeric not null check (commission_pct >= 0 and commission_pct <= 40),
  recorded_at    timestamptz not null default now()
);
revoke all on private.trip_commission from public, anon, authenticated;
alter table private.trip_commission enable row level security;
alter table private.trip_commission force row level security;
comment on table private.trip_commission is
  'The commission each trip was accepted at (0068). No client grant; read through trip_payout().';

-- The formula, once, at a given rate. payout_for keeps its meaning: today's rate.
create or replace function private.payout_at(p_price_baisa bigint, p_pct numeric)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_price_baisa is null then null
    else greatest(0, floor(p_price_baisa * (100 - p_pct) / 100)::bigint)
  end;
$$;
revoke all on function private.payout_at(bigint, numeric) from public, anon, authenticated;

create or replace function private.payout_for(p_price_baisa bigint)
returns bigint
language sql
stable
set search_path = ''
as $$
  select private.payout_at(p_price_baisa, private.commission_pct());
$$;
revoke all on function private.payout_for(bigint) from public, anon, authenticated;

create or replace function private.record_trip_commission()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into private.trip_commission (trip_id, commission_pct)
  values (new.id, private.commission_pct())
  on conflict (trip_id) do nothing;
  return null;
end;
$$;
revoke all on function private.record_trip_commission() from public, anon, authenticated;
create trigger trips_record_commission
  after insert on public.trips
  for each row execute function private.record_trip_commission();

-- Trips from before 0068 are recorded at the rate in force when it is applied:
-- the rate they were being shown at, since nothing older was kept.
insert into private.trip_commission (trip_id, commission_pct)
select t.id, private.commission_pct() from public.trips t
on conflict (trip_id) do nothing;

create or replace function private.trip_payout(p_trip_id uuid, p_price_baisa bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select bl.awarded_payout_baisa from private.bid_loads bl where bl.load_id = t.load_id),
    private.payout_at(p_price_baisa, tc.commission_pct),
    private.payout_for(p_price_baisa))
  from public.trips t
  left join private.trip_commission tc on tc.trip_id = t.id
  where t.id = p_trip_id;
$$;
revoke all on function private.trip_payout(uuid, bigint) from public, anon, authenticated;

-- Eagle view's margin: each booked load at its live trip's own rate.
create or replace function private.ops_metrics_window(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
           (select b.awarded_payout_baisa from private.bid_loads b where b.load_id = l.id) as awarded_payout,
           (select tc.commission_pct from public.trips t
              join private.trip_commission tc on tc.trip_id = t.id
             where t.load_id = l.id
             order by (t.status = 'cancelled'::public.trip_status), t.created_at desc
             limit 1) as commission
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
    'margin_baisa', (select coalesce(sum(b.price_baisa - coalesce(b.awarded_payout, private.payout_at(b.price_baisa, coalesce(b.commission, private.commission_pct())))), 0)
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
$function$;
revoke all on function private.ops_metrics_window(timestamptz, timestamptz) from public, anon, authenticated;
