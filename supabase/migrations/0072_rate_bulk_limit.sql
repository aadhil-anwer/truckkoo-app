-- 0072 · A bulk price change is one change, not 64.
--
-- Found on production, 2026-10-07, minutes after 0071: the founder's first
-- "every route" save for pickups wrote 64 bands, and the second was refused with
-- "Too many changes in a short time". ops_upsert_rate_card_impl carried the
-- 100-an-hour limit, and ops_set_rate_for_type called it once per corridor
-- pair, so one bulk save spent 64 of the hour's 100 and a correction could not
-- follow it. The refused save rolled back whole; nothing was half-written.
--
-- The limit moves out of the shared impl into its two callers: one band is one
-- of 100 an hour, as before; one bulk save is one of 20 an hour. The impl,
-- the validation and both audits are otherwise unchanged (bodies copied from
-- 0069 and 0071).

-- ═══ 1. the shared impl, without the limit ══════════════════════════════════
create or replace function private.ops_upsert_rate_card_impl(p_origin_corridor text, p_dest_corridor text, p_truck_type_code text, p_base_baisa bigint, p_per_tonne_baisa bigint, p_min_fare_baisa bigint, p_reason text, p_per_km_baisa bigint DEFAULT 0, p_wait_free_minutes integer DEFAULT NULL::integer, p_wait_per_15min_baisa bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
VOLATILE
AS $function$
declare
  v_id     bigint;
  v_before jsonb;
  v_reason text;
begin
  perform private.require_ops();
  v_reason := private.require_reason(p_reason);
  -- 0072: the rate limit moved to the callers (ops_upsert_rate_card,
  -- ops_set_rate_for_type), so a bulk write counts as one change.

  -- Bounds, in integer baisa. OMR is a THREE-decimal currency: 1,000,000,000
  -- baisa is 1,000,000 OMR. The point is to catch a slipped decimal at
  -- configuration time rather than to model a ceiling — a rate card is applied
  -- to every future load on that corridor, so an error here is not one bad
  -- quote, it is all of them.
  if p_base_baisa is null or p_base_baisa < 0 or p_base_baisa > 1000000000 then
    raise exception 'base fare out of range' using errcode = 'check_violation';
  end if;
  if p_per_tonne_baisa is null or p_per_tonne_baisa < 0 or p_per_tonne_baisa > 1000000000 then
    raise exception 'per-tonne rate out of range' using errcode = 'check_violation';
  end if;
  -- A zero floor would let a zero-weight quote price at zero, and
  -- `loads_price_positive` would then reject the load's price with a constraint
  -- error the shipper cannot act on. The table says this too; saying it here
  -- gives the dispatcher a sentence instead of a constraint name.
  if p_min_fare_baisa is null or p_min_fare_baisa <= 0 or p_min_fare_baisa > 1000000000 then
    raise exception 'the minimum fare must be above zero' using errcode = 'check_violation';
  end if;

  -- Waiting: both or neither. Neither means no waiting charge on this band.
  if (p_wait_free_minutes is null) <> (p_wait_per_15min_baisa is null) then
    raise exception 'set both the free minutes and the waiting rate, or neither' using errcode = 'check_violation';
  end if;
  if p_wait_free_minutes is not null and (p_wait_free_minutes < 0 or p_wait_free_minutes > 240) then
    raise exception 'free waiting is 0 to 240 minutes' using errcode = 'check_violation';
  end if;
  if p_wait_per_15min_baisa is not null and (p_wait_per_15min_baisa <= 0 or p_wait_per_15min_baisa > 100000000) then
    raise exception 'waiting rate out of range' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.truck_types t where t.code = p_truck_type_code) then
    raise exception 'unknown truck type' using errcode = 'foreign_key_violation';
  end if;

  -- Corridors are validated by the 0010 trigger; this is only so the dispatcher
  -- gets a readable error rather than a foreign_key_violation from a trigger.
  if not exists (select 1 from public.cities c where c.corridor = p_origin_corridor) then
    raise exception 'unknown origin corridor: %', p_origin_corridor
      using errcode = 'foreign_key_violation';
  end if;
  if not exists (select 1 from public.cities c where c.corridor = p_dest_corridor) then
    raise exception 'unknown destination corridor: %', p_dest_corridor
      using errcode = 'foreign_key_violation';
  end if;

  select to_jsonb(rc) into v_before
  from private.rate_cards rc
  where rc.origin_corridor = p_origin_corridor
    and rc.dest_corridor   = p_dest_corridor
    and rc.truck_type_code = p_truck_type_code;

  insert into private.rate_cards (
    origin_corridor, dest_corridor, truck_type_code,
    base_baisa, per_tonne_baisa, min_fare_baisa, per_km_baisa,
    wait_free_minutes, wait_per_15min_baisa
  )
  values (
    p_origin_corridor, p_dest_corridor, p_truck_type_code,
    p_base_baisa, p_per_tonne_baisa, p_min_fare_baisa, coalesce(p_per_km_baisa, 0),
    p_wait_free_minutes, p_wait_per_15min_baisa
  )
  on conflict (origin_corridor, dest_corridor, truck_type_code) do update set
    base_baisa      = excluded.base_baisa,
    per_tonne_baisa = excluded.per_tonne_baisa,
    min_fare_baisa  = excluded.min_fare_baisa,
    per_km_baisa    = excluded.per_km_baisa,
    wait_free_minutes    = excluded.wait_free_minutes,
    wait_per_15min_baisa = excluded.wait_per_15min_baisa
  returning id into v_id;

  -- Two logs on purpose. `rate_card_audit` (0010) is the row-level history the
  -- pricing rules require; `ops_audit` is the who-and-why history the console
  -- requires. Neither subsumes the other.
  perform private.log_ops(
    'ops_upsert_rate_card', 'rate_card', v_id::text,
    v_before,
    (select to_jsonb(rc) from private.rate_cards rc where rc.id = v_id),
    v_reason
  );

  return v_id;
