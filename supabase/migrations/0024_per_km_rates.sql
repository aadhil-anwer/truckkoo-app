-- 0024_per_km_rates.sql
--
-- DISTANCE-BASED PRICING, and a per-kilometre rate the dispatcher controls.
--
-- WHY. The card prices a CORRIDOR PAIR — Batinah → Dhofar — so every trip inside
-- a pair costs the same. `OPEN_ISSUES.md` has carried "the corridor band is
-- coarse, and Muscat→Sohar proves it" since 0010: Muscat→Sohar and Muscat→Shinas
-- are the same band and are 40 km apart in reality.
--
-- The fix is not 2,116 rows for 46×46 city pairs, which nobody could maintain.
-- It is `base + per_km × km + per_tonne × tonnes`, floored at a minimum fare —
-- so one row per corridor pair still prices every city pair inside it correctly,
-- and the dispatcher tunes three numbers instead of maintaining a matrix.
--
-- STILL NO RATES IN THIS MIGRATION. `per_km_baisa` defaults to 0, which changes
-- no existing price. Rates are loaded by hand through the ops console
-- (`ops_upsert_rate_card`) or by `npm run seed:rates` in development — never
-- invented here. CLAUDE.md 3b.
--
-- NOTHING CAN BE QUOTED AT ZERO. `min_fare_baisa` already had a positive
-- constraint; this migration adds the matching guarantee at the other end, so a
-- misconfigured card cannot produce a free trip.

-- ═══ 1. the per-km rate ═════════════════════════════════════════════════════

alter table private.rate_cards
  add column if not exists per_km_baisa bigint not null default 0;

alter table private.rate_cards
  add constraint rate_per_km_sane check (per_km_baisa >= 0 and per_km_baisa <= 10000000);

comment on column private.rate_cards.per_km_baisa is
  'Baisa per road kilometre. 0 keeps a card on the old flat corridor price.';

-- ═══ 2. distance, server-side ═══════════════════════════════════════════════
-- The app already computes a road distance for display (src/map/distance.ts).
-- PRICING cannot use that number: it arrives from the client, and a client-
-- supplied multiplier on a price is a client-supplied price.
--
-- So the same arithmetic lives here, over `cities.lat/lng` from 0020. The road
-- factor is a SETTING rather than a literal, so the dispatcher can tune it from
-- the console without a migration — and so there is one authoritative value
-- rather than a constant in SQL arguing with a constant in TypeScript.

insert into private.app_settings (key, value)
values ('road_factor_pct', '135'::jsonb)
on conflict (key) do nothing;

create or replace function private.route_km(p_origin_city bigint, p_dest_city bigint)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.cities;
  d public.cities;
  v_factor numeric;
  v_km     numeric;
