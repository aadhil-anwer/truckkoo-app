-- Urdu is a right-to-left option, stored alongside English and Arabic.
alter table public.profiles drop constraint profiles_language_valid;
alter table public.profiles add constraint profiles_language_valid
  check (language in ('en', 'ar', 'ur'));

create or replace function public.ops_update_profile(
  p_profile_id uuid, p_full_name text default null, p_phone text default null,
  p_language char(2) default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_before jsonb;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_update_profile', 100, interval '1 hour');
  select to_jsonb(p) into v_before from public.profiles p where p.id = p_profile_id;
  if v_before is null then raise exception 'account not found' using errcode = 'no_data_found'; end if;
  if p_language is not null and p_language not in ('en', 'ar', 'ur')
  then raise exception 'invalid language' using errcode = 'check_violation'; end if;
  if private.contains_unsafe_text(p_full_name) or private.contains_unsafe_text(p_phone)
  then raise exception 'that contains disallowed characters' using errcode = 'check_violation'; end if;
  update public.profiles set
    full_name = coalesce(left(btrim(p_full_name), 120), full_name),
    phone = coalesce(left(btrim(p_phone), 24), phone),
    language = coalesce(p_language, language)
  where id = p_profile_id;
  perform private.log_ops('ops_update_profile', 'account', p_profile_id::text,
    jsonb_build_object('full_name', v_before->>'full_name', 'phone', v_before->>'phone',
      'language', v_before->>'language'),
    (select jsonb_build_object('full_name', p.full_name, 'phone', p.phone,
      'language', p.language) from public.profiles p where p.id = p_profile_id), null);
end $$;
