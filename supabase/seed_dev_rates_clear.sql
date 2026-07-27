-- Remove the fake development rate card loaded by `seed_dev_rates.sql`.
--
-- Same guard, for the same reason: on a database that somehow held REAL rates,
-- this would delete the business's rate card. Deletions are captured by the
-- audit trigger either way.

do $$
begin
  if coalesce(current_setting('truckkoo.allow_dev_seed', true), '') <> '1' then
    raise exception
      'REFUSED: dev rate seed not enabled. Use `npm run seed:rates:clear` if this '
      'is a local database.'
      using errcode = 'insufficient_privilege';
  end if;
end $$;

begin;

do $$
declare
  v_rows integer;
begin
  delete from private.rate_cards;
  get diagnostics v_rows = row_count;
  raise notice 'Removed % rate rows. Quotes now return no_rate and route to a human.', v_rows;
end $$;

commit;
