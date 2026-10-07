-- 0070 · The founder: an owner who is exempt from the staff-account rule, and
-- the only person who can appoint or remove staff.
--
-- Founder's call, 2026-10-07: aadhilanwer@gmail.com is the owner, with full
-- permissions, and staff are added by them and nobody else. 0054's
-- staff_account_ok refuses that account twice — gmail.com is not a staff
-- domain, and it is also used as a customer — so the console was locked to
-- every owner production had.
--
-- What is exempted, and what is not:
--   * staff_account_ok — the domain and never-a-customer rules — is skipped for
--     the founder only.
--   * 2FA is NOT exempted. is_ops still demands aal2 and require_owner_fresh a
--     TOTP from the last 15 minutes. The founder chose to keep it: without it a
--     phished Gmail password reads every tenant and appoints staff.
--
-- The founder is named in private.founder, one row, no client grant, so a
-- console bug cannot add a second. The exemption holds only while that account
-- still has that email address AND it is confirmed: changing the email on the
-- account ends it, so it cannot be handed on by an email change. Changing who
-- the founder is takes SQL by hand, as appointing the first dispatcher did
-- (0007).
--
-- No row (a fresh or local database) means nobody can appoint staff through the
-- console at all. That is deliberate: there is no fallback to "any owner".

create table if not exists private.founder (
  only_one   boolean primary key default true check (only_one),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  email      text not null check (email = lower(btrim(email)))
);
revoke all on private.founder from public, anon, authenticated;
alter table private.founder enable row level security;
alter table private.founder force row level security;
comment on table private.founder is
  'The one founder (0070): exempt from staff_account_ok, the only appointer of staff. No client grant; edited by hand.';

-- Pinned to the production account's id AND its address: a different database
-- with the same email on another id gets nothing.
insert into private.founder (profile_id, email)
select u.id, 'aadhilanwer@gmail.com'
  from auth.users u
  join public.profiles p on p.id = u.id
 where u.id = '7f75b9a5-2635-4e6a-a376-bd6d86d18978'
   and lower(u.email) = 'aadhilanwer@gmail.com'
on conflict (only_one) do nothing;

create or replace function private.is_founder(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.founder f
      join auth.users u on u.id = f.profile_id
     where f.profile_id = p_uid
       and lower(u.email) = f.email
       and u.email_confirmed_at is not null);
$$;
revoke all on function private.is_founder(uuid) from public, anon, authenticated;

-- 0054's body, unchanged, behind the founder's exemption.
create or replace function private.staff_account_ok(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_founder(p_uid) or case
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

-- The founder, with fresh 2FA. Anyone else — an owner included — is told "not
-- found", as every ops door answers someone it does not admit.
create or replace function private.require_founder_fresh()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_owner_fresh();
  if not private.is_founder((select auth.uid())) then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function private.require_founder_fresh() from public, anon, authenticated;

-- 0054's ops_appoint_staff: founder only, and the founder stays an owner.
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
  perform private.require_founder_fresh();
  if p_level is null or p_level not in ('owner', 'dispatcher') then
    raise exception 'level must be owner or dispatcher' using errcode = 'check_violation';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a staff change needs a reason' using errcode = 'check_violation';
  end if;
  if private.is_founder(p_profile_id) and p_level <> 'owner' then
    raise exception 'the founder stays an owner' using errcode = 'check_violation';
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
  perform private.system_raise_alert('staff_change',
    format('Staff change: account %s is now %s (was %s). See ops_audit.',
           p_profile_id, p_level, coalesce(v_before, 'not staff')),
    jsonb_build_object('profile_id', p_profile_id, 'level', p_level, 'before', v_before));
end;
$$;
revoke all on function public.ops_appoint_staff(uuid, text, text) from public, anon;
grant execute on function public.ops_appoint_staff(uuid, text, text) to authenticated;

-- 0054's ops_remove_staff: founder only, and nobody removes the founder.
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
  perform private.require_founder_fresh();
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a staff change needs a reason' using errcode = 'check_violation';
  end if;
  if private.is_founder(p_profile_id) then
    raise exception 'the founder cannot be removed' using errcode = 'check_violation';
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
