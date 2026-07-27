-- ─────────────────────────────────────────────────────────────────────────────
-- 0011 — price before commitment
--
-- WHY THIS EXISTS
--
-- 0010 gave the shipper a price, but only after they had already posted the load:
-- post, wait, then tap "Get a price". That is backwards. The single most useful
-- thing Uber established about this shape of transaction is that the price is
-- known *before* you commit, not after — and a shipper with near-zero tech skills
-- committing to something they cannot price is exactly the moment they stop and
-- call someone instead, which is the loop this product exists to remove.
--
-- So: `quote_route()` prices a set of parameters. No load, no commitment, no row.
-- The post-load form ends on a review step showing the price, and the shipper
-- confirms.
--
-- ONE IMPLEMENTATION, NOT TWO
--
-- The obvious way to build this is to copy quote_load's body and drop the load
-- lookup. That would put the outcome rules — advise_me, over_capacity, no_rate —
-- in two places, which is the same mistake 0010's header argues against for the
-- formula itself: two implementations of a price disagree eventually, and the
-- disagreement surfaces as a number a customer was shown.
--
-- Instead the whole decision moves into `private.price_for()`, and BOTH
-- `quote_load` and `quote_route` call it. `quote_load` is rewritten below to do
-- so; its signature, grants, and behaviour are unchanged.
--
-- WHAT THIS DOES NOT DO
--
-- It does not issue a quote. `public.quotes` rows are immutable, bound, and
-- expiring because they are a commitment (SECURITY.md §5); an estimate the
-- shipper has not acted on is not one, and writing a row per keystroke-level
-- exploration would fill the table with things nobody agreed to. The binding
-- quote is still issued by `quote_load()` at post time, from the same card, so
-- the number the shipper confirmed is the number they get.
--
-- THE NEW EXPOSURE, STATED PLAINLY
--
-- This is now the cheapest path to sweeping the rate card: no load required, so
-- the natural throttle of `post_load` (20/hour) no longer applies. It is
-- therefore shipper-only, authenticated-only, and rate-limited at the same 30/hour
-- as `quote_load`. That is a real reduction in the cost of extraction and it is
-- accepted deliberately — a price a customer cannot see before committing is not
-- a product — but it is the reason there is still no anonymous quote path, and it
-- is worth watching. See SECURITY.md §5 and §11.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ THE SHARED DECISION ════════════════════════════════════════════════════
-- Everything that turns a route into a price or into one of the three
-- human-backstop outcomes. The only caller-visible difference between
-- quote_load and quote_route is where the parameters came from.

