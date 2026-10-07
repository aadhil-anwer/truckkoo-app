-- 0054 · Ops console v2, phase 1: staff levels and the fort.
--
-- Spec: ~/truckkoo-ops/docs/superpowers/specs/2026-10-05-ops-console-v2-design.md
-- §4 (roles) and §9b (the fort). The locks that matter most are here, in the
-- database, so they hold even if the console, Cloudflare or a laptop is
-- compromised.
--
-- `private.is_ops()` is the single gate behind every ops_* function, the `pod`
-- and `driver-verification` storage policies and the trip-position read.
-- Tightening it here tightens all of them at once.

-- ═══ 1. levels ═══════════════════════════════════════════════════════════════

alter table private.ops_users
  add column if not exists level text not null default 'dispatcher';
alter table private.ops_users
  drop constraint if exists ops_users_level_valid;
alter table private.ops_users
  add constraint ops_users_level_valid check (level in ('owner', 'dispatcher'));

insert into private.app_settings (key, value) values
  -- A staff account must be a confirmed address on one of these domains.
  -- Absent key = rule off (local fixtures only); production keeps it.
  ('staff_email_domains', '["truckkoo.com"]'::jsonb),
  -- How recent a TOTP verification an owner's dangerous action needs.
  ('ops_stepup_minutes',  '15'::jsonb)
on conflict (key) do nothing;

-- The caller's staff level, ignoring 2FA. For navigation and for the gate
-- below — never authorization on its own.
create or replace function private.ops_level()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select o.level from private.ops_users o where o.profile_id = (select auth.uid());
$$;
revoke all on function private.ops_level() from public, anon, authenticated;

-- A staff account is a staff account and nothing else: confirmed, on a staff
-- email domain, and never used as a customer. A compromised shipper or driver
-- login must not be one row away from reading every tenant.
create or replace function private.staff_account_ok(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not exists (select 1 from private.app_settings s where s.key = 'staff_email_domains') then true
    else exists (
           select 1 from auth.users u
            where u.id = p_uid
              and u.email_confirmed_at is not null
              and lower(split_part(u.email, '@', 2)) in (
                    select lower(d) from private.app_settings s,
                           jsonb_array_elements_text(s.value) d
                     where s.key = 'staff_email_domains'))
         and not exists (select 1 from public.loads l where l.shipper_id = p_uid)
         and not exists (select 1 from public.trips t where t.driver_id = p_uid)
         and not exists (select 1 from public.trucks k where k.owner_id = p_uid)
  end;
$$;
revoke all on function private.staff_account_ok(uuid) from public, anon, authenticated;

-- ═══ 2. the gate ═════════════════════════════════════════════════════════════
-- Lock 3 (2FA) and lock 5 (staff-only accounts), for every door at once.
create or replace function private.is_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.ops_level() is not null
     and coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
     and private.staff_account_ok((select auth.uid()));
$$;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_ops() and private.ops_level() = 'owner';
$$;
revoke all on function private.is_owner() from public, anon, authenticated;

create or replace function private.require_owner()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function private.require_owner() from public, anon, authenticated;

-- Lock 4. Supabase records each TOTP verification in the JWT's `amr` with a
-- unix timestamp; verifying again issues a token with a newer one. Only an
-- owner ever learns that step-up exists — anyone else gets "not found".
create or replace function private.require_owner_fresh()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_last bigint;
begin
  perform private.require_owner();
  select max((m ->> 'timestamp')::bigint) into v_last
    from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) m
   where m ->> 'method' = 'totp';
  if v_last is null
     or to_timestamp(v_last) < now() - make_interval(mins => private.setting_int('ops_stepup_minutes', 15)) then
    raise exception 'step-up required' using errcode = 'insufficient_privilege', hint = 'stepup';
  end if;
end;
$$;
revoke all on function private.require_owner_fresh() from public, anon, authenticated;

-- ═══ 3. staff management ═════════════════════════════════════════════════════

create or replace function private.assert_an_owner_remains()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.ops_users o where o.level = 'owner') then
    raise exception 'the last owner cannot be removed or demoted' using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function private.assert_an_owner_remains() from public, anon, authenticated;

