-- 0069 · Pickups: per-km on the real distance, jobs inside one town, and paid
-- waiting (founder, 2026-10-06).
--
-- Launch is pickups, mostly short jobs inside one town, booked for now. Three
-- things stood in the way:
--
--   * Distance was city centre to city centre, so every job inside a town was
--     0 km and per-km did nothing. Now a load with both pins is measured pin to
--     pin (straight line × road factor, as route_km has always done between
--     towns); without pins, town to town as before.
--   * A job inside one town was refused outright (loads_not_circular, and
--     quote_route). Now allowed when both pins are set and far enough apart —
--     without pins it would be a 0 km job, so post_load without places still
--     refuses it.
--   * Waiting was unpaid. The rate card gains free minutes and a rate per
--     started 15 minutes; the terms are kept with the load at pricing. The
--     driver taps "I've arrived" with the phone's fix, checked against the pin
--     and not stored; the clock runs to "picked up" / "delivered", counts up to
--     a cap, and past the cap a support case opens. The driver keeps all of the
--     waiting charge; commission is on the price only. Staff can waive a stop,
--     with a reason.
--
-- quote_route keeps its shape for builds already installed; the app now asks
-- quote_trip, which takes the pins and returns the waiting terms.

-- ═══ 1. distance ════════════════════════════════════════════════════════════
create or replace function private.road_km_between(
  p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_km     numeric;
  v_factor numeric;
begin
  if p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then
    return null;
  end if;
  v_km := 2 * 6371 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)));
  select coalesce((value #>> '{}')::numeric, 135) into v_factor
    from private.app_settings where key = 'road_factor_pct';
  return round(v_km * coalesce(v_factor, 135) / 100, 1);
end;
$$;
revoke all on function private.road_km_between(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- Straight-line metres, for "is the phone at the pin" and "are the pins apart".
create or replace function private.metres_between(
  p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians(p_lat2 - p_lat1) / 2), 2)
    + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)))::numeric);
$$;
revoke all on function private.metres_between(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

create or replace function private.load_km(p_load_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select private.road_km_between(o.lat, o.lng, d.lat, d.lng)
       from public.load_places o
       join public.load_places d on d.load_id = o.load_id and d.kind = 'drop'
      where o.load_id = p_load_id and o.kind = 'pickup'),
    (select private.route_km(l.origin_city, l.dest_city) from public.loads l where l.id = p_load_id));
$$;
revoke all on function private.load_km(uuid) from public, anon, authenticated;

create or replace function private.price_for_km(p_origin_city bigint, p_dest_city bigint, p_truck_type_code text, p_weight_kg integer, p_km numeric)
 RETURNS TABLE(price_baisa bigint, outcome text, rate_card_id bigint, currency character)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_code     text := private.resolve_truck_type(p_truck_type_code, p_weight_kg);
  v_rate     private.rate_cards;
  v_capacity integer;
  v_price    bigint;
begin
  if v_code is null then
    return query select null::bigint, 'advise_me'::text, null::bigint, 'OMR'::char(3);
    return;
  end if;

  select tt.capacity_kg into v_capacity
  from public.truck_types tt where tt.code = v_code;

  if v_capacity is null then
    raise exception 'unknown truck type' using errcode = 'foreign_key_violation';
  end if;

  -- SECURITY.md §5: over-capacity is refused, not priced. `>`, not `>=`.
  if p_weight_kg is not null and p_weight_kg > v_capacity then
    return query select null::bigint, 'over_capacity'::text, null::bigint, 'OMR'::char(3);
    return;
  end if;

  select * into v_rate
  from private.rate_cards rc
  where rc.origin_corridor = private.corridor_of(p_origin_city)
    and rc.dest_corridor   = private.corridor_of(p_dest_city)
    and rc.truck_type_code = v_code;

  if v_rate.id is null then
    return query select null::bigint, 'no_rate'::text, null::bigint, 'OMR'::char(3);
    return;
  end if;

  -- Distance comes from the caller's server-side measure (load_km, or the
  -- quote's own pins checked against their cities), never a client number.
  v_price := private.compute_price(
    v_rate.base_baisa, v_rate.per_tonne_baisa, v_rate.min_fare_baisa, p_weight_kg,
    v_rate.per_km_baisa, p_km);

  if v_price is null or v_price <= 0 then
    raise exception 'computed a non-positive price' using errcode = 'check_violation';
  end if;

  return query select v_price, 'quoted'::text, v_rate.id, v_rate.currency;
end;
$function$;
revoke all on function private.price_for_km(bigint, bigint, text, integer, numeric) from public, anon, authenticated;

-- price_for keeps its meaning (town to town) for estimate_route and quote_route.
create or replace function private.price_for(p_origin_city bigint, p_dest_city bigint, p_truck_type_code text, p_weight_kg integer)
returns table (price_baisa bigint, outcome text, rate_card_id bigint, currency character)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.price_for_km(p_origin_city, p_dest_city, p_truck_type_code, p_weight_kg,
                                     private.route_km(p_origin_city, p_dest_city));
$$;
revoke all on function private.price_for(bigint, bigint, text, integer) from public, anon, authenticated;

