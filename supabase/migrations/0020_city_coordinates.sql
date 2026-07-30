-- 0020_city_coordinates.sql
--
-- Coordinates for the 46 reference cities, so the map can place a pin.
--
-- PROVENANCE. CLAUDE.md says reference data comes from the website — that rule
-- cannot apply here, because the website has no coordinates at all
-- (`~/truckkoo/js/main.js` populates names only). So:
--   * 13 cities are the design handoff's own values, marked `-- handoff`.
--   * 33 are public gazetteer data, marked `-- gazetteer`.
-- The gazetteer rows have NOT been confirmed by anyone who knows Oman. A
-- coordinate can sit inside the country and still be the wrong town, which no
-- constraint below can catch. See OPEN_ISSUES.md.
--
-- `double precision`, not `numeric`: these are positions, not money. The
-- three-decimal rule in CLAUDE.md is about `price_baisa` and does not apply here.
--
-- NO GRANT STATEMENT. `public.cities` carries a table-level
-- `grant select ... to authenticated` (0001 line 467), which extends to columns
-- added later. Verified against 0001 rather than assumed.

alter table public.cities add column lat double precision;
alter table public.cities add column lng double precision;

-- ── Oman ────────────────────────────────────────────────────────────────────
update public.cities set lng = 58.408, lat = 23.588 where name_en = 'Muscat';            -- handoff
update public.cities set lng = 58.563, lat = 23.617 where name_en = 'Muttrah';           -- gazetteer
update public.cities set lng = 58.180, lat = 23.670 where name_en = 'Seeb';              -- handoff
update public.cities set lng = 58.383, lat = 23.586 where name_en = 'Bawshar';           -- gazetteer
update public.cities set lng = 58.541, lat = 23.514 where name_en = 'Al Amerat';         -- gazetteer
update public.cities set lng = 58.905, lat = 23.258 where name_en = 'Qurayyat';          -- gazetteer
update public.cities set lng = 57.890, lat = 23.706 where name_en = 'Barka';             -- handoff
update public.cities set lng = 57.617, lat = 23.786 where name_en = 'Al Musanaah';       -- gazetteer
update public.cities set lng = 57.442, lat = 23.849 where name_en = 'Suwaiq';            -- gazetteer
update public.cities set lng = 57.093, lat = 23.977 where name_en = 'Al Khaburah';       -- gazetteer
update public.cities set lng = 56.888, lat = 24.172 where name_en = 'Saham';             -- gazetteer
update public.cities set lng = 56.709, lat = 24.347 where name_en = 'Sohar';             -- handoff
update public.cities set lng = 56.560, lat = 24.531 where name_en = 'Liwa';              -- gazetteer
update public.cities set lng = 56.470, lat = 24.746 where name_en = 'Shinas';            -- gazetteer
update public.cities set lng = 57.424, lat = 23.391 where name_en = 'Rustaq';            -- handoff
update public.cities set lng = 57.533, lat = 22.933 where name_en = 'Nizwa';             -- handoff
update public.cities set lng = 57.300, lat = 22.965 where name_en = 'Bahla';             -- gazetteer
update public.cities set lng = 57.983, lat = 23.305 where name_en = 'Samail';            -- gazetteer
update public.cities set lng = 58.128, lat = 23.406 where name_en = 'Bidbid';            -- gazetteer
update public.cities set lng = 57.766, lat = 22.933 where name_en = 'Izki';              -- gazetteer
update public.cities set lng = 57.528, lat = 22.379 where name_en = 'Adam';              -- gazetteer
update public.cities set lng = 56.516, lat = 23.226 where name_en = 'Ibri';              -- handoff
update public.cities set lng = 55.793, lat = 24.251 where name_en = 'Buraimi';           -- handoff
update public.cities set lng = 59.529, lat = 22.567 where name_en = 'Sur';               -- handoff
update public.cities set lng = 58.533, lat = 22.690 where name_en = 'Ibra';              -- gazetteer
update public.cities set lng = 58.083, lat = 22.583 where name_en = 'Sinaw';             -- gazetteer
update public.cities set lng = 58.128, lat = 22.573 where name_en = 'Al Mudhaibi';       -- gazetteer
update public.cities set lng = 59.203, lat = 22.163 where name_en = 'Al Kamil Wal Wafi'; -- gazetteer
update public.cities set lng = 56.283, lat = 19.958 where name_en = 'Haima';             -- gazetteer
update public.cities set lng = 57.700, lat = 19.665 where name_en = 'Duqm';              -- handoff
update public.cities set lng = 54.024, lat = 17.664 where name_en = 'Thumrait';          -- gazetteer
update public.cities set lng = 54.092, lat = 17.020 where name_en = 'Salalah';           -- handoff
update public.cities set lng = 54.402, lat = 17.037 where name_en = 'Taqah';             -- gazetteer
update public.cities set lng = 54.691, lat = 16.992 where name_en = 'Mirbat';            -- gazetteer
update public.cities set lng = 56.246, lat = 26.179 where name_en = 'Khasab';            -- handoff

