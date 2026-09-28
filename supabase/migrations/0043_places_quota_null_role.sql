-- 0043 · No profile, no search quota.
--
-- 0041's `use_places_quota` refused non-shippers with
-- `actor_role() <> 'shipper'`. A signed-in user with no profile row has a NULL
-- role, `NULL <> 'shipper'` is NULL, and an IF treats NULL as false — so the
-- guard let them through to spend Google quota on Truckkoo's bill. The body
-- below is 0041's, word for word, with `is distinct from` in that one line.

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
  if (select private.actor_role()) is distinct from 'shipper' then
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