create or replace function private.price_for(
  p_origin_city     bigint,
  p_dest_city       bigint,
  p_truck_type_code text,      -- NULL = "Not sure — advise me"
  p_weight_kg       integer
)
returns table (
  price_baisa  bigint,
  outcome      text,
  rate_card_id bigint,
  currency     char(3)
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rate     private.rate_cards;
  v_capacity integer;
  v_price    bigint;
begin
  -- "Not sure — advise me". The card is keyed on truck type, so there is nothing
  -- to look up — and choosing a type on the shipper's behalf to produce a number
  -- would quote them for a truck they never asked for. The most important
  -- affordance in the product costs an automated price and buys a human
  -- recommendation.
  if p_truck_type_code is null then
    return query select null::bigint, 'advise_me'::text, null::bigint, 'OMR'::char(3);
    return;
  end if;

  select tt.capacity_kg into v_capacity
  from public.truck_types tt where tt.code = p_truck_type_code;

  if v_capacity is null then
    raise exception 'unknown truck type' using errcode = 'foreign_key_violation';
  end if;

  -- SECURITY.md §5 requires over-capacity to be rejected rather than priced.
  -- Refusing the PRICE is the rejection: pricing 12 t onto a 3 t hi-up quotes a
  -- trip that physically cannot happen. Note `>`, not `>=` — a full truck is a
  -- normal trip, and refusing it would refuse every fully-loaded run.
  if p_weight_kg is not null and p_weight_kg > v_capacity then
    return query select null::bigint, 'over_capacity'::text, null::bigint, 'OMR'::char(3);
    return;
  end if;

  select * into v_rate
  from private.rate_cards rc
  where rc.origin_corridor = private.corridor_of(p_origin_city)
    and rc.dest_corridor   = private.corridor_of(p_dest_city)
    and rc.truck_type_code = p_truck_type_code;

  -- The empty-card path, and the normal state of this system until real rates are
  -- loaded band by band (OPEN_ISSUES 13).
  if v_rate.id is null then
    return query select null::bigint, 'no_rate'::text, null::bigint, 'OMR'::char(3);
    return;
  end if;

  v_price := private.compute_price(
    v_rate.base_baisa, v_rate.per_tonne_baisa, v_rate.min_fare_baisa, p_weight_kg);

  -- §5: assert total > 0 before it goes anywhere. `min_fare_baisa > 0` is
  -- constrained, so this is unreachable — which is why it raises rather than
  -- coercing. An unreachable branch that fires means an assumption broke.
  if v_price is null or v_price <= 0 then
    raise exception 'computed a non-positive price' using errcode = 'check_violation';
  end if;

  return query select v_price, 'quoted'::text, v_rate.id, v_rate.currency;
end;
$$;

-- No client grant: it reads the rate card, and a caller who could reach it
-- directly would sweep the card without passing a rate limit.
revoke all on function private.price_for(bigint, bigint, text, integer)
  from public, anon, authenticated;

-- ═══ PRICE A ROUTE, WITHOUT COMMITTING TO IT ════════════════════════════════
-- Pickup dates are deliberately NOT parameters. They do not affect the price —
-- the card has no seasonality — and accepting them would imply to the next reader
-- that they might. The issued quote records them (0010); this estimate does not
-- need them.

create or replace function public.quote_route(
  p_origin_city     bigint,
  p_dest_city       bigint,
  p_truck_type_code text    default null,   -- NULL = "Not sure — advise me"
  p_weight_kg       integer default null
)
returns table (
  price_baisa bigint,
  currency    char(3),
  outcome     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_r     record;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Shipper-only. A driver has no reason to price a route, and excluding them
  -- halves the set of accounts that can probe the card.
  if (select private.actor_role()) <> 'shipper' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  -- The throttle that `post_load` used to provide implicitly. See the header.
  perform private.check_rate_limit('quote_route', 30, interval '1 hour');

  -- Bound the input (§6). These mirror the constraints on `loads`, so an estimate
  -- can never be produced for something that could not be posted.
  if p_origin_city is null or p_dest_city is null then
    raise exception 'route required' using errcode = 'check_violation';
  end if;

  if p_origin_city = p_dest_city then
    raise exception 'origin and destination must differ' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.cities c where c.id = p_origin_city)
     or not exists (select 1 from public.cities c where c.id = p_dest_city) then
    raise exception 'unknown city' using errcode = 'foreign_key_violation';
  end if;

  if p_weight_kg is not null and (p_weight_kg <= 0 or p_weight_kg > 60000) then
    raise exception 'weight out of range' using errcode = 'check_violation';
  end if;

  select * into v_r
  from private.price_for(p_origin_city, p_dest_city, p_truck_type_code, p_weight_kg);

  -- rate_card_id is deliberately not returned: provenance stays server-side, for
  -- the same reason it is withheld from the client's column grant on `quotes`.
  return query select v_r.price_baisa, v_r.currency, v_r.outcome;
end;
$$;

revoke all on function public.quote_route(bigint, bigint, text, integer) from public, anon;
grant execute on function public.quote_route(bigint, bigint, text, integer) to authenticated;

-- ═══ quote_load, NOW DELEGATING ═════════════════════════════════════════════
-- Same signature, same grants, same behaviour. The outcome rules that used to be
-- inline now come from `private.price_for`, so there is exactly one place where a
-- route becomes a price.

create or replace function public.quote_load(p_load_id uuid)
returns table (
  quote_id    uuid,
  price_baisa bigint,
  currency    char(3),
  outcome     text,
  expires_at  timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_load  public.loads;
  v_r     record;
  v_quote public.quotes;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  perform private.check_rate_limit('quote_load', 30, interval '1 hour');

  -- Fetch SCOPED TO THE ACTOR (§3). This function is `security definer` and takes
  -- a load id, which is the exact shape of the IDOR `match_load` was fixed for.
  select * into v_load
  from public.loads l
  where l.id = p_load_id and l.shipper_id = v_actor;

  if v_load.id is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;

  if v_load.status not in ('posted', 'finding_truck') then
    raise exception 'load is no longer open for quoting' using errcode = 'check_violation';
  end if;

  select * into v_r
  from private.price_for(v_load.origin_city, v_load.dest_city,
                         v_load.truck_type_code, v_load.weight_kg);

  -- The quote row records the binding whatever the outcome, so an unpriced
  -- request is still evidence a shipper asked — which is what tells ops there is
  -- a band worth loading a rate for.
  insert into public.quotes (
    shipper_id, load_id,
    origin_city, dest_city, truck_type_code, weight_kg, pickup_from, pickup_to,
    price_baisa, currency, outcome, rate_card_id
  ) values (
    v_actor, v_load.id,
    v_load.origin_city, v_load.dest_city, v_load.truck_type_code, v_load.weight_kg,
    v_load.pickup_from, v_load.pickup_to,
    v_r.price_baisa, coalesce(v_r.currency, v_load.currency), v_r.outcome, v_r.rate_card_id
  )
  returning * into v_quote;

  if v_r.outcome = 'quoted' then
    update public.loads l set price_baisa = v_r.price_baisa where l.id = v_load.id;
  else
    -- No price means a human owns this one. finding_truck is what puts it in
    -- ops_queue() and keeps the "we are finding you a truck" promise.
    update public.loads l set status = 'finding_truck'
    where l.id = v_load.id and l.status = 'posted';
  end if;

  return query
  select v_quote.id, v_quote.price_baisa, v_quote.currency,
         v_quote.outcome, v_quote.expires_at;
end;
$$;

revoke all on function public.quote_load(uuid) from public, anon;
grant execute on function public.quote_load(uuid) to authenticated;
