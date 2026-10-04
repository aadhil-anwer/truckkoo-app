-- 0060 · Ops console v2, phase 1: staff levels and the fort.
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
