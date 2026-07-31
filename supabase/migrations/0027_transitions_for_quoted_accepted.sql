-- ═══════════════════════════════════════════════════════════════════════════
-- 0027 · A dispatcher can move a load out of `quoted` and `accepted`
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0022 added two statuses. `private.load_transition_ok` was written in 0016 and
-- ends in `else false`, so it answered false for every move out of either of
-- them — including `cancelled`.
--
-- That is a dead end, on the ops side of the same rule that forbids one on the
-- shipper's side. And it lands on exactly the two states a load is most likely
-- to get stuck in:
--
--   `quoted`    the shipper was sent a price and has not answered. Days pass.
--   `accepted`  they said yes and no driver has taken it.
--
-- Both need a human to be able to do something, and until this migration the
-- only thing a dispatcher could do with either was watch. `ops_set_load_status`
-- refused every target, so a load whose shipper went quiet could not even be
-- cancelled — it sat in the queue forever.
--
-- Found by running the ops console against the reordered schema rather than by
-- reading it. The end-to-end walk added in P4b passes straight through both
-- states on the happy path, so it never asked this question.

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

    -- A price is sitting with the shipper. The dispatcher may take it back into
    -- the hunt or drop it, and NOTHING ELSE: moving `quoted` forward by hand
    -- would dispatch a load at a price nobody agreed to, which is the entire
    -- thing the reorder exists to prevent. Only `accept_quote` leaves this state
    -- forwards, and only the shipper can call it.
    when 'quoted' then p_to in ('posted', 'finding_truck', 'cancelled')

    -- The shipper agreed and no truck has taken it yet. `matched` is reachable
    -- because a dispatcher may offer it by hand; `posted` is NOT, because a load
    -- that has been agreed is past the stage `posted` describes and putting it
    -- back there loses the fact that someone said yes.
    --
    -- `loads.accepted_at` outlives all of these (0026), so a load walked back to
    -- `finding_truck` still cannot be silently re-priced. Re-pricing an agreed
    -- load is a new quote the shipper decides on again — by design, and now by
    -- construction.
    when 'accepted' then p_to in ('finding_truck', 'matched', 'cancelled')

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

comment on function private.load_transition_ok(public.load_status, public.load_status) is
  'The load state machine, and the only authority on it. The ops console mirrors '
  'this in nextLoadStatuses() as a courtesy so the UI does not offer a move that '
  'will be refused — if the two drift, this one wins.';
