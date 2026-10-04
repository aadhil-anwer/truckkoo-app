-- 0063 · Ops console v2, phase 4: bids for staff; award and extend for owners.
--
-- Spec: ~/truckkoo-ops/docs/superpowers/specs/2026-10-05-ops-console-v2-design.md
-- §5.3, §6.2. Award and extend reuse the shipper's own machinery
-- (private.award_bid, extend_bidding's rules) so pushes, the trip and the
-- offers move exactly as when a shipper does it. What changes is who may:
-- an owner with a fresh 2FA code, a reason, an audit row and an email.
--
-- No "force any status" is added: ops_set_load_status / ops_set_trip_status
-- (0016) already allow every legal transition with its cascades. A raw force
-- would skip them and leave contradictions behind.

-- The fee split, for staff only. Shippers see totals and drivers payouts
-- (0045); only here are both on one row.
create or replace function public.ops_load_bids(p_load_id uuid)
returns table (bid_id uuid, driver_id uuid, driver_name text, payout_baisa bigint,
               total_baisa bigint, fee_baisa bigint, submitted_at timestamptz,
               eligible boolean, selected boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  if not exists (select 1 from public.loads l where l.id = p_load_id and l.pricing_mode = 'bid') then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  return query
    select b.id, b.driver_id, p.full_name, b.payout_baisa,
           private.bid_total(b.payout_baisa, bl.fee_bps),
           private.bid_total(b.payout_baisa, bl.fee_bps) - b.payout_baisa,
           b.created_at,
           o.status <> 'declined' and private.bid_driver_eligible(b.load_id, b.driver_id),
           l.selected_bid_id is not distinct from b.id
      from private.driver_bids b
      join public.loads l on l.id = b.load_id
      join private.bid_loads bl on bl.load_id = b.load_id
      join public.profiles p on p.id = b.driver_id
      join public.offers o on o.id = b.offer_id
     where b.load_id = p_load_id
     order by b.payout_baisa, b.created_at;
end;
$$;
revoke all on function public.ops_load_bids(uuid) from public, anon;
grant execute on function public.ops_load_bids(uuid) to authenticated;

create or replace function public.ops_award_bid(p_load_id uuid, p_bid_id uuid, p_reason text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_load   public.loads;
  v_bid    private.driver_bids;
  v_offer  text;
  v_trip   uuid;
begin
  perform private.require_owner_fresh();
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'an override needs a reason' using errcode = 'check_violation';
  end if;
  select * into v_load from public.loads l where l.id = p_load_id for update;
  if v_load.id is null or v_load.pricing_mode <> 'bid' then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  if v_load.status not in ('posted'::public.load_status, 'matched'::public.load_status,
                           'quoted'::public.load_status, 'finding_truck'::public.load_status)
     or exists (select 1 from public.trips t where t.load_id = p_load_id and t.status <> 'cancelled'::public.trip_status) then
    raise exception 'this load already has a driver' using errcode = 'check_violation';
  end if;
  select * into v_bid from private.driver_bids b where b.id = p_bid_id and b.load_id = p_load_id;
  if v_bid.id is null then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  select o.status::text into v_offer from public.offers o where o.id = v_bid.offer_id;
  if v_offer = 'declined' or not private.bid_driver_eligible(p_load_id, v_bid.driver_id) then
    raise exception 'That driver can no longer take it' using errcode = 'check_violation';
  end if;

  v_trip := private.award_bid(p_load_id, v_bid.id);

  perform private.log_ops('ops_award_bid', 'load', p_load_id::text,
    jsonb_build_object('status', v_load.status, 'selected_bid_id', v_load.selected_bid_id),
    jsonb_build_object('bid_id', v_bid.id, 'trip_id', v_trip, 'payout_baisa', v_bid.payout_baisa),
    p_reason);
  perform private.system_raise_alert('owner_override',
    format('Owner override: bid awarded on load %s. See ops_audit.', upper(left(p_load_id::text, 8))),
    jsonb_build_object('action', 'ops_award_bid', 'load_id', p_load_id, 'trip_id', v_trip));
  return v_trip;
end;
$$;
revoke all on function public.ops_award_bid(uuid, uuid, text) from public, anon;
grant execute on function public.ops_award_bid(uuid, uuid, text) to authenticated;

create or replace function public.ops_extend_bidding(p_load_id uuid, p_minutes integer, p_reason text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_load public.loads;
  v_new  timestamptz;
begin
  perform private.require_owner_fresh();
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'an override needs a reason' using errcode = 'check_violation';
  end if;
  select * into v_load from public.loads l where l.id = p_load_id for update;
  if v_load.id is null or v_load.pricing_mode <> 'bid' then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  -- The shipper's rules (extend_bidding, 0045), unchanged.
  if v_load.bid_deadline <= now() or v_load.selected_bid_id is not null
     or v_load.status not in ('posted'::public.load_status, 'matched'::public.load_status)
     or p_minutes is null or p_minutes not between 5 and 1440 then
    raise exception 'cannot extend bidding' using errcode = 'check_violation';
  end if;
  v_new := v_load.bid_deadline + make_interval(mins => p_minutes);
  if v_new > v_load.created_at + interval '24 hours'
     or v_new > (v_load.pickup_to + 1)::timestamp at time zone 'Asia/Muscat' then
    raise exception 'bidding deadline too late' using errcode = 'check_violation';
  end if;
  update public.loads set bid_deadline = v_new where id = p_load_id;
  update public.offers set expires_at = v_new
   where load_id = p_load_id and source = 'bid' and status = 'pending';

  perform private.log_ops('ops_extend_bidding', 'load', p_load_id::text,
    jsonb_build_object('bid_deadline', v_load.bid_deadline), jsonb_build_object('bid_deadline', v_new), p_reason);
  perform private.system_raise_alert('owner_override',
    format('Owner override: bidding extended on load %s to %s. See ops_audit.',
           upper(left(p_load_id::text, 8)), to_char(v_new at time zone 'Asia/Muscat', 'HH24:MI')),
    jsonb_build_object('action', 'ops_extend_bidding', 'load_id', p_load_id));
  return v_new;
end;
$$;
revoke all on function public.ops_extend_bidding(uuid, integer, text) from public, anon;
grant execute on function public.ops_extend_bidding(uuid, integer, text) to authenticated;
