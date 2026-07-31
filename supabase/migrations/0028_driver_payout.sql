-- ═══════════════════════════════════════════════════════════════════════════
-- 0028 · The driver's payout, and the rate that decides it
-- ═══════════════════════════════════════════════════════════════════════════
--
-- P5 introduces a margin: the shipper pays a price, the driver keeps a share of
-- it and owes Truckkoo the difference. The share is derived, never stored on an
-- offer — a payout written down beside a price drifts from it the first time
-- somebody re-prices a load, and then two screens disagree about what a person
-- is owed.
--
-- THE RATE SHIPS AT ZERO. A commission invented in a migration is a number
-- quoted to a driver the first time somebody forgets it was a placeholder —
-- exactly the rule the rate card follows (`CLAUDE.md` §3b, `STACK.md` §2c). Until
-- a dispatcher sets one from the console, `payout_for(price) = price` and the
-- driver keeps everything.
--
-- What this is NOT: a secret from the driver. They collect the shipper's price
-- in cash and keep a share, so both numbers are on their screen by design and
-- the margin follows by subtraction. See the P5 spec §2 — an earlier draft tried
-- to hide the price from drivers *and* show them what to collect, which are the
-- same number. What is actually protected is the rate CARD, closed in 0030.

insert into private.app_settings (key, value)
values ('commission_pct', '0'::jsonb)
on conflict (key) do nothing;

create or replace function private.commission_pct()
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce((value #>> '{}')::numeric, 0)
  from private.app_settings where key = 'commission_pct';
$$;

revoke all on function private.commission_pct() from public, anon, authenticated;

-- What the driver keeps.
--
-- ROUNDS DOWN, deliberately. Rounding up would hand the driver a baisa the
-- shipper never paid, and across enough loads that is a real number coming out
-- of nowhere. Down means the margin absorbs the remainder, which is the only
-- direction that cannot invent money.
create or replace function private.payout_for(p_price_baisa bigint)
returns bigint
language sql
stable
set search_path = ''
as $$
  select case
    when p_price_baisa is null then null
    else greatest(0, floor(p_price_baisa * (100 - private.commission_pct()) / 100)::bigint)
  end;
$$;

revoke all on function private.payout_for(bigint) from public, anon, authenticated;

-- ─── the dispatcher sets it, and says why ───────────────────────────────────
-- Same shape as every rate-card edit: guarded by require_ops(), bounded, and
-- audited with a reason. This decides what a person is paid for a day's work,
-- so "who changed it and why" is not optional.

create or replace function public.ops_set_commission(p_pct numeric, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_before numeric;
begin
  perform private.require_ops();

  -- 40 is not a business ceiling, it is a slipped-decimal catch: someone typing
  -- 1875 for 18.75 should get an error, not a driver working for nothing.
  if p_pct is null or p_pct < 0 or p_pct > 40 then
    raise exception 'commission must be between 0 and 40 percent'
      using errcode = 'check_violation';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'a commission change needs a reason'
      using errcode = 'check_violation';
  end if;

  v_before := private.commission_pct();

  insert into private.app_settings (key, value)
  values ('commission_pct', to_jsonb(p_pct))
  on conflict (key) do update set value = to_jsonb(p_pct);

  perform private.log_ops(
    'ops_set_commission', 'setting', 'commission_pct',
    jsonb_build_object('pct', v_before),
    jsonb_build_object('pct', p_pct),
    p_reason);
end;
$$;

comment on function public.ops_set_commission(numeric, text) is
  'Sets the share Truckkoo keeps of a load price. Ops only, bounded 0-40, '
  'audited with a reason. Payout is derived from this and never stored.';

revoke all on function public.ops_set_commission(numeric, text) from public, anon;
grant execute on function public.ops_set_commission(numeric, text) to authenticated;

-- ─── and reads it back, so the console can show what is in force ────────────
-- The console needs the current rate to render the panel. It is not secret from
-- a dispatcher — they set it — but it has no business reaching a shipper or a
-- driver, so it goes through require_ops() like every other ops read.

create or replace function public.ops_commission()
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_ops();
  return private.commission_pct();
end;
$$;

revoke all on function public.ops_commission() from public, anon;
grant execute on function public.ops_commission() to authenticated;
