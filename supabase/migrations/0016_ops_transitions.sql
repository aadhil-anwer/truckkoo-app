-- ─────────────────────────────────────────────────────────────────────────────
-- 0016 — dispatcher state transitions
--
-- WHY THIS EXISTS
--
-- Until now a dispatcher could do exactly three things: send an offer, set a
-- price, and mark a load `finding_truck`. Everything else was unreachable. A
-- load stuck in `matched` behind a driver who never answered, a trip whose
-- driver changed truck, a cancellation phoned in — none of it had a path, so the
-- only remedy was a hand-written UPDATE in the SQL editor, which is worse than a
-- guarded RPC in every way: unaudited, unvalidated, and available to anyone with
-- the database password rather than to an appointed dispatcher.
--
-- THE SHAPE OF "GOD MODE"
--
-- Every transition is checked against an explicit matrix. This is not timidity —
-- the dispatcher can reach any reachable state, unstick anything, and reverse
-- almost anything. What the matrix refuses are the moves that leave the data
-- lying: a load in `assigned` with no trip, a `delivered` load walked back to
-- `posted` while its trip still points at it. Those are not powers, they are
-- corruption, and an operator who "successfully" performs one has been failed by
-- the tool.
--
-- Two invariants are enforced separately from the matrix, because they are about
-- rows other than the one being changed:
--
--   * a load in assigned|in_transit|delivered must have a trip
--   * moving a load back before `assigned` must take its trip with it
--
-- EVERY WRITE IS AUDITED
--
-- Including the four that already existed. `ops_send_offer`, `ops_set_price`,
-- `ops_mark_finding_truck` and `ops_sweep_expired_offers` are recreated at the
-- bottom of this file solely to add `private.log_ops`. "Every privileged write is
-- recorded" is only true if it is true of all of them, and an audit log with four
-- known holes is worse than none — it invites the assumption that silence means
-- nothing happened.
--
-- A REASON IS MANDATORY on anything that changes a state a human chose. Six
-- months later, `matched -> finding_truck` at 02:00 is either a dispatcher
-- unsticking a dead offer or an account takeover, and only the reason field
-- tells them apart.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. THE TRANSITION MATRICES ══════════════════════════════════════════════

