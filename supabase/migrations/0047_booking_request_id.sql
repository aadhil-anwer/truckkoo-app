-- 0047 · One tap books one load.
--
-- `book_load` and `post_bid_load` had no idempotency key. The Book button
-- disables while a call is pending, but on bad signal the call can commit on
-- the server and still time out on the phone; the shipper sees "We could not
-- post that", taps again, and a second load is posted — and dispatched.
--
-- HOW: the app makes one random request id per booking attempt and sends it
-- with every try. The first call that carries it books and records the load
-- against (shipper, request id); any later call with the same pair returns that
-- load and books nothing. The id is scoped to `auth.uid()`, so one shipper's id
-- can never reach another shipper's load, and it is not an ownership id — the
-- caller cannot name a load with it, only repeat their own call.
--
-- The request id is optional. A 1.1.0/1.2.0 binary sends none and books exactly
-- as before; the parameter has a default, so its calls still resolve.
--
-- The existing functions are not rewritten: they move to `private`, unchanged
-- and ungranted, and the public names become thin wrappers that call them.
-- A repeat is answered before the inner call, so it spends no rate limit.

create table private.load_requests (
  shipper_id     uuid not null references public.profiles(id) on delete cascade,
  request_id     uuid not null,
  load_id        uuid not null references public.loads(id) on delete cascade,
  -- book_load's answer to the first call, so a repeat answers the same way.
  price_matched  boolean,
  created_at     timestamptz not null default now(),
  primary key (shipper_id, request_id)
);
alter table private.load_requests enable row level security;
alter table private.load_requests force row level security;
revoke all on table private.load_requests from anon, authenticated;

-- ═══ 1. the originals move out of reach ═════════════════════════════════════

alter function public.book_load(bigint, bigint, date, date, text, integer, text, bigint, jsonb, jsonb)
  set schema private;
revoke all on function private.book_load(bigint, bigint, date, date, text, integer, text, bigint, jsonb, jsonb)
  from public, anon, authenticated;

alter function public.post_bid_load(bigint, bigint, date, date, text, integer, text, jsonb, jsonb, bigint)
  set schema private;
revoke all on function private.post_bid_load(bigint, bigint, date, date, text, integer, text, jsonb, jsonb, bigint)
  from public, anon, authenticated;

-- Serialises calls carrying the same (shipper, request id) for the rest of the
-- transaction, so two in flight at once cannot both miss the row and both book.
create function private.lock_load_request(p_actor uuid, p_request_id uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('load_request:' || p_actor::text || ':' || p_request_id::text, 0));
$$;
revoke all on function private.lock_load_request(uuid, uuid) from public, anon, authenticated;

-- ═══ 2. book_load ═══════════════════════════════════════════════════════════

create function public.book_load(
  p_origin_city bigint, p_dest_city bigint,
  p_pickup_from date, p_pickup_to date, p_goods text,
  p_weight_kg integer default null, p_truck_type_code text default null,
  p_seen_price_baisa bigint default null,
  p_origin_place jsonb default null, p_dest_place jsonb default null,
  p_request_id uuid default null
)
returns table(load_id uuid, status public.load_status, price_baisa bigint, price_matched boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_load    uuid;
  v_matched boolean;
  v_status  public.load_status;
  v_price   bigint;
begin
  if p_request_id is not null and v_actor is not null then
    perform private.lock_load_request(v_actor, p_request_id);
    select r.load_id, r.price_matched into v_load, v_matched
      from private.load_requests r
     where r.shipper_id = v_actor and r.request_id = p_request_id;
    if found then
      return query select l.id, l.status, l.price_baisa, v_matched
        from public.loads l where l.id = v_load and l.shipper_id = v_actor;
      return;
    end if;
  end if;

  select b.load_id, b.status, b.price_baisa, b.price_matched
    into v_load, v_status, v_price, v_matched
    from private.book_load(p_origin_city, p_dest_city, p_pickup_from, p_pickup_to, p_goods,
                           p_weight_kg, p_truck_type_code, p_seen_price_baisa,
                           p_origin_place, p_dest_place) b;

  if p_request_id is not null and v_actor is not null then
    insert into private.load_requests (shipper_id, request_id, load_id, price_matched)
    values (v_actor, p_request_id, v_load, v_matched);
  end if;

  return query select v_load, v_status, v_price, v_matched;
end;
$$;

revoke all on function public.book_load(bigint, bigint, date, date, text, integer, text, bigint, jsonb, jsonb, uuid)
  from public, anon;
grant execute on function public.book_load(bigint, bigint, date, date, text, integer, text, bigint, jsonb, jsonb, uuid)
  to authenticated;

-- ═══ 3. post_bid_load ═══════════════════════════════════════════════════════

create function public.post_bid_load(
  p_origin_city bigint, p_dest_city bigint,
  p_pickup_from date, p_pickup_to date, p_goods text,
  p_weight_kg integer default null, p_truck_type_code text default null,
  p_origin_place jsonb default null, p_dest_place jsonb default null,
  p_target_total_baisa bigint default null,
  p_request_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_load  uuid;
begin
  if p_request_id is not null and v_actor is not null then
    perform private.lock_load_request(v_actor, p_request_id);
    select r.load_id into v_load
      from private.load_requests r
     where r.shipper_id = v_actor and r.request_id = p_request_id;
    if found then
      return v_load;
    end if;
  end if;

  v_load := private.post_bid_load(p_origin_city, p_dest_city, p_pickup_from, p_pickup_to, p_goods,
                                  p_weight_kg, p_truck_type_code, p_origin_place, p_dest_place,
                                  p_target_total_baisa);

  if p_request_id is not null and v_actor is not null then
    insert into private.load_requests (shipper_id, request_id, load_id)
    values (v_actor, p_request_id, v_load);
  end if;

  return v_load;
end;
$$;

revoke all on function public.post_bid_load(bigint, bigint, date, date, text, integer, text, jsonb, jsonb, bigint, uuid)
  from public, anon;
grant execute on function public.post_bid_load(bigint, bigint, date, date, text, integer, text, jsonb, jsonb, bigint, uuid)
  to authenticated;