end;
$function$;
revoke all on function private.ops_upsert_rate_card_impl(text, text, text, bigint, bigint, bigint, text, bigint, integer, bigint) from public, anon, authenticated;

-- ═══ 2. one band: the limit, here ═══════════════════════════════════════════
create or replace function public.ops_upsert_rate_card(p_origin_corridor text, p_dest_corridor text, p_truck_type_code text, p_base_baisa bigint, p_per_tonne_baisa bigint, p_min_fare_baisa bigint, p_reason text, p_per_km_baisa bigint DEFAULT 0, p_wait_free_minutes integer DEFAULT NULL::integer, p_wait_per_15min_baisa bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id bigint;
begin
  perform private.require_owner_fresh();
  perform private.check_rate_limit('ops_upsert_rate_card', 100, interval '1 hour');
  v_id := private.ops_upsert_rate_card_impl(p_origin_corridor, p_dest_corridor, p_truck_type_code,
            p_base_baisa, p_per_tonne_baisa, p_min_fare_baisa, p_reason, p_per_km_baisa,
            p_wait_free_minutes, p_wait_per_15min_baisa);
  perform private.system_raise_alert('owner_money_change',
    format('Owner changed rate band %s: %s → %s, %s. See ops_audit.',
           v_id, p_origin_corridor, p_dest_corridor, p_truck_type_code),
    jsonb_build_object('action', 'ops_upsert_rate_card', 'rate_card_id', v_id));
  return v_id;
end;
$function$;
revoke all on function public.ops_upsert_rate_card(text, text, text, bigint, bigint, bigint, text, bigint, integer, bigint) from public, anon;
grant execute on function public.ops_upsert_rate_card(text, text, text, bigint, bigint, bigint, text, bigint, integer, bigint) to authenticated;

-- ═══ 3. every route: its own limit ═════════════════════════════════════════
create or replace function public.ops_set_rate_for_type(
  p_truck_type_code      text,
  p_base_baisa           bigint,
  p_per_tonne_baisa      bigint,
  p_min_fare_baisa       bigint,
  p_reason               text,
  p_per_km_baisa         bigint  default 0,
  p_wait_free_minutes    integer default null,
  p_wait_per_15min_baisa bigint  default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n integer := 0;
begin
  perform private.require_owner_fresh();
  -- One bulk save is one change: 20 an hour, however many routes it writes.
  perform private.check_rate_limit('ops_set_rate_for_type', 20, interval '1 hour');
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a price change needs a reason' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.truck_types t where t.code = p_truck_type_code) then
    raise exception 'unknown truck type' using errcode = 'foreign_key_violation';
  end if;

  for r in
    select o.corridor as origin, d.corridor as dest
      from (select distinct c.corridor from public.cities c where c.corridor is not null) o
     cross join (select distinct c.corridor from public.cities c where c.corridor is not null) d
     order by 1, 2
  loop
    -- The impl validates every amount and writes both audits, as for one band.
    perform private.ops_upsert_rate_card_impl(r.origin, r.dest, p_truck_type_code,
      p_base_baisa, p_per_tonne_baisa, p_min_fare_baisa, p_reason, p_per_km_baisa,
      p_wait_free_minutes, p_wait_per_15min_baisa);
    v_n := v_n + 1;
  end loop;

  perform private.system_raise_alert('owner_money_change',
    format('Owner set one price for %s on all %s routes. See ops_audit.', p_truck_type_code, v_n),
    jsonb_build_object('action', 'ops_set_rate_for_type', 'truck_type_code', p_truck_type_code,
                       'routes', v_n));
  return v_n;
end;
$$;
revoke all on function public.ops_set_rate_for_type(text, bigint, bigint, bigint, text, bigint, integer, bigint)
  from public, anon;
grant execute on function public.ops_set_rate_for_type(text, bigint, bigint, bigint, text, bigint, integer, bigint)
  to authenticated;
