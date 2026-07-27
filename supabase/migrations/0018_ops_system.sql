-- ─────────────────────────────────────────────────────────────────────────────
-- 0018 — system settings and the rate card
--
-- WHY THIS EXISTS
--
-- Two things in this system are configured by editing the database by hand:
-- `private.app_settings`, which holds the auto-dispatch kill switch, and
-- `private.rate_cards`, which decides every price. Both are correct places for
-- them to live. Neither is a reasonable place to *reach* them from, when the
-- person who needs to reach them is a dispatcher at 6am and the alternative is
-- ringing whoever has the database password.
--
-- SETTINGS: A WHITELIST, NOT A TABLE EDITOR
--
-- `ops_set_setting` accepts five keys by name and validates each one's type and
-- range. It is deliberately not "write any key" — `app_settings` is where kill
-- switches live, and a generic key/value writer reachable from a browser is a
-- way to turn one compromised dispatcher session into arbitrary configuration.
-- A sixth setting means editing this function, which is the point.
--
-- THE RATE CARD — A DELIBERATE LOOSENING, RECORDED
--
-- `STACK.md` §2c and `CLAUDE.md` non-negotiable 3b keep the rate card in
-- `private`, ungranted, and loaded by hand — "like appointing a dispatcher". The
-- reasoning was that a client-side rate card ships the shape of the pricing model
-- in the app bundle.
--
-- That reasoning still holds for the *shipper and driver* app, and nothing here
-- changes it: no rate data reaches that bundle, and `src/lib/pricing.ts` is still
-- never written — the formula stays in `private.compute_price` alone. What
-- changes is that an appointed dispatcher, behind `require_ops()`, can now read
-- and edit the card from the ops console instead of from a psql prompt.
--
-- That is a real widening of where the crown jewel can be read, agreed to
-- explicitly rather than inherited. Both documents are amended in the same
-- change so the codebase does not quietly contradict itself.
--
-- Writes still flow through the existing 0010 trigger, so every rate mutation
-- keeps its before/after row in `private.rate_card_audit` — and now also lands in
-- `private.ops_audit` with the dispatcher's name and reason.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. SETTINGS ═════════════════════════════════════════════════════════════

