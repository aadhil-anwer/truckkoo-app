-- 0030 — what a driver may read.
--
-- Drivers stop reading public.loads. Not because the price is a secret from them
-- — they collect it in cash, see the P5 spec §2 — but because this is where
-- payout, detour and remaining capacity are computed, and because a table-level
-- `grant select` hands a driver every column the table ever grows.

-- ═══ 1. the driver's view of an offer ═══════════════════════════════════════

create or replace function public.driver_offers()
returns table (
  offer_id      uuid,
  expires_at    timestamptz,
  leg_id        uuid,
  origin_city   bigint,
  dest_city     bigint,
  pickup_from   date,
  pickup_to     date,
  goods         text,
  weight_kg     integer,
  truck_type_code text,
  collect_baisa bigint,
  payout_baisa  bigint,
  owed_baisa    bigint,
  currency      char(3),
  detour_km     numeric,
  free_after_kg integer
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
    o.id, o.expires_at, o.leg_id,
    l.origin_city, l.dest_city, l.pickup_from, l.pickup_to,
    l.goods_description, l.weight_kg, l.truck_type_code,
    l.price_baisa,
    private.payout_for(l.price_baisa),
    l.price_baisa - private.payout_for(l.price_baisa),
    l.currency,
    case when o.leg_id is null then null
         else private.detour_km(o.leg_id, l.id) end,
    -- What is left on the truck after this load. NULL when either number is
    -- unknown, never a guess: a driver planning a second load on a maybe is
    -- worse off than one told nothing.
    case when t.capacity_kg is null or l.weight_kg is null then null
         else greatest(0, t.capacity_kg - l.weight_kg) end
  from public.offers o
  join public.loads l on l.id = o.load_id
  left join public.legs g on g.id = o.leg_id
  left join public.trucks t on t.id = g.truck_id
  -- Scoped to the actor INSIDE the definer, like match_load. Without this it is
  -- an IDOR into every driver's work and every shipper's cargo at once.
  where o.driver_id = v_actor
    and o.status = 'pending'::public.offer_status
    and o.expires_at > now()
  order by o.created_at desc;
end;
$$;

revoke all on function public.driver_offers() from public, anon;
grant execute on function public.driver_offers() to authenticated;

-- One offer, by OFFER id. Never by load id: a driver holds no load id, and
-- accepting one would re-open the door this closes.
create or replace function public.driver_offer(p_offer_id uuid)
returns table (
  offer_id      uuid,
  expires_at    timestamptz,
  leg_id        uuid,
  origin_city   bigint,
  dest_city     bigint,
  pickup_from   date,
  pickup_to     date,
  goods         text,
  weight_kg     integer,
  truck_type_code text,
  collect_baisa bigint,
  payout_baisa  bigint,
  owed_baisa    bigint,
  currency      char(3),
  detour_km     numeric,
  free_after_kg integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.driver_offers() d where d.offer_id = p_offer_id;
$$;

revoke all on function public.driver_offer(uuid) from public, anon;
grant execute on function public.driver_offer(uuid) to authenticated;

-- ═══ 2. what a driver has earned ════════════════════════════════════════════
-- THE WEEK STARTS ON SUNDAY. Oman's weekend is Friday–Saturday, so an ISO
-- Monday-start week shows every driver last week's total every Sunday, on the
-- screen they check most.
--
-- And the week is Oman's week, not UTC's. A load delivered at 2am on a Sunday in
-- Muscat is 10pm Saturday in UTC, and bucketing on UTC would drop it into the
-- week that has just ended — a driver watching their own total go backwards.

create or replace function public.driver_earnings()
returns table (week_baisa bigint, week_trips bigint, all_time_trips bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date;
  v_start date;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  v_today := (now() at time zone 'Asia/Muscat')::date;

  -- date_trunc('week') is Monday-based and has no option. Subtracting the ISO
  -- day-of-week modulo 7 walks back to Sunday instead: Sunday is 7, and 7 % 7
  -- is 0, so Sunday stays where it is.
  v_start := v_today - (extract(isodow from v_today)::int % 7);

  return query
  with delivered as (
    select
      t.id,
      l.price_baisa,
      -- WHEN IT WAS DELIVERED, not when the trip was created. A trip opened
      -- three weeks ago and delivered this morning is this week's money, and
      -- bucketing on created_at would leave it off the screen the driver checks
      -- to see whether the week was worth it. `created_at` is only the fallback
      -- for a trip closed without a delivery event.
      coalesce(
        (select max(e.occurred_at) from public.trip_events e
          where e.trip_id = t.id and e.type = 'delivered'),
        t.created_at) as done_at
    from public.trips t
    join public.loads l on l.id = t.load_id
    where t.driver_id = v_actor
      and t.status in ('delivered'::public.trip_status, 'closed'::public.trip_status)
  )
  select
    coalesce(sum(private.payout_for(d.price_baisa))
             filter (where (d.done_at at time zone 'Asia/Muscat')::date >= v_start), 0)::bigint,
    count(*) filter (where (d.done_at at time zone 'Asia/Muscat')::date >= v_start)::bigint,
    count(*)::bigint
  from delivered d;
end;
$$;

revoke all on function public.driver_earnings() from public, anon;
grant execute on function public.driver_earnings() to authenticated;

-- ═══ 3. the rate card is not a driver's to enumerate ════════════════════════
-- The P5 plan called for a shipper-only guard to be added to `quote_route` and
-- `estimate_route` here. IT IS ALREADY THERE — 0011 and 0021 each reject a
-- non-shipper before touching an argument, and the tenant suite now asserts it
-- rather than assuming it. Reproducing both bodies to insert a guard they
-- already carry would risk two rate-card lookups for no change in behaviour.
--
-- The refusal stays `not permitted` rather than the plan's `not found`. It is
-- raised before any city, weight or truck type is examined, so it is identical
-- for every argument and discloses nothing about the card — only the caller's
-- own role, which the caller already knows.
