-- 0025_road_factor_120.sql
--
-- Road factor 1.35 → 1.20, set deliberately.
--
-- Measured against real road distances at 1.35:
--
--   Muscat→Barka     73 km vs ~80 km    −8%   (implied factor 1.47)
--   Muscat→Sohar    259 km vs ~230 km  +13%   (implied factor 1.20)
--   Muscat→Salalah 1158 km vs ~1030 km +12%   (implied factor 1.20)
--
-- Short trips run on local roads and want a HIGHER factor; long trips run on
-- highway and want a lower one, so one constant cannot serve both. 1.20 is
-- chosen because the per-km term dominates on long routes, and over-charging
-- there is the expensive error. The cost is that short hops now read low —
-- Muscat→Barka comes out around 65 km against ~80 on the ground — which the
-- minimum fare absorbs.
--
-- This is a SETTING, not a constant: it can be retuned from the ops console
-- without a migration once there is real trip data to tune against.

update private.app_settings
   set value = '120'::jsonb
 where key = 'road_factor_pct';