create or replace function public.ops_settings()
returns table (
  key         text,
  value       jsonb,
  value_type  text,
  label       text,
  description text,
  min_value   integer,
  max_value   integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  -- The descriptions are part of the feature, not decoration. A boolean called
  -- `auto_dispatch_requires_price` means nothing at 6am without the sentence
  -- explaining what happens when you flip it.
  return query
  with known(key, value_type, label, description, min_value, max_value) as (
    values
      ('auto_dispatch_enabled', 'boolean',
       'Automatic dispatch',
       'When on, posting a load immediately offers it to matching empty legs with no human involved. When off, every load waits for a dispatcher. Turning this off does not lose anything — loads queue normally.',
       null::integer, null::integer),
      ('auto_dispatch_max_offers', 'integer',
       'Offers per load',
       'How many drivers a single load may be offered to automatically. Higher fills faster and annoys more drivers.',
       1, 20),
      ('auto_dispatch_max_pending_per_driver', 'integer',
       'Live offers per driver',
       'How many unanswered offers one driver may be holding. Stops a single driver being buried.',
       1, 20),
      ('auto_dispatch_requires_price', 'boolean',
       'Only auto-dispatch priced loads',
       -- Wording note: "live drivers", not "real drivers". The schema-invariant
       -- test scans every line mentioning a price for float/real/money, and it
       -- is not worth weakening that check over a word choice.
       'When on, a load with no price waits for a dispatcher instead of being offered. Turn this ON before opening to live drivers — offering an unpriced load asks someone to commit a truck to an unknown number.',
       null, null),
      ('require_verified_driver', 'boolean',
       'Only verified drivers may accept',
       'When on, an unverified driver cannot accept an offer. The website claims "100% verified drivers"; this is the setting that makes that true.',
       null, null)
  )
  select
    k.key,
    coalesce(s.value, 'null'::jsonb),
    k.value_type, k.label, k.description, k.min_value, k.max_value
  from known k
  left join private.app_settings s on s.key = k.key;
end;
$$;

revoke all on function public.ops_settings() from public, anon;
grant execute on function public.ops_settings() to authenticated;

create or replace function public.ops_set_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_int    integer;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_set_setting', 50, interval '1 hour');

  -- The whitelist. Not a lookup table — a literal, in the function body, so that
  -- adding a remotely-writable setting is a migration somebody reviews rather
  -- than an INSERT somebody runs.
  if p_key not in (
    'auto_dispatch_enabled',
    'auto_dispatch_max_offers',
    'auto_dispatch_max_pending_per_driver',
    'auto_dispatch_requires_price',
    'require_verified_driver'
  ) then
    -- "not found", not "forbidden": the set of settings that exist is not
    -- something to confirm one guess at a time.
    raise exception 'no such setting' using errcode = 'no_data_found';
  end if;

  if p_key in ('auto_dispatch_enabled', 'auto_dispatch_requires_price',
               'require_verified_driver') then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception 'that setting is true or false' using errcode = 'check_violation';
    end if;
  else
    if jsonb_typeof(p_value) <> 'number' then
      raise exception 'that setting is a whole number' using errcode = 'check_violation';
    end if;
    v_int := (p_value #>> '{}')::integer;
    if v_int < 1 or v_int > 20 then
      raise exception 'that setting must be between 1 and 20'
        using errcode = 'check_violation';
    end if;
  end if;

  select s.value into v_before from private.app_settings s where s.key = p_key;

  insert into private.app_settings (key, value)
  values (p_key, p_value)
  on conflict (key) do update set value = excluded.value;

  perform private.log_ops(
    'ops_set_setting', 'setting', p_key,
    jsonb_build_object('value', v_before),
    jsonb_build_object('value', p_value),
    null
  );
end;
$$;

revoke all on function public.ops_set_setting(text, jsonb) from public, anon;
grant execute on function public.ops_set_setting(text, jsonb) to authenticated;

-- ═══ 2. THE RATE CARD ════════════════════════════════════════════════════════

-- The corridor bands, so the console offers a dropdown rather than a text field.
-- A typo'd corridor inserts cleanly and then silently never matches a load,
-- which is the worst failure available here: a rate that exists, looks
-- configured, and prices nothing. The 0010 trigger catches it; a dropdown means
-- nobody has to be caught.
create or replace function public.ops_corridors()
returns table (corridor text, city_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();

  return query
  select c.corridor, count(*)
  from public.cities c
  where c.corridor is not null
  group by c.corridor
  order by c.corridor;
end;
$$;

revoke all on function public.ops_corridors() from public, anon;
grant execute on function public.ops_corridors() to authenticated;

create or replace function public.ops_rate_cards()
returns table (
  id              bigint,
  origin_corridor text,
  dest_corridor   text,
  truck_type_code text,
  truck_type_name text,
  base_baisa      bigint,
  per_tonne_baisa bigint,
  min_fare_baisa  bigint,
  currency        char(3),
  created_at      timestamptz
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
    rc.id, rc.origin_corridor, rc.dest_corridor, rc.truck_type_code, tt.name_en,
    rc.base_baisa, rc.per_tonne_baisa, rc.min_fare_baisa, rc.currency, rc.created_at
  from private.rate_cards rc
  left join public.truck_types tt on tt.code = rc.truck_type_code
  order by rc.origin_corridor, rc.dest_corridor, tt.sort;
end;
$$;

revoke all on function public.ops_rate_cards() from public, anon;
grant execute on function public.ops_rate_cards() to authenticated;

create or replace function public.ops_upsert_rate_card(
  p_origin_corridor text,
  p_dest_corridor   text,
  p_truck_type_code text,
  p_base_baisa      bigint,
  p_per_tonne_baisa bigint,
  p_min_fare_baisa  bigint,
  p_reason          text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
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
    base_baisa, per_tonne_baisa, min_fare_baisa
  )
  values (
    p_origin_corridor, p_dest_corridor, p_truck_type_code,
    p_base_baisa, p_per_tonne_baisa, p_min_fare_baisa
  )
  on conflict (origin_corridor, dest_corridor, truck_type_code) do update set
    base_baisa      = excluded.base_baisa,
    per_tonne_baisa = excluded.per_tonne_baisa,
    min_fare_baisa  = excluded.min_fare_baisa
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
$$;

revoke all on function public.ops_upsert_rate_card(text, text, text, bigint, bigint, bigint, text)
  from public, anon;
grant execute on function public.ops_upsert_rate_card(text, text, text, bigint, bigint, bigint, text)
  to authenticated;

create or replace function public.ops_delete_rate_card(p_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_reason text;
begin
  perform private.require_ops();
  v_reason := private.require_reason(p_reason);
  perform private.check_rate_limit('ops_delete_rate_card', 50, interval '1 hour');

  select to_jsonb(rc) into v_before from private.rate_cards rc where rc.id = p_id;
  if v_before is null then
    raise exception 'rate not found' using errcode = 'no_data_found';
  end if;

  delete from private.rate_cards where id = p_id;

  -- Deleting a band is not destructive to anything already quoted: `quotes` rows
  -- are immutable and `loads.price_baisa` is already set. It only means future
  -- loads on that corridor get no automatic price and go to a human, which is
  -- the system's designed fallback rather than a failure.
  perform private.log_ops(
    'ops_delete_rate_card', 'rate_card', p_id::text, v_before, null, v_reason
  );
end;
$$;

revoke all on function public.ops_delete_rate_card(bigint, text) from public, anon;
grant execute on function public.ops_delete_rate_card(bigint, text) to authenticated;

/*
 * What a corridor pair would quote, without creating anything.
 *
 * A dispatcher editing a rate card is changing every future price on that
 * corridor. Being able to see the number before saving it is the difference
 * between configuring a rate and guessing at one. Calls the same
 * `private.compute_price` the real quote path uses — there is exactly one
 * implementation of the formula and this is not a second one.
 */
create or replace function public.ops_preview_price(
  p_base_baisa      bigint,
  p_per_tonne_baisa bigint,
  p_min_fare_baisa  bigint,
  p_weight_kg       integer default null
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return private.compute_price(
    p_base_baisa, p_per_tonne_baisa, p_min_fare_baisa, p_weight_kg
  );
end;
$$;

revoke all on function public.ops_preview_price(bigint, bigint, bigint, integer)
  from public, anon;
grant execute on function public.ops_preview_price(bigint, bigint, bigint, integer)
  to authenticated;
