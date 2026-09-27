-- Truckkoo — index the foreign keys that queries and policies actually filter on.
--
-- `quotes` RLS is `shipper_id = (select auth.uid())`, and `quotes` grows with
-- every priced load: without this index, any direct read of /rest/v1/quotes —
-- the app never makes one, but anyone with the anon key can — is a sequential
-- scan that gets slower every week. `ratings.shipper_id` and the city/truck
-- references are cheap to index and make deleting a user or a city a lookup
-- instead of a scan.
--
-- `create index if not exists` without CONCURRENTLY: migrations run in a
-- transaction, and at today's table sizes the lock is milliseconds. Revisit
-- (CONCURRENTLY, outside a migration) once these tables are large.

create index if not exists quotes_shipper_idx       on public.quotes (shipper_id);
create index if not exists quotes_origin_city_idx   on public.quotes (origin_city);
create index if not exists quotes_dest_city_idx     on public.quotes (dest_city);
create index if not exists quotes_truck_type_idx    on public.quotes (truck_type_code);
create index if not exists quotes_rate_card_idx     on public.quotes (rate_card_id);
create index if not exists ratings_shipper_idx      on public.ratings (shipper_id);
create index if not exists profiles_suspended_by_idx on public.profiles (suspended_by);
create index if not exists client_errors_actor_idx  on private.client_errors (actor_id);
create index if not exists rate_cards_truck_type_idx on private.rate_cards (truck_type_code);
