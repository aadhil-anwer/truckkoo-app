-- Truckkoo — MVP matching.
--
-- Phase 1 matches on EXACT city pairs. No PostGIS, no routing API, no detour
-- cost. Not a shortcut to apologise for: testable, free, and correct for
-- city-to-city freight quoting, which is how the business already works.
--
-- Phase 3 replaces the BODY of match_load() with PostGIS proximity plus
-- two-tier detour scoring. Everything calls this function, so that swap touches
-- one place. Keep it that way.
--
-- ── SECURITY (SECURITY.md §3, §7) ──────────────────────────────────────────
-- This is `security definer` because driver legs are supply intelligence and
-- are unreadable by shippers under RLS. That makes it the single most dangerous
-- function in the schema, so:
--   * search_path is pinned to '' and every identifier is fully qualified
--   * THE CALLER'S OWNERSHIP OF THE LOAD IS RE-CHECKED INSIDE THE FUNCTION.
--     Without that check any authenticated user could pass any load_id and
--     harvest driver identities — an IDOR straight into crown jewels #1 and #3.
--   * a non-owner gets an empty set, not an error: no existence disclosure (§3)
--   * it returns the driver's display name only. Never their phone, never their
--     other legs, never another load.

create or replace function public.match_load(p_load_id uuid)
returns table (
  leg_id      uuid,
  driver_id   uuid,
  driver_name text,
  truck_id    uuid,
  truck_type  text,
  is_empty    boolean,
  depart_from date,
  depart_to   date,
  day_gap     integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with l as (
    select
      lo.id, lo.origin_city, lo.dest_city, lo.pickup_from, lo.pickup_to,
      lo.weight_kg, lo.truck_type_code
    from public.loads lo
    where lo.id = p_load_id
      -- Authorization, per-object, server-side. Do not remove.
      and lo.shipper_id = (select auth.uid())
  )
  select
    lg.id                       as leg_id,
    lg.driver_id                as driver_id,
    p.full_name                 as driver_name,
    lg.truck_id                 as truck_id,
    coalesce(tk.truck_type, '') as truck_type,
    lg.is_empty                 as is_empty,
    lg.depart_from              as depart_from,
    lg.depart_to                as depart_to,
    greatest(
      0,
      greatest(l.pickup_from - lg.depart_to, lg.depart_from - l.pickup_to)
    )::integer                  as day_gap
  from public.legs lg
  cross join l
  join public.profiles p        on p.id = lg.driver_id
  left join public.trucks tk    on tk.id = lg.truck_id
  where lg.status = 'open'
    and lg.origin_city = l.origin_city
    and lg.dest_city   = l.dest_city
    -- windows overlap, or sit within a 2-day grace either side
    and lg.depart_from <= l.pickup_to   + 2
    and lg.depart_to   >= l.pickup_from - 2
    -- Truck type: honour it when the shipper chose one. A NULL choice is
    -- "Not sure — advise me" and must match EVERY truck, not none.
    and (l.truck_type_code is null or tk.truck_type = l.truck_type_code)
    -- Capacity: same rule. Unknown weight must not filter anything out.
    and (l.weight_kg is null or coalesce(tk.capacity_kg, 2147483647) >= l.weight_kg)
  -- Empty legs first: filling deadhead is the whole point.
  order by lg.is_empty desc, day_gap asc, lg.depart_from asc
  limit 20;
$$;

comment on function public.match_load(uuid) is
  'MVP matching: exact city pair + overlapping window, empty legs first. Ownership '
  'of p_load_id is re-checked inside. Replace the body (not the signature) with '
  'PostGIS proximity in phase 3.';

revoke all on function public.match_load(uuid) from public, anon;
grant execute on function public.match_load(uuid) to authenticated;

-- ─── the verification gate ──────────────────────────────────────────────────
-- Deferred by decision: drivers are hand-onboarded at MVP scale. The helper
-- exists so enabling it later is one statement, not a refactor.
--
-- The live website publicly claims "100% verified drivers". Before OPEN driver
-- signup ships, enable this — otherwise that claim stops being true the moment a
-- stranger can accept a load. It is wired into accept_offer() in 0004 behind a
-- settings flag.

create or replace function private.is_verified_driver(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.drivers d
    where d.profile_id = p_profile_id and d.verified_at is not null
  );
$$;

-- Called only from inside respond_to_offer(), which is security definer and runs
-- as the owner. No client grant needed, so it gets none.
revoke all on function private.is_verified_driver(uuid) from public, anon, authenticated;
