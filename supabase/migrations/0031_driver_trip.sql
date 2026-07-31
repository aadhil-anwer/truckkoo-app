-- 0031 — the job a driver is on, composed the same way an offer is.
--
-- D7 states what the driver earns beside where it drops. That number is
-- `payout_for(price)`, and `payout_for` is private — so without this the screen
-- has two ways to get it, both wrong: read `loads.price_baisa` and show the
-- shipper's price as the driver's earnings, or apply the commission in
-- TypeScript. The second is the pricing formula leaving SQL, which is the thing
-- CLAUDE.md #3b exists to prevent.
--
-- Same shape as `driver_offers`, deliberately: one composed row per screen, and
-- `DriverMoney` renders both without knowing which it was given.

create or replace function public.driver_trip(p_trip_id uuid)
returns table (
  trip_id       uuid,
  status        public.trip_status,
  load_id       uuid,
  origin_city   bigint,
  dest_city     bigint,
  pickup_from   date,
  pickup_to     date,
  goods         text,
  weight_kg     integer,
  collect_baisa bigint,
  payout_baisa  bigint,
  owed_baisa    bigint,
  currency      char(3),
  shipper_name  text,
  shipper_phone text
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
    t.id, t.status, l.id,
    l.origin_city, l.dest_city, l.pickup_from, l.pickup_to,
    l.goods_description, l.weight_kg,
    l.price_baisa,
    private.payout_for(l.price_baisa),
    l.price_baisa - private.payout_for(l.price_baisa),
    l.currency,
    -- The shipper's name and number, because the driver has to call the gate.
    -- Nothing else about them: this is a contact, not a profile.
    p.full_name, p.phone
  from public.trips t
  join public.loads l on l.id = t.load_id
  join public.profiles p on p.id = l.shipper_id
  -- Scoped to the actor INSIDE the definer, like match_load and driver_offers.
  -- The trip id comes from the client and is worth nothing without this.
  where t.id = p_trip_id
    and t.driver_id = v_actor;
end;
$$;

revoke all on function public.driver_trip(uuid) from public, anon;
grant execute on function public.driver_trip(uuid) to authenticated;
