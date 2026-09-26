-- Removes exactly what seed_driver_demo.sql added. Run as postgres.
--
-- Deleting the demo shipper cascades through their profile to the demo loads,
-- and from the loads to every offer, trip, trip event and position hanging off
-- them. The leg and the fallback truck belong to the driver, so they go by id.
-- Nothing without a de30… id is touched.

delete from public.legs   where id = 'de300000-0000-4000-8000-0000000000a1';
delete from auth.users    where id = 'de300000-0000-4000-8000-000000000001';
delete from public.trucks where id = 'de300000-0000-4000-8000-0000000000e1';
