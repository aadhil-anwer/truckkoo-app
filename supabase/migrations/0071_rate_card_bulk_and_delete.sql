-- 0071 · One price for a truck type on every route, and rate rows that can be
-- deleted after they have priced something.
--
-- Found on production, 2026-10-07: the rate card held the 320-row dev seed
-- (seed_dev_rates.sql, loaded 2026-09-28 — not through any migration). Clearing
-- it failed on the 8 rows that quotes had used: quotes.rate_card_id was a
-- foreign key `on delete set null`, and quotes are immutable (0010), so the
-- set-null raised and the delete rolled back. ops_delete_rate_card had the same
-- flaw: any band that had ever priced a load could never be removed.
--
-- 1. The foreign key goes. A quote keeps the id of the band that priced it as
--    a plain number — ids are never reused — and the band's last contents stay
--    in private.rate_card_audit, which records every insert, update and delete.
--    Provenance survives the band; the band no longer has to survive the quote.
--
-- 2. ops_set_rate_for_type: the founder's ask, "one per-km rate for pickups".
--    The card is keyed by corridor pair, so one rate everywhere was 64 forms.
--    This writes the same terms to every ordered corridor pair for one truck
--    type, in one transaction, through the same validated impl as the single
--    form — each band audited in rate_card_audit and ops_audit, one alert for
--    the whole change. Any band can still be overridden afterwards.

-- ═══ 1. quotes outlive their band ════════════════════════════════════════════
do $$
declare
  v_name text;
begin
  select c.conname into v_name
    from pg_constraint c
   where c.conrelid = 'public.quotes'::regclass
     and c.contype = 'f'
     and c.confrelid = 'private.rate_cards'::regclass;
  if v_name is not null then
    execute format('alter table public.quotes drop constraint %I', v_name);
  end if;
end;
$$;
comment on column public.quotes.rate_card_id is
  'Id of the private.rate_cards band that priced this quote, or null. No foreign key since 0071: the band may be deleted; its contents remain in private.rate_card_audit.';

-- ═══ 2. one price for a truck type, every route ══════════════════════════════
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
