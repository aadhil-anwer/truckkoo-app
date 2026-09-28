-- 0041 · Shipper places — the exact pickup and drop-off, beside the city.
--
-- Spec: docs/superpowers/specs/2026-09-28-shipper-places-design.md.
--
-- THE CITY STAYS. Pricing, dispatch and the rate card are per city; the server
-- derives the city from the point (private.nearest_city), so this changes none
-- of them.
--
-- A SEPARATE TABLE, NOT COLUMNS ON `loads`. `loads` carries a table-level select
-- grant and a policy letting a driver read any load they ever had an offer for.
-- A contact phone there would outlive the offer. Here no driver has a policy at
-- all: they read places only through driver_offers()/driver_offer()/driver_trip(),
-- which decide inside the definer.
--
-- FOUNDER'S CALL (2026-09-28): the exact point, note and contact are shown in the
-- offer — every offered driver sees them — but only while that offer is pending.

-- ═══ 1. the table ═══════════════════════════════════════════════════════════

create table public.load_places (
  load_id       uuid not null references public.loads (id) on delete cascade,
  kind          text not null constraint load_places_kind check (kind in ('pickup', 'drop')),
  lat           double precision not null,
  lng           double precision not null,
  place_name    text,
  note          text,
  contact_name  text,
  contact_phone text,
  created_at    timestamptz not null default now(),
  primary key (load_id, kind),
  constraint load_places_in_region check (lat between 12 and 33 and lng between 34 and 60),
  constraint load_places_name_len  check (place_name   is null or char_length(place_name)   between 1 and 200),
  constraint load_places_note_len  check (note         is null or char_length(note)         between 1 and 300),
  constraint load_places_cname_len check (contact_name is null or char_length(contact_name) between 1 and 80),
  constraint load_places_phone     check (contact_phone is null or contact_phone ~ '^\+?[0-9 ]{6,24}$'),
  -- Bidi overrides are a spoofing vector in an RTL UI. Rejected here AND
  -- sanitised at output by src/lib/safe-text.ts, on purpose.
  constraint load_places_safe_text check (
    not private.contains_unsafe_text(place_name)
    and not private.contains_unsafe_text(note)
    and not private.contains_unsafe_text(contact_name))
);

-- Deny by default. The shipper reads their own; nobody writes except book_load.
revoke all on table public.load_places from anon, authenticated;
alter table public.load_places enable row level security;
alter table public.load_places force row level security;

drop policy if exists "shipper reads own load places" on public.load_places;
create policy "shipper reads own load places" on public.load_places
  for select to authenticated using ((select private.owns_load(load_places.load_id)));

-- Select only. There is no driver policy, so a driver's select returns nothing;
-- the grant exists for the shipper's own T3/T4.
grant select (load_id, kind, lat, lng, place_name, note, contact_name, contact_phone, created_at)
  on public.load_places to authenticated;

-- ═══ 2. the nearest city, for "Near Barka" ══════════════════════════════════
-- One nearest-city rule, server-side, shared with book_load. Read-only.

create or replace function public.city_near(p_lat double precision, p_lng double precision)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between 12 and 33 or p_lng not between 34 and 60 then
    raise exception 'position out of range' using errcode = 'check_violation';
  end if;
  return private.nearest_city(p_lat, p_lng);
end;
$$;

revoke all on function public.city_near(double precision, double precision) from public, anon;
grant execute on function public.city_near(double precision, double precision) to authenticated;

-- ═══ 3. the search quota ════════════════════════════════════════════════════
-- Called by the `places` Edge Function WITH THE CALLER'S JWT, so the function
-- needs no service-role key. Writes a rate event, so VOLATILE.

create or replace function public.use_places_quota(p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if (select private.actor_role()) <> 'shipper' then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.require_active();
  if p_kind = 'autocomplete' then
    perform private.check_rate_limit('places_autocomplete', 300, interval '1 hour');
  elsif p_kind = 'details' then
    perform private.check_rate_limit('places_details', 60, interval '1 hour');
  else
    raise exception 'unknown quota' using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function public.use_places_quota(text) from public, anon;
grant execute on function public.use_places_quota(text) to authenticated;

-- ═══ 4. ops reads a load's places ═══════════════════════════════════════════

create or replace function public.ops_load_places(p_load_id uuid)
returns table (
  kind text, lat double precision, lng double precision, place_name text,
  note text, contact_name text, contact_phone text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return query
  select p.kind, p.lat, p.lng, p.place_name, p.note, p.contact_name, p.contact_phone
  from public.load_places p
  where p.load_id = p_load_id
  order by p.kind desc;  -- pickup before drop
end;
$$;

revoke all on function public.ops_load_places(uuid) from public, anon;
grant execute on function public.ops_load_places(uuid) to authenticated;
