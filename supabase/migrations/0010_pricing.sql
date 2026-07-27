-- ─────────────────────────────────────────────────────────────────────────────
-- 0010 — pricing: the quote engine
--
-- WHY THIS EXISTS
--
-- `loads.price_baisa` has existed since 0001 with no client write grant and
-- nothing that ever wrote it. `src/lib/queries.ts` selected it, `formatMoney()`
-- was written and never called, and the post-load button has always said
-- "Request a quote". The shipper was promised a price by a button and there was
-- no code path in the product that could produce one.
--
-- SECURITY.md §5 is a constraint spec for this file, not a design — it opens with
-- "Pricing is not yet designed". PRODUCT.md and STACK.md §10 both list the model
-- as explicitly undecided. What is decided here is the SHAPE (corridor-band), and
-- every §5 constraint it names.
--
-- THE MODEL: corridor bands, not per-km
--
-- `cities.corridor` already groups the 46 seeded cities into 8 bands, lifted from
-- the website. A rate keyed on (origin corridor, dest corridor, truck type) is
-- ~320 ordered cells — authorable by a human who knows the business.
--
-- The per-km alternative needs 1,035 city-pair road distances. Real ones need a
-- routing API, which STACK.md defers to Phase 3; invented ones would be worse
-- than none, because a wrong distance is an invisibly wrong price.
--
-- Directional on purpose: Muscat→Salalah and Salalah→Muscat are not the same
-- price. Backhaul on a leg a truck is already running is the entire economic
-- argument in PRODUCT.md, so the schema must be able to express it.
--
-- THE TABLE SHIPS EMPTY. NO RATES ARE INVENTED HERE.
--
-- A rate card is "crown jewel #1 — the business's actual moat" (§1). Placeholder
-- numbers in a migration would be quoted to real customers in Omani rial the
-- first time someone forgot they were placeholders. So: no rows.
--
-- The empty-card behaviour is the point, not a gap. No rate → no quote →
-- `finding_truck` → a human prices it. That is exactly the path PRODUCT.md
-- already promises ("a shipper never hits a dead end"), so the engine degrades
-- into the concierge product it is replacing, one corridor at a time, as real
-- rates get loaded. Nothing is dead-ended while the card is empty.
--
-- THE FORMULA LIVES ONLY IN SQL
--
-- There is deliberately no `src/lib/pricing.ts`. Two reasons:
--   1. §5: "The server always recomputes the price." One implementation cannot
--      disagree with itself; two will, and the divergence shows up as a price.
--   2. The rate card is the moat. A client-side formula ships the shape of the
--      moat in the app bundle to anyone who unzips an APK — and §9 is blunt that
--      anything in the client bundle is public forever.
--
-- The client never computes and never sees a rate; it renders
-- `quotes.price_baisa` and nothing else. That is why the §5-mandated pricing unit
-- tests live in `supabase/tests/pricing.sql` rather than in jest.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ THE RATE CARD ══════════════════════════════════════════════════════════
-- In `private`, not `public`. PostgREST only exposes `public`, so the moat is not
-- one mistaken grant away from being readable — same reasoning as
-- `private.ops_users` in 0005. There is no client grant and no write RPC:
-- rates are loaded by hand, like appointing a dispatcher.

