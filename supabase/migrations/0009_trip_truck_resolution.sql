-- ─────────────────────────────────────────────────────────────────────────────
-- 0009 — actually attach a truck to a trip
--
-- THE BUG
--
-- `respond_to_offer` resolves the trip's truck from `legs.truck_id`:
--
--     select l.truck_id into v_truck from public.legs l where l.id = v_offer.leg_id;
--
-- `post_leg` accepts `p_truck_id` and validates ownership correctly, but it
-- defaults to NULL and no client ever passes it — `post-leg.tsx` never asks which
-- truck, because a driver has exactly one. So every leg carries no truck, every
-- trip is created with `truck_id = NULL`, and anything reading the trip's truck
-- gets nothing.
--
-- That went unnoticed because nothing read it until `trip_truck()` (0008). The
-- shipper would simply never have seen a truck, with no error anywhere.
--
-- THE FIX
--
-- Fall back to the driver's own truck when the leg does not name one. A driver
-- registers exactly one truck at signup (`createTruck` in src/lib/auth.ts), so in
-- practice the fallback is the answer. When a driver somehow owns more than one,
-- the fallback declines to guess and leaves NULL rather than attributing a random
-- truck to a delivery — a wrong plate on a consignment note is worse than a
-- missing one.
--
-- Replacing the function rather than editing 0004: migrations are append-only.
-- The body below is 0004's, unchanged except for the truck resolution block.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.respond_to_offer(p_offer_id uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_offer   public.offers;
  v_truck   uuid;
  v_trip_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Fetch SCOPED TO THE ACTOR, never fetch-then-check (§3).
  select * into v_offer
  from public.offers o
  where o.id = p_offer_id and o.driver_id = v_actor
  for update;

  -- Not found and not-yours are indistinguishable to the caller (§3).
  if v_offer.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'offer already resolved' using errcode = 'check_violation';
  end if;

  if v_offer.expires_at <= now() then
    update public.offers set status = 'expired' where id = v_offer.id;
    raise exception 'offer expired' using errcode = 'check_violation';
  end if;

  if not p_accept then
    update public.offers set status = 'declined' where id = v_offer.id;
    return null;
  end if;

  -- The verification gate. Off for MVP hand-onboarding; flip the setting before
  -- open driver signup so "100% verified drivers" stays true.
  if private.setting_bool('require_verified_driver', false)
     and not private.is_verified_driver(v_actor) then
    raise exception 'driver not verified' using errcode = 'insufficient_privilege';
  end if;

  -- ── changed in 0009 ───────────────────────────────────────────────────────
  select l.truck_id into v_truck from public.legs l where l.id = v_offer.leg_id;

  -- The leg usually names no truck, because nothing asks the driver to choose
  -- one. Fall back to the truck they own — but only when there is exactly one, so
  -- a delivery is never stamped with a plate we guessed.
  if v_truck is null then
    select t.id into v_truck
    from public.trucks t
    where t.owner_id = v_actor
    limit 2;

    if (select count(*) from public.trucks t where t.owner_id = v_actor) <> 1 then
      v_truck := null;
    end if;
  end if;
  -- ──────────────────────────────────────────────────────────────────────────

  insert into public.trips (load_id, driver_id, truck_id, leg_id, status)
  values (v_offer.load_id, v_actor, v_truck, v_offer.leg_id, 'assigned')
  returning id into v_trip_id;

  update public.offers set status = 'accepted' where id = v_offer.id;
  -- Every other pending offer on this load is dead.
  update public.offers set status = 'expired'
  where load_id = v_offer.load_id and id <> v_offer.id and status = 'pending';

  update public.loads set status = 'assigned' where id = v_offer.load_id;
  update public.legs  set status = 'matched'  where id = v_offer.leg_id;

  return v_trip_id;
end;
$$;

revoke all on function public.respond_to_offer(uuid, boolean) from public, anon;
grant execute on function public.respond_to_offer(uuid, boolean) to authenticated;
