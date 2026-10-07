-- Keep the existing audited ops implementation, including any deployment's
-- stronger staff guard, behind a private wrapper. Fixed-price actions must not
-- rewrite an auction's private fee/payout state or create fixed-price offers.
alter function public.ops_set_price(uuid, bigint) set schema private;
alter function private.ops_set_price(uuid, bigint) rename to ops_set_price_pre_bidding;
revoke all on function private.ops_set_price_pre_bidding(uuid, bigint) from public, anon, authenticated;

create function public.ops_set_price(p_load_id uuid, p_price_baisa bigint)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_mode text;
begin
  perform private.require_ops();
  select l.pricing_mode into v_mode from public.loads l where l.id = p_load_id for update;
  if v_mode is null then raise exception 'load not found' using errcode = 'no_data_found'; end if;
  if v_mode = 'bid' then raise exception 'bid loads are priced by driver bids'
    using errcode = 'check_violation'; end if;
  perform private.ops_set_price_pre_bidding(p_load_id, p_price_baisa);
end $$;
revoke all on function public.ops_set_price(uuid, bigint) from public, anon;
grant execute on function public.ops_set_price(uuid, bigint) to authenticated;

alter function public.ops_send_offer(uuid, uuid, uuid) set schema private;
alter function private.ops_send_offer(uuid, uuid, uuid) rename to ops_send_offer_pre_bidding;
revoke all on function private.ops_send_offer_pre_bidding(uuid, uuid, uuid) from public, anon, authenticated;

create function public.ops_send_offer(p_load_id uuid, p_driver_id uuid, p_leg_id uuid default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_mode text;
begin
  perform private.require_ops();
  select l.pricing_mode into v_mode from public.loads l where l.id = p_load_id for update;
  if v_mode is null then raise exception 'load not found' using errcode = 'no_data_found'; end if;
  if v_mode = 'bid' then raise exception 'bid loads use bidding invitations'
    using errcode = 'check_violation'; end if;
  return private.ops_send_offer_pre_bidding(p_load_id, p_driver_id, p_leg_id);
end $$;
revoke all on function public.ops_send_offer(uuid, uuid, uuid) from public, anon;
grant execute on function public.ops_send_offer(uuid, uuid, uuid) to authenticated;

alter function public.ops_set_load_status(uuid, public.load_status, text) set schema private;
alter function private.ops_set_load_status(uuid, public.load_status, text) rename to ops_set_load_status_pre_bidding;
revoke all on function private.ops_set_load_status_pre_bidding(uuid, public.load_status, text)
  from public, anon, authenticated;

create function public.ops_set_load_status(p_load_id uuid, p_status public.load_status, p_reason text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_mode text; v_awarded boolean;
begin
  perform private.require_ops();
  select l.pricing_mode into v_mode from public.loads l where l.id = p_load_id for update;
  if v_mode is null then raise exception 'load not found' using errcode = 'no_data_found'; end if;
  if v_mode = 'bid' then
    select bl.awarded_payout_baisa is not null into v_awarded
      from private.bid_loads bl where bl.load_id = p_load_id;
    if p_status is null or (not coalesce(v_awarded, false) and p_status <> 'cancelled')
       or (coalesce(v_awarded, false) and p_status not in ('in_transit', 'delivered', 'closed', 'cancelled'))
    then raise exception 'bidding controls this load until award; dispatch may cancel it'
      using errcode = 'check_violation'; end if;
  end if;
  perform private.ops_set_load_status_pre_bidding(p_load_id, p_status, p_reason);
end $$;
revoke all on function public.ops_set_load_status(uuid, public.load_status, text) from public, anon;
grant execute on function public.ops_set_load_status(uuid, public.load_status, text) to authenticated;