begin
  select * into o from public.cities c where c.id = p_origin_city;
  select * into d from public.cities c where c.id = p_dest_city;
  if o.id is null or d.id is null then
    return null;
  end if;

  -- Haversine. `earth_distance` would need an extension for a dozen lines of
  -- arithmetic that will not change.
  v_km := 2 * 6371 * asin(
    sqrt(
      power(sin(radians(d.lat - o.lat) / 2), 2)
      + cos(radians(o.lat)) * cos(radians(d.lat))
        * power(sin(radians(d.lng - o.lng) / 2), 2)
    )
  );

  select coalesce((value #>> '{}')::numeric, 135) into v_factor
  from private.app_settings where key = 'road_factor_pct';

  -- A straight line is not a road. Oman's network hugs the coast and threads the
  -- Hajar mountains, so the ratio is higher than the ~1.2 of a flat, gridded
  -- country. Muscat→Barka is ~55 km straight against ~80 km driven.
  return round(v_km * v_factor / 100, 1);
end;
$$;

revoke all on function private.route_km(bigint, bigint) from public, anon, authenticated;

-- ═══ 3. the price, now with distance ════════════════════════════════════════
-- The four-argument version is DROPPED, not left beside this one. Defaults make
-- a 4-arg call match both signatures and Postgres refuses it as ambiguous — the
-- whole pricing path fails at once. Dropping is safe because `price_for` is its
-- only caller and it is updated below.
drop function if exists private.compute_price(bigint, bigint, bigint, integer);


create or replace function private.compute_price(
  p_base_baisa      bigint,
  p_per_tonne_baisa bigint,
  p_min_fare_baisa  bigint,
  p_weight_kg       integer,   -- NULL = not stated by the shipper
  p_per_km_baisa    bigint default 0,
  p_km              numeric default 0
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select greatest(
    -- The floor. A card with a positive minimum fare cannot produce a free trip,
    -- however the other terms are configured.
    p_min_fare_baisa,
    p_base_baisa
      + coalesce(p_per_km_baisa, 0) * ceil(coalesce(p_km, 0))::bigint
      + p_per_tonne_baisa * (
          case
            -- Weight is optional on a load. An unstated weight prices the leg
            -- alone rather than guessing a tonnage — guessing high overcharges,
            -- guessing low is a quote Truckkoo has to break.
            when p_weight_kg is null then 0
            -- Billable tonnes round UP: 1,200 kg occupies two tonnes of
            -- capacity. ceil() on numeric, never float — see money.ts.
            else ceil(p_weight_kg::numeric / 1000)::bigint
          end
        )
  );
$$;

comment on function private.compute_price(bigint, bigint, bigint, integer, bigint, numeric) is
  'Pure price arithmetic, now including a per-kilometre term. immutable, so '
  'Postgres forbids the clock and table reads — distance is passed in.';

revoke all on function private.compute_price(bigint, bigint, bigint, integer, bigint, numeric)
  from public, anon, authenticated;

-- ═══ 4. price_for passes the distance through ═══════════════════════════════
-- Reproduced from the live definition with the compute_price call changed.
-- Everything else — the advise_me and over_capacity outcomes, the corridor
-- lookup, and the assertion that a computed price is positive — is untouched.

CREATE OR REPLACE FUNCTION private.price_for(p_origin_city bigint, p_dest_city bigint, p_truck_type_code text, p_weight_kg integer)
 RETURNS TABLE(price_baisa bigint, outcome text, rate_card_id bigint, currency character)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Distance is resolved HERE, server-side, from cities.lat/lng. It is never
  -- accepted from the client: a client-supplied multiplier on a price is a
  -- client-supplied price.
  v_price := private.compute_price(
    v_rate.base_baisa, v_rate.per_tonne_baisa, v_rate.min_fare_baisa, p_weight_kg,
    v_rate.per_km_baisa, private.route_km(p_origin_city, p_dest_city));

  -- §5: assert total > 0 before it goes anywhere. `min_fare_baisa > 0` is
  -- constrained, so this is unreachable — which is why it raises rather than
  -- coercing. An unreachable branch that fires means an assumption broke.
  if v_price is null or v_price <= 0 then
    raise exception 'computed a non-positive price' using errcode = 'check_violation';
  end if;

  return query select v_price, 'quoted'::text, v_rate.id, v_rate.currency;
end;
$function$;

-- ═══ 5. the dispatcher can set the per-km rate ══════════════════════════════
-- `p_per_km_baisa` is added LAST and defaults to 0, so the ops console's
-- existing seven-argument call keeps working and simply leaves the new term at
-- zero. The console adopts it whenever it is updated.
--
-- The SEVEN-ARGUMENT VERSION IS DROPPED FIRST. Leaving it beside a defaulted
-- eight-argument one does not preserve the old call — it makes it AMBIGUOUS, and
-- Postgres refuses with 42725. Dropping it is what keeps the console working,
-- which is the opposite of how it looks.
drop function if exists public.ops_upsert_rate_card(text, text, text, bigint, bigint, bigint, text);

CREATE OR REPLACE FUNCTION public.ops_upsert_rate_card(p_origin_corridor text, p_dest_corridor text, p_truck_type_code text, p_base_baisa bigint, p_per_tonne_baisa bigint, p_min_fare_baisa bigint, p_reason text, p_per_km_baisa bigint DEFAULT 0)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id     bigint;
  v_before jsonb;
  v_reason text;
begin
  perform private.require_ops();
  v_reason := private.require_reason(p_reason);
  perform private.check_rate_limit('ops_upsert_rate_card', 100, interval '1 hour');

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
    base_baisa, per_tonne_baisa, min_fare_baisa, per_km_baisa
  )
  values (
    p_origin_corridor, p_dest_corridor, p_truck_type_code,
    p_base_baisa, p_per_tonne_baisa, p_min_fare_baisa, coalesce(p_per_km_baisa, 0)
  )
  on conflict (origin_corridor, dest_corridor, truck_type_code) do update set
    base_baisa      = excluded.base_baisa,
    per_tonne_baisa = excluded.per_tonne_baisa,
    min_fare_baisa  = excluded.min_fare_baisa,
    per_km_baisa    = excluded.per_km_baisa
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

revoke all on function public.ops_upsert_rate_card(text, text, text, bigint, bigint, bigint, text, bigint)
  from public, anon;
grant execute on function public.ops_upsert_rate_card(text, text, text, bigint, bigint, bigint, text, bigint)
  to authenticated;