create or replace function private.load_transition_ok(
  p_from public.load_status,
  p_to   public.load_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    -- Pre-assignment: freely interchangeable. These three differ only in what
    -- the shipper is told, and a dispatcher owns that message.
    when 'posted'        then p_to in ('finding_truck', 'matched', 'cancelled')
    when 'finding_truck' then p_to in ('posted', 'matched', 'cancelled')
    when 'matched'       then p_to in ('posted', 'finding_truck', 'cancelled')

    -- Post-assignment. Going backwards is allowed — a driver drops out and the
    -- load must return to the dispatcher rather than sit assigned to nobody —
    -- but it drags the trip with it. See ops_set_load_status.
    when 'assigned'   then p_to in ('posted', 'finding_truck', 'matched', 'in_transit', 'cancelled')
    when 'in_transit' then p_to in ('assigned', 'delivered', 'cancelled')

    -- Delivered can be walked back (marked too early, by phone) or closed out.
    when 'delivered' then p_to in ('in_transit', 'closed')
    -- Closed reopens only to delivered: a dispute, not a restart.
    when 'closed'    then p_to in ('delivered')

    -- Cancelled revives to `posted` only. Reviving straight into `matched` would
    -- claim offers that were expired when it was cancelled.
    when 'cancelled' then p_to in ('posted')
    else false
  end;
$$;

revoke all on function private.load_transition_ok(public.load_status, public.load_status)
  from public, anon, authenticated;

create or replace function private.trip_transition_ok(
  p_from public.trip_status,
  p_to   public.trip_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'assigned'   then p_to in ('in_transit', 'delivered', 'cancelled')
    when 'in_transit' then p_to in ('assigned', 'delivered', 'cancelled')
    when 'delivered'  then p_to in ('in_transit', 'closed')
    when 'closed'     then p_to in ('delivered')
    -- A cancelled trip is terminal. Reviving it would resurrect a row the load
    -- has already moved on from; post the load again instead.
    when 'cancelled'  then false
    else false
  end;
$$;

revoke all on function private.trip_transition_ok(public.trip_status, public.trip_status)
  from public, anon, authenticated;

/*
 * A reason is not optional. Enforced in one place so no call site can decide it
 * is the exception.
 */
create or replace function private.require_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a reason is required for this change'
      using errcode = 'check_violation';
  end if;
  return left(btrim(p_reason), 500);
end;
$$;

revoke all on function private.require_reason(text) from public, anon, authenticated;

-- ═══ 2. LOAD STATUS ══════════════════════════════════════════════════════════

create or replace function public.ops_set_load_status(
  p_load_id uuid,
  p_status  public.load_status,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_load    public.loads;
  v_before  jsonb;
  v_trip    public.trips;
  v_reason  text;
begin
  perform private.require_ops();
  v_reason := private.require_reason(p_reason);
  -- A compromised dispatcher session bulk-cancelling the book is the failure
  -- this bounds. 300/hour is far above any real day's work.
  perform private.check_rate_limit('ops_set_load_status', 300, interval '1 hour');

  select * into v_load from public.loads l where l.id = p_load_id for update;
  if v_load.id is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;

  if v_load.status = p_status then
    raise exception 'load is already %', p_status using errcode = 'check_violation';
  end if;

  if not private.load_transition_ok(v_load.status, p_status) then
    raise exception 'cannot move a load from % to %', v_load.status, p_status
      using errcode = 'check_violation';
  end if;

  v_before := to_jsonb(v_load);
  select * into v_trip from public.trips t where t.load_id = p_load_id for update;

  -- A load cannot claim to be on a truck without a trip saying which one.
  if p_status in ('assigned', 'in_transit', 'delivered') and v_trip.id is null then
    raise exception
      'a load cannot be % with no trip — accept an offer for a driver first', p_status
      using errcode = 'check_violation';
  end if;

  -- ── cascades ──────────────────────────────────────────────────────────────

  if p_status = 'cancelled' then
    update public.offers set status = 'expired'
    where load_id = p_load_id and status in ('pending', 'accepted');

    if v_trip.id is not null and v_trip.status not in ('cancelled', 'closed') then
      update public.trips set status = 'cancelled' where id = v_trip.id;
      insert into public.trip_events (trip_id, type, note)
      values (v_trip.id, 'note', 'Load cancelled by dispatch: ' || v_reason);
    end if;

    -- The leg is supply again. It was matched to a load that no longer exists.
    update public.legs set status = 'open'
    where id = v_trip.leg_id and status = 'matched';

  elsif p_status in ('posted', 'finding_truck', 'matched')
        and v_load.status in ('assigned', 'in_transit', 'delivered') then
    -- Walking a load back before assignment must take its trip with it,
    -- otherwise a live trip points at a load that says nobody is carrying it.
    if v_trip.id is not null and v_trip.status not in ('cancelled', 'closed') then
      update public.trips set status = 'cancelled' where id = v_trip.id;
      insert into public.trip_events (trip_id, type, note)
      values (v_trip.id, 'note', 'Returned to dispatch: ' || v_reason);
      update public.legs set status = 'open'
      where id = v_trip.leg_id and status = 'matched';
    end if;

    update public.offers set status = 'expired'
    where load_id = p_load_id and status in ('pending', 'accepted');

  elsif p_status = 'posted' and v_load.status = 'cancelled' then
    -- Reviving. Offers stay dead; the load is genuinely starting again.
    null;
  end if;

  update public.loads set status = p_status where id = p_load_id;

  perform private.log_ops(
    'ops_set_load_status', 'load', p_load_id::text,
    v_before,
    (select to_jsonb(l) from public.loads l where l.id = p_load_id),
    v_reason
  );
end;
$$;

revoke all on function public.ops_set_load_status(uuid, public.load_status, text)
  from public, anon;
grant execute on function public.ops_set_load_status(uuid, public.load_status, text)
  to authenticated;

-- ═══ 3. TRIP STATUS ══════════════════════════════════════════════════════════
--
-- NOTE ON PROOF OF DELIVERY. `advance_trip` (the driver's path) refuses to mark
-- a trip delivered without a photo, and that stays true. This function does not
-- require one, because the case it exists for is a driver ringing in from a
-- place with no signal — refusing would either lose the delivery record or push
-- the dispatcher back to a raw UPDATE.
--
-- That is a real weakening and it is made visible rather than hidden: the trip
-- event says the delivery was recorded by dispatch without proof, and the audit
-- row carries the dispatcher and the reason. A delivery with no photo is now a
-- thing you can find and count, which it was not before.

create or replace function public.ops_set_trip_status(
  p_trip_id uuid,
  p_status  public.trip_status,
  p_reason  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip   public.trips;
  v_before jsonb;
  v_reason text;
begin
  perform private.require_ops();
  v_reason := private.require_reason(p_reason);
  perform private.check_rate_limit('ops_set_trip_status', 300, interval '1 hour');

  select * into v_trip from public.trips t where t.id = p_trip_id for update;
  if v_trip.id is null then
    raise exception 'trip not found' using errcode = 'no_data_found';
  end if;

  if v_trip.status = p_status then
    raise exception 'trip is already %', p_status using errcode = 'check_violation';
  end if;

  if not private.trip_transition_ok(v_trip.status, p_status) then
    raise exception 'cannot move a trip from % to %', v_trip.status, p_status
      using errcode = 'check_violation';
  end if;

  v_before := to_jsonb(v_trip);

  update public.trips set status = p_status where id = p_trip_id;

  -- The load follows the trip. A cancelled trip returns the load to the
  -- dispatcher — never to a dead end, which is the product's stated promise.
  update public.loads set status = case p_status
    when 'assigned'   then 'assigned'::public.load_status
    when 'in_transit' then 'in_transit'::public.load_status
    when 'delivered'  then 'delivered'::public.load_status
    when 'closed'     then 'closed'::public.load_status
    when 'cancelled'  then 'finding_truck'::public.load_status
  end
  where id = v_trip.load_id;

  if p_status = 'cancelled' then
    update public.offers set status = 'expired'
    where load_id = v_trip.load_id and status in ('pending', 'accepted');
    update public.legs set status = 'open'
    where id = v_trip.leg_id and status = 'matched';
  end if;

  insert into public.trip_events (trip_id, type, note)
  values (
    v_trip.id,
    case p_status
      when 'in_transit' then 'en_route'
      when 'delivered'  then 'delivered'
      else 'note'
    end,
    case
      when p_status = 'delivered'
        then 'Marked delivered by dispatch without proof photo: ' || v_reason
      else 'Set to ' || p_status || ' by dispatch: ' || v_reason
    end
  );

  perform private.log_ops(
    'ops_set_trip_status', 'trip', p_trip_id::text,
    v_before,
    (select to_jsonb(t) from public.trips t where t.id = p_trip_id),
    v_reason
  );
end;
$$;

revoke all on function public.ops_set_trip_status(uuid, public.trip_status, text)
  from public, anon;
grant execute on function public.ops_set_trip_status(uuid, public.trip_status, text)
  to authenticated;

-- Change who is carrying a load, and in what. The common case is a driver
-- swapping truck; the harder one is handing the job to someone else entirely.
create or replace function public.ops_reassign_trip(
  p_trip_id   uuid,
  p_driver_id uuid,
  p_truck_id  uuid,
  p_reason    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip   public.trips;
  v_before jsonb;
  v_reason text;
  v_role   public.user_role;
begin
  perform private.require_ops();
  v_reason := private.require_reason(p_reason);
  perform private.check_rate_limit('ops_reassign_trip', 100, interval '1 hour');

  select * into v_trip from public.trips t where t.id = p_trip_id for update;
  if v_trip.id is null then
    raise exception 'trip not found' using errcode = 'no_data_found';
  end if;

  if v_trip.status in ('delivered', 'closed', 'cancelled') then
    raise exception 'cannot reassign a % trip', v_trip.status
      using errcode = 'check_violation';
  end if;

  select p.role into v_role from public.profiles p where p.id = p_driver_id;
  if v_role is null then
    raise exception 'driver not found' using errcode = 'no_data_found';
  end if;
  if v_role <> 'driver' then
    raise exception 'that account is a shipper, not a driver'
      using errcode = 'check_violation';
  end if;

  -- The truck must belong to the driver. Without this check a dispatcher could
  -- put one operator's plate on another operator's trip, which is a paperwork
  -- lie with real consequences at a checkpoint.
  if p_truck_id is not null and not exists (
    select 1 from public.trucks t where t.id = p_truck_id and t.owner_id = p_driver_id
  ) then
    raise exception 'that truck does not belong to that driver'
      using errcode = 'check_violation';
  end if;

  -- The verification gate applies to a reassignment exactly as it does to an
  -- acceptance. Otherwise it is a one-step bypass of "100% verified drivers".
  if private.setting_bool('require_verified_driver', false)
     and not private.is_verified_driver(p_driver_id) then
    raise exception 'that driver is not verified'
      using errcode = 'insufficient_privilege';
  end if;

  v_before := to_jsonb(v_trip);

  -- The old leg goes back to being supply; the new trip is not tied to one,
  -- because the dispatcher chose the driver directly rather than off a leg.
  update public.legs set status = 'open'
  where id = v_trip.leg_id and status = 'matched';

  update public.trips
  set driver_id = p_driver_id, truck_id = p_truck_id, leg_id = null
  where id = p_trip_id;

  insert into public.trip_events (trip_id, type, note)
  values (v_trip.id, 'note', 'Reassigned by dispatch: ' || v_reason);

  perform private.log_ops(
    'ops_reassign_trip', 'trip', p_trip_id::text,
    v_before,
    (select to_jsonb(t) from public.trips t where t.id = p_trip_id),
    v_reason
  );
end;
$$;

revoke all on function public.ops_reassign_trip(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.ops_reassign_trip(uuid, uuid, uuid, text) to authenticated;

-- A note on a trip. The dispatcher's half of a phone call, written down where
-- the next person to look at this trip will find it.
create or replace function public.ops_add_trip_note(p_trip_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip  public.trips;
  v_note  text;
  v_id    uuid;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_add_trip_note', 300, interval '1 hour');

  if p_note is null or char_length(btrim(p_note)) = 0 then
    raise exception 'a note cannot be empty' using errcode = 'check_violation';
  end if;
  -- trip_events.note is capped at 500 by constraint; clamp rather than fail on
  -- a dispatcher's long paste.
  v_note := left(btrim(p_note), 500);

  if private.contains_unsafe_text(v_note) then
    raise exception 'that note contains disallowed characters'
      using errcode = 'check_violation';
  end if;

  select * into v_trip from public.trips t where t.id = p_trip_id;
  if v_trip.id is null then
    raise exception 'trip not found' using errcode = 'no_data_found';
  end if;

  insert into public.trip_events (trip_id, type, note)
  values (p_trip_id, 'note', v_note)
  returning id into v_id;

  perform private.log_ops(
    'ops_add_trip_note', 'trip', p_trip_id::text, null,
    jsonb_build_object('event_id', v_id), v_note
  );

  return v_id;
end;
$$;

revoke all on function public.ops_add_trip_note(uuid, text) from public, anon;
grant execute on function public.ops_add_trip_note(uuid, text) to authenticated;

-- ═══ 4. OFFERS ═══════════════════════════════════════════════════════════════
--
-- The accept path is factored out of `respond_to_offer` rather than copied.
-- Trip creation, the truck-resolution rule, the sibling-offer expiry and the
-- load lock all have exactly one implementation; a second one would diverge, and
-- the first symptom would be two trips for one load.

create or replace function private.accept_offer(
  p_offer_id  uuid,
  p_driver_id uuid,
  p_by_ops    boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer   public.offers;
  v_load    public.loads;
  v_truck   uuid;
  v_trip_id uuid;
begin
  -- The serialisation point, unchanged from 0013: the load is the only row two
  -- competing drivers share, so both accepts queue here rather than racing to
  -- the trips unique constraint. Lock order is load-then-offer everywhere.
  select * into v_load from public.loads l where l.id = (
    select o.load_id from public.offers o where o.id = p_offer_id
  ) for update;

  select * into v_offer from public.offers o where o.id = p_offer_id for update;

  if v_offer.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'offer already resolved' using errcode = 'check_violation';
  end if;

  -- A dispatcher accepting on the phone may well be doing it because the offer
  -- just lapsed and nothing has swept it. That is the case this exists for, so
  -- ops is allowed past expiry; the driver's own path is not.
  if v_offer.expires_at <= now() and not p_by_ops then
    update public.offers set status = 'expired' where id = v_offer.id;
    raise exception 'offer expired' using errcode = 'check_violation';
  end if;

  -- The verification gate applies to ops too. If it did not, accepting "on
  -- behalf of" a driver would be a one-call bypass of the public claim that
  -- every Truckkoo driver is verified.
  if private.setting_bool('require_verified_driver', false)
     and not private.is_verified_driver(p_driver_id) then
    raise exception 'driver not verified' using errcode = 'insufficient_privilege';
  end if;

  if v_load.status not in ('posted', 'finding_truck', 'matched') then
    update public.offers set status = 'expired' where id = v_offer.id;
    raise exception 'load already assigned' using errcode = 'check_violation';
  end if;

  -- Truck resolution, unchanged from 0009: prefer the leg's truck, fall back to
  -- the driver's own only when they own exactly one, never guess a plate.
  select l.truck_id into v_truck from public.legs l where l.id = v_offer.leg_id;
  if v_truck is null then
    if (select count(*) from public.trucks t where t.owner_id = p_driver_id) = 1 then
      select t.id into v_truck from public.trucks t where t.owner_id = p_driver_id;
    end if;
  end if;

  begin
    insert into public.trips (load_id, driver_id, truck_id, leg_id, status)
    values (v_offer.load_id, p_driver_id, v_truck, v_offer.leg_id, 'assigned')
    returning id into v_trip_id;
  exception when unique_violation then
    raise exception 'load already assigned' using errcode = 'check_violation';
  end;

  update public.offers set status = 'accepted' where id = v_offer.id;
  update public.offers set status = 'expired'
  where load_id = v_offer.load_id and id <> v_offer.id and status = 'pending';

  update public.loads set status = 'assigned' where id = v_offer.load_id;
  update public.legs  set status = 'matched'  where id = v_offer.leg_id;

  return v_trip_id;
end;
$$;

revoke all on function private.accept_offer(uuid, uuid, boolean)
  from public, anon, authenticated;

-- Recreated to delegate. The driver-facing behaviour is unchanged: still scoped
-- to auth.uid(), still indistinguishable between "not found" and "not yours",
-- still refuses an expired offer.
create or replace function public.respond_to_offer(p_offer_id uuid, p_accept boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_offer public.offers;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Fetch SCOPED TO THE ACTOR, never fetch-then-check. No lock yet: locking the
  -- offer here and the load later would take two locks in the opposite order to
  -- accept_offer, which is how deadlocks are built.
  select * into v_offer
  from public.offers o
  where o.id = p_offer_id and o.driver_id = v_actor;

  if v_offer.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;

  if p_accept then
    return private.accept_offer(p_offer_id, v_actor, false);
  end if;

  -- ── decline ───────────────────────────────────────────────────────────────
  select * into v_offer from public.offers o where o.id = p_offer_id for update;

  if v_offer.status <> 'pending' then
    raise exception 'offer already resolved' using errcode = 'check_violation';
  end if;
  if v_offer.expires_at <= now() then
    update public.offers set status = 'expired' where id = v_offer.id;
    raise exception 'offer expired' using errcode = 'check_violation';
  end if;

  update public.offers set status = 'declined' where id = v_offer.id;

  -- If that was the last LIVE offer the load has nobody working on it and must
  -- go back to the dispatcher rather than sitting in 'matched' unnoticed.
  --
  -- `expires_at > now()` is load-bearing: offers expire lazily, so a sibling
  -- that timed out days ago is still status 'pending' in the table. Without the
  -- expiry clause this load waits forever for a decline that cannot come.
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
end;
$$;

revoke all on function public.respond_to_offer(uuid, boolean) from public, anon;
grant execute on function public.respond_to_offer(uuid, boolean) to authenticated;

/*
 * The dispatcher accepts for a driver who rang in.
 *
 * This is the highest-value function in the migration. The product's users have
 * near-zero tech skills; a driver who has decided to take a load by telephone
 * should not lose it because the app defeated them. Before this, that call ended
 * with the dispatcher either talking the driver through the screen or editing
 * the database by hand.
 */
create or replace function public.ops_accept_offer_for_driver(
  p_offer_id uuid,
  p_reason   text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer   public.offers;
  v_reason  text;
  v_trip_id uuid;
begin
  perform private.require_ops();
  v_reason := private.require_reason(p_reason);
  perform private.check_rate_limit('ops_accept_offer_for_driver', 100, interval '1 hour');

  select * into v_offer from public.offers o where o.id = p_offer_id;
  if v_offer.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;

  v_trip_id := private.accept_offer(p_offer_id, v_offer.driver_id, true);

  -- Written on the trip, not only in the audit log, so the next person to open
  -- this trip can see that the driver never touched a screen.
  insert into public.trip_events (trip_id, type, note)
  values (v_trip_id, 'note', 'Accepted by dispatch on the driver''s behalf: ' || v_reason);

  perform private.log_ops(
    'ops_accept_offer_for_driver', 'offer', p_offer_id::text,
    to_jsonb(v_offer),
    jsonb_build_object('trip_id', v_trip_id, 'driver_id', v_offer.driver_id),
    v_reason
  );

  return v_trip_id;
end;
$$;

revoke all on function public.ops_accept_offer_for_driver(uuid, text) from public, anon;
grant execute on function public.ops_accept_offer_for_driver(uuid, text) to authenticated;

-- Kill a single offer. The blunt version of the sweep, for the driver who has
-- stopped answering.
create or replace function public.ops_expire_offer(p_offer_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer  public.offers;
  v_reason text;
begin
  perform private.require_ops();
  v_reason := private.require_reason(p_reason);
  perform private.check_rate_limit('ops_expire_offer', 300, interval '1 hour');

  select * into v_offer from public.offers o where o.id = p_offer_id for update;
  if v_offer.id is null then
    raise exception 'offer not found' using errcode = 'no_data_found';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'that offer is already %', v_offer.status
      using errcode = 'check_violation';
  end if;

  update public.offers set status = 'expired' where id = p_offer_id;

  -- Same rule as a decline: if nothing live is left, the load returns to the
  -- dispatcher rather than sitting in 'matched' with nobody working on it.
  if not exists (
    select 1 from public.offers o
    where o.load_id = v_offer.load_id and o.status = 'pending' and o.expires_at > now()
  ) then
    update public.loads set status = 'finding_truck'
    where id = v_offer.load_id and status = 'matched';
  end if;

  perform private.log_ops(
    'ops_expire_offer', 'offer', p_offer_id::text,
    to_jsonb(v_offer),
    (select to_jsonb(o) from public.offers o where o.id = p_offer_id),
    v_reason
  );
end;
$$;

revoke all on function public.ops_expire_offer(uuid, text) from public, anon;
grant execute on function public.ops_expire_offer(uuid, text) to authenticated;

-- ═══ 5. LEGS ═════════════════════════════════════════════════════════════════

create or replace function public.ops_set_leg_status(
  p_leg_id uuid,
  p_status public.leg_status,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leg    public.legs;
  v_reason text;
begin
  perform private.require_ops();
  v_reason := private.require_reason(p_reason);
  perform private.check_rate_limit('ops_set_leg_status', 200, interval '1 hour');

  select * into v_leg from public.legs l where l.id = p_leg_id for update;
  if v_leg.id is null then
    raise exception 'leg not found' using errcode = 'no_data_found';
  end if;
  if v_leg.status = p_status then
    raise exception 'leg is already %', p_status using errcode = 'check_violation';
  end if;

  -- A leg carrying a live trip is not free to be reopened; the truck is busy.
  if p_status = 'open' and exists (
    select 1 from public.trips t
    where t.leg_id = p_leg_id and t.status in ('assigned', 'in_transit')
  ) then
    raise exception 'that leg is carrying a live trip'
      using errcode = 'check_violation';
  end if;

  update public.legs set status = p_status where id = p_leg_id;

  perform private.log_ops(
    'ops_set_leg_status', 'leg', p_leg_id::text,
    to_jsonb(v_leg),
    (select to_jsonb(l) from public.legs l where l.id = p_leg_id),
    v_reason
  );
end;
$$;

revoke all on function public.ops_set_leg_status(uuid, public.leg_status, text)
  from public, anon;
grant execute on function public.ops_set_leg_status(uuid, public.leg_status, text)
  to authenticated;

-- ═══ 6. TUNABLE MATCHING ═════════════════════════════════════════════════════
--
-- `ops_candidates` calls `candidates_for(load, 3, 2, 50)` with those numbers
-- hardcoded at the call site. A dispatcher who cannot find a truck has exactly
-- one lever available today, which is to give up. This exposes the three
-- parameters, clamped.
--
-- `private.candidates_for` itself stays ungranted: it is the load board with the
-- guard removed, and this function is its caller doing the checking.

create or replace function public.ops_candidates_tuned(
  p_load_id     uuid,
  p_max_tier    smallint default 3,
  p_grace_days  integer  default 2,
  p_limit       integer  default 50
)
returns table (
  tier         smallint,
  driver_id    uuid,
  driver_name  text,
  leg_id       uuid,
  leg_origin   bigint,
  leg_dest     bigint,
  depart_from  date,
  depart_to    date,
  is_empty     boolean,
  truck_id     uuid,
  truck_type   text,
  capacity_kg  integer,
  day_gap      integer,
  last_run_at  date,
  offer_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Clamped, not trusted. A 90-day grace window would return every driver in
  -- Oman as a "match" and quietly make the tiers meaningless.
  v_tier  smallint := least(greatest(coalesce(p_max_tier, 3), 1::smallint), 3::smallint);
  v_grace integer  := least(greatest(coalesce(p_grace_days, 2), 0), 14);
  v_limit integer  := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform private.require_ops();

  return query
  select * from private.candidates_for(p_load_id, v_tier, v_grace, v_limit);
end;
$$;

revoke all on function public.ops_candidates_tuned(uuid, smallint, integer, integer)
  from public, anon;
grant execute on function public.ops_candidates_tuned(uuid, smallint, integer, integer)
  to authenticated;

-- ═══ 7. THE FOUR THAT ALREADY EXISTED ════════════════════════════════════════
--
-- Recreated solely to write an audit row. An audit log with four known holes is
-- worse than no audit log, because it invites the assumption that silence means
-- nothing happened. Behaviour is otherwise unchanged.

create or replace function public.ops_send_offer(
  p_load_id   uuid,
  p_driver_id uuid,
  p_leg_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer_id uuid;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_send_offer', 200, interval '1 hour');

  if p_leg_id is not null and not exists (
    select 1 from public.legs l where l.id = p_leg_id and l.driver_id = p_driver_id
  ) then
    raise exception 'leg does not belong to that driver' using errcode = 'check_violation';
  end if;

  -- `true` is p_allow_resend: the dispatcher may re-offer a load a driver
  -- previously declined. The automated path may not.
  v_offer_id := public.create_offer(p_load_id, p_driver_id, p_leg_id, 'ops', true);

  perform private.log_ops(
    'ops_send_offer', 'load', p_load_id::text, null,
    jsonb_build_object('offer_id', v_offer_id, 'driver_id', p_driver_id, 'leg_id', p_leg_id),
    null
  );

  return v_offer_id;
end;
$$;

revoke all on function public.ops_send_offer(uuid, uuid, uuid) from public, anon;
grant execute on function public.ops_send_offer(uuid, uuid, uuid) to authenticated;

create or replace function public.ops_set_price(p_load_id uuid, p_price_baisa bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_load public.loads;
begin
  perform private.require_ops();

  -- Bounds, in integer baisa. 1,000,000,000 baisa is 1,000,000 OMR — far beyond
  -- any real freight movement, and the point is to catch a slipped decimal
  -- rather than to model a ceiling.
  if p_price_baisa is null or p_price_baisa <= 0 or p_price_baisa > 1000000000 then
    raise exception 'price out of range' using errcode = 'check_violation';
  end if;

  select * into v_load from public.loads l where l.id = p_load_id for update;
  if v_load.id is null or v_load.status not in ('posted', 'finding_truck', 'matched') then
    raise exception 'load not open' using errcode = 'no_data_found';
  end if;

  insert into public.quotes (
    shipper_id, load_id, origin_city, dest_city, truck_type_code, weight_kg,
    pickup_from, pickup_to, price_baisa, currency, outcome, rate_card_id
  )
  values (
    v_load.shipper_id, v_load.id, v_load.origin_city, v_load.dest_city,
    v_load.truck_type_code, v_load.weight_kg, v_load.pickup_from, v_load.pickup_to,
    p_price_baisa, v_load.currency, 'quoted', null
  );

  update public.loads set price_baisa = p_price_baisa where id = p_load_id;

  perform private.log_ops(
    'ops_set_price', 'load', p_load_id::text,
    jsonb_build_object('price_baisa', v_load.price_baisa),
    jsonb_build_object('price_baisa', p_price_baisa),
    null
  );
end;
$$;

revoke all on function public.ops_set_price(uuid, bigint) from public, anon;
grant execute on function public.ops_set_price(uuid, bigint) to authenticated;

create or replace function public.ops_mark_finding_truck(p_load_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.load_status;
begin
  perform private.require_ops();

  select l.status into v_before from public.loads l where l.id = p_load_id for update;

  update public.loads set status = 'finding_truck'
  where id = p_load_id and status in ('posted', 'finding_truck', 'matched');

  if not found then
    raise exception 'load not open' using errcode = 'no_data_found';
  end if;

  update public.offers set status = 'expired'
  where load_id = p_load_id and status = 'pending';

  perform private.log_ops(
    'ops_mark_finding_truck', 'load', p_load_id::text,
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', 'finding_truck'),
    null
  );
end;
$$;

revoke all on function public.ops_mark_finding_truck(uuid) from public, anon;
grant execute on function public.ops_mark_finding_truck(uuid) to authenticated;

create or replace function public.ops_sweep_expired_offers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform private.require_ops();

  with swept as (
    update public.offers set status = 'expired'
    where status = 'pending' and expires_at <= now()
    returning load_id
  )
  select count(distinct load_id) into v_count from swept;

  update public.loads set status = 'finding_truck'
  where status = 'matched'
    and not exists (
      select 1 from public.offers o
      where o.load_id = public.loads.id
        and o.status = 'pending'
        and o.expires_at > now()
    );

  -- Logged even when it sweeps nothing. "The sweep was run at 09:00 and found
  -- nothing" and "nobody ran the sweep" are different facts, and the second one
  -- is the failure mode 0013 created by making this a button.
  perform private.log_ops(
    'ops_sweep_expired_offers', 'system', 'offers', null,
    jsonb_build_object('loads_affected', v_count), null
  );

  return v_count;
end;
$$;

revoke all on function public.ops_sweep_expired_offers() from public, anon;
grant execute on function public.ops_sweep_expired_offers() to authenticated;
