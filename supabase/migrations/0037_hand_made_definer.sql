-- Truckkoo — close a hole created outside the migrations.
--
-- Supabase's Security Advisor (2026-09-27) found `public.rls_auto_enable()` in
-- production: SECURITY DEFINER, and executable by `anon` — callable at
-- /rest/v1/rpc/rls_auto_enable without signing in. No migration creates it; it
-- was added through the dashboard (most likely the "enable RLS on new tables"
-- helper, which backs an event trigger).
--
-- Revoked rather than dropped: its body was never reviewed here, and dropping a
-- function an event trigger depends on fails or cascades. Event triggers do not
-- check EXECUTE when they fire, so whatever it automates keeps working; only
-- the API route to it closes. Naming it here also makes it "known" to
-- `scripts/check-migrations.mjs drift`, which now fails on any public function
-- no migration mentions — the check that would have caught this.
--
-- Conditional, because it exists only where someone clicked: a fresh local
-- stack and CI never have it.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
