-- ─────────────────────────────────────────────────────────────────────────────
-- 0007 — appoint the founder as the first dispatcher
--
-- `private.ops_users` has no API path on purpose, so the first dispatcher has to
-- be appointed out of band. Doing it here rather than by hand in the SQL editor
-- means it is version controlled, reviewable, and reproducible on a fresh
-- database instead of being a click nobody remembers making.
--
-- WHY THIS IS A ONE-TIME SNAPSHOT AND NOT A RULE
--
-- The obvious "nicer" design is a trigger on `profiles` that auto-appoints anyone
-- whose email matches a bootstrap list. That is rejected deliberately:
-- `enable_confirmations` is currently OFF (OPEN_ISSUES #5b), so an email address
-- is not proof of identity right now — anyone could sign up as the founder's
-- address and be handed cross-tenant read access to every shipper's cargo. A
-- standing email-based grant is only safe once confirmation is back on, and even
-- then it is a bigger surface than this problem needs.
--
-- So: a single insert, evaluated once, at push time.
--
-- IF THIS FINDS NOTHING
--
-- `profile_id` references `public.profiles`, and a profiles row only exists after
-- signup's role step is completed. If the founder has not finished signing up when
-- this migration runs, it inserts nothing and — being a migration — never retries.
-- It raises a NOTICE saying so, which appears in the `db push` output. The fix is
-- the same insert run by hand; the comment at the bottom of 0005 has it.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_email text := 'aadhilanwer@gmail.com';
  v_id    uuid;
begin
  select p.id into v_id
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(u.email) = lower(v_email);

  if v_id is null then
    raise notice
      'ops: no profile found for % — founder NOT appointed. Complete signup, then run: '
      'insert into private.ops_users (profile_id, note) values (''<uuid>'', ''founder'');',
      v_email;
    return;
  end if;

  insert into private.ops_users (profile_id, note)
  values (v_id, 'founder — appointed by migration 0007')
  on conflict (profile_id) do nothing;

  raise notice 'ops: founder appointed (%)', v_id;
end $$;
