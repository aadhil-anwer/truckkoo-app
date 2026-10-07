-- Driver evidence is private and append-only in Storage. Metadata is readable
-- only through actor-scoped RPCs; the files never have public URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-verification', 'driver-verification', false, 8388608,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function private.is_driver_actor()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'driver' and p.suspended_at is null);
$$;
revoke all on function private.is_driver_actor() from public, anon;
grant execute on function private.is_driver_actor() to authenticated;

create policy "driver uploads own verification" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'driver-verification'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_driver_actor())
    and (storage.foldername(name))[2] in ('id_front', 'id_back', 'mulkiya', 'truck_photo')
    and storage.extension(name) in ('jpg', 'jpeg', 'png', 'webp')
  );

create policy "driver reads own verification" on storage.objects
  for select to authenticated
  using (bucket_id = 'driver-verification'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Explicitly approved by the founder: appointed ops may mint short-lived
-- signed URLs to review evidence. No write, update or delete policy for ops.
create policy "ops reads driver verification" on storage.objects
  for select to authenticated
  using (bucket_id = 'driver-verification' and (select private.is_ops()));

create table public.driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('id_front', 'id_back', 'mulkiya', 'truck_photo')),
  object_path text not null unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint driver_documents_one_kind unique (driver_id, kind),
  constraint driver_documents_path_len check (char_length(object_path) <= 240),
  constraint driver_documents_review_note_len check (review_note is null or char_length(review_note) <= 500)
);
revoke all on public.driver_documents from public, anon, authenticated;
alter table public.driver_documents enable row level security;
alter table public.driver_documents force row level security;
create index driver_documents_pending_idx on public.driver_documents(status, created_at)
  where status = 'pending';

