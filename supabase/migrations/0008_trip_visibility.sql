-- ─────────────────────────────────────────────────────────────────────────────
-- 0008 — let a shipper see the truck carrying their cargo
--
-- PRODUCT.md lists "see the assigned truck and driver" in MVP scope, and Product
-- Principle #4 says vetting and route-fit must be *visible* — "show the truck and
-- the person, and why this truck". Neither was reachable.
--
-- `trip_counterpart()` (0004) already gives each participant the other's name and
-- phone. The truck did not have an equivalent: `public.trucks` is owner-only
-- (`"own trucks readable"`, 0001:506), deliberately, because a readable trucks
-- table leaks fleet composition. So the shipper's view of the truck goes through
-- a definer function with the same participant check.
--
-- WHAT IS AND IS NOT RETURNED
--
-- Returned: truck type, plate, and whether the truck is verified. A plate is how
-- you recognise the lorry at your gate, and "verified" is the public claim
-- ("100% verified drivers") made concrete for the person relying on it.
--
-- Withheld: `owner_id` (identity belongs to trip_counterpart, which checks its own
-- access), `capacity_kg` (fleet intelligence), and the raw `verified_at`
-- timestamp — a boolean answers the shipper's question without publishing when
-- vetting happened.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.trip_truck(p_trip_id uuid)
returns table (truck_type text, plate text, is_verified boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tr.truck_type,
    tr.plate,
    tr.verified_at is not null
  from public.trips t
  join public.trucks tr on tr.id = t.truck_id
  where t.id = p_trip_id
    -- Authorization, per-object, server-side. Identical shape to
    -- trip_counterpart: the caller must be on this trip. Do not remove.
    and (select private.is_trip_participant(p_trip_id))
    and t.status in ('assigned', 'in_transit', 'delivered', 'closed');
$$;

comment on function public.trip_truck(uuid) is
  'The truck on a trip, for either participant. Exists because public.trucks is '
  'owner-only by design — a readable trucks table would leak fleet composition.';

revoke all on function public.trip_truck(uuid) from public, anon;
grant execute on function public.trip_truck(uuid) to authenticated;
