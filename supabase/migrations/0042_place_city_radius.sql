-- 0042 · A place belongs to a city only if it is near one.
--
-- 0041 named a place's city with `private.nearest_city`, which always answers:
-- anything inside the 12–33 N / 34–60 E box snapped to *some* town. The box
-- holds Qatar, Kuwait and Bahrain (which search offers, but which have no city
-- of ours), coastal Iran and Yemen. A Doha pin became a UAE or Saudi city and
-- was priced as that corridor — the feature was never meant to touch money.
--
-- Now a place further than 100 km from every city has no city: `city_near`
-- returns NULL (the pin screen says "choose a city instead"), and `book_load`
-- refuses it because NULL is distinct from any city passed. Bandar Abbas is
-- ~111 km from Khasab; the widest gap between two Omani towns on our list is
-- about twice the radius, so a real Omani site is refused only deep in the
-- desert, and even then the city list still books it.
--
-- `nearest_city` itself is unchanged: a driver's GPS fix still maps to the
-- nearest town whatever the distance (0036, 0039, 0040).

create or replace function private.place_near_city(p_lat double precision, p_lng double precision)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.cities c
  where private.point_km(p_lat::numeric, p_lng::numeric, c.id) <= 100
  order by private.point_km(p_lat::numeric, p_lng::numeric, c.id) asc
  limit 1;
$$;

revoke all on function private.place_near_city(double precision, double precision)
  from public, anon, authenticated;

-- Bodies are 0041's, with nearest_city → place_near_city.

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
  return private.place_near_city(p_lat, p_lng);
end;
$$;

revoke all on function public.city_near(double precision, double precision) from public, anon;
grant execute on function public.city_near(double precision, double precision) to authenticated;

create or replace function private.place_city(p jsonb)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lat double precision := (p ->> 'lat')::double precision;
  v_lng double precision := (p ->> 'lng')::double precision;
begin
  if v_lat is null or v_lng is null
     or v_lat not between 12 and 33 or v_lng not between 34 and 60 then
    raise exception 'place out of range' using errcode = 'check_violation';
  end if;
  return private.place_near_city(v_lat, v_lng);
end;
$$;

revoke all on function private.place_city(jsonb) from public, anon, authenticated;
