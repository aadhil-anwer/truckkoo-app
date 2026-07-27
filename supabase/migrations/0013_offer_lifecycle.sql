-- ─────────────────────────────────────────────────────────────────────────────
-- 0013 — the offer lifecycle: dead ends and races
--
-- Two live defects, both of which 0014's auto-dispatch turns from rare into
-- routine. They land BEFORE it deliberately.
--
-- DEFECT 1 — A LOAD EVERY DRIVER DECLINED IS STUCK FOREVER
--
-- `respond_to_offer`'s decline path sets the offer to 'declined' and does nothing
-- else, so the load stays 'matched'. But `ops_mark_finding_truck` only fires
-- `where status = 'posted'`, so a load that reached 'matched' can never be moved
-- back. It falls out of the "awaiting a decision" side of the ops queue and sits
-- there — no error, no alert, no dispatcher action possible.
--
-- That is exactly the dead end PRODUCT.md promises a shipper never hits, and it is
-- reachable today with one driver and one decline.
--
-- DEFECT 2 — TWO DRIVERS ACCEPTING THE SAME LOAD COLLIDE ON A CONSTRAINT
--
-- The old code locks only the caller's OWN offer row. Two drivers holding two
-- offers on one load lock different rows and never block each other; the loser is
-- stopped by `trips.load_id UNIQUE` (0001) and gets a raw `unique_violation`.
-- The driver screen renders that as nothing at all.
--
-- Fan-out to three drivers makes this the normal case, not a rare one. The fix is
-- to serialise on the row both transactions share — the LOAD — and to fail with a
-- domain error the client can actually say something about.
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
  v_load    public.loads;
  v_truck   uuid;
  v_trip_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Fetch SCOPED TO THE ACTOR, never fetch-then-check (§3). No lock yet: locking
  -- here and then the load would take two locks in the opposite order to any
  -- future load-first path, which is how deadlocks are built.
  select * into v_offer
  from public.offers o
  where o.id = p_offer_id and o.driver_id = v_actor;

  -- Not found and not-yours are indistinguishable to the caller (§3).
  if v_offer.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;

  -- ── the serialisation point ───────────────────────────────────────────────
  -- The load is the only row two competing drivers share. Both accepts queue
  -- here, so the second one sees the first one's committed work instead of
  -- racing it to the trips constraint.
  select * into v_load
  from public.loads l
  where l.id = v_offer.load_id
  for update;

  -- Re-read the offer under the load lock and re-check EVERY precondition. The
  -- state read before the lock is not evidence of anything afterwards.
  select * into v_offer
  from public.offers o
  where o.id = v_offer.id
  for update;

  if v_offer.status <> 'pending' then
    raise exception 'offer already resolved' using errcode = 'check_violation';
  end if;

  if v_offer.expires_at <= now() then
    update public.offers set status = 'expired' where id = v_offer.id;
    raise exception 'offer expired' using errcode = 'check_violation';
  end if;

  -- ── decline ───────────────────────────────────────────────────────────────
  if not p_accept then
    update public.offers set status = 'declined' where id = v_offer.id;

    -- If that was the last LIVE offer, the load has no one working on it and must
    -- go back to the dispatcher rather than sitting in 'matched' unnoticed.
    --
    -- `expires_at > now()` is load-bearing, not decoration. Offers expire lazily —
    -- nothing sweeps them except `ops_sweep_expired_offers` below — so a sibling
    -- offer that timed out days ago is still status 'pending' in the table. Without
    -- the expiry clause this load would wait forever for a decline that can no
    -- longer come.
    if not exists (
      select 1 from public.offers o
      where o.load_id = v_offer.load_id
        and o.status = 'pending'
        and o.expires_at > now()
    ) then
      update public.loads set status = 'finding_truck'
      where id = v_offer.load_id and status = 'matched';
    end if;

    return null;
  end if;

  -- ── accept ────────────────────────────────────────────────────────────────

  -- The verification gate. Off for MVP hand-onboarding; flip the setting before
  -- open driver signup so "100% verified drivers" stays true.
  if private.setting_bool('require_verified_driver', false)
     and not private.is_verified_driver(v_actor) then
    raise exception 'driver not verified' using errcode = 'insufficient_privilege';
  end if;

  -- The loser of the race lands here, having waited on the lock above. A domain
  -- error, not a constraint violation: the client can only apologise usefully for
  -- something it can recognise.
  if v_load.status not in ('posted', 'finding_truck', 'matched') then
    update public.offers set status = 'expired' where id = v_offer.id;
    raise exception 'load already assigned' using errcode = 'check_violation';
  end if;

  -- Truck resolution, unchanged from 0009: prefer the leg's truck, fall back to
  -- the driver's own only when they own exactly one, never guess a plate.
  select l.truck_id into v_truck from public.legs l where l.id = v_offer.leg_id;

  if v_truck is null then
    if (select count(*) from public.trucks t where t.owner_id = v_actor) = 1 then
      select t.id into v_truck from public.trucks t where t.owner_id = v_actor;
    end if;
  end if;

  begin
    insert into public.trips (load_id, driver_id, truck_id, leg_id, status)
    values (v_offer.load_id, v_actor, v_truck, v_offer.leg_id, 'assigned')
    returning id into v_trip_id;
  exception when unique_violation then
    -- Unreachable: the load lock above serialises this. An unreachable branch
    -- that fires means an assumption broke, so it reports the same domain error
    -- rather than leaking the constraint name.
    raise exception 'load already assigned' using errcode = 'check_violation';
  end;

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