-- Appoint, or change the level of, a staff member. Owner, fresh 2FA, a reason.
create or replace function public.ops_appoint_staff(p_profile_id uuid, p_level text, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before text;
begin
  perform private.require_owner_fresh();
  if p_level is null or p_level not in ('owner', 'dispatcher') then
    raise exception 'level must be owner or dispatcher' using errcode = 'check_violation';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a staff change needs a reason' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id)
     or not private.staff_account_ok(p_profile_id) then
    raise exception 'this account cannot be a staff account' using errcode = 'check_violation';
  end if;

  select o.level into v_before from private.ops_users o where o.profile_id = p_profile_id;
  insert into private.ops_users (profile_id, note, level)
  values (p_profile_id, left(btrim(p_reason), 200), p_level)
  on conflict (profile_id) do update set level = excluded.level;
  perform private.assert_an_owner_remains();

  perform private.log_ops('ops_appoint_staff', 'profile', p_profile_id::text,
    jsonb_build_object('level', v_before), jsonb_build_object('level', p_level), p_reason);
  -- Ids and levels only: the reason is staff-typed text and stays in the audit.
  perform private.system_raise_alert('staff_change',
    format('Staff change: account %s is now %s (was %s). See ops_audit.',
           p_profile_id, p_level, coalesce(v_before, 'not staff')),
    jsonb_build_object('profile_id', p_profile_id, 'level', p_level, 'before', v_before));
end;
$$;
revoke all on function public.ops_appoint_staff(uuid, text, text) from public, anon;
grant execute on function public.ops_appoint_staff(uuid, text, text) to authenticated;

create or replace function public.ops_remove_staff(p_profile_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before text;
begin
  perform private.require_owner_fresh();
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a staff change needs a reason' using errcode = 'check_violation';
  end if;
  delete from private.ops_users o where o.profile_id = p_profile_id returning o.level into v_before;
  if v_before is null then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  perform private.assert_an_owner_remains();

  perform private.log_ops('ops_remove_staff', 'profile', p_profile_id::text,
    jsonb_build_object('level', v_before), null, p_reason);
  perform private.system_raise_alert('staff_change',
    format('Staff change: account %s was removed (was %s). See ops_audit.', p_profile_id, v_before),
    jsonb_build_object('profile_id', p_profile_id, 'level', null, 'before', v_before));
end;
$$;
revoke all on function public.ops_remove_staff(uuid, text) from public, anon;
grant execute on function public.ops_remove_staff(uuid, text) to authenticated;

create or replace function public.ops_staff()
returns table (profile_id uuid, full_name text, email text, level text,
               added_at timestamptz, account_ok boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return query
    select o.profile_id, p.full_name, u.email::text, o.level, o.added_at,
           private.staff_account_ok(o.profile_id)
      from private.ops_users o
      join public.profiles p on p.id = o.profile_id
      join auth.users u on u.id = o.profile_id
     order by o.level, p.full_name;
end;
$$;
revoke all on function public.ops_staff() from public, anon;
grant execute on function public.ops_staff() to authenticated;

-- ═══ 4. witnessed ═════════════════════════════════════════════════════════════

-- Lock 6: the record of what staff did cannot be rewritten by anyone — not a
-- dispatcher, not an owner, not a definer function, not the table owner.
-- (A superuser can still drop the trigger; that act is itself a migration.)
create or replace function private.ops_audit_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ops_audit is append-only' using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function private.ops_audit_append_only() from public, anon, authenticated;

drop trigger if exists ops_audit_no_change on private.ops_audit;
create trigger ops_audit_no_change
  before update or delete on private.ops_audit
  for each row execute function private.ops_audit_append_only();
drop trigger if exists ops_audit_no_truncate on private.ops_audit;
create trigger ops_audit_no_truncate
  before truncate on private.ops_audit
  for each statement execute function private.ops_audit_append_only();

-- The console's door. Navigation only — the console asks this to decide which
-- screen to show; authorization stays in is_ops(). It does not raise, so a
-- non-staff sign-in can be recorded and alerted (0044's trip(): once per
-- account per hour, global cap). It takes no argument: it cannot be asked
-- about anyone else.
create or replace function public.my_ops_level()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_level text := private.ops_level();
begin
  if v_uid is null then
    return null;
  end if;
  if v_level is null then
    perform private.trip('ops_console_door');
  end if;
  return jsonb_build_object(
    'level',      v_level,
    'aal',        coalesce((select auth.jwt()) ->> 'aal', 'aal1'),
    'account_ok', case when v_level is null then false else private.staff_account_ok(v_uid) end);
end;
$$;
revoke all on function public.my_ops_level() from public, anon;
grant execute on function public.my_ops_level() to authenticated;
