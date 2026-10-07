-- 0049 · A truck with no stated capacity can bid on a load with a weight.
--
-- `trucks.capacity_kg` is nullable on purpose: the app's truck step asks for a
-- type, not a number, and NULL means "not stated". Matching has always read it
-- as "assume it fits" — `coalesce(capacity_kg, 2147483647)` in 0003 and 0012.
-- 0045 wrote three capacity checks without the coalesce, and `NULL >= 8000` is
-- never true. In production 9 of 10 trucks have no stated capacity, so every bid
-- load posted WITH a weight could invite, and award, only the tenth driver.
-- Found on the first device walk (2026-10-04): a load that sat 15 minutes with
-- one invitation while eight drivers were nearby.
--
-- The three functions below are 0045's, unchanged except for the coalesce.

create or replace function private.bid_driver_eligible(p_load_id uuid, p_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.loads l
    join public.profiles p on p.id = p_driver_id
    join public.driver_availability a on a.driver_id = p.id and a.available
    where l.id = p_load_id and l.pricing_mode = 'bid'
      and l.pickup_to >= (now() at time zone 'Asia/Muscat')::date
      and p.role = 'driver' and p.suspended_at is null
      and (not private.setting_bool('require_verified_driver', false)
           or private.is_verified_driver(p.id))
      and exists (
        select 1 from public.trucks t where t.owner_id = p.id
          and (l.truck_type_code is null or t.truck_type = l.truck_type_code)
          and (l.weight_kg is null or coalesce(t.capacity_kg, 2147483647) >= l.weight_kg)
      )
      and not exists (
        select 1 from public.trips t where t.driver_id = p.id
          and t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
      )
  );
$$;
revoke all on function private.bid_driver_eligible(uuid, uuid) from public, anon, authenticated;

create or replace function public.driver_load_bids(p_offer_id uuid)
returns table(
  bidder_no integer, truck_type text, payout_baisa bigint,
  updated_at timestamptz, is_you boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_load public.loads;
begin
  select l.* into v_load from public.offers o
  join public.loads l on l.id = o.load_id
  where o.id = p_offer_id and o.driver_id = auth.uid() and auth.uid() is not null
    and o.source = 'bid' and o.status = 'pending' and o.expires_at > now()
    and l.pricing_mode = 'bid' and l.bid_deadline > now() and l.selected_bid_id is null;
  if v_load.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;
  return query
  with numbered as (
    select b.*, row_number() over (order by b.created_at, b.id) as n
    from private.driver_bids b where b.load_id = v_load.id
  )
  select nb.n::integer, t.truck_type, nb.payout_baisa, nb.updated_at, nb.driver_id = auth.uid()
  from numbered nb
  join public.offers o on o.id = nb.offer_id and o.status <> 'declined'
  left join lateral (
    select tr.truck_type from public.trucks tr
    where tr.owner_id = nb.driver_id
      and (v_load.truck_type_code is null or tr.truck_type = v_load.truck_type_code)
      and (v_load.weight_kg is null or coalesce(tr.capacity_kg, 2147483647) >= v_load.weight_kg)
    order by tr.capacity_kg asc nulls last limit 1
  ) t on true
  order by nb.payout_baisa, nb.created_at, nb.id;
end;
$$;
revoke all on function public.driver_load_bids(uuid) from public, anon;
grant execute on function public.driver_load_bids(uuid) to authenticated;

create or replace function public.shipper_load_bids(p_load_id uuid)
returns table(
  bid_id uuid, driver_name text, truck_type text,
  total_baisa bigint, submitted_at timestamptz, selected boolean, eligible boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.loads l where l.id = p_load_id
      and l.shipper_id = auth.uid() and l.pricing_mode = 'bid'
  ) then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;
  return query
  select b.id, p.full_name, t.truck_type,
         private.bid_total(b.payout_baisa, bl.fee_bps), b.created_at,
         l.selected_bid_id is not distinct from b.id,
         private.bid_driver_eligible(l.id, b.driver_id)
  from private.driver_bids b
  join public.loads l on l.id = b.load_id
  join private.bid_loads bl on bl.load_id = l.id
  join public.profiles p on p.id = b.driver_id
  join public.offers o on o.id = b.offer_id and o.status <> 'declined'
  left join lateral (
    select tr.truck_type from public.trucks tr
    where tr.owner_id = b.driver_id
      and (l.truck_type_code is null or tr.truck_type = l.truck_type_code)
      and (l.weight_kg is null or coalesce(tr.capacity_kg, 2147483647) >= l.weight_kg)
    order by tr.capacity_kg asc nulls last limit 1
  ) t on true
  where b.load_id = p_load_id
  order by b.payout_baisa, b.created_at, b.id;
end;
$$;
revoke all on function public.shipper_load_bids(uuid) from public, anon;
grant execute on function public.shipper_load_bids(uuid) to authenticated;
