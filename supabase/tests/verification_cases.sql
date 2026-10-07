-- Focused, rollback-only tests for 0050-0053. Unique actors avoid demo data.
begin;
set local client_min_messages to notice;

create or replace function vc_actor(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid,
    'role', 'authenticated', 'aal', 'aal2')::text, true);
end $$;
create or replace function vc_reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function vc_true(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAIL: %', p_label; end if;
  raise notice 'pass: %', p_label;
end $$;
create or replace function vc_reject(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then raise notice 'pass: % (rejected)', p_label; return;
  end;
  raise exception 'FAIL: % succeeded', p_label;
end $$;

insert into auth.users(id, email) values
  ('77777777-0000-4000-8000-000000000001', 'vc-driver-a@test.local'),
  ('77777777-0000-4000-8000-000000000002', 'vc-driver-b@test.local'),
  ('77777777-0000-4000-8000-000000000003', 'vc-shipper-a@test.local'),
  ('77777777-0000-4000-8000-000000000004', 'vc-shipper-b@test.local'),
  ('77777777-0000-4000-8000-000000000005', 'vc-ops@test.local')
on conflict (id) do nothing;
-- Use an allowed, confirmed synthetic staff identity when the local instance
-- also contains the newer staff-domain/MFA guard. No access policy is changed.
update auth.users set email = 'vc-ops@' || coalesce(
  (select value->>0 from private.app_settings where key = 'staff_email_domains'), 'test.local'),
  email_confirmed_at = now()
where id = '77777777-0000-4000-8000-000000000005';
insert into public.profiles(id, role, full_name) values
  ('77777777-0000-4000-8000-000000000002', 'driver', 'Other Driver'),
  ('77777777-0000-4000-8000-000000000003', 'shipper', 'Case Shipper'),
  ('77777777-0000-4000-8000-000000000004', 'shipper', 'Other Shipper'),
  ('77777777-0000-4000-8000-000000000005', 'shipper', 'Case Dispatcher')
on conflict (id) do nothing;
insert into private.ops_users(profile_id, note)
values ('77777777-0000-4000-8000-000000000005', 'test') on conflict do nothing;
select vc_true((select count(*) = 1 from private.ops_users where profile_id = '77777777-0000-4000-8000-000000000005'), 'ops membership inserted');

select vc_actor('77777777-0000-4000-8000-000000000001');
select vc_reject($$select public.complete_driver_signup('Case Driver', null, '10t', 8000, 'VC-123')$$,
  'signup rejects missing phone');
select vc_reject($$select public.complete_driver_signup('Case Driver', '+96891234567', '10t', null, 'VC-123')$$,
  'signup rejects missing capacity');
select public.complete_driver_signup('Case Driver', '+96891234567', '10t', 8000, 'VC-123');
select public.complete_driver_signup('Case Driver', '+96891234567', '10t', 8000, 'VC-123');
select vc_reset();
select vc_true((select count(*) = 1 from public.trucks
  where owner_id = '77777777-0000-4000-8000-000000000001'),
  'retry creates exactly one truck');
select vc_true((select role = 'driver' from public.profiles
  where id = '77777777-0000-4000-8000-000000000001'),
  'signup sets the fixed driver role');

select vc_actor('77777777-0000-4000-8000-000000000003');
select vc_reject($$insert into storage.objects(bucket_id, name) values
  ('driver-verification', '77777777-0000-4000-8000-000000000003/id_front/77777777-1111-4111-8111-000000000099.jpg')$$,
  'shipper cannot upload an ID to the driver bucket');
select vc_reset();

insert into storage.objects(bucket_id, name) values
  ('driver-verification', '77777777-0000-4000-8000-000000000001/id_front/77777777-1111-4111-8111-000000000001.jpg'),
  ('driver-verification', '77777777-0000-4000-8000-000000000001/id_back/77777777-1111-4111-8111-000000000002.jpg'),
  ('driver-verification', '77777777-0000-4000-8000-000000000001/mulkiya/77777777-1111-4111-8111-000000000003.jpg'),
  ('driver-verification', '77777777-0000-4000-8000-000000000001/truck_photo/77777777-1111-4111-8111-000000000004.jpg');

select vc_actor('77777777-0000-4000-8000-000000000001');
select public.submit_driver_document('id_front',
  '77777777-0000-4000-8000-000000000001/id_front/77777777-1111-4111-8111-000000000001.jpg');
select public.submit_driver_document('id_back',
  '77777777-0000-4000-8000-000000000001/id_back/77777777-1111-4111-8111-000000000002.jpg');
select public.submit_driver_document('mulkiya',
  '77777777-0000-4000-8000-000000000001/mulkiya/77777777-1111-4111-8111-000000000003.jpg');
select public.submit_driver_document('truck_photo',
  '77777777-0000-4000-8000-000000000001/truck_photo/77777777-1111-4111-8111-000000000004.jpg');
select vc_true((select count(*) = 4 from public.driver_document_status()),
  'driver sees four own document statuses');
select vc_reject($$select * from public.ops_driver_documents('77777777-0000-4000-8000-000000000001')$$,
  'driver cannot read ops document metadata');
select vc_reset();

select vc_actor('77777777-0000-4000-8000-000000000002');
select vc_true((select count(*) = 0 from public.driver_document_status()),
  'other driver sees no document metadata');
select vc_true((select count(*) = 0 from storage.objects
  where bucket_id = 'driver-verification'), 'other driver cannot read photos');
select vc_reject($$select public.submit_driver_document('id_front',
  '77777777-0000-4000-8000-000000000001/id_front/77777777-1111-4111-8111-000000000001.jpg')$$,
  'other driver cannot claim the photo');
select vc_reset();

select vc_actor('77777777-0000-4000-8000-000000000005');
select vc_true(auth.uid() = '77777777-0000-4000-8000-000000000005', 'ops JWT actor is active');
select vc_true(private.is_ops(), 'appointed ops fixture is active');
select vc_true((select count(*) = 4 from public.ops_driver_documents(
  '77777777-0000-4000-8000-000000000001')), 'ops sees four document rows');
select vc_true((select count(*) = 4 from storage.objects
  where bucket_id = 'driver-verification'), 'ops can read private photos');
select vc_reject($$select public.ops_verify_driver('77777777-0000-4000-8000-000000000001', true)$$,
  'ops cannot verify without review');
select public.ops_review_driver_document(id, true, 'Photo and account checked')
  from public.ops_driver_documents('77777777-0000-4000-8000-000000000001');
select vc_reset();

select id as vc_truck_id from public.trucks
where owner_id = '77777777-0000-4000-8000-000000000001' \gset
select vc_actor('77777777-0000-4000-8000-000000000005');
select public.ops_verify_truck(:'vc_truck_id'::uuid, true);
select public.ops_verify_driver('77777777-0000-4000-8000-000000000001', true,
  'All four documents and truck checked');
select vc_reset();
select vc_true((select verified_at is not null from public.drivers
  where profile_id = '77777777-0000-4000-8000-000000000001'),
  'driver becomes verified only after document and truck review');

select vc_actor('77777777-0000-4000-8000-000000000001');
select vc_reject($$update public.trucks set plate = 'CHANGED'
  where owner_id = '77777777-0000-4000-8000-000000000001'$$,
  'verified truck details cannot be self-edited');
select vc_reject($$delete from public.trucks
  where owner_id = '77777777-0000-4000-8000-000000000001'$$,
  'verified truck cannot be self-deleted');
select vc_reset();

insert into public.loads(id, shipper_id, origin_city, dest_city, pickup_from,
  pickup_to, goods_description, status)
select '77777777-2222-4222-8222-000000000001',
  '77777777-0000-4000-8000-000000000003', a.id, b.id,
  current_date + 2, current_date + 3, 'Case cargo', 'posted'
from public.cities a cross join public.cities b
where a.name_en = 'Muscat' and b.name_en = 'Salalah';

select vc_actor('77777777-0000-4000-8000-000000000004');
select vc_reject($$select public.request_load_cancellation(
  '77777777-2222-4222-8222-000000000001', 'Please cancel this shipment')$$,
  'other shipper cannot cancel load');
select vc_reject($$select public.report_shipment_problem(
  '77777777-2222-4222-8222-000000000001', null, 'delay', 'Shipment is late')$$,
  'other shipper cannot report on load');
select vc_reject($$select public.report_shipment_problem(
  '77777777-2222-4222-8222-000000000001', null, 'cancel_request', 'Please cancel this load')$$,
  'report endpoint cannot bypass the cancellation flow');
select vc_reject($$select * from public.ops_shipment_cases()$$,
  'non-ops cannot read cross-tenant queue');
select vc_reset();

select vc_actor('77777777-0000-4000-8000-000000000003');
select vc_reject($$select public.report_shipment_problem(
  '77777777-2222-4222-8222-000000000001', null, 'cancel_request', 'Please cancel this load')$$,
  'owner must use cancellation endpoint');
select vc_true(public.request_load_cancellation(
  '77777777-2222-4222-8222-000000000001', 'No longer need this shipment'),
  'unassigned shipper load cancels now');
select vc_true((select count(*) = 1 from public.my_shipment_cases(
  '77777777-2222-4222-8222-000000000001')), 'shipper sees own cancellation record');
select vc_reset();
select vc_true((select status = 'cancelled' from public.loads
  where id = '77777777-2222-4222-8222-000000000001'), 'load status changed to cancelled');

insert into public.loads(id, shipper_id, origin_city, dest_city, pickup_from,
  pickup_to, goods_description, status)
select '77777777-2222-4222-8222-000000000002',
  '77777777-0000-4000-8000-000000000003', a.id, b.id,
  current_date + 2, current_date + 3, 'Assigned case cargo', 'assigned'
from public.cities a cross join public.cities b
where a.name_en = 'Muscat' and b.name_en = 'Salalah';
insert into public.trips(id, load_id, driver_id, truck_id, status)
values ('77777777-3333-4333-8333-000000000001',
  '77777777-2222-4222-8222-000000000002',
  '77777777-0000-4000-8000-000000000001', :'vc_truck_id'::uuid, 'assigned');

select vc_actor('77777777-0000-4000-8000-000000000003');
select vc_true(not public.request_load_cancellation(
  '77777777-2222-4222-8222-000000000002', 'Driver cannot collect now'),
  'assigned load cancellation becomes a dispatch case');
select vc_reset();
select vc_true((select status = 'assigned' from public.loads
  where id = '77777777-2222-4222-8222-000000000002'),
  'assigned load remains active until dispatch decides');

select vc_actor('77777777-0000-4000-8000-000000000001');
select public.report_shipment_problem(null, '77777777-3333-4333-8333-000000000001',
  'breakdown', 'Truck stopped near Muscat') is not null;
select vc_reset();
select vc_actor('77777777-0000-4000-8000-000000000005');
select vc_true((select count(*) = 2 from public.ops_shipment_cases(true)),
  'ops queue holds both open assigned-load cases');
select public.ops_resolve_shipment_case(id, 'Dispatcher spoke to both parties')
from public.ops_shipment_cases(true);
select vc_true((select count(*) = 0 from public.ops_shipment_cases(true)),
  'resolved cases leave the open queue');
select vc_reset();

-- Existing dispatch actions must not bypass an auction, even though ops does
-- not expose bidding details yet. Use a case fixture that has no trip.
update public.loads set pricing_mode = 'bid', bid_deadline = now() + interval '1 hour',
  status = 'matched', price_baisa = null
where id = '77777777-2222-4222-8222-000000000001';
insert into private.bid_loads(load_id, fee_bps)
values ('77777777-2222-4222-8222-000000000001', 0);
select vc_actor('77777777-0000-4000-8000-000000000005');
select vc_reject($$select public.ops_set_price(
  '77777777-2222-4222-8222-000000000001', 10000)$$,
  'ops cannot overwrite bidding price');
select vc_reject($$select public.ops_send_offer(
  '77777777-2222-4222-8222-000000000001',
  '77777777-0000-4000-8000-000000000001', null)$$,
  'ops cannot send fixed-price offer for auction');
select vc_reject($$select public.ops_set_load_status(
  '77777777-2222-4222-8222-000000000001', 'assigned', 'Trying to bypass bidding')$$,
  'ops cannot assign an unawarded auction');
select vc_reset();
select vc_true((select price_baisa is null and status = 'matched' from public.loads
  where id = '77777777-2222-4222-8222-000000000001'),
  'rejected ops actions leave bidding state intact');
select vc_actor('77777777-0000-4000-8000-000000000005');
select public.ops_set_load_status('77777777-2222-4222-8222-000000000001',
  'cancelled', 'Dispatcher cancelled the auction');
select vc_reset();
select vc_true((select status = 'cancelled' from public.loads
  where id = '77777777-2222-4222-8222-000000000001'),
  'ops can still cancel an auction');

select vc_true(not has_function_privilege('authenticated',
  'private.ops_set_price_pre_bidding(uuid,bigint)', 'execute'),
  'clients cannot invoke the unguarded pricing implementation');
select vc_actor('77777777-0000-4000-8000-000000000005');
select public.ops_set_load_status('77777777-2222-4222-8222-000000000002',
  'cancelled', 'Dispatcher confirmed cancellation');
select vc_reset();
select vc_true((select status = 'cancelled' from public.trips
  where id = '77777777-3333-4333-8333-000000000001'),
  'fixed-price ops handling preserves trip cancellation cascade');
select vc_true(exists (select 1 from private.ops_audit
  where action = 'ops_set_load_status' and target_id = '77777777-2222-4222-8222-000000000002'),
  'delegated ops action still records its audit');

do $$ begin raise notice 'VERIFICATION AND CASE ASSERTIONS HELD'; end $$;
rollback;
