-- 0046 · Push notifications.
--
-- Until now a driver saw a job only while the app was open (offers poll every
-- 15 s) and a shipper was never told a price had arrived. The founder's call,
-- 2026-10-04: push for
--   * a driver — a new job (bid invitation or offer), and getting the job;
--   * a shipper — a price arriving (a bid, the proposal when prices close, or a
--     fixed price set by a dispatcher), a driver assigned, picked up, delivered.
--
-- HOW: the app registers its Expo push token through `register_push_token`.
-- Database triggers compose the message in the recipient's language and hand it
-- to Expo's push service through pg_net — asynchronous, after commit, the same
-- path 0034's alerts take. No service-role key, no Edge Function.
--
-- THREE RULES the code below keeps:
--   1. A push never breaks the thing that caused it. Every send swallows its own
--      errors; an award must not roll back because Expo was down.
--   2. Nothing intermediate buzzes. The triggers are DEFERRED to commit and
--      re-read the row: award_bid briefly sets the winner's offer back to
--      `pending` before accept_offer accepts it, and without this the winner
--      would be told "new job" a moment before "you got the job".
--   3. The lock screen is public. Messages name cities and amounts — never
--      cargo, never a person's name, never a phone.

create table private.push_tokens (
  token       text primary key
              check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$'),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  platform    text not null check (platform in ('android', 'ios')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index push_tokens_profile_idx on private.push_tokens(profile_id);
alter table private.push_tokens enable row level security;
alter table private.push_tokens force row level security;
revoke all on table private.push_tokens from anon, authenticated;

-- What was sent, to whom, about what. Also the throttle for price pushes.
create table private.push_log (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null,
  kind        text not null,
  load_id     uuid,
  recipients  integer not null default 0,
  request_id  bigint,
  created_at  timestamptz not null default now()
);
create index push_log_throttle_idx on private.push_log(load_id, kind, created_at desc);
alter table private.push_log enable row level security;
alter table private.push_log force row level security;
revoke all on table private.push_log from anon, authenticated;

insert into private.app_settings (key, value) values
  ('push_enabled',              'true'::jsonb),
  -- At most one "new price" buzz per load in this window; the shipper sees
  -- every price when they open the app anyway.
  ('push_bid_throttle_minutes', '5'::jsonb),
  ('push_tokens_per_profile',   '5'::jsonb)
on conflict (key) do nothing;

/* ─── registering a phone ─────────────────────────────────────────────────── */

create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_keep  integer := private.setting_int('push_tokens_per_profile', 5);
begin
  if v_actor is null or private.actor_role() is null then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  perform private.check_rate_limit('register_push_token', 30, interval '1 hour');
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$'
     or p_platform is null or p_platform not in ('android', 'ios') then
    raise exception 'invalid push token' using errcode = 'check_violation';
  end if;
  -- A shared phone moves to whoever signed in last: the token is the device,
  -- and the device now belongs to this account.
  insert into private.push_tokens(token, profile_id, platform)
  values (p_token, v_actor, p_platform)
  on conflict (token) do update
    set profile_id = excluded.profile_id, platform = excluded.platform, updated_at = now();
  -- A handful of phones per person, newest first; old installs fall off.
  delete from private.push_tokens t
  where t.profile_id = v_actor
    and t.token not in (
      select k.token from private.push_tokens k where k.profile_id = v_actor
      order by k.updated_at desc limit v_keep);
end;
$$;
revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- Called before sign-out, so a shared phone stops receiving this account's pushes.
create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;
  delete from private.push_tokens t where t.token = p_token and t.profile_id = auth.uid();
end;
$$;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

/* ─── composing ───────────────────────────────────────────────────────────── */

-- "Muscat → Sohar", or "مسقط ← صحار" — the arrow points the way the line reads.
create or replace function private.push_route(p_load_id uuid, p_lang text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_lang = 'ar' then o.name_ar || ' ← ' || d.name_ar
              else o.name_en || ' → ' || d.name_en end
  from public.loads l
  join public.cities o on o.id = l.origin_city
  join public.cities d on d.id = l.dest_city
  where l.id = p_load_id;
$$;
revoke all on function private.push_route(uuid, text) from public, anon, authenticated;

create or replace function private.push_city(p_city_id bigint, p_lang text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_lang = 'ar' then c.name_ar else c.name_en end
  from public.cities c where c.id = p_city_id;
$$;
revoke all on function private.push_city(bigint, text) from public, anon, authenticated;

-- Integer baisa to "110.000 OMR" / "١١٠٫٠٠٠ ر.ع.". Three decimals, always: OMR
-- is a three-decimal currency, and the app's own formatter says the same.
create or replace function private.push_money(p_baisa bigint, p_lang text)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_baisa is null then null
    when p_lang = 'ar' then
      translate(to_char(p_baisa / 1000, 'FM999,999,990') || '.' || lpad((p_baisa % 1000)::text, 3, '0'),
                '0123456789.,', '٠١٢٣٤٥٦٧٨٩٫٬') || ' ر.ع.'
    else to_char(p_baisa / 1000, 'FM999,999,990') || '.' || lpad((p_baisa % 1000)::text, 3, '0') || ' OMR'
  end;
$$;
revoke all on function private.push_money(bigint, text) from public, anon, authenticated;

/* ─── sending ─────────────────────────────────────────────────────────────── */

-- One person, every phone they have registered. Never raises: a failed push is
-- a warning in the log, not a rolled-back award.
create or replace function private.push_send(
  p_profile uuid, p_kind text, p_load_id uuid,
  p_title_en text, p_body_en text, p_title_ar text, p_body_ar text,
  p_data jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lang  text;
  v_msgs  jsonb;
  v_count integer;
  v_req   bigint;
  v_token text := private.setting_text('expo_push_access_token');
begin
  if not private.setting_bool('push_enabled', true) then return; end if;
  select p.language::text into v_lang from public.profiles p where p.id = p_profile;
  select jsonb_agg(jsonb_build_object(
           'to', t.token,
           'title', case when v_lang = 'ar' then p_title_ar else p_title_en end,
           'body',  case when v_lang = 'ar' then p_body_ar  else p_body_en  end,
           'data', p_data,
           'sound', 'default',
           'channelId', 'default',
           'priority', 'high')),
         count(*)
    into v_msgs, v_count
  from private.push_tokens t where t.profile_id = p_profile;

  if v_count > 0 then
    select net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      body    := v_msgs,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json')
                 || case when v_token is null then '{}'::jsonb
                         else jsonb_build_object('Authorization', 'Bearer ' || v_token) end
    ) into v_req;
  end if;
  insert into private.push_log(profile_id, kind, load_id, recipients, request_id)
  values (p_profile, p_kind, p_load_id, coalesce(v_count, 0), v_req);
exception when others then
  raise warning 'push % to % failed: %', p_kind, p_profile, sqlstate;
end;
$$;
revoke all on function private.push_send(uuid, text, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;

/* ─── driver: a new job ───────────────────────────────────────────────────── */

create or replace function private.push_on_offer()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_offer public.offers;
  v_route text;
begin
  if tg_op = 'UPDATE' and old.status = 'pending' then return null; end if;
  -- Re-read at commit: only an offer still open is news.
  select * into v_offer from public.offers o where o.id = new.id;
  if v_offer.id is null or v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return null;
  end if;
  v_route := private.push_route(v_offer.load_id, 'en');
  if v_offer.source = 'bid' then
    perform private.push_send(v_offer.driver_id, 'driver_new_bid', v_offer.load_id,
      'New job', 'Name your price: ' || v_route,
      'عمل جديد', 'حدّد سعرك: ' || private.push_route(v_offer.load_id, 'ar'),
      jsonb_build_object('kind', 'driver_new_job', 'offer_id', v_offer.id, 'bid', true));
  else
    perform private.push_send(v_offer.driver_id, 'driver_new_offer', v_offer.load_id,
      'New job', v_route || ' — open Truckkoo to take it.',
      'عمل جديد', private.push_route(v_offer.load_id, 'ar') || ' — افتح تركو لتقبله.',
      jsonb_build_object('kind', 'driver_new_job', 'offer_id', v_offer.id, 'bid', false));
  end if;
  return null;
exception when others then
  raise warning 'push_on_offer: %', sqlstate;
  return null;
end;
$$;
revoke all on function private.push_on_offer() from public, anon, authenticated;

create constraint trigger push_on_offer
  after insert or update of status on public.offers
  deferrable initially deferred
  for each row when (new.status = 'pending')
  execute function private.push_on_offer();

/* ─── shipper: a new price on a bid load ──────────────────────────────────── */

create or replace function private.push_on_bid()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_shipper uuid;
  v_fee     integer;
  v_total   bigint;
begin
  select l.shipper_id, bl.fee_bps into v_shipper, v_fee
  from public.loads l join private.bid_loads bl on bl.load_id = l.id
  where l.id = new.load_id and l.selected_bid_id is null
    and l.status in ('posted'::public.load_status, 'matched'::public.load_status);
  if v_shipper is null then return null; end if;
  if exists (
    select 1 from private.push_log g
    where g.load_id = new.load_id and g.kind = 'shipper_new_price'
      and g.created_at > now() - make_interval(mins => private.setting_int('push_bid_throttle_minutes', 5))
  ) then
    return null;
  end if;
  v_total := private.bid_total(new.payout_baisa, v_fee);
  perform private.push_send(v_shipper, 'shipper_new_price', new.load_id,
    'New price', private.push_money(v_total, 'en') || ' for ' || private.push_route(new.load_id, 'en'),
    'سعر جديد', private.push_money(v_total, 'ar') || ' لـ ' || private.push_route(new.load_id, 'ar'),
    jsonb_build_object('kind', 'shipper_load', 'load_id', new.load_id));
  return null;
exception when others then
  raise warning 'push_on_bid: %', sqlstate;
  return null;
end;
$$;
revoke all on function private.push_on_bid() from public, anon, authenticated;

create constraint trigger push_on_bid
  after insert on private.driver_bids
  deferrable initially deferred
  for each row execute function private.push_on_bid();

/* ─── both: where the load has got to ─────────────────────────────────────── */

create or replace function private.push_on_load_status()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_load   public.loads;
  v_driver uuid;
  v_trip   uuid;
  v_amount bigint;
  v_data   jsonb;
begin
  -- Re-read at commit. If the load moved on again in the same transaction, the
  -- later move has its own event; this one is not news.
  select * into v_load from public.loads l where l.id = new.id;
  if v_load.id is null or v_load.status <> new.status then return null; end if;
  v_data := jsonb_build_object('kind', 'shipper_load', 'load_id', v_load.id);

  if v_load.status = 'quoted' then
    if v_load.pricing_mode = 'bid' then
      select private.bid_total(b.payout_baisa, bl.fee_bps) into v_amount
      from private.driver_bids b join private.bid_loads bl on bl.load_id = b.load_id
      where b.id = v_load.selected_bid_id;
      perform private.push_send(v_load.shipper_id, 'shipper_prices_closed', v_load.id,
        'Prices are in', 'Best price for ' || private.push_route(v_load.id, 'en') || ': '
                         || private.push_money(v_amount, 'en'),
        'وصلت الأسعار', 'أفضل سعر لـ ' || private.push_route(v_load.id, 'ar') || ': '
                         || private.push_money(v_amount, 'ar'),
        v_data);
    elsif v_load.price_baisa is not null then
      perform private.push_send(v_load.shipper_id, 'shipper_price_ready', v_load.id,
        'Your price is ready', private.push_money(v_load.price_baisa, 'en') || ' for '
                               || private.push_route(v_load.id, 'en'),
        'سعرك جاهز', private.push_money(v_load.price_baisa, 'ar') || ' لـ '
                     || private.push_route(v_load.id, 'ar'),
        v_data);
    end if;

  elsif v_load.status = 'assigned' then
    perform private.push_send(v_load.shipper_id, 'shipper_assigned', v_load.id,
      'A driver has your load', private.push_route(v_load.id, 'en'),
      'سائق استلم شحنتك', private.push_route(v_load.id, 'ar'),
      v_data);
    select t.id, t.driver_id into v_trip, v_driver
    from public.trips t where t.load_id = v_load.id
    order by t.created_at desc limit 1;
    if v_driver is not null then
      perform private.push_send(v_driver, 'driver_awarded', v_load.id,
        'You got the job', private.push_route(v_load.id, 'en') || ' — open Truckkoo for the pickup.',
        'حصلت على العمل', private.push_route(v_load.id, 'ar') || ' — افتح تركو لتفاصيل الاستلام.',
        jsonb_build_object('kind', 'driver_trip', 'trip_id', v_trip));
    end if;

  elsif v_load.status = 'in_transit' then
    perform private.push_send(v_load.shipper_id, 'shipper_picked_up', v_load.id,
      'Picked up', 'Your cargo is on its way to ' || private.push_city(v_load.dest_city, 'en') || '.',
      'تم الاستلام', 'شحنتك في الطريق إلى ' || private.push_city(v_load.dest_city, 'ar') || '.',
      v_data);

  elsif v_load.status = 'delivered' then
    perform private.push_send(v_load.shipper_id, 'shipper_delivered', v_load.id,
      'Delivered', 'Your cargo has arrived in ' || private.push_city(v_load.dest_city, 'en') || '.',
      'تم التسليم', 'وصلت شحنتك إلى ' || private.push_city(v_load.dest_city, 'ar') || '.',
      v_data);
  end if;
  return null;
exception when others then
  raise warning 'push_on_load_status: %', sqlstate;
  return null;
end;
$$;
revoke all on function private.push_on_load_status() from public, anon, authenticated;

create constraint trigger push_on_load_status
  after update of status on public.loads
  deferrable initially deferred
  for each row when (old.status is distinct from new.status)
  execute function private.push_on_load_status();
