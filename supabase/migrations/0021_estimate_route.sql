-- 0021_estimate_route.sql
--
-- The pre-commit estimate shown on the review screen (S9): a RANGE rather than a
-- number, because nothing has been confirmed yet and a single figure would read
-- as a quote.
--
-- WHY NOT JUST CALL quote_route AND WIDEN IT IN THE APP. Because that would put
-- pricing arithmetic in the client, and CLAUDE.md 3b keeps the formula in SQL
-- only — two implementations of a price disagree eventually, and a client-side
-- one ships the rate card's shape in the app bundle. The band is part of how a
-- price is presented, so it lives here with the rest of it.
--
-- This adds no new pricing logic: it delegates to `private.price_for`, the same
-- function `quote_route` and `quote_load` use, so there is still exactly one
-- place where a route becomes a price.

-- The band, as a percentage either side of the computed price. In settings
-- rather than a literal so it can be tuned without a migration — the right width
-- is an operations question and will change once there is real data.
insert into private.app_settings (key, value)
values ('estimate_band_pct', '15'::jsonb)
on conflict (key) do nothing;

create or replace function public.estimate_route(
  p_origin_city     bigint,
  p_dest_city       bigint,
  p_truck_type_code text    default null,   -- NULL = "Not sure — advise me"
  p_weight_kg       integer default null
)
returns table (
  low_baisa  bigint,
  high_baisa bigint,
  currency   char(3),
  outcome    text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_r     record;
  v_pct   numeric;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Shipper-only, matching quote_route: a driver has no reason to price a route,
  -- and excluding them halves the set of accounts that can probe the card.
  -- Types are fully qualified throughout this function. An unqualified cast
  -- inside a definer function with search_path = '' is what killed advance_trip
  -- for months, and nothing noticed because nothing read it.
  if (select private.actor_role()) <> 'shipper' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  perform private.check_rate_limit('estimate_route', 60, interval '1 hour');

  -- Same input bounds as quote_route, so an estimate can never be produced for a
  -- route that could not then be posted.
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

  -- Every non-'quoted' outcome returns NULL prices and lets the screen say a
  -- person will handle it. With an empty rate card that is EVERY call, which is
  -- the expected state today rather than an edge case — a shipper must never see
  -- an error here (CLAUDE.md #6).
  if v_r.outcome is distinct from 'quoted' then
    return query select null::bigint, null::bigint, v_r.currency, v_r.outcome;
    return;
  end if;

  select coalesce((value #>> '{}')::numeric, 15) into v_pct
  from private.app_settings where key = 'estimate_band_pct';

  -- Integer baisa throughout. OMR has THREE decimal places and the arithmetic
  -- goes through numeric, never float — see src/lib/money.ts. Rounded to whole
  -- rials (1000 baisa) because a range quoted to the baisa would imply a
  -- precision an estimate does not have.
  return query
  select
    (floor(v_r.price_baisa * (1 - v_pct / 100) / 1000) * 1000)::bigint,
    (ceil (v_r.price_baisa * (1 + v_pct / 100) / 1000) * 1000)::bigint,
    v_r.currency,
    'estimated'::text;
end;
$$;

comment on function public.estimate_route(bigint, bigint, text, integer) is
  'Pre-commit price RANGE for the review screen. Delegates to private.price_for, '
  'so there is one implementation of a price. NULL prices on any outcome other '
  'than estimated — with an empty rate card that is every call, by design.';

-- No table grant is added anywhere by this migration. The rate card stays
-- ungranted; this function is the only way its shape is ever observable, and it
-- observes it as a rounded range.
revoke all on function public.estimate_route(bigint, bigint, text, integer) from public, anon;
grant execute on function public.estimate_route(bigint, bigint, text, integer) to authenticated;
