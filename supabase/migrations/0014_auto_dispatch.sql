-- ─────────────────────────────────────────────────────────────────────────────
-- 0014 — auto-dispatch: match the empty legs without waiting for a human
--
-- WHY THIS EXISTS
--
-- The product's reason to exist is that trucks are already making these trips. A
-- driver who declared an empty leg Muscat→Sohar on Tuesday and a shipper who posts
-- Muscat→Sohar for Tuesday are a match that needs no judgement — and making them
-- wait for a dispatcher to open a screen is the delay the website's "replies in
-- minutes" claim is measured against.
--
-- So `post_load` now prices the load and, when the match is unambiguous, sends
-- the offers itself.
--
-- WHAT "UNAMBIGUOUS" MEANS, EXACTLY
--
-- Tier 1 only — a declared EMPTY leg — and grace 0, meaning the driver's own
-- declared window actually covers the pickup window. Stretching a window by two
-- days is a judgement, and judgements stay with the dispatcher. Everything softer
-- than that still lands in `ops_queue` for a person.
--
-- ── THE EXPOSURE, STATED PLAINLY (SECURITY.md §16) ─────────────────────────
-- An offer grants its driver read access to the load (`private.driver_has_offer`).
-- So this feature lets an UNPRIVILEGED SHIPPER cause up to `auto_dispatch_max_offers`
-- drivers to gain read access to their own cargo details, automatically, with no
-- human reviewing it first. That is the largest automated widening of cargo
-- visibility in the schema.
--
-- It is not a load board: each driver still sees only the offer addressed to them,
-- and nothing lets a driver enumerate loads. The controls are all here:
--   * tier 1 only, grace 0            — the match has to be exact
--   * auto_dispatch_max_offers        — how many drivers per load
--   * auto_dispatch_max_pending_per_driver — how much one driver can be flooded
--   * auto_dispatch_enabled           — the kill switch
-- Every one of them is a setting in `private.app_settings`, changeable without a
-- migration. Read the risk notes in OPEN_ISSUES before widening any of them.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ SETTINGS ═══════════════════════════════════════════════════════════════

create or replace function private.setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value)::integer from private.app_settings s where s.key = p_key), p_default);
$$;

revoke all on function private.setting_int(text, integer) from public, anon, authenticated;

insert into private.app_settings (key, value) values
  ('auto_dispatch_enabled',               'true'::jsonb),
  ('auto_dispatch_max_offers',            '3'::jsonb),
  ('auto_dispatch_max_pending_per_driver','3'::jsonb),
  -- FALSE on purpose, and this is the one to revisit first.
  --
  -- `private.rate_cards` is empty — rates are loaded by hand, never invented in a
  -- migration (CLAUDE.md). With this true, every load returns 'no_rate' or
  -- 'advise_me' and auto-dispatch would never fire at all; the feature would ship
  -- dark and nobody would know whether it worked.
  --
  -- With it false, auto-offers reach drivers showing "pay pending" until real
  -- rates exist. PRODUCT.md names driver-side pay visibility as the supply-side
  -- launch risk. FLIP THIS TO TRUE BEFORE REAL DRIVERS ARE ON THE PLATFORM:
  --   update private.app_settings set value = 'true'::jsonb
  --    where key = 'auto_dispatch_requires_price';
  ('auto_dispatch_requires_price',        'false'::jsonb)
on conflict (key) do nothing;

-- ═══ WHAT THE MACHINE DID ═══════════════════════════════════════════════════
-- An automated path that silently sends zero offers forever is indistinguishable
-- from a working one. This project has already paid for that lesson twice
-- (OPEN_ISSUES: `trips.truck_id` NULL for every trip ever created, and a definer
-- function being the first reader of a column). One row per post, always.

create table if not exists private.dispatch_log (
  id          bigint generated always as identity primary key,
  load_id     uuid not null references public.loads (id) on delete cascade,
  candidates  integer not null default 0,
  offers_sent integer not null default 0,
  -- null = it ran normally
  skipped     text,
  -- SQLSTATE only, never SQLERRM: an error message can carry a goods description
  -- out of a check constraint and into a table dispatch reads (§10).
  detail      text,
  created_at  timestamptz not null default now(),

  constraint dispatch_log_skip_known check (
    skipped is null or skipped in ('disabled', 'no_price', 'no_candidates', 'error')
  )
);

create index if not exists dispatch_log_load_idx on private.dispatch_log (load_id, created_at desc);

alter table private.dispatch_log enable row level security;
alter table private.dispatch_log force row level security;
revoke all on table private.dispatch_log from anon, authenticated;

comment on table private.dispatch_log is
  'One row per post_load, recording what auto-dispatch decided. No client grant. '
  'detail carries SQLSTATE only — never SQLERRM, which can leak cargo text.';

-- ═══ ISSUING A QUOTE, WITHOUT THE CALLER'S AUTH ═════════════════════════════
-- `post_load` needs to price the load it just created. The three ways to do that:
--
--   * inline a copy of quote_load's tail  — two implementations of a price, which
--     is the exact divergence 0010 and 0011 both argue against
--   * call public.quote_load from post_load — double-charges the 30/hour rate
--     limit and redoes the ownership check it just did
--   * extract the shared part                ← this
--
-- Same precedent as `private.price_for` in 0011. `quote_load` is recreated below
-- to call it; its signature, grants and behaviour are unchanged.

create or replace function private.issue_quote(p_load_id uuid)
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
  v_load  public.loads;
  v_r     record;
  v_quote public.quotes;
begin
  -- No ownership check here on purpose: both callers have already done theirs.
  -- This is private and ungranted for that reason.
  select * into v_load from public.loads l where l.id = p_load_id;

  if v_load.id is null then
    raise exception 'load not found' using errcode = 'no_data_found';
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
    v_load.shipper_id, v_load.id,
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