-- ── U.A.E. ──────────────────────────────────────────────────────────────────
update public.cities set lng = 55.271, lat = 25.205 where name_en = 'Dubai';             -- handoff
update public.cities set lng = 55.027, lat = 25.011 where name_en = 'Jebel Ali';         -- gazetteer
update public.cities set lng = 54.366, lat = 24.453 where name_en = 'Abu Dhabi';         -- gazetteer
update public.cities set lng = 55.392, lat = 25.346 where name_en = 'Sharjah';           -- gazetteer
update public.cities set lng = 55.436, lat = 25.412 where name_en = 'Ajman';             -- gazetteer
update public.cities set lng = 55.760, lat = 24.208 where name_en = 'Al Ain';            -- gazetteer
update public.cities set lng = 55.943, lat = 25.789 where name_en = 'Ras Al Khaimah';    -- gazetteer
update public.cities set lng = 56.336, lat = 25.128 where name_en = 'Fujairah';          -- gazetteer

-- ── Saudi Arabia ────────────────────────────────────────────────────────────
-- NOTE: these three sit OUTSIDE the handoff's regional map framing
-- ([51.6,16.3]-[60.3,26.6]). Riyadh and Jeddah are far outside it. They stay
-- reachable through the searchable city list, which is the complete index — the
-- map is an orientation aid, not the only way to choose a city. A shipper is
-- never blocked (CLAUDE.md #6).
update public.cities set lng = 46.716, lat = 24.633 where name_en = 'Riyadh';            -- gazetteer
update public.cities set lng = 50.103, lat = 26.434 where name_en = 'Dammam';            -- gazetteer
update public.cities set lng = 39.197, lat = 21.486 where name_en = 'Jeddah';            -- gazetteer

-- ── constrain, only once every row is filled ────────────────────────────────
-- Fails loudly if a city was added between 0002 and here without a coordinate,
-- which is exactly the failure we want: a NULL coordinate projects as (0,0),
-- which is in the Atlantic off Ghana.
alter table public.cities alter column lat set not null;
alter table public.cities alter column lng set not null;

-- Bounds are the operating region, wide enough for Jeddah on the Red Sea
-- (39.2E) and tight enough that a TRANSPOSED lat/lng pair fails — a swapped
-- Muscat would present lat 58.4 and be rejected. That transposition is the
-- likeliest error in a table of hand-entered coordinates.
alter table public.cities
  add constraint cities_lat_in_region check (lat between 16 and 27),
  add constraint cities_lng_in_region check (lng between 38 and 61);

-- Oman sits in a much tighter box than the GCC as a whole, so give it its own
-- check: the loose bound above would happily accept an Omani city carrying a
-- Saudi coordinate. These numbers are Oman's actual extent, read off the
-- Natural Earth 1:50m outline the map draws (src/map/geometry.json), plus a
-- small margin — so a city that passes here will land on the drawn landmass
-- rather than beside it.
alter table public.cities
  add constraint cities_om_within_oman check (
    country <> 'OM' or (lng between 51.9 and 60.0 and lat between 16.6 and 26.5)
  );
