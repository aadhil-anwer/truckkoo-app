-- ─────────────────────────────────────────────────────────────────────────────
-- 0006 — let the client ask whether IT is a dispatcher
--
-- The app has to route somewhere on launch, and it cannot read
-- `private.ops_users` (correctly — that table has no client grant at all). Without
-- this the only way to find out would be to call `ops_queue()` and interpret an
-- exception as "not ops", which conflates "you are not a dispatcher" with "the
-- network is down" and would send a real dispatcher to the shipper screen every
-- time their signal dropped.
--
-- WHY THIS LEAKS NOTHING
--
-- It takes no argument. A caller learns exactly one bit about themselves, which
-- they could already infer by calling any ops function and watching it fail. It
-- cannot enumerate dispatchers, and it cannot be asked about anyone else.
--
-- It is NOT authorization. Every ops function still calls `private.require_ops()`
-- internally. This exists so the UI can route; hiding a screen protects nothing
-- (SECURITY.md §3).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.am_i_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_ops();
$$;

comment on function public.am_i_ops() is
  'Navigation only. Returns whether the CALLER is a dispatcher — no argument, so '
  'it cannot be asked about anyone else. Authorization still lives in '
  'private.require_ops() inside each ops function.';

revoke all on function public.am_i_ops() from public, anon;
grant execute on function public.am_i_ops() to authenticated;