revoke all on function private.issue_quote(uuid) from public, anon, authenticated;

-- quote_load, now delegating. Auth, rate limit and the actor-scoped fetch stay
-- exactly where they were.
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

  return query select * from private.issue_quote(v_load.id);
end;
$$;

revoke all on function public.quote_load(uuid) from public, anon;
grant execute on function public.quote_load(uuid) to authenticated;

-- ═══ THE MACHINE ════════════════════════════════════════════════════════════

create or replace function private.auto_dispatch(p_load_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap         integer;
  v_per_driver  integer;
  v_candidates  integer := 0;
  v_sent        integer := 0;
  v_pending     integer;
  c             record;
begin
  if not private.setting_bool('auto_dispatch_enabled', true) then
    insert into private.dispatch_log (load_id, skipped) values (p_load_id, 'disabled');
    return 0;
  end if;

  if private.setting_bool('auto_dispatch_requires_price', false)
     and (select l.price_baisa from public.loads l where l.id = p_load_id) is null then
    insert into private.dispatch_log (load_id, skipped) values (p_load_id, 'no_price');
    return 0;
  end if;

  v_cap        := private.setting_int('auto_dispatch_max_offers', 3);
  v_per_driver := private.setting_int('auto_dispatch_max_pending_per_driver', 3);

  -- Tier 1, grace 0. See the header for why nothing softer qualifies.
  for c in
    select * from private.candidates_for(p_load_id, 1::smallint, 0, v_cap * 4)
  loop
    v_candidates := v_candidates + 1;

    exit when v_sent >= v_cap;

    -- Already has an offer on this load in any state — including a decline, which
    -- an automated path must never talk over.
    continue when c.offer_status is not null;

    -- Do not bury one driver. A shipper posting their hourly allowance of loads on
    -- a corridor they know one driver runs would otherwise put 20 offers in front
    -- of them.
    select count(*) into v_pending
    from public.offers o
    where o.driver_id = c.driver_id
      and o.status = 'pending'
      and o.expires_at > now();

    continue when v_pending >= v_per_driver;

    perform public.create_offer(p_load_id, c.driver_id, c.leg_id, 'auto', false);
    v_sent := v_sent + 1;
  end loop;

  insert into private.dispatch_log (load_id, candidates, offers_sent, skipped)
  values (p_load_id, v_candidates, v_sent,
          case when v_candidates = 0 then 'no_candidates' else null end);

  return v_sent;
end;
$$;

-- No grant to anything. `post_load` is the only caller and it runs as owner.
revoke all on function private.auto_dispatch(uuid) from public, anon, authenticated;

-- ═══ post_load, NOW PRICING AND DISPATCHING ═════════════════════════════════
-- Body identical to 0004 through the insert.
--
-- ── A DELIBERATE EXCEPTION TO "FAIL CLOSED AND LOUD" (SECURITY.md §0.5) ────
-- Both tails are wrapped so that neither can take the load down with it. A
-- shipper's load must exist even when matching or pricing is broken: losing the
-- load loses the customer, whereas losing the automation drops the work back to
-- the dispatcher, which is the human backstop that already exists and that every
-- load went through until this migration.
--
-- It fails OPEN INTO THE HUMAN PATH, and it is loud in `private.dispatch_log`.
-- SQLSTATE only — SQLERRM can carry the goods description out of a constraint.

create or replace function public.post_load(
  p_origin_city     bigint,
  p_dest_city       bigint,
  p_pickup_from     date,
  p_pickup_to       date,
  p_goods           text,
  p_weight_kg       integer default null,
  p_truck_type_code text    default null   -- NULL = "Not sure, advise me"
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

  perform private.check_rate_limit('post_load', 20, interval '1 hour');

  -- Fail closed on anything unexpected rather than coercing it (§0.5).
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
  ) values (
    -- shipper_id from the session, never from a parameter (§2)
    v_actor, p_origin_city, p_dest_city, p_pickup_from, p_pickup_to,
    p_weight_kg, p_truck_type_code, btrim(p_goods), 'posted'
  )
  returning id into v_id;

  begin
    perform private.issue_quote(v_id);
  exception when others then
    insert into private.dispatch_log (load_id, skipped, detail)
    values (v_id, 'error', 'quote: ' || sqlstate);
  end;

  begin
    perform private.auto_dispatch(v_id);
  exception when others then
    insert into private.dispatch_log (load_id, skipped, detail)
    values (v_id, 'error', 'dispatch: ' || sqlstate);
  end;

  return v_id;
end;
$$;

revoke all on function public.post_load(bigint, bigint, date, date, text, integer, text) from public, anon;
grant execute on function public.post_load(bigint, bigint, date, date, text, integer, text) to authenticated;

-- ═══ THE QUEUE MUST SHOW WHAT THE MACHINE ALREADY DID ═══════════════════════
-- Without this the dispatcher cannot tell an untouched load from one that already
-- has three auto-offers out, and `ops/index.tsx`'s "needs a decision" / "offer
-- out" split becomes a lie. Same failure shape as 0010's reason for adding the
-- price: a column nothing surfaced, quietly wrong.
--
-- Third recreation of this function (0005, 0010, here). Return type changes, so
-- drop and recreate; earlier migrations are not edited.

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
  currency         char(3),
  auto_offer_count bigint
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
    l.currency,
    (select count(*) from public.offers o
      where o.load_id = l.id and o.status = 'pending' and o.source = 'auto')
  from public.loads l
  where l.status in ('posted', 'finding_truck', 'matched')
  order by l.created_at asc;
end;
$$;

revoke all on function public.ops_queue() from public, anon;
grant execute on function public.ops_queue() to authenticated;
