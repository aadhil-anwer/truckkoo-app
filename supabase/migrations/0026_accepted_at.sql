-- ═══════════════════════════════════════════════════════════════════════════
-- 0026 · An accepted price is immutable — for real this time
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0023 §4 tried to close this by refusing `ops_set_price` on a load whose status
-- was past acceptance. It listed `matched` as still re-priceable, and that was
-- correct BEFORE the reorder: `matched` used to mean "offers are out and no
-- shipper has agreed to anything", because there was nothing for a shipper to
-- agree to.
--
-- After 0023 it means two different things. `create_offer` moves a load to
-- `matched` from `accepted` — the auto-dispatch that `accept_quote` triggers —
-- and ALSO from `posted` / `finding_truck`, which is a dispatcher offering a load
-- by hand before any price was agreed. One status, two histories, and only one of
-- them is a commitment.
--
-- So the guard let a dispatcher move the price on a load the shipper had already
-- accepted, as long as an offer had gone out in between — which auto-dispatch
-- does in the same transaction as the acceptance. In other words the guard was
-- open on precisely the path the product actually takes.
--
-- Found by writing the assertion the P4 spec's definition of done asked for
-- ("`ops_set_price` refuses an accepted load") and watching it fail. The status
-- column cannot answer the question, so this adds a column that can.
--
-- NOTHING TO BACKFILL. 0023 carried a syntax error and never applied anywhere,
-- so no database has ever run `accept_quote` and no load has ever been accepted.

-- ─── 1. the fact the status could not carry ─────────────────────────────────

alter table public.loads
  add column if not exists accepted_at timestamptz;

comment on column public.loads.accepted_at is
  'When the shipper agreed the price. NULL means they have not — which is a '
  'different question from `status`, because `matched` is reachable both before '
  'and after acceptance. Set by accept_quote() only; no client write grant.';

-- NO WRITE GRANT NEEDED, AND NO COLUMN REVOKE EITHER. `public.loads` holds a
-- single table-level `grant select to authenticated` and nothing else — there is
-- no INSERT or UPDATE grant on the table at all, so a new column arrives
-- unwritable by any client. A `revoke (accepted_at)` here would look like a
-- defence and be none: a column-level revoke does not cut a hole in a table-level
-- grant, which is a lesson this repo has already paid for once.
--
-- Readable by the owning shipper, which is correct — it is the timestamp on
-- their own decision, and RLS restricts the rows to them.

-- ─── 2. accept_quote records it ─────────────────────────────────────────────
-- Reproduced from 0023 with one line added, rather than rewritten: the ownership
-- re-check and the idempotence are what make this function safe to call from a
-- screen with a committing button, and neither may be lost in an edit.

create or replace function public.accept_quote(p_load_id uuid)
returns public.load_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_status public.load_status;
  v_price  bigint;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Ownership is re-checked INSIDE the definer function against auth.uid(),
  -- like match_load. Without this it is an IDOR: any signed-in user could accept
  -- a price on somebody else's load. `for update` because two taps can arrive
  -- together on flaky signal.
  select l.status, l.price_baisa into v_status, v_price
  from public.loads l
  where l.id = p_load_id and l.shipper_id = v_actor
  for update;

  -- "Not found", never "forbidden": a 403 would confirm the load exists.
  if v_status is null then
    raise exception 'load not found' using errcode = 'no_data_found';
  end if;

  -- IDEMPOTENT. This is reached from a screen with a live countdown and a
  -- committing button; a double tap, a retry after a timeout and a stale screen
  -- must all be safe. Already past acceptance is a success, not an error.
  if v_status in (
    'accepted'::public.load_status, 'matched'::public.load_status,
    'assigned'::public.load_status, 'in_transit'::public.load_status,
    'delivered'::public.load_status, 'closed'::public.load_status
  ) then
    return v_status;
  end if;

  if v_status <> 'quoted'::public.load_status or v_price is null then
    raise exception 'no price to accept' using errcode = 'check_violation';
  end if;

  update public.loads
     set status      = 'accepted'::public.load_status,
         -- THE LINE THIS MIGRATION EXISTS FOR. Stamped before dispatch runs, so
         -- the price is locked even if auto-dispatch moves the load to `matched`
         -- in this same transaction — which is the normal case, not the edge one.
         accepted_at = now()
   where id = p_load_id;

  -- NOW the offers go out. Same caps, same log, same fail-open-into-the-human-
  -- path behaviour as before — only the trigger point moved.
  begin
    perform private.auto_dispatch(p_load_id);
  exception when others then
    insert into private.dispatch_log (load_id, skipped, detail)
    values (p_load_id, 'error', 'dispatch: ' || sqlstate);
  end;

  return 'accepted'::public.load_status;
end;
$$;

revoke all on function public.accept_quote(uuid) from public, anon;
grant execute on function public.accept_quote(uuid) to authenticated;

-- ─── 3. the guard, on the fact rather than on the status ────────────────────
-- Again reproduced from its live definition rather than rewritten. This function
-- is the dispatcher's only way to price a load and it carries the require_ops()
-- check, the baisa bounds and the audit call, none of which may be lost.

create or replace function public.ops_set_price(p_load_id uuid, p_price_baisa bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_load public.loads;
begin
  perform private.require_ops();

  -- Bounds, in integer baisa. 1,000,000,000 baisa is 1,000,000 OMR — far beyond
  -- any real freight movement, and the point is to catch a slipped decimal
  -- rather than to model a ceiling.
  if p_price_baisa is null or p_price_baisa <= 0 or p_price_baisa > 1000000000 then
    raise exception 'price out of range' using errcode = 'check_violation';
  end if;

  select * into v_load from public.loads l where l.id = p_load_id for update;

  if v_load.id is null or v_load.status not in (
    'posted'::public.load_status, 'finding_truck'::public.load_status,
    'quoted'::public.load_status, 'matched'::public.load_status
  ) then
    raise exception 'load not open' using errcode = 'no_data_found';
  end if;

  -- AND the shipper must not already have agreed to a price. `matched` stays in
  -- the list above because a dispatcher may offer an unpriced load by hand and
  -- then price it; what is forbidden is moving a number somebody has said yes to.
  -- Re-pricing an accepted load is a NEW quote they decide on again — which is a
  -- product change, not something to slip past them through the ops console.
  if v_load.accepted_at is not null then
    raise exception 'price already accepted by the shipper'
      using errcode = 'check_violation';
  end if;

  insert into public.quotes (
    shipper_id, load_id, origin_city, dest_city, truck_type_code, weight_kg,
    pickup_from, pickup_to, price_baisa, currency, outcome, rate_card_id
  )
  values (
    v_load.shipper_id, v_load.id, v_load.origin_city, v_load.dest_city,
    v_load.truck_type_code, v_load.weight_kg, v_load.pickup_from, v_load.pickup_to,
    p_price_baisa, v_load.currency, 'quoted', null
  );

  update public.loads set price_baisa = p_price_baisa where id = p_load_id;

  -- A newly priced load becomes decidable by the shipper.
  perform private.mark_quoted(p_load_id);

  perform private.log_ops(
    'ops_set_price', 'load', p_load_id::text,
    jsonb_build_object('price_baisa', v_load.price_baisa),
    jsonb_build_object('price_baisa', p_price_baisa),
    null
  );
end;
$$;

revoke all on function public.ops_set_price(uuid, bigint) from public, anon, authenticated;
grant execute on function public.ops_set_price(uuid, bigint) to authenticated;