create table private.rate_cards (
  id bigint generated always as identity primary key,

  -- Matched against `cities.corridor` verbatim. Validated by trigger below
  -- rather than by a foreign key, because `cities.corridor` is not unique.
  origin_corridor text not null,
  dest_corridor   text not null,

  truck_type_code text not null references public.truck_types,

  -- Money: integer baisa, like every other amount in this schema. OMR is a
  -- THREE-decimal currency. See src/lib/money.ts.
  base_baisa      bigint not null,  -- the leg, irrespective of weight
  per_tonne_baisa bigint not null default 0,
  min_fare_baisa  bigint not null,  -- the floor; §5 requires one

  currency char(3) not null default 'OMR',

  created_at timestamptz not null default now(),

  -- One current rate per band+type. History lives in the audit table, so this
  -- can be a plain unique constraint rather than effective-dating every row.
  unique (origin_corridor, dest_corridor, truck_type_code),

  constraint rate_base_sane      check (base_baisa      >= 0),
  constraint rate_per_tonne_sane check (per_tonne_baisa >= 0),
  -- A zero floor would let a zero-weight quote price at zero, and
  -- `loads_price_positive` would then reject the load's price with a constraint
  -- error the shipper cannot act on. Fail here, at configuration time.
  constraint rate_min_fare_sane  check (min_fare_baisa  >  0),
  constraint rate_bands_present  check (
    -- Same-corridor bands ARE valid (intra-Muscat is a real trip); this only
    -- rejects a row that says nothing.
    origin_corridor <> '' and dest_corridor <> ''
  )
);

alter table private.rate_cards enable row level security;
alter table private.rate_cards force row level security;
revoke all on table private.rate_cards from anon, authenticated;

comment on table private.rate_cards is
  'Corridor-band rate card — crown jewel #1 (SECURITY.md §1). No client grant, no '
  'write RPC: loaded by hand like private.ops_users. Ships EMPTY on purpose; a '
  'missing band yields no quote and the load goes to finding_truck for a human.';

-- ─── corridor validation ────────────────────────────────────────────────────
-- A typo'd corridor string would otherwise insert cleanly and then silently
-- never match a load, which is the worst possible failure: a rate that exists,
-- looks configured, and prices nothing. Fail closed and loud (§0.5).

create or replace function private.rate_card_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.cities c where c.corridor = new.origin_corridor) then
    raise exception 'unknown origin corridor: %', new.origin_corridor
      using errcode = 'foreign_key_violation';
  end if;

  if not exists (select 1 from public.cities c where c.corridor = new.dest_corridor) then
    raise exception 'unknown destination corridor: %', new.dest_corridor
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

create trigger rate_cards_validate
  before insert or update on private.rate_cards
  for each row execute function private.rate_card_validate();

-- ─── audit: §5 requires every rate mutation logged with before/after ────────

create table private.rate_card_audit (
  id         bigint generated always as identity primary key,
  rate_id    bigint,            -- not an FK: the log outlives a deleted rate
  action     text not null,
  actor_id   uuid,              -- null when written by a superuser/dashboard
  before_row jsonb,
  after_row  jsonb,
  at         timestamptz not null default now()
);

alter table private.rate_card_audit enable row level security;
alter table private.rate_card_audit force row level security;
revoke all on table private.rate_card_audit from anon, authenticated;

