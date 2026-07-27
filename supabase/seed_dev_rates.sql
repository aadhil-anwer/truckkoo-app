-- ─────────────────────────────────────────────────────────────────────────────
-- DEV SEED — FAKE RATES. NOT REAL PRICES. NEVER RUN THIS AGAINST PRODUCTION.
--
-- Every number this file produces is invented by a formula for the purpose of
-- making the app show *a* price during development. None of it came from anyone
-- who prices Omani freight. Quoting any of it to a customer would be quoting a
-- made-up number in real rial.
--
-- WHY THIS IS NOT A MIGRATION
--
-- `supabase/migrations/` is applied to production by `supabase db push`. Anything
-- placed there arrives in front of real shippers eventually, which is exactly how
-- a placeholder becomes a customer's quote. This file therefore lives outside that
-- directory and is applied only by an explicit npm script.
--
-- `tests/security/schema-invariants.test.ts` fails the build if an
-- `insert into private.rate_cards` ever appears in a migration. That test is what
-- keeps this file from drifting back into the shipped path.
--
-- HOW TO USE IT
--
--   npm run seed:rates        # load the fake card
--   npm run seed:rates:clear  # remove it again
--
-- The npm script sets the opt-in flag below. Running this file by hand without it
-- raises, so it cannot be applied by pasting into a psql prompt on the wrong
-- database.
--
-- WHAT IT PRODUCES
--
-- 8 corridors x 8 corridors x 5 truck types = 320 rows, which is every ordered
-- corridor pair. Because the rate card is keyed on corridors rather than cities,
-- those 320 rows price all 2,070 ordered city pairs across the 46 seeded cities.
-- There is nothing to add per city.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── the opt-in guard ───────────────────────────────────────────────────────
-- Set by the npm script via PGOPTIONS. Absent = refuse.

do $$
begin
  if coalesce(current_setting('truckkoo.allow_dev_seed', true), '') <> '1' then
    raise exception
      'REFUSED: dev rate seed not enabled. This file loads FAKE prices and must '
      'never touch production. Use `npm run seed:rates` if this is a local database.'
      using errcode = 'insufficient_privilege';
  end if;
end $$;

begin;

-- Idempotent: re-running replaces the fake card rather than stacking onto it.
-- Deletes are captured by the audit trigger, so the churn stays visible.
delete from private.rate_cards;

-- ─── invented geography ─────────────────────────────────────────────────────
-- A crude zone index per corridor, so prices at least *vary* with distance and a
-- test can tell Muscat->Seeb from Muscat->Salalah. These are eyeballed from a map,
-- not measured, and they are wrong in the way that does not matter for testing and
-- would matter enormously for money.
--
-- Corridor strings are read from `cities.corridor` rather than retyped, so a rename
-- upstream cannot leave this silently matching nothing — and the validation trigger
-- on rate_cards would reject them anyway.

with zone (corridor, z) as (
  values
    ('Muscat governorate',                        0),
    ('Batinah coast (Muscat - Sohar corridor)',   1),
    ('Interior and Dhahirah',                     2),
    ('Sharqiyah',                                 2),
    ('UAE',                                       3),
    ('Musandam',                                  4),
    ('Wusta and Dhofar (Salalah corridor)',       5),
    ('Saudi Arabia',                              6)
),

-- Only corridors that actually exist in the seeded city list. If a corridor were
-- renamed in 0002, it drops out here instead of failing 64 inserts one at a time.
present as (
  select z.corridor, z.z
  from zone z
  where exists (select 1 from public.cities c where c.corridor = z.corridor)
),

pair as (
  select
    a.corridor as origin_corridor,
    b.corridor as dest_corridor,
    abs(a.z - b.z) as tier
  from present a
  cross join present b
)

insert into private.rate_cards
  (origin_corridor, dest_corridor, truck_type_code,
   base_baisa, per_tonne_baisa, min_fare_baisa, currency)
select
  p.origin_corridor,
  p.dest_corridor,
  t.code,

  -- Bigger truck costs more; further costs more. `capacity_kg` drives the truck
  -- factor so the five types stay ordered without a second invented table.
  --   factor: pickup 1.1x, hi-up 1.3x, 10t 2.0x, 20t 3.0x, 40t 5.0x
  round((25000 + p.tier * 40000) * (1 + t.capacity_kg / 10000.0))::bigint  as base_baisa,

  (1500 + p.tier * 1200)::bigint                                          as per_tonne_baisa,

  -- Minimum charge = the base plus one tonne, i.e. nobody is billed less than a
  -- one-tonne trip. This is the one line here shaped like a real commercial rule,
  -- and it is why the floor is reachable in testing: any load under 1,000 kg hits
  -- it instead of the computed price.
  (round((25000 + p.tier * 40000) * (1 + t.capacity_kg / 10000.0))::bigint
     + (1500 + p.tier * 1200)::bigint)                                    as min_fare_baisa,

  'OMR'
from pair p
cross join public.truck_types t;

-- ─── what just happened ─────────────────────────────────────────────────────

do $$
declare
  v_rows integer;
  v_min  bigint;
  v_max  bigint;
begin
  select count(*), min(base_baisa), max(base_baisa)
    into v_rows, v_min, v_max
  from private.rate_cards;

  raise notice '';
  -- plpgsql's raise takes plain % only, so the three decimals are formatted with
  -- to_char rather than a printf spec. Three, because OMR has three.
  raise notice '  Loaded % FAKE rate rows. Base ranges % - % OMR.',
    v_rows,
    to_char(v_min / 1000.0, 'FM999990.000'),
    to_char(v_max / 1000.0, 'FM999990.000');
  raise notice '  These are invented for testing. Do not quote them to anyone.';
  raise notice '  Remove with: npm run seed:rates:clear';
  raise notice '';
end $$;

commit;
