-- 0022_load_status_quoted_accepted.sql
--
-- Two new load states, and NOTHING ELSE in this migration.
--
-- Postgres cannot use a new enum value in the same transaction that adds it, so
-- any function or constraint referencing `quoted` or `accepted` has to wait for
-- 0023. Splitting them is not tidiness — a combined migration fails on apply.
--
--   quoted    a price is waiting for the shipper to decide on
--   accepted  the shipper said yes; we are now finding the truck
--
-- These are ADDITIVE. No existing value is renamed or removed, so the ops
-- console (~/truckkoo-ops, a separate deployment) keeps working against this
-- schema — it simply cannot act on the two new states until it is updated.
-- See OPEN_ISSUES.md.

alter type public.load_status add value if not exists 'quoted' after 'finding_truck';
alter type public.load_status add value if not exists 'accepted' after 'quoted';
