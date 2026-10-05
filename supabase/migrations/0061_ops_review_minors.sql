-- 0061 · Ops console v2: the review minors.
--
-- 1. A person's history shows each thing once: a staff note, a console
--    verification and a suspension were each listed twice. Its load scan is
--    scoped to the person.
-- 2. See as user also swaps request.jwt.claim (auth.jwt() reads it first) and
--    is rate limited; the staff-account lookup is rate limited too.
-- 3. Alerts keep their sentence (already free of names, phones and cargo —
--    0048), so the alert log can say what happened instead of raw JSON.
-- 4. ops_audit_facets(): the audit log's filters list what actually exists.

-- ═══ 1. history ══════════════════════════════════════════════════════════════
create or replace function private.person_history(p_id uuid)
returns table (at timestamptz, key text, kind text, title text, detail text,
               target_kind text, target_id text, actor text)
language sql
stable
security definer
set search_path = ''
as $$
  -- Only this person's loads: theirs as shipper, or ones they were offered,
  -- bid on or carried. (0059 joined every load in the system.)
  with routes as (
    select l.id, l.shipper_id, l.created_at, l.accepted_at, l.status,
           o.name_en || ' → ' || d.name_en as route
      from public.loads l
      join public.cities o on o.id = l.origin_city
      join public.cities d on d.id = l.dest_city
     where l.shipper_id = p_id
        or l.id in (select o2.load_id from public.offers o2 where o2.driver_id = p_id)
        or l.id in (select b2.load_id from private.driver_bids b2 where b2.driver_id = p_id)
        or l.id in (select t2.load_id from public.trips t2 where t2.driver_id = p_id)
  ),
  my_trips as (
    select t.id, t.created_at, r.route
      from public.trips t join routes r on r.id = t.load_id
     where t.driver_id = p_id or r.shipper_id = p_id
  )
  -- shipper: loads posted and prices accepted
  select r.created_at, 'load_posted:' || r.id, 'load_posted', 'Posted a load: ' || r.route,
         r.status::text, 'load', r.id::text, null::text
    from routes r where r.shipper_id = p_id
  union all
  select r.accepted_at, 'quote_accepted:' || r.id, 'quote_accepted', 'Accepted the price: ' || r.route,
         null, 'load', r.id::text, null
    from routes r where r.shipper_id = p_id and r.accepted_at is not null
  -- driver: offers (no response timestamp exists, so the offer's own time and its outcome)
  union all
  select o.created_at, 'offer:' || o.id,
         case o.status when 'pending'::public.offer_status then 'offer_sent' else 'offer_' || o.status::text end,
         case o.status
           when 'pending'::public.offer_status then 'Offered a load: '
           when 'accepted'::public.offer_status then 'Accepted a load: '
           when 'declined'::public.offer_status then 'Declined a load: '
           else 'Offer closed: ' end || r.route,
         case o.source when 'bid' then 'invited to bid' when 'auto' then 'automatic dispatch' else 'sent by a dispatcher' end,
         'load', o.load_id::text, null
    from public.offers o join routes r on r.id = o.load_id
   where o.driver_id = p_id
  union all
  select b.created_at, 'bid_placed:' || b.id, 'bid_placed', 'Bid on a load: ' || r.route,
         null, 'load', b.load_id::text, null
    from private.driver_bids b join routes r on r.id = b.load_id
   where b.driver_id = p_id
  -- both: trips and what happened on them
  union all
  select t.created_at, 'trip_started:' || t.id, 'trip_started', 'Took the job: ' || t.route,
         null, 'trip', t.id::text, null
    from my_trips t
  union all
  select e.occurred_at, 'trip_event:' || e.id, 'trip_event', initcap(replace(e.type, '_', ' ')) || ': ' || t.route,
         e.note, 'trip', t.id::text, null
    from public.trip_events e join my_trips t on t.id = e.trip_id
   -- A note staff added is already a staff action (ops_add_trip_note).
   where not (e.type = 'note' and exists (select 1 from private.ops_users ou where ou.profile_id = e.created_by))
  union all
  select ra.created_at, 'rating:' || ra.trip_id, 'rating',
         case when ra.driver_id = p_id then 'Was rated ' else 'Gave ' end || ra.stars || ' stars',
         null, 'trip', ra.trip_id::text, null
    from public.ratings ra where ra.driver_id = p_id or ra.shipper_id = p_id
  -- account
  union all
  select dd.created_at, 'document_submitted:' || dd.id, 'document_submitted',
         'Sent a document: ' || replace(dd.kind, '_', ' '), null, 'document', p_id::text, null
    from public.driver_documents dd where dd.driver_id = p_id
  union all
  select dd.reviewed_at, 'document_reviewed:' || dd.id, 'document_reviewed',
         'Document ' || dd.status || ': ' || replace(dd.kind, '_', ' '), dd.review_note,
         'document', p_id::text, null
    from public.driver_documents dd
   where dd.driver_id = p_id and dd.reviewed_at is not null and dd.status <> 'pending'
  union all
  select d.verified_at, 'verified:' || d.profile_id, 'verified', 'Verified as a driver',
         null, 'account', p_id::text, null
    from public.drivers d where d.profile_id = p_id and d.verified_at is not null
     -- Verified from the console: the staff action row says it, with who and why.
     and not exists (select 1 from private.ops_audit a where a.action = 'ops_verify_driver'
                      and a.target_kind = 'account' and a.target_id = p_id::text)
  union all
  select p.suspended_at, 'suspended:' || p.id, 'suspended', 'Suspended', p.suspended_reason,
         'account', p_id::text, null
    from public.profiles p where p.id = p_id and p.suspended_at is not null
     and not exists (select 1 from private.ops_audit a where a.action = 'ops_suspend_account'
                      and a.target_kind = 'account' and a.target_id = p_id::text)
  -- every staff action on them, their loads, trips, documents or trucks
  union all
  select a.created_at, 'staff_action:' || a.id, 'staff_action',
         initcap(replace(regexp_replace(a.action, '^ops_', ''), '_', ' ')), a.reason,
         a.target_kind, a.target_id, ap.full_name
    from private.ops_audit a
    left join public.profiles ap on ap.id = a.actor_id
   where (a.target_kind in ('account', 'profile') and a.target_id = p_id::text)
      or (a.target_kind = 'load' and a.target_id in (select r.id::text from routes r where r.shipper_id = p_id))
      or (a.target_kind = 'trip' and a.target_id in (select t.id::text from my_trips t))
      or (a.target_kind = 'driver_document'
          and a.target_id in (select dd.id::text from public.driver_documents dd where dd.driver_id = p_id))
      or (a.target_kind = 'truck'
          and a.target_id in (select tr.id::text from public.trucks tr where tr.owner_id = p_id))
      or (a.target_kind = 'offer'
          and a.target_id in (select o.id::text from public.offers o where o.driver_id = p_id))
      or (a.target_kind = 'leg'
          and a.target_id in (select lg.id::text from public.legs lg where lg.driver_id = p_id))
      -- A trip reassigned away from them no longer names them; its audit row's
      -- before-state still does, and that is the trace of why.
      or (a.target_kind in ('trip', 'load')
          and p_id::text in (a.before ->> 'driver_id', a.after ->> 'driver_id'));
$$;
revoke all on function private.person_history(uuid) from public, anon, authenticated;

-- ═══ 2. see as user, staff lookup ════════════════════════════════════════════
create or replace function public.ops_view_as(p_profile_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_owner      uuid := auth.uid();
  v_p          public.profiles;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_claims     text := current_setting('request.jwt.claims', true);
  v_claim_sub  text := current_setting('request.jwt.claim.sub', true);
  -- auth.jwt() reads request.jwt.claim BEFORE request.jwt.claims (0061).
  v_claim      text := current_setting('request.jwt.claim', true);
  v_view       jsonb;
begin
  perform private.require_owner_fresh();
  -- Every look emails the owners; 30 an hour is far beyond any real need.
  perform private.check_rate_limit('ops_view_as', 30, interval '1 hour');

  select * into v_p from public.profiles p
   where p.id = p_profile_id
     and not exists (select 1 from private.ops_users ou where ou.profile_id = p.id);
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'A reason is required' using errcode = 'check_violation';
  end if;

  perform private.log_ops('ops_view_as', 'account', v_p.id::text, null,
                          jsonb_build_object('role', v_p.role), v_reason);
  perform private.system_raise_alert('owner_view_as',
    -- Short id only: this text leaves by email and webhook, and no alert
    -- carries a name, phone or cargo (0048).
    format('Owner viewed the app as user %s. See ops_audit.', upper(left(v_p.id::text, 8))),
    jsonb_build_object('action', 'ops_view_as', 'owner_id', v_owner, 'profile_id', v_p.id));

  begin
    perform set_config('request.jwt.claims',
      jsonb_build_object('sub', v_p.id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    perform set_config('request.jwt.claim.sub', v_p.id::text, true);
    perform set_config('request.jwt.claim',
      jsonb_build_object('sub', v_p.id, 'role', 'authenticated', 'aal', 'aal1')::text, true);

    if v_p.role = 'driver'::public.user_role then
      v_view := jsonb_build_object(
        'role', 'driver',
        'offers', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_offers() x),
        'bid_invites', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_bid_invites() x),
        'active_trips', (select coalesce(jsonb_agg(to_jsonb(x) order by t.created_at desc), '[]'::jsonb)
                           from public.trips t, lateral public.driver_trip(t.id) x
                          where t.driver_id = v_p.id
                            and t.status in ('assigned'::public.trip_status, 'in_transit'::public.trip_status)),
        'past_trips', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_trips() x),
        'earnings', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_earnings() x),
        'documents', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.driver_document_status() x));
    else
      -- The shipper app reads its loads straight from public.loads under RLS,
      -- not through a function: the same columns (src/lib/queries.ts
      -- LOAD_COLUMNS), scoped explicitly to this shipper.
      v_view := jsonb_build_object(
        'role', 'shipper',
        'loads', (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
                    from (select l.id, l.origin_city, l.dest_city, l.pickup_from, l.pickup_to, l.weight_kg,
                                 l.truck_type_code, l.goods_description, l.status, l.price_baisa, l.currency,
                                 l.created_at, l.pricing_mode, l.bid_deadline
                            from public.loads l where l.shipper_id = v_p.id) x),
        'bids', (select coalesce(jsonb_object_agg(l.id::text, jsonb_build_object(
                    'status', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.shipper_bid_status(l.id) s),
                    'bids', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from public.shipper_load_bids(l.id) b))),
                    '{}'::jsonb)
                   from public.loads l
                  where l.shipper_id = v_p.id and l.pricing_mode = 'bid'
                    and l.status not in ('delivered'::public.load_status, 'closed'::public.load_status,
                                         'cancelled'::public.load_status)));
    end if;

    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
    perform set_config('request.jwt.claim', coalesce(v_claim, ''), true);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
    perform set_config('request.jwt.claim', coalesce(v_claim, ''), true);
    raise;
  end;

  if auth.uid() is distinct from v_owner then
    raise exception 'identity was not restored' using errcode = 'internal_error';
  end if;

  return jsonb_build_object(
    'viewed_at', now(),
    'account', jsonb_build_object('id', v_p.id, 'full_name', v_p.full_name, 'role', v_p.role),
    'view', v_view);