create or replace function public.submit_driver_document(p_kind text, p_object_path text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_existing_status text;
begin
  perform private.require_active();
  perform private.check_rate_limit('submit_driver_document', 20, interval '1 hour');
  if v_uid is null or not exists (
    select 1 from public.profiles p where p.id = v_uid and p.role = 'driver'
  ) then raise exception 'account not found' using errcode = 'no_data_found'; end if;
  if p_kind not in ('id_front', 'id_back', 'mulkiya', 'truck_photo')
     or p_object_path !~ ('^' || v_uid::text || '/' || p_kind || '/[0-9a-f-]{36}[.](jpg|jpeg|png|webp)$')
     or not exists (select 1 from storage.objects o
                    where o.bucket_id = 'driver-verification' and o.name = p_object_path)
  then raise exception 'document not found' using errcode = 'no_data_found'; end if;

  -- Approved evidence stays immutable. A rejected or pending item can be
  -- resubmitted; old files remain private for audit and can be swept by ops.
  select d.status into v_existing_status from public.driver_documents d
  where d.driver_id = v_uid and d.kind = p_kind for update;
  if v_existing_status = 'approved'
  then raise exception 'document already approved' using errcode = 'check_violation'; end if;
  insert into public.driver_documents(driver_id, kind, object_path)
  values (v_uid, p_kind, p_object_path)
  on conflict (driver_id, kind) do update
    set object_path = excluded.object_path, status = 'pending',
        review_note = null, reviewed_by = null, reviewed_at = null,
        created_at = now()
    where public.driver_documents.status <> 'approved';
  if not found then raise exception 'document already approved' using errcode = 'check_violation'; end if;
end $$;
revoke all on function public.submit_driver_document(text, text) from public, anon;
grant execute on function public.submit_driver_document(text, text) to authenticated;

create or replace function public.driver_document_status()
returns table(kind text, status text, review_note text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.kind, d.status, d.review_note, d.created_at
  from public.driver_documents d
  where d.driver_id = (select auth.uid()) and auth.uid() is not null
  order by d.kind;
$$;
revoke all on function public.driver_document_status() from public, anon;
grant execute on function public.driver_document_status() to authenticated;

create or replace function public.ops_driver_documents(p_driver_id uuid)
returns table(id uuid, kind text, object_path text, status text,
              review_note text, created_at timestamptz, reviewed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_ops();
  return query select d.id, d.kind, d.object_path, d.status, d.review_note,
                      d.created_at, d.reviewed_at
    from public.driver_documents d where d.driver_id = p_driver_id
    order by d.kind;
end $$;
revoke all on function public.ops_driver_documents(uuid) from public, anon;
grant execute on function public.ops_driver_documents(uuid) to authenticated;

create or replace function public.ops_review_driver_document(
  p_document_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_before jsonb;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_review_driver_document', 200, interval '1 hour');
  select to_jsonb(d) into v_before from public.driver_documents d
  where d.id = p_document_id for update;
  if v_before is null then raise exception 'document not found' using errcode = 'no_data_found'; end if;
  if p_approve is null then raise exception 'review decision required' using errcode = 'check_violation'; end if;
  if p_note is not null and (char_length(p_note) > 500 or private.contains_unsafe_text(p_note))
  then raise exception 'invalid review note' using errcode = 'check_violation'; end if;
  perform 1 from public.profiles p where p.id = (v_before->>'driver_id')::uuid for update;
  if not p_approve and nullif(btrim(p_note), '') is null
  then raise exception 'rejection needs a reason' using errcode = 'check_violation'; end if;
  if not p_approve and exists (
    select 1 from public.drivers d where d.profile_id = (v_before->>'driver_id')::uuid
      and d.verified_at is not null)
  then raise exception 'remove driver verification before rejecting evidence'
    using errcode = 'check_violation'; end if;
  update public.driver_documents set status = case when p_approve then 'approved' else 'rejected' end,
    review_note = left(nullif(btrim(p_note), ''), 500),
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_document_id;
  perform private.log_ops('ops_review_driver_document', 'driver_document', p_document_id::text,
    v_before, (select to_jsonb(d) from public.driver_documents d where d.id = p_document_id), p_note);
end $$;
revoke all on function public.ops_review_driver_document(uuid, boolean, text) from public, anon;
grant execute on function public.ops_review_driver_document(uuid, boolean, text) to authenticated;

-- Verification remains a human act, but cannot be granted without evidence.
create or replace function public.ops_verify_driver(
  p_profile_id uuid, p_verified boolean, p_notes text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_before jsonb;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_verify_driver', 200, interval '1 hour');
  if p_verified is null then raise exception 'verification decision required' using errcode = 'check_violation'; end if;
  perform 1 from public.profiles p where p.id = p_profile_id for update;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.role = 'driver')
  then raise exception 'account not found' using errcode = 'no_data_found'; end if;
  if p_verified and (
    (select count(*) from public.driver_documents d where d.driver_id = p_profile_id
       and d.status = 'approved') <> 4
    or not exists (select 1 from public.trucks t where t.owner_id = p_profile_id
                   and t.verified_at is not null and t.capacity_kg is not null
                   and nullif(btrim(t.plate), '') is not null)
  ) then raise exception 'documents and truck need review first' using errcode = 'check_violation'; end if;
  if not p_verified and nullif(btrim(p_notes), '') is null
  then raise exception 'say why you are removing verification' using errcode = 'check_violation'; end if;
  select to_jsonb(d) into v_before from public.drivers d where d.profile_id = p_profile_id;
  insert into public.drivers(profile_id, verified_at, verified_by, notes)
  values (p_profile_id, case when p_verified then now() end,
          case when p_verified then auth.uid() end, p_notes)
  on conflict (profile_id) do update set
    verified_at = case when p_verified then now() end,
    verified_by = case when p_verified then auth.uid() end,
    notes = coalesce(p_notes, public.drivers.notes);
  perform private.log_ops('ops_verify_driver', 'account', p_profile_id::text,
    v_before, (select to_jsonb(d) from public.drivers d where d.profile_id = p_profile_id), p_notes);
end $$;

create or replace function public.ops_verify_truck(p_truck_id uuid, p_verified boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_before jsonb; v_owner uuid;
begin
  perform private.require_ops();
  perform private.check_rate_limit('ops_verify_truck', 200, interval '1 hour');
  select to_jsonb(t), t.owner_id into v_before, v_owner from public.trucks t
  where t.id = p_truck_id for update;
  if v_before is null then raise exception 'truck not found' using errcode = 'no_data_found'; end if;
  if p_verified is null then raise exception 'verification decision required' using errcode = 'check_violation'; end if;
  perform 1 from public.profiles p where p.id = v_owner for update;
  if p_verified and (
    not exists (select 1 from public.trucks t
      join public.truck_types tt on tt.code = t.truck_type
      where t.id = p_truck_id and t.capacity_kg between 1 and tt.capacity_kg
        and nullif(btrim(t.plate), '') is not null)
    or (select count(*) from public.driver_documents d where d.driver_id = v_owner
      and d.kind in ('mulkiya', 'truck_photo') and d.status = 'approved') <> 2
  ) then raise exception 'truck evidence, capacity and plate need review first'
    using errcode = 'check_violation'; end if;
  update public.trucks set verified_at = case when p_verified then now() end where id = p_truck_id;
  if not p_verified then update public.drivers set verified_at = null, verified_by = null
    where profile_id = v_owner; end if;
  perform private.log_ops('ops_verify_truck', 'truck', p_truck_id::text, v_before,
    (select to_jsonb(t) from public.trucks t where t.id = p_truck_id), null);
end $$;

-- Existing column grants let an owner correct an unreviewed truck. Once
-- verified, changing the plate/type/capacity needs an ops re-review first.
create or replace function private.guard_verified_truck()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.verified_at is not null and
     (old.truck_type, old.plate, old.capacity_kg) is distinct from
     (new.truck_type, new.plate, new.capacity_kg)
  then raise exception 'verified truck must be reviewed again' using errcode = 'check_violation'; end if;
  return new;
end $$;
revoke all on function private.guard_verified_truck() from public, anon, authenticated;
drop trigger if exists guard_verified_truck on public.trucks;
create trigger guard_verified_truck before update on public.trucks for each row
execute function private.guard_verified_truck();

create or replace function private.guard_verified_truck_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.verified_at is not null and exists (select 1 from public.profiles p where p.id = old.owner_id)
  then raise exception 'remove verification before deleting truck' using errcode = 'check_violation'; end if;
  return old;
end $$;
revoke all on function private.guard_verified_truck_delete() from public, anon, authenticated;
drop trigger if exists guard_verified_truck_delete on public.trucks;
create trigger guard_verified_truck_delete before delete on public.trucks for each row
execute function private.guard_verified_truck_delete();

create or replace function private.check_truck_class_capacity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_class_max integer;
begin
  select tt.capacity_kg into v_class_max from public.truck_types tt where tt.code = new.truck_type;
  if new.capacity_kg is not null and new.capacity_kg > v_class_max
  then raise exception 'truck capacity exceeds its class' using errcode = 'check_violation'; end if;
  return new;
end $$;
revoke all on function private.check_truck_class_capacity() from public, anon, authenticated;
drop trigger if exists check_truck_class_capacity on public.trucks;
create trigger check_truck_class_capacity before insert or update of capacity_kg, truck_type
on public.trucks for each row execute function private.check_truck_class_capacity();

-- From this release forward a self-declared driver cannot receive offers or
-- bid before an appointed dispatcher completes review. Existing verified rows
-- remain valid; previously unverified accounts stop receiving new work.
update private.app_settings set value = 'true'::jsonb
where key = 'require_verified_driver';

-- Profile and truck are one signup commit. A lost response can be retried
-- without creating another truck or stranding a profile-only driver.
create or replace function public.complete_driver_signup(
  p_name text, p_phone text, p_truck_type text, p_capacity_kg integer, p_plate text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_class_max integer;
begin
  if v_uid is null then raise exception 'account not found' using errcode = 'no_data_found'; end if;
  perform private.require_active();
  perform private.check_rate_limit('complete_driver_signup', 20, interval '1 hour');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120
     or private.contains_unsafe_text(p_name)
     or p_phone is null or p_phone !~ '^[+]968[79][0-9]{7}$'
     or p_plate is null or char_length(btrim(p_plate)) not between 3 and 24
     or private.contains_unsafe_text(p_plate)
  then raise exception 'invalid driver details' using errcode = 'check_violation'; end if;
  select tt.capacity_kg into v_class_max from public.truck_types tt where tt.code = p_truck_type;
  if v_class_max is null or p_capacity_kg is null or p_capacity_kg not between 1 and v_class_max
  then raise exception 'invalid truck capacity' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.role <> 'driver')
  then raise exception 'account not found' using errcode = 'no_data_found'; end if;
  if exists (select 1 from public.trucks t where t.owner_id = v_uid)
     and not exists (select 1 from public.trucks t where t.owner_id = v_uid
       and t.truck_type = p_truck_type and t.capacity_kg = p_capacity_kg and t.plate = btrim(p_plate))
  then raise exception 'driver signup already completed' using errcode = 'check_violation'; end if;

  insert into public.profiles(id, role, full_name, phone)
  values (v_uid, 'driver'::public.user_role, btrim(p_name), p_phone)
  on conflict (id) do nothing;
  if not exists (select 1 from public.trucks t where t.owner_id = v_uid
    and t.truck_type = p_truck_type and t.capacity_kg = p_capacity_kg
    and t.plate = btrim(p_plate))
  then insert into public.trucks(owner_id, truck_type, capacity_kg, plate)
    values (v_uid, p_truck_type, p_capacity_kg, btrim(p_plate)); end if;
end $$;
revoke all on function public.complete_driver_signup(text, text, text, integer, text)
  from public, anon;
grant execute on function public.complete_driver_signup(text, text, text, integer, text)
  to authenticated;
