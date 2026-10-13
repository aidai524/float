-- ============================================================
-- 0022_crypto_billing.sql
-- Phase 9：Crypto（USDC）订阅
--
-- 流程：用户把 USDC 转到配置的收款地址 → 在 /account 提交 tx hash →
--   Worker 直接查链验证（ERC-20 Transfer：收款地址 / 金额 / 确认状态）→
--   apply_crypto_payment() 原子落库并续期 Pro。
--
-- 安全：
--   - crypto_payments 对 anon/authenticated 完全不可见（含 tx_hash，防重放靠唯一键）
--   - subscriptions 只允许本人 select；写只发生在 service role 的函数里
--   - 免费/Pro 的 Watchlist 限额用触发器在数据库层强制
-- ============================================================

create table if not exists public.subscriptions (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  tier        text not null default 'free',       -- free | pro
  method      text,                                -- usdc
  status      text not null default 'inactive',    -- active | expired | inactive
  price_usd   numeric,
  period_days int,
  chain       text,
  started_at  timestamptz,
  expires_at  timestamptz,
  updated_at  timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists subscriptions_read_own on public.subscriptions;
create policy subscriptions_read_own on public.subscriptions
  for select to authenticated
  using (auth.uid() = user_id);

grant select on public.subscriptions to authenticated;

-- 支付流水（service role 专用）
create table if not exists public.crypto_payments (
  id            bigserial primary key,
  user_id       uuid not null,
  chain         text not null,
  tx_hash       text not null,
  token_address text,
  amount_usdc   numeric,
  from_address  text,
  to_address    text,
  block_ts      timestamptz,
  verified_at   timestamptz not null default now(),
  raw           jsonb,
  unique (chain, tx_hash)
);

revoke all on public.crypto_payments from anon, authenticated;

-- 原子应用支付：写流水（唯一键防重放）+ 续期订阅；返回新的到期时间
create or replace function public.apply_crypto_payment(
  p_user_id  uuid,
  p_chain    text,
  p_tx_hash  text,
  p_amount   numeric,
  p_from     text,
  p_to       text,
  p_block_ts timestamptz,
  p_price    numeric,
  p_days     int,
  p_token    text,
  p_raw      jsonb
) returns timestamptz
language plpgsql security definer as $$
declare
  v_expires timestamptz;
begin
  insert into public.crypto_payments
    (user_id, chain, tx_hash, token_address, amount_usdc, from_address, to_address, block_ts, raw)
  values
    (p_user_id, p_chain, p_tx_hash, p_token, p_amount, p_from, p_to, p_block_ts, p_raw);

  select
    greatest(now(), coalesce(s.expires_at, now()))
      + make_interval(days => p_days)
  into v_expires
  from public.subscriptions s
  where s.user_id = p_user_id;

  if v_expires is null then
    v_expires := now() + make_interval(days => p_days);
  end if;

  insert into public.subscriptions
    (user_id, tier, method, status, price_usd, period_days, chain, started_at, expires_at, updated_at)
  values
    (p_user_id, 'pro', 'usdc', 'active', p_price, p_days, p_chain, now(), v_expires, now())
  on conflict (user_id) do update set
    tier = 'pro',
    method = 'usdc',
    status = 'active',
    price_usd = excluded.price_usd,
    period_days = excluded.period_days,
    chain = excluded.chain,
    expires_at = v_expires,
    updated_at = now();

  return v_expires;
exception
  when unique_violation then
    return null;  -- 同一 tx 重复提交：调用方返回 409
end;
$$;

grant execute on function public.apply_crypto_payment(
  uuid, text, text, numeric, text, text, timestamptz, numeric, int, text, jsonb
) to service_role;

-- Watchlist 限额：免费 5 / Pro 100（数据库层强制）
create or replace function public.enforce_watchlist_limit()
returns trigger
language plpgsql security definer as $$
declare
  v_tier  text;
  v_limit int;
  v_count int;
begin
  select s.tier into v_tier
  from public.subscriptions s
  where s.user_id = new.user_id
    and s.status = 'active'
    and s.expires_at > now();

  v_limit := case when v_tier = 'pro' then 100 else 5 end;

  select count(*) into v_count
  from public.watchlists w
  where w.user_id = new.user_id;

  if v_count >= v_limit then
    raise exception 'watchlist_limit_reached: %（% 档）', v_limit, coalesce(v_tier, 'free')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_watchlist_limit on public.watchlists;
create trigger trg_watchlist_limit
  before insert on public.watchlists
  for each row execute function public.enforce_watchlist_limit();