end;
$$;
revoke all on function public.ops_view_as(uuid, text) from public, anon;
grant execute on function public.ops_view_as(uuid, text) to authenticated;

create or replace function public.ops_find_staff_account(p_email text)
returns table (profile_id uuid, full_name text, email text, has_profile boolean,
               account_ok boolean, staff_level text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_owner();
  -- It answers "does this email have an account?"; 60 an hour is plenty.
  perform private.check_rate_limit('ops_find_staff_account', 60, interval '1 hour');
  return query
  select u.id, p.full_name, u.email::text, p.id is not null,
         p.id is not null and private.staff_account_ok(u.id),
         o.level
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join private.ops_users o on o.profile_id = u.id
   where lower(u.email) = lower(btrim(coalesce(p_email, '')));
  if not found then
    raise exception 'not found' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function public.ops_find_staff_account(text) from public, anon;
grant execute on function public.ops_find_staff_account(text) to authenticated;

-- ═══ 3. alert text ═══════════════════════════════════════════════════════════
alter table private.ops_alerts add column if not exists text text;

create or replace function private.system_raise_alert(p_kind text, p_text text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url        text := private.setting_text('alert_webhook_url');
  v_to         text := private.setting_text('alert_email_to');
  v_from       text := coalesce(private.setting_text('alert_email_from'),
                                'Truckkoo alerts <onboarding@resend.dev>');
  v_key        text;
  v_request_id bigint;
  v_email_id   bigint;
begin
  if v_url is not null then
    select net.http_post(
      url     := v_url,
      body    := jsonb_build_object('text', p_text),
      headers := '{"Content-Type": "application/json"}'::jsonb
    ) into v_request_id;
  end if;

  if v_to is not null then
    select s.decrypted_secret into v_key
      from vault.decrypted_secrets s
     where s.name = 'resend_api_key';
  end if;

  if v_to is not null and v_key is not null then
    select net.http_post(
      url     := 'https://api.resend.com/emails',
      body    := jsonb_build_object(
                   'from',    v_from,
                   'to',      (select coalesce(jsonb_agg(btrim(a)), '[]'::jsonb)
                                 from unnest(string_to_array(v_to, ',')) a
                                where btrim(a) <> ''),
                   -- The first line is the headline every caller writes; a
                   -- phone's inbox shows the subject and little else.
                   'subject', '[Truckkoo] ' || left(split_part(p_text, E'\n', 1), 120),
                   'text',    p_text),
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer ' || v_key)
    ) into v_email_id;
  end if;

  insert into private.ops_alerts (kind, detail, request_id, email_request_id, text)
  values (p_kind, p_detail, v_request_id, v_email_id, left(p_text, 1000));
end;
$$;
revoke all on function private.system_raise_alert(text, text, jsonb) from public, anon, authenticated;

drop function public.ops_alert_log(boolean, integer, integer);
create function public.ops_alert_log(
  p_open_only boolean default false,
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns table (id bigint, kind text, detail jsonb, created_at timestamptz,
               acknowledged_at timestamptz, acknowledged_by_name text, total_count bigint, text text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform private.require_ops();
  return query
  select a.id, a.kind, a.detail, a.created_at, a.acknowledged_at, p.full_name, count(*) over (), a.text
    from private.ops_alerts a
    left join public.profiles p on p.id = a.acknowledged_by
   where not coalesce(p_open_only, false) or a.acknowledged_at is null
   order by a.created_at desc, a.id desc
   limit v_limit offset v_offset;
end;
$$;
revoke all on function public.ops_alert_log(boolean, integer, integer) from public, anon;
grant execute on function public.ops_alert_log(boolean, integer, integer) to authenticated;

-- ═══ 4. audit facets ═════════════════════════════════════════════════════════
create or replace function public.ops_audit_facets()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return jsonb_build_object(
    'actions', (select coalesce(jsonb_agg(x.action order by x.action), '[]'::jsonb)
                  from (select distinct a.action from private.ops_audit a) x),
    'target_kinds', (select coalesce(jsonb_agg(x.target_kind order by x.target_kind), '[]'::jsonb)
                       from (select distinct a.target_kind from private.ops_audit a where a.target_kind is not null) x),
    'actors', (select coalesce(jsonb_agg(jsonb_build_object('id', x.actor_id, 'name', p.full_name)
                                         order by p.full_name nulls last), '[]'::jsonb)
                 from (select distinct a.actor_id from private.ops_audit a where a.actor_id is not null) x
                 left join public.profiles p on p.id = x.actor_id));
end;
$$;
revoke all on function public.ops_audit_facets() from public, anon;
grant execute on function public.ops_audit_facets() to authenticated;