create or replace function private.rate_card_audit_fn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.rate_card_audit (rate_id, action, actor_id, before_row, after_row)
  values (
    coalesce(new.id, old.id),
    lower(tg_op),
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger rate_cards_audit
  after insert or update or delete on private.rate_cards
  for each row execute function private.rate_card_audit_fn();

-- ═══ THE PURE FORMULA ═══════════════════════════════════════════════════════
-- §5: "The pricing function is pure and unit-tested. No network, no clock read
-- inside it (pass the date in), no env reads."
--
-- `immutable` is the enforcement, not a hint: Postgres rejects a clock read or a
-- table read inside an immutable function. Every input is a parameter, including
-- the rate values — the LOOKUP happens in the caller, so this function has
-- nothing to read and nothing to depend on.

create or replace function private.compute_price(
  p_base_baisa      bigint,
  p_per_tonne_baisa bigint,
  p_min_fare_baisa  bigint,
  p_weight_kg       integer   -- NULL = not stated by the shipper
)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select greatest(
    p_min_fare_baisa,
    p_base_baisa + p_per_tonne_baisa * (
      case
        -- Weight is optional on a load (the shipper may not know it). An unstated
        -- weight prices the leg alone rather than guessing a tonnage — guessing
        -- high overcharges, guessing low is a quote Truckkoo has to break.
        when p_weight_kg is null then 0
        -- Billable tonnes round UP: a 1,200 kg load occupies two tonnes of
        -- capacity. ceil() on a numeric, never float arithmetic — see money.ts.
        else ceil(p_weight_kg::numeric / 1000)::bigint
      end
    )
  );
$$;

comment on function private.compute_price(bigint, bigint, bigint, integer) is
  'Pure price arithmetic. immutable, so Postgres forbids the clock and table reads '
  'that SECURITY.md §5 forbids by policy. Tested in supabase/tests/pricing.sql.';

-- No grant. Reachable only from the definer functions below, never as an RPC —
-- a client that could call this with its own rate values could brute-force the
-- card by observing which inputs reproduce a real quote.
revoke all on function private.compute_price(bigint, bigint, bigint, integer)
  from public, anon, authenticated;

-- ─── corridor of a city ─────────────────────────────────────────────────────

create or replace function private.corridor_of(p_city_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select c.corridor from public.cities c where c.id = p_city_id;
$$;

revoke all on function private.corridor_of(bigint) from public, anon, authenticated;

-- ═══ QUOTES ═════════════════════════════════════════════════════════════════
-- §5: "Quotes are immutable and bound to exact origin, destination, truck type,
-- weight, and date." Every binding column is stored on the row, so what was
-- quoted is recoverable from the quote itself and not inferred from a load that
-- may since have changed.

create table public.quotes (
  id uuid primary key default gen_random_uuid(),

  shipper_id uuid not null references public.profiles on delete cascade,
  load_id    uuid not null references public.loads    on delete cascade,

  -- ── the binding (§5) ──
  origin_city bigint not null references public.cities,
  dest_city   bigint not null references public.cities,
  -- NULLABLE, like loads.truck_type_code. NULL is "Not sure — advise me" and it
  -- is the reason a quote can exist with no price: see quote_load() below.
  truck_type_code text references public.truck_types,
  weight_kg   integer,
  pickup_from date not null,
  pickup_to   date not null,

  -- ── the result ──
  -- NULL price is a legitimate, expected outcome, not a failure row. `outcome`
  -- says which of the three no-price cases applied.
  price_baisa bigint,
  currency    char(3) not null default 'OMR',
  outcome     text not null,

  -- Provenance: which card priced this. NOT client-readable (see grants) — the
  -- id plus a price is a foothold for reconstructing the card.
  rate_card_id bigint references private.rate_cards on delete set null,

  created_at timestamptz not null default now(),
  -- §5: "Quotes expire — default 48h, enforced server-side." Same window as an
  -- offer, deliberately: a shipper's price and a driver's offer age together.
  expires_at timestamptz not null default now() + interval '48 hours',

  constraint quotes_price_positive check (price_baisa is null or price_baisa > 0),
  constraint quotes_window_ordered check (pickup_to >= pickup_from),
  constraint quotes_outcome_known check (
    outcome in ('quoted', 'advise_me', 'no_rate', 'over_capacity')
  ),
  -- A priced quote must carry a price; an unpriced outcome must not.
  constraint quotes_outcome_consistent check (
    (outcome = 'quoted' and price_baisa is not null)
    or (outcome <> 'quoted' and price_baisa is null)
  )
);

create index quotes_by_load on public.quotes (load_id, created_at desc);

alter table public.quotes enable row level security;
alter table public.quotes force row level security;
revoke all on table public.quotes from anon, authenticated;

-- ─── immutability, structurally ─────────────────────────────────────────────
-- There is no UPDATE or DELETE grant below, so this trigger is the second layer,
-- for the same reason trip_events has no update path: a price that can be
-- rewritten after the fact is not a quote, it is a note. The trigger also binds
-- any FUTURE definer function that might otherwise edit a quote without
-- thinking, which is the case a grant cannot cover — definer functions run as
-- owner and are not subject to grants at all.

create or replace function private.quotes_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'quotes are immutable — issue a new quote instead'
    using errcode = 'check_violation';
end;
$$;

create trigger quotes_no_update
  before update or delete on public.quotes
  for each row execute function private.quotes_immutable();

-- ─── grants: own rows, and not the provenance column ────────────────────────
-- Column-level SELECT, not table-level. `rate_card_id` is withheld: a shipper
-- collecting quotes across routes and seeing which ones shared a card learns the
-- band structure of the rate card, which is the moat (§1).
--
-- No INSERT grant — quotes come from quote_load() only. No UPDATE, no DELETE.

grant select (
  id, shipper_id, load_id,
  origin_city, dest_city, truck_type_code, weight_kg, pickup_from, pickup_to,
  price_baisa, currency, outcome, created_at, expires_at
) on public.quotes to authenticated;

create policy "own quotes readable" on public.quotes
  for select to authenticated
  using (shipper_id = (select auth.uid()));

comment on table public.quotes is
  'Immutable, bound, expiring quotes (SECURITY.md §5). A NULL price with an '
  'outcome of advise_me/no_rate/over_capacity is an expected result, not an error: '
  'it routes the load to a human, which is the no-dead-end promise in PRODUCT.md.';

-- ═══ THE BINDING GUARD ══════════════════════════════════════════════════════
-- §5: "A quote for Muscat→Seeb must never be redeemable for Muscat→Salalah."
--
-- Today that is structurally impossible: `loads` carries no client UPDATE grant
-- at all (SENSITIVE_FIELDS.md — "Client may write on UPDATE: nothing"), so a
-- shipper cannot re-route a load after pricing it. This trigger exists for the
-- case grants cannot reach: a future definer RPC that edits a load's route or
-- weight and does not think about the price hanging off it.
--
-- Both layers on purpose, the same way safe-text.ts is enforced again by a
-- database trigger.

create or replace function private.loads_price_binding()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.price_baisa is not null
     and (   new.origin_city     is distinct from old.origin_city
          or new.dest_city       is distinct from old.dest_city
          or new.truck_type_code is distinct from old.truck_type_code
          or new.weight_kg       is distinct from old.weight_kg
          or new.pickup_from     is distinct from old.pickup_from
          or new.pickup_to       is distinct from old.pickup_to)
  then
    -- Drop the price rather than raise. The edit itself may be legitimate (ops
    -- correcting a city); what is never legitimate is carrying the old price
    -- across it. The load re-quotes, and the quote row survives as the record of
    -- what was priced under the old binding.
    new.price_baisa := null;
  end if;

  return new;
end;
$$;

create trigger loads_price_binding_guard
  before update on public.loads
  for each row execute function private.loads_price_binding();

-- ═══ THE QUOTE RPC ══════════════════════════════════════════════════════════
-- Authenticated shippers only. SECURITY.md §11 records that per-IP rate limiting
-- is NOT implemented and that "anonymous endpoints must not ship before they
-- are" — so there is deliberately no anonymous quote path, even though the
-- website's public quote form would suggest one. The rate card is exactly what an
-- unthrottled anonymous quote endpoint would leak.

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
  v_actor    uuid := auth.uid();
  v_load     public.loads;
  v_rate     private.rate_cards;
  v_capacity integer;
  v_price    bigint;
  v_outcome  text;
  v_rate_id  bigint;
  v_quote    public.quotes;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- §5: "Rate-limit the quote path. Without it a competitor sweeps every route
  -- pair and extracts the whole rate card in an afternoon."
  perform private.check_rate_limit('quote_load', 30, interval '1 hour');

  -- Fetch SCOPED TO THE ACTOR (§3). This function is `security definer` and takes
  -- a load id, which is the exact shape of the IDOR that `match_load` was fixed
  -- for: without `shipper_id = v_actor` here, any authenticated user could price
  -- any load and read back its route and weight.
  select * into v_load
  from public.loads l
  where l.id = p_load_id and l.shipper_id = v_actor;

  -- Not-found and not-yours are indistinguishable to the caller (§3).
  if v_load.id is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;

  if v_load.status not in ('posted', 'finding_truck') then
    raise exception 'load is no longer open for quoting' using errcode = 'check_violation';
  end if;

  -- ── the three no-price outcomes ──
  -- None of these is an error. Each one hands the load to a human, which is the
  -- product's permanent fallback rather than an MVP shortcut (PRODUCT.md).

  if v_load.truck_type_code is null then
    -- "Not sure — advise me". The card is keyed on truck type, so there is
    -- nothing to look up — and picking a type on the shipper's behalf in order to
    -- produce a number would quote them for a truck they never asked for. This is
    -- the most important affordance in the product staying intact: it costs an
    -- automated price and buys a human recommendation.
    v_outcome := 'advise_me';
  else
    select tt.capacity_kg into v_capacity
    from public.truck_types tt where tt.code = v_load.truck_type_code;

    if v_load.weight_kg is not null and v_load.weight_kg > v_capacity then
      -- §5 requires over-capacity to be rejected rather than priced. Refusing the
      -- PRICE (not the load) is the rejection: pricing a 20-tonne load onto a
      -- 3-tonne hi-up would quote a trip that physically cannot happen.
      v_outcome := 'over_capacity';
    else
      select * into v_rate
      from private.rate_cards rc
      where rc.origin_corridor = private.corridor_of(v_load.origin_city)
        and rc.dest_corridor   = private.corridor_of(v_load.dest_city)
        and rc.truck_type_code = v_load.truck_type_code;

      if v_rate.id is null then
        -- The empty-card path, and the normal state of this system until real
        -- rates are loaded band by band.
        v_outcome := 'no_rate';
      else
        v_price   := private.compute_price(
                       v_rate.base_baisa, v_rate.per_tonne_baisa,
                       v_rate.min_fare_baisa, v_load.weight_kg);
        v_rate_id := v_rate.id;
        v_outcome := 'quoted';

        -- §5: "Assert total > 0 before persisting." min_fare_baisa > 0 is
        -- constrained, so this is unreachable — which is why it raises rather
        -- than coercing. An unreachable branch that fires means an assumption
        -- broke, and 0009 is this repo's own lesson about what silence costs.
        if v_price is null or v_price <= 0 then
          raise exception 'computed a non-positive price for load %', v_load.id
            using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end if;

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
    v_price, coalesce(v_rate.currency, v_load.currency), v_outcome, v_rate_id
  )
  returning * into v_quote;

  if v_outcome = 'quoted' then
    update public.loads l set price_baisa = v_price where l.id = v_load.id;
  else
    -- No price means a human owns this one. Moving it to finding_truck is what
    -- puts it in ops_queue() and keeps the "we are finding you a truck" promise
    -- instead of showing the shipper an empty price and no explanation.
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

-- ═══ OPS OVERRIDE ═══════════════════════════════════════════════════════════
-- The dispatcher path, and the only way a load gets a price while the rate card
-- is empty. STACK.md §0 argues for exactly this ordering — "be the algorithm
-- yourself" first, and let the hand-priced trips teach the card what to say.
--
-- Reads and writes across tenants, so it opens with require_ops() like every
-- other ops function, and no table policy was loosened to build it.

create or replace function public.ops_set_price(
  p_load_id     uuid,
  p_price_baisa bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_load public.loads;
begin
  perform private.require_ops();

  -- Bound the input (§6). A dispatcher fat-fingering an extra three digits is
  -- the likeliest way a wrong price reaches a customer, and OMR's three decimals
  -- make every amount look an order of magnitude larger than it is: 50 rial is
  -- 50000 baisa. The ceiling is 1,000,000,000 baisa = 1,000,000 OMR.
  if p_price_baisa is null or p_price_baisa <= 0 or p_price_baisa > 1000000000 then
    raise exception 'price out of range' using errcode = 'check_violation';
  end if;

  select * into v_load from public.loads l where l.id = p_load_id;

  if v_load.id is null then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;

  if v_load.status not in ('posted', 'finding_truck', 'matched') then
    raise exception 'load is no longer open for pricing' using errcode = 'check_violation';
  end if;

  -- Recorded as a quote like any other, with outcome 'quoted' and no
  -- rate_card_id: a hand-priced load is still a bound, expiring, immutable quote,
  -- and it is the raw material for the eventual rate card.
  insert into public.quotes (
    shipper_id, load_id,
    origin_city, dest_city, truck_type_code, weight_kg, pickup_from, pickup_to,
    price_baisa, currency, outcome, rate_card_id
  ) values (
    v_load.shipper_id, v_load.id,
    v_load.origin_city, v_load.dest_city, v_load.truck_type_code, v_load.weight_kg,
    v_load.pickup_from, v_load.pickup_to,
    p_price_baisa, v_load.currency, 'quoted', null
  );

  update public.loads l set price_baisa = p_price_baisa where l.id = v_load.id;
end;
$$;

revoke all on function public.ops_set_price(uuid, bigint) from public, anon;
grant execute on function public.ops_set_price(uuid, bigint) to authenticated;

-- ─── the dispatch queue now shows the price ─────────────────────────────────
-- `ops_queue()` (0005) did not return a price, because until this migration no
-- load had one. Without it a dispatcher cannot see that a load is already priced
-- and would quote it a second time — the same silent-gap failure as 0009, where a
-- column nothing read turned out to have been NULL all along.
--
-- Replaced rather than added to: `create or replace` cannot change a function's
-- return type, so this drops and recreates. Migrations stay append-only — 0005 is
-- not edited.

drop function if exists public.ops_queue();

create function public.ops_queue()
returns table (
  load_id          uuid,
  origin_city      bigint,
  dest_city        bigint,
  pickup_from      date,
  pickup_to        date,
  goods            text,
  weight_kg        integer,
  truck_type_code  text,
  status           text,
  posted_at        timestamptz,
  offer_count      bigint,
  price_baisa      bigint,
  currency         char(3)
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select
    l.id,
    l.origin_city,
    l.dest_city,
    l.pickup_from,
    l.pickup_to,
    l.goods_description,
    l.weight_kg,
    l.truck_type_code,
    l.status::text,
    l.created_at,
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'pending'),
    l.price_baisa,
    l.currency
  from public.loads l
  where l.status in ('posted', 'finding_truck', 'matched')
  order by l.created_at asc;
end;
$$;

revoke all on function public.ops_queue() from public, anon;
grant execute on function public.ops_queue() to authenticated;

-- ─── the quote a shipper is currently holding ───────────────────────────────
-- The latest unexpired quote for a load. Expiry is enforced HERE, server-side
-- (§5), not by the client filtering on expires_at — a client that forgets the
-- filter would show an expired price indefinitely.

create or replace function public.current_quote(p_load_id uuid)
returns table (
  quote_id    uuid,
  price_baisa bigint,
  currency    char(3),
  outcome     text,
  expires_at  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.price_baisa, q.currency, q.outcome, q.expires_at
  from public.quotes q
  join public.loads l on l.id = q.load_id
  where q.load_id = p_load_id
    -- Ownership re-checked inside the definer function (§3), not assumed from the
    -- fact that the caller supplied an id.
    and l.shipper_id = (select auth.uid())
    and q.expires_at > now()
  order by q.created_at desc
  limit 1;
$$;

revoke all on function public.current_quote(uuid) from public, anon;
grant execute on function public.current_quote(uuid) to authenticated;

-- ─── loading rates, by hand ─────────────────────────────────────────────────
-- No UI, no API, no seed. Run in the SQL editor once per band, with real numbers
-- from someone who prices Omani freight for a living:
--
--   insert into private.rate_cards
--     (origin_corridor, dest_corridor, truck_type_code,
--      base_baisa, per_tonne_baisa, min_fare_baisa)
--   values
--     ('Muscat governorate', 'Wusta and Dhofar (Salalah corridor)', '10t',
--      <base>, <per tonne>, <floor>);
--
-- Amounts are BAISA: 1 OMR = 1000 baisa. 120 rial is 120000, not 120.
-- Corridor strings must match `cities.corridor` exactly; a typo raises.
-- Every insert and update is logged to `private.rate_card_audit`.