-- ═══ 2. jobs inside one town ═════════════════════════════════════════════════
alter table public.loads drop constraint loads_not_circular;

-- Same town: both pins, and far enough apart to be a job. Otherwise unchanged.
create or replace function private.check_same_city(
  p_origin_city bigint, p_dest_city bigint, p_origin_place jsonb, p_dest_place jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_origin_city is distinct from p_dest_city then
    return;
  end if;
  if p_origin_place is null or p_dest_place is null then
    raise exception 'For a job inside one town, put both the pickup and the drop-off on the map.'
      using errcode = 'check_violation';
  end if;
  if private.metres_between((p_origin_place ->> 'lat')::double precision, (p_origin_place ->> 'lng')::double precision,
                            (p_dest_place ->> 'lat')::double precision, (p_dest_place ->> 'lng')::double precision)
     < private.setting_int('same_city_min_m', 300) then
    raise exception 'The pickup and the drop-off are too close together.' using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function private.check_same_city(bigint, bigint, jsonb, jsonb) from public, anon, authenticated;

create table private.load_wait_terms (
  load_id         uuid primary key references public.loads(id) on delete cascade,
  free_minutes    integer not null check (free_minutes between 0 and 240),
  per_15min_baisa bigint not null check (per_15min_baisa > 0),
  cap_minutes     integer not null check (cap_minutes between 30 and 480),
  created_at      timestamptz not null default now()
);
revoke all on private.load_wait_terms from public, anon, authenticated;
alter table private.load_wait_terms enable row level security;
alter table private.load_wait_terms force row level security;
comment on table private.load_wait_terms is
  'Waiting terms a load was priced with (0069). No client grant; read through quote_trip / trip_waiting.';

create or replace function private.post_load_impl(
  p_origin_city bigint, p_dest_city bigint, p_pickup_from date, p_pickup_to date, p_goods text,
  p_weight_kg integer, p_truck_type_code text, p_origin_place jsonb, p_dest_place jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if (select private.actor_role()) <> 'shipper' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  perform private.require_active();
  perform private.check_rate_limit('post_load', 20, interval '1 hour');

  perform private.check_same_city(p_origin_city, p_dest_city, p_origin_place, p_dest_place);

  if p_goods is null or char_length(btrim(p_goods)) = 0 then
    raise exception 'goods description required' using errcode = 'check_violation';
  end if;

  if p_truck_type_code is not null
     and not exists (select 1 from public.truck_types t where t.code = p_truck_type_code) then
    raise exception 'unknown truck type' using errcode = 'foreign_key_violation';
  end if;

  insert into public.loads (
    shipper_id, origin_city, dest_city, pickup_from, pickup_to,
    weight_kg, truck_type_code, goods_description, status
  )
  values (
    v_actor, p_origin_city, p_dest_city, p_pickup_from, p_pickup_to,
    p_weight_kg, p_truck_type_code, btrim(p_goods), 'posted'::public.load_status
  )
  returning id into v_id;

  -- 0069: the exact places go in before the price, which is measured between them.
  perform private.insert_load_place(v_id, 'pickup', p_origin_place);
  perform private.insert_load_place(v_id, 'drop', p_dest_place);

  -- Still wrapped, and still failing OPEN into the human path: a broken pricer
  -- must never lose a shipper's load.
  begin
    perform private.issue_quote(v_id);
    perform private.mark_quoted(v_id);
  exception when others then
    insert into private.dispatch_log (load_id, skipped, detail)
    values (v_id, 'error', 'quote: ' || sqlstate);
  end;

  -- NO auto_dispatch here any more. It moved to accept_quote — see the header.
  -- If the load could not be priced, `issue_quote` has already put it in
  -- `finding_truck` and a dispatcher picks it up.

  return v_id;
end;
$function$;
revoke all on function private.post_load_impl(bigint, bigint, date, date, text, integer, text, jsonb, jsonb) from public, anon, authenticated;

-- Without places a job inside one town would be 0 km: check_same_city refuses it.
create or replace function public.post_load(p_origin_city bigint, p_dest_city bigint, p_pickup_from date, p_pickup_to date, p_goods text, p_weight_kg integer default null, p_truck_type_code text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.post_load_impl(p_origin_city, p_dest_city, p_pickup_from, p_pickup_to,
                                p_goods, p_weight_kg, p_truck_type_code, null, null);
end;
$$;

create or replace function private.book_load(p_origin_city bigint, p_dest_city bigint, p_pickup_from date, p_pickup_to date, p_goods text, p_weight_kg integer DEFAULT NULL::integer, p_truck_type_code text DEFAULT NULL::text, p_seen_price_baisa bigint DEFAULT NULL::bigint, p_origin_place jsonb DEFAULT NULL::jsonb, p_dest_place jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(load_id uuid, status load_status, price_baisa bigint, price_matched boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id      uuid;
  v_price   bigint;
  v_status  public.load_status;
  v_matched boolean;
begin
  if p_origin_place is not null and private.place_city(p_origin_place) is distinct from p_origin_city then
    raise exception 'city does not match place' using errcode = 'check_violation';
  end if;
  if p_dest_place is not null and private.place_city(p_dest_place) is distinct from p_dest_city then
    raise exception 'city does not match place' using errcode = 'check_violation';
  end if;

  -- 0069: places go in with the load, before it is priced between them.
  v_id := private.post_load_impl(p_origin_city, p_dest_city, p_pickup_from, p_pickup_to,
                                 p_goods, p_weight_kg, p_truck_type_code, p_origin_place, p_dest_place);

  select l.price_baisa into v_price from public.loads l where l.id = v_id;

  v_matched := v_price is not null and p_seen_price_baisa is not distinct from v_price;

  if v_matched then
    perform public.accept_quote(v_id);
  end if;

  select l.status into v_status from public.loads l where l.id = v_id;
  return query select v_id, v_status, v_price,
    (v_matched or (v_price is null and p_seen_price_baisa is null));
end;
$function$;

-- ═══ 3. waiting on the rate card, and the price at the real distance ════════
alter table private.rate_cards
  add column wait_free_minutes integer,
  add column wait_per_15min_baisa bigint,
  add constraint rate_cards_wait_terms check (
    (wait_free_minutes is null and wait_per_15min_baisa is null)
    or (wait_free_minutes between 0 and 240 and wait_per_15min_baisa between 1 and 100000000));

create or replace function private.issue_quote(p_load_id uuid)
 RETURNS TABLE(quote_id uuid, price_baisa bigint, currency character, outcome text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_load  public.loads;
  v_r     record;
  v_quote public.quotes;
begin
  select * into v_load from public.loads l where l.id = p_load_id;

  if v_load.id is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;

  select * into v_r
  from private.price_for_km(v_load.origin_city, v_load.dest_city,
                            v_load.truck_type_code, v_load.weight_kg, private.load_km(v_load.id));

  insert into public.quotes (
    shipper_id, load_id,
    origin_city, dest_city, truck_type_code, weight_kg, pickup_from, pickup_to,
    price_baisa, currency, outcome, rate_card_id
  ) values (
    v_load.shipper_id, v_load.id,
    v_load.origin_city, v_load.dest_city, v_load.truck_type_code, v_load.weight_kg,
    v_load.pickup_from, v_load.pickup_to,
    v_r.price_baisa, coalesce(v_r.currency, v_load.currency), v_r.outcome, v_r.rate_card_id
  )
  returning * into v_quote;

  -- 0069: the waiting terms in force at this price, kept with the load so the
  -- shipper is held to what they were shown, whatever the card says later.
  delete from private.load_wait_terms w where w.load_id = v_load.id;
  if v_r.outcome = 'quoted' then
    insert into private.load_wait_terms (load_id, free_minutes, per_15min_baisa, cap_minutes)
    select v_load.id, rc.wait_free_minutes, rc.wait_per_15min_baisa, private.setting_int('wait_cap_minutes', 120)
      from private.rate_cards rc
     where rc.id = v_r.rate_card_id and rc.wait_per_15min_baisa is not null;
  end if;

  if v_r.outcome = 'quoted' then
    update public.loads l
       set price_baisa       = v_r.price_baisa,
           priced_truck_type = private.resolve_truck_type(v_load.truck_type_code, v_load.weight_kg)
     where l.id = v_load.id;
  else
    update public.loads l set status = 'finding_truck'::public.load_status
    where l.id = v_load.id and l.status = 'posted'::public.load_status;
  end if;

  return query
  select v_quote.id, v_quote.price_baisa, v_quote.currency,
         v_quote.outcome, v_quote.expires_at;
end;
$function$;

drop function public.ops_upsert_rate_card(text, text, text, bigint, bigint, bigint, text, bigint);
drop function private.ops_upsert_rate_card_impl(text, text, text, bigint, bigint, bigint, text, bigint);
drop function public.ops_rate_cards();
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

create or replace function public.ops_rate_cards()
returns table (id bigint, origin_corridor text, dest_corridor text, truck_type_code text, truck_type_name text,
               base_baisa bigint, per_tonne_baisa bigint, min_fare_baisa bigint, currency character,
               created_at timestamptz, per_km_baisa bigint, wait_free_minutes integer, wait_per_15min_baisa bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return query
  select rc.id, rc.origin_corridor, rc.dest_corridor, rc.truck_type_code, tt.name_en,
         rc.base_baisa, rc.per_tonne_baisa, rc.min_fare_baisa, rc.currency, rc.created_at, rc.per_km_baisa,
         rc.wait_free_minutes, rc.wait_per_15min_baisa
    from private.rate_cards rc
    left join public.truck_types tt on tt.code = rc.truck_type_code
   order by rc.origin_corridor, rc.dest_corridor, tt.sort;
end;
$$;
revoke all on function public.ops_rate_cards() from public, anon;
grant execute on function public.ops_rate_cards() to authenticated;

-- The price the shipper sees, for the trip they are about to book: their pins
-- (checked against their towns, the same rule book_load applies), the price at
-- that distance, and the waiting terms that come with it. Volatile: it writes
-- the rate-limit counter (see quote_route, 0036).
create or replace function public.quote_trip(
  p_origin_city bigint, p_dest_city bigint, p_truck_type_code text default null, p_weight_kg integer default null,
  p_origin_lat double precision default null, p_origin_lng double precision default null,
  p_dest_lat double precision default null, p_dest_lng double precision default null
)
returns table (price_baisa bigint, currency character, outcome text, truck_type_code text, km numeric,
               wait_free_minutes integer, wait_per_15min_baisa bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_from   jsonb;
  v_to     jsonb;
  v_km     numeric;
  v_r      record;
  v_rate   private.rate_cards;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if (select private.actor_role()) <> 'shipper' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.check_rate_limit('quote_route', 30, interval '1 hour');

  if p_origin_city is null or p_dest_city is null then
    raise exception 'route required' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.cities c where c.id = p_origin_city)
     or not exists (select 1 from public.cities c where c.id = p_dest_city) then
    raise exception 'unknown city' using errcode = 'foreign_key_violation';
  end if;
  if p_weight_kg is not null and (p_weight_kg <= 0 or p_weight_kg > 60000) then
    raise exception 'weight out of range' using errcode = 'check_violation';
  end if;
  if p_truck_type_code is not null
     and not exists (select 1 from public.truck_types t where t.code = p_truck_type_code) then
    raise exception 'unknown truck type' using errcode = 'foreign_key_violation';
  end if;
  if (p_origin_lat is null) <> (p_origin_lng is null) or (p_dest_lat is null) <> (p_dest_lng is null) then
    raise exception 'a place needs both coordinates' using errcode = 'check_violation';
  end if;

  if p_origin_lat is not null then
    v_from := jsonb_build_object('lat', p_origin_lat, 'lng', p_origin_lng);
    if private.place_city(v_from) is distinct from p_origin_city then
      raise exception 'city does not match place' using errcode = 'check_violation';
    end if;
  end if;
  if p_dest_lat is not null then
    v_to := jsonb_build_object('lat', p_dest_lat, 'lng', p_dest_lng);
    if private.place_city(v_to) is distinct from p_dest_city then
      raise exception 'city does not match place' using errcode = 'check_violation';
    end if;
  end if;
  perform private.check_same_city(p_origin_city, p_dest_city, v_from, v_to);

  -- The same measure load_km applies once the load exists: pins when both are
  -- set, towns otherwise. Same inputs, same price.
  v_km := coalesce(private.road_km_between(p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng),
                   private.route_km(p_origin_city, p_dest_city));
  select * into v_r from private.price_for_km(p_origin_city, p_dest_city, p_truck_type_code, p_weight_kg, v_km);
  if v_r.outcome = 'quoted' then
    select * into v_rate from private.rate_cards rc where rc.id = v_r.rate_card_id;
  end if;

  return query select
    v_r.price_baisa, v_r.currency, v_r.outcome,
    case when v_r.outcome = 'quoted' then private.resolve_truck_type(p_truck_type_code, p_weight_kg) end,
    v_km, v_rate.wait_free_minutes, v_rate.wait_per_15min_baisa;
end;
$$;
revoke all on function public.quote_trip(bigint, bigint, text, integer, double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.quote_trip(bigint, bigint, text, integer, double precision, double precision, double precision, double precision) to authenticated;

-- ═══ 4. arriving, and the waiting clock ══════════════════════════════════════
alter table public.trip_events drop constraint trip_events_type_valid;
alter table public.trip_events add constraint trip_events_type_valid
  check (type = any (array['picked_up', 'en_route', 'delivered', 'note', 'arrived_pickup', 'arrived_drop']));

create table private.trip_wait_waivers (
  trip_id    uuid not null references public.trips(id) on delete cascade,
  stop       text not null check (stop in ('pickup', 'drop')),
  waived_by  uuid references public.profiles(id),
  reason     text not null,
  created_at timestamptz not null default now(),
  primary key (trip_id, stop)
);
revoke all on private.trip_wait_waivers from public, anon, authenticated;
alter table private.trip_wait_waivers enable row level security;
alter table private.trip_wait_waivers force row level security;

-- Each stop of a trip on a load with waiting terms: when the driver arrived,
-- when the wait ended (picked up / delivered; still running while the trip is
-- live), and the charge — free minutes first, then per started 15 minutes, up
-- to the cap. A waived stop charges nothing. The only place this is computed.
create or replace function private.trip_wait(p_trip_id uuid)
returns table (stop text, arrived_at timestamptz, ended_at timestamptz, running boolean, minutes integer,
               free_minutes integer, per_15min_baisa bigint, cap_minutes integer, capped boolean,
               waived boolean, charge_baisa bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select tr.id, tr.status, w.free_minutes, w.per_15min_baisa, w.cap_minutes
      from public.trips tr
      join private.load_wait_terms w on w.load_id = tr.load_id
     where tr.id = p_trip_id
  ),
  s as (
    select v.stop, v.arrive_type, v.end_type, v.ord
      from (values ('pickup', 'arrived_pickup', 'en_route', 1), ('drop', 'arrived_drop', 'delivered', 2))
           v(stop, arrive_type, end_type, ord)
  ),
  a as (
    select s.stop, s.ord, t.*,
           (select min(e.occurred_at) from public.trip_events e where e.trip_id = t.id and e.type = s.arrive_type) as arrived,
           (select min(e.occurred_at) from public.trip_events e where e.trip_id = t.id and e.type = s.end_type) as ended_event
      from t cross join s
  ),
  b as (
    select a.*,
           case when a.arrived is null then null
                when a.ended_event is not null and a.ended_event >= a.arrived then a.ended_event
                when a.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status) then now()
                else a.arrived end as ended,
           (a.arrived is not null and (a.ended_event is null or a.ended_event < a.arrived)
             and a.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)) as is_running,
           exists (select 1 from private.trip_wait_waivers x where x.trip_id = a.id and x.stop = a.stop) as is_waived
      from a
  ),
  c as (
    select b.*,
           coalesce(floor(extract(epoch from (b.ended - b.arrived)) / 60)::integer, 0) as mins
      from b
  )
  select c.stop, c.arrived, case when c.is_running then null else c.ended end, c.is_running, c.mins,
         c.free_minutes, c.per_15min_baisa, c.cap_minutes, c.mins >= c.cap_minutes, c.is_waived,
         case when c.is_waived then 0::bigint
              else (ceil(greatest(least(c.mins, c.cap_minutes) - c.free_minutes, 0) / 15.0)::bigint * c.per_15min_baisa)
         end
    from c
   order by c.ord;
$$;
revoke all on function private.trip_wait(uuid) from public, anon, authenticated;

create or replace function private.trip_wait_total(p_trip_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(w.charge_baisa), 0)::bigint from private.trip_wait(p_trip_id) w;
$$;
revoke all on function private.trip_wait_total(uuid) from public, anon, authenticated;

-- The whole picture of a trip's waiting, as jsonb. p_with_payout adds what the
-- driver earns (staff and the driver); the shipper never gets it.
create or replace function private.trip_wait_json(p_trip_id uuid, p_with_payout boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'terms', (select jsonb_build_object('free_minutes', w.free_minutes, 'per_15min_baisa', w.per_15min_baisa,
                                        'cap_minutes', w.cap_minutes)
                from private.load_wait_terms w where w.load_id = t.load_id),
    'stops', coalesce((select jsonb_agg(to_jsonb(s)) from private.trip_wait(t.id) s), '[]'::jsonb),
    'waiting_baisa', private.trip_wait_total(t.id),
    'price_baisa', l.price_baisa,
    'total_baisa', l.price_baisa + private.trip_wait_total(t.id),
    'payout_baisa', case when p_with_payout
                         then private.trip_payout(t.id, l.price_baisa) + private.trip_wait_total(t.id) end)
    from public.trips t join public.loads l on l.id = t.load_id
   where t.id = p_trip_id;
$$;
revoke all on function private.trip_wait_json(uuid, boolean) from public, anon, authenticated;

-- The driver or the shipper of the trip; anyone else is told it does not exist.
create or replace function public.trip_waiting(p_trip_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_driver  uuid;
  v_shipper uuid;
begin
  select t.driver_id, l.shipper_id into v_driver, v_shipper
    from public.trips t join public.loads l on l.id = t.load_id where t.id = p_trip_id;
  if v_uid is null or v_uid is distinct from v_driver and v_uid is distinct from v_shipper then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  return private.trip_wait_json(p_trip_id, v_uid = v_driver);
end;
$$;
revoke all on function public.trip_waiting(uuid) from public, anon;
grant execute on function public.trip_waiting(uuid) to authenticated;

-- "I've arrived". The phone's fix comes with the tap and is checked against the
-- pin, then dropped: nothing about it is stored (a position is only ever one
-- row, 0032/0039). Arriving twice keeps the first time. The shipper is told,
-- with the waiting terms — amounts only on the lock screen (0046).
create or replace function public.mark_arrived(
  p_trip_id uuid, p_stop text, p_lat double precision, p_lng double precision, p_accuracy_m numeric default null
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_trip   public.trips;
  v_load   public.loads;
  v_pin    public.load_places;
  v_type   text;
  v_at     timestamptz;
  v_dist   numeric;
  v_terms  private.load_wait_terms;
  v_lang   text;
begin
  perform private.check_rate_limit('mark_arrived', 60, interval '1 hour');
  select * into v_trip from public.trips t where t.id = p_trip_id and t.driver_id = v_uid for update;
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  if p_stop not in ('pickup', 'drop') then
    raise exception 'stop is pickup or drop' using errcode = 'check_violation';
  end if;
  if (p_stop = 'pickup' and v_trip.status <> 'assigned'::public.trip_status)
     or (p_stop = 'drop' and v_trip.status <> 'in_transit'::public.trip_status) then
    raise exception 'not at this stage of the job' using errcode = 'check_violation';
  end if;
  v_type := 'arrived_' || p_stop;
  select min(e.occurred_at) into v_at from public.trip_events e where e.trip_id = p_trip_id and e.type = v_type;
  if v_at is not null then
    return v_at;
  end if;

  select * into v_pin from public.load_places p where p.load_id = v_trip.load_id and p.kind = p_stop;
  if not found then
    raise exception 'This job has no pin for that stop.' using errcode = 'check_violation';
  end if;
  if p_lat is null or p_lng is null or p_lat not between 12 and 33 or p_lng not between 34 and 60 then
    raise exception 'no location from the phone' using errcode = 'check_violation';
  end if;
  v_dist := private.metres_between(p_lat, p_lng, v_pin.lat, v_pin.lng);
  if v_dist > private.setting_int('arrive_radius_m', 500) + least(coalesce(p_accuracy_m, 0), 200) then
    raise exception 'You are % m from the pin. Tap again when you are there.', round(v_dist)
      using errcode = 'check_violation';
  end if;

  insert into public.trip_events (trip_id, type) values (p_trip_id, v_type) returning occurred_at into v_at;

  select * into v_load from public.loads l where l.id = v_trip.load_id;
  select * into v_terms from private.load_wait_terms w where w.load_id = v_trip.load_id;
  perform private.push_send(v_load.shipper_id, 'shipper_driver_arrived', v_load.id,
    case p_stop when 'pickup' then 'Your truck is at the pickup' else 'Your truck is at the drop-off' end,
    case when v_terms.load_id is null then private.push_route(v_load.id, 'en')
         else 'Waiting is free for ' || v_terms.free_minutes || ' minutes, then '
              || private.push_money(v_terms.per_15min_baisa, 'en') || ' per 15 minutes.' end,
    case p_stop when 'pickup' then 'شاحنتك عند موقع التحميل' else 'شاحنتك عند موقع التسليم' end,
    case when v_terms.load_id is null then private.push_route(v_load.id, 'ar')
         else 'الانتظار مجاني لمدة ' || v_terms.free_minutes || ' دقيقة، ثم '
              || private.push_money(v_terms.per_15min_baisa, 'ar') || ' لكل ١٥ دقيقة.' end,
    jsonb_build_object('kind', 'shipper_driver_arrived', 'load_id', v_load.id));
  return v_at;
end;
$$;
revoke all on function public.mark_arrived(uuid, text, double precision, double precision, numeric) from public, anon;
grant execute on function public.mark_arrived(uuid, text, double precision, double precision, numeric) to authenticated;

-- Staff: the same picture with the driver's side, and waiving a stop.
create or replace function public.ops_trip_waiting(p_trip_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  if not exists (select 1 from public.trips t where t.id = p_trip_id) then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  return private.trip_wait_json(p_trip_id, true)
    || jsonb_build_object('waivers', coalesce((select jsonb_agg(jsonb_build_object(
         'stop', x.stop, 'reason', x.reason, 'at', x.created_at,
         'by', (select p.full_name from public.profiles p where p.id = x.waived_by)))
         from private.trip_wait_waivers x where x.trip_id = p_trip_id), '[]'::jsonb));
end;
$$;
revoke all on function public.ops_trip_waiting(uuid) from public, anon;
grant execute on function public.ops_trip_waiting(uuid) to authenticated;

create or replace function public.ops_waive_waiting(p_trip_id uuid, p_stop text, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_before bigint;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_waive_waiting', 100, interval '1 hour');
  v_reason := private.clean_text(p_reason, 3, 'waiving waiting');
  if p_stop not in ('pickup', 'drop') then
    raise exception 'stop is pickup or drop' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.trips t where t.id = p_trip_id) then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  select w.charge_baisa into v_before from private.trip_wait(p_trip_id) w where w.stop = p_stop;
  insert into private.trip_wait_waivers (trip_id, stop, waived_by, reason)
  values (p_trip_id, p_stop, auth.uid(), v_reason)
  on conflict (trip_id, stop) do nothing;
  perform private.log_ops('ops_waive_waiting', 'trip', p_trip_id::text,
    jsonb_build_object('stop', p_stop, 'charge_baisa', v_before), jsonb_build_object('stop', p_stop, 'charge_baisa', 0),
    v_reason);
end;
$$;
revoke all on function public.ops_waive_waiting(uuid, text, text) from public, anon;
grant execute on function public.ops_waive_waiting(uuid, text, text) to authenticated;

-- ═══ 5. past the cap, a person steps in ══════════════════════════════════════
alter table public.shipment_cases drop constraint shipment_cases_kind_check;
alter table public.shipment_cases add constraint shipment_cases_kind_check check (kind = any (array[
  'delay', 'breakdown', 'damage', 'other', 'cancel_request', 'no_show', 'abandoned', 'release',
  'delivery_dispute', 'no_pod', 'price_demand', 'misconduct', 'not_ready', 'cargo_mismatch', 'late_cancel',
  'unreachable', 'change_request', 'account_flag', 'appeal', 'app_problem', 'long_wait']));

create or replace function private.case_priority_for(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_kind in ('breakdown', 'abandoned', 'no_show', 'misconduct') then 'urgent'
    when p_kind in ('damage', 'delivery_dispute', 'price_demand', 'release', 'late_cancel', 'cancel_request',
                    'not_ready', 'unreachable', 'delay', 'change_request', 'cargo_mismatch', 'long_wait') then 'high'
    else 'normal'
  end;
$$;

-- A stop still waiting at the cap: one case per trip and stop. The charge has
-- stopped growing; a person finds out why.
create or replace function private.system_detect_long_waits()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select t.id as trip_id, t.load_id, t.driver_id, w.stop, w.minutes
      from public.trips t
      join private.load_wait_terms lw on lw.load_id = t.load_id
      cross join lateral private.trip_wait(t.id) w
     where t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)
       and w.running and w.capped and not w.waived
       and not exists (select 1 from public.shipment_cases c
                        where c.trip_id = t.id and c.kind = 'long_wait'
                          and c.details like 'Waiting at the ' || case w.stop when 'pickup' then 'pickup' else 'drop-off' end || '%')
  loop
    insert into public.shipment_cases (load_id, trip_id, subject_id, kind, details)
    values (r.load_id, r.trip_id, null, 'long_wait',
            'Waiting at the ' || case r.stop when 'pickup' then 'pickup' else 'drop-off' end
            || ' reached ' || r.minutes || ' minutes; the waiting charge has stopped growing.');
    n := n + 1;
  end loop;
  if n > 0 then
    perform private.log_system('system_detect_long_waits', 'system', 'long_waits', jsonb_build_object('cases', n));
  end if;
  return n;
end;
$$;
revoke all on function private.system_detect_long_waits() from public, anon, authenticated;

create or replace function private.system_detect_trouble()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- One detector failing must not stop the other.
  begin
    perform private.system_detect_no_shows();
  exception when others then
    perform private.log_system('system_detect_error', 'system', 'no_shows', jsonb_build_object('sqlstate', sqlstate));
  end;
  begin
    perform private.system_detect_abandoned();
  exception when others then
    perform private.log_system('system_detect_error', 'system', 'abandoned', jsonb_build_object('sqlstate', sqlstate));
  end;
  begin
    perform private.system_detect_long_waits();
  exception when others then
    perform private.log_system('system_detect_error', 'system', 'long_waits', jsonb_build_object('sqlstate', sqlstate));
  end;
end;
$function$;

create or replace function private.ops_setting_spec()
 RETURNS TABLE(key text, value_type text, label text, description text, min_value integer, max_value integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  values
    ('auto_dispatch_enabled', 'boolean', 'Automatic dispatch',
     'When on, a posted load is offered to nearby drivers with no human involved. When off, every load waits for a dispatcher. Nothing is lost — loads queue normally.',
     null::integer, null::integer),
    -- Since 0036 this is the WAVE size (dispatch_wave: v_size), not a per-load cap.
    ('auto_dispatch_max_offers', 'integer', 'Drivers asked per wave',
     'How many drivers each dispatch wave offers a load to. Every wave asks this many more, so higher fills faster and bothers more drivers.', 1, 20),
    ('auto_dispatch_max_pending_per_driver', 'integer', 'Live offers per driver',
     'How many unanswered offers one driver may hold. Stops one driver being buried.', 1, 20),
    ('auto_dispatch_requires_price', 'boolean', 'Only auto-dispatch priced loads',
     'When on, a load with no price waits for a dispatcher instead of being offered.', null, null),
    ('require_verified_driver', 'boolean', 'Only verified drivers may accept',
     'When on, an unverified driver cannot accept an offer or bid. The website claims "100% verified drivers"; this setting makes that true.', null, null),
    ('dispatch_wave_minutes', 'integer', 'Minutes per dispatch wave',
     'How long each group of drivers has to answer before the next group is asked.', 1, 60),
    -- At most 3: dispatch reads dispatch_radius_km_<wave> and only three exist; a
    -- fourth wave would silently search the 1500 km default.
    ('dispatch_max_waves', 'integer', 'Dispatch waves before a person is alerted',
     'After this many waves with no taker, a dispatcher is alerted. The machine keeps looking, as far as the last wave''s radius.', 1, 3),
    ('dispatch_radius_km_1', 'integer', 'First wave radius (km)',
     'How far from the pickup the first wave looks for drivers.', 10, 2000),
    ('dispatch_radius_km_2', 'integer', 'Second wave radius (km)',
     'How far the second wave looks.', 10, 2000),
    ('dispatch_radius_km_3', 'integer', 'Third wave radius (km)',
     'How far the third wave looks.', 10, 3000),
    ('dispatch_location_fresh_minutes', 'integer', 'GPS counts as fresh for (minutes)',
     'A driver''s last GPS point older than this is ignored and their town is used instead.', 5, 240),
    ('dispatch_rescue_enabled', 'boolean', 'Keep looking after the alert',
     'When on, a load nobody took is offered to any driver who comes online, until its collection date.', null, null),
    ('drivers_online_by_default', 'boolean', 'Drivers online unless they switch off',
     'When on, every driver is offered work unless they turn themselves off.', null, null),
    ('bid_window_minutes', 'integer', 'Bidding window (minutes)',
     'How long a bid load takes bids before the shipper chooses.', 10, 1440),
    ('bid_wave_minutes', 'integer', 'Minutes between bid invitations',
     'How often more drivers are invited to bid.', 1, 60),
    ('bid_invites_per_wave', 'integer', 'Drivers invited per wave',
     'How many drivers each bid invitation wave reaches.', 1, 20),
    ('bid_enough_bids', 'integer', 'Bids that are enough',
     'Once a load has this many bids, no more drivers are invited.', 1, 20),
    ('push_enabled', 'boolean', 'Push notifications',
     'When off, the database sends no push notifications at all. The kill switch for a bad push.', null, null),
    ('stuck_alert_minutes', 'integer', 'Stuck-load alert (minutes)',
     'A load waiting this long with nobody on it alerts a person.', 5, 240),
    -- 0062: support desk response times.
    ('case_sla_urgent_minutes', 'integer', 'Urgent case: answer within (minutes)',
     'An urgent case (breakdown, abandoned trip, no-show, misconduct) is overdue after this long.', 5, 240),
    ('case_sla_high_minutes', 'integer', 'High-priority case: answer within (minutes)',
     'A high-priority case (damage, dispute, delay, cancellation) is overdue after this long.', 15, 1440),
    ('case_sla_normal_minutes', 'integer', 'Normal case: answer within (minutes)',
     'Any other case is overdue after this long. Changing these does not move deadlines already set.', 60, 10080),
    -- 0063: strikes and the detectors.
    ('strike_suspend_threshold', 'integer', 'Strike points before suspension is suggested',
     'Strikes weigh 1 to 3 points (an abandoned load is 3). When a driver''s points in the last 30 days reach this, the console suggests suspending them. Staff decide.', 1, 20),
    ('dispatch_deprioritise_strikes', 'boolean', 'Offer work to drivers with strikes last',
     'When on, drivers with strikes in the last 30 days are asked after every driver without strikes in the same search — even ones further away. They are still asked. Declared empty legs are matched first either way.', null, null),
    ('no_show_hour', 'integer', 'No-show check, hour of the last pickup day (Muscat)',
     'An accepted trip not started by this hour on the last day of its pickup window is flagged as a possible no-show for a person to check.', 8, 23),
    ('abandon_hours', 'integer', 'Possible abandonment after (hours of silence)',
     'A truck on the road with no event or GPS for this long is flagged as possibly abandoned, for a person to check. Leave room for a night''s sleep and a border queue.', 2, 48),
    ('late_release_hours', 'integer', 'Late release, within (hours of pickup)',
     'A driver who releases a job this close to the pickup day gets a heavier strike.', 1, 72),
    -- 0069: pickups.
    ('wait_cap_minutes', 'integer', 'Waiting stops counting after (minutes, per stop)',
     'Waiting at a pickup or drop-off is charged up to this long; past it the charge stops and a support case opens for a person to sort out. Applies to loads priced after the change.', 30, 480),
    ('arrive_radius_m', 'integer', 'Driver counts as arrived within (metres of the pin)',
     'How close the driver''s phone must be to the pin for "I''ve arrived" to start the waiting clock.', 100, 2000),
    ('same_city_min_m', 'integer', 'Shortest job inside one town (metres between pins)',
     'A job whose pickup and drop-off are in the same town needs both pins at least this far apart.', 100, 5000)
$function$;

-- ═══ 6. the driver keeps the waiting ════════════════════════════════════════
create or replace function public.driver_earnings()
 RETURNS TABLE(week_baisa bigint, week_trips bigint, all_time_trips bigint, month_baisa bigint, month_trips bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_today date;
  v_week date;
  v_month date;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  v_today := (now() at time zone 'Asia/Muscat')::date;
  v_week := v_today - (extract(isodow from v_today)::int % 7);
  v_month := date_trunc('month', v_today)::date;
  return query
  with delivered as (
    select private.trip_payout(t.id, l.price_baisa) + private.trip_wait_total(t.id) as payout,
      (private.trip_done_at(t.id, t.created_at) at time zone 'Asia/Muscat')::date as done_on
    from public.trips t join public.loads l on l.id = t.load_id
    where t.driver_id = v_actor
      and t.status in ('delivered'::public.trip_status, 'closed'::public.trip_status)
  )
  select
    coalesce(sum(d.payout) filter (where d.done_on >= v_week), 0)::bigint,
    count(*) filter (where d.done_on >= v_week)::bigint,
    count(*)::bigint,
    coalesce(sum(d.payout) filter (where d.done_on >= v_month), 0)::bigint,
    count(*) filter (where d.done_on >= v_month)::bigint
  from delivered d;
end;
$function$;

create or replace function public.driver_trips()
 RETURNS TABLE(trip_id uuid, origin_city bigint, dest_city bigint, goods text, weight_kg integer, payout_baisa bigint, currency character, delivered_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  return query
  select t.id, l.origin_city, l.dest_city, l.goods_description, l.weight_kg,
    private.trip_payout(t.id, l.price_baisa) + private.trip_wait_total(t.id), l.currency,
    private.trip_done_at(t.id, t.created_at) as done_at
  from public.trips t
  join public.loads l on l.id = t.load_id
  where t.driver_id = v_actor
    and t.status in ('delivered'::public.trip_status, 'closed'::public.trip_status)
  order by done_at desc limit 200;
end;
$function$;