-- ═══ NO MATCH, FROM ANY STATE A DISPATCHER CAN STILL FIX ════════════════════
-- 'posted' alone was the bug: the state a stuck load actually reaches is
-- 'matched'. 'finding_truck' is included so a double tap is idempotent rather
-- than an error. 'assigned' and beyond stay excluded — a truck is already on it.

create or replace function public.ops_mark_finding_truck(p_load_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  update public.loads
     set status = 'finding_truck'
   where id = p_load_id
     and status in ('posted', 'finding_truck', 'matched');

  if not found then
    raise exception 'load not open' using errcode = 'check_violation';
  end if;

  -- Take back any offer still outstanding. Leaving them live would put the load in
  -- the dispatcher's "needs a decision" list while a driver can still accept it —
  -- two people arranging the same truck, and whichever loses has already told a
  -- customer something.
  --
  -- The cost is real and accepted: a driver mid-decision loses the offer.
  update public.offers set status = 'expired'
  where load_id = p_load_id and status = 'pending';
end;
$$;

revoke all on function public.ops_mark_finding_truck(uuid) from public, anon;
grant execute on function public.ops_mark_finding_truck(uuid) to authenticated;

-- ═══ RECLAIM LOADS WHOSE OFFERS QUIETLY TIMED OUT ═══════════════════════════
-- Offers expire lazily: `expires_at` passes and nothing happens until the owning
-- driver calls `respond_to_offer` on it — which, for an offer they are ignoring,
-- is never. The load sits in 'matched' looking worked-on.
--
-- The decline path above works around this when a sibling offer exists. This
-- closes it properly. Auto-dispatch makes it common: a machine sends three
-- offers, all three drivers ignore them, and 48 hours later nothing has changed.
--
-- Ops-triggered rather than scheduled: `pg_cron` is not enabled on this project,
-- and a sweeper that silently does not run is worse than one a dispatcher pulls.

create or replace function public.ops_sweep_expired_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_swept integer;
begin
  perform private.require_ops();

  with expired as (
    update public.offers
       set status = 'expired'
     where status = 'pending'
       and expires_at <= now()
    returning load_id
  )
  select count(distinct load_id) into v_swept from expired;

  -- Any load left with no live offer goes back to the dispatcher. Same liveness
  -- test as the decline path, for the same reason.
  update public.loads l
     set status = 'finding_truck'
   where l.status = 'matched'
     and not exists (
       select 1 from public.offers o
       where o.load_id = l.id
         and o.status = 'pending'
         and o.expires_at > now()
     );

  return coalesce(v_swept, 0);
end;
$$;

revoke all on function public.ops_sweep_expired_offers() from public, anon;
grant execute on function public.ops_sweep_expired_offers() to authenticated;
