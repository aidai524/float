-- ============================================================
-- 0017_accounts_alerts.sql
-- Phase 8：账号 / Watchlist / 个性化告警
--
-- 设计：
--   - 用户侧数据放 public schema + RLS（仅本人可读写），前端用 anon key + 登录态访问
--   - 派发侧（VPS daily）用 service role 读 watchlists / alert_prefs，写 alert_log 去重
--   - 公共研究数据仍只读 api.* 契约视图，不受影响
-- ============================================================

-- ---------- 关注列表（代币级） ----------
create table if not exists public.watchlists (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_symbol text not null,
  created_at   timestamptz not null default now(),
  unique (user_id, token_symbol)
);

alter table public.watchlists enable row level security;

drop policy if exists watchlists_own on public.watchlists;
create policy watchlists_own on public.watchlists
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.watchlists to authenticated;
grant usage, select on sequence public.watchlists_id_seq to authenticated;

-- ---------- 告警偏好（每用户一行） ----------
create table if not exists public.alert_prefs (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  telegram_chat_id text,
  enabled          boolean not null default true,
  horizons         int[]   not null default '{7,3,1}',  -- T-7 / T-3 / T-1（天）
  updated_at       timestamptz not null default now()
);

alter table public.alert_prefs enable row level security;

drop policy if exists alert_prefs_own on public.alert_prefs;
create policy alert_prefs_own on public.alert_prefs
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.alert_prefs to authenticated;

-- ---------- 告警发送记录（去重；service role 专用） ----------
create table if not exists public.alert_log (
  id       bigserial primary key,
  user_id  uuid not null,
  event_id bigint not null references events(id) on delete cascade,
  kind     text not null,            -- 't-7' | 't-3' | 't-1' | 'post'
  sent_at  timestamptz not null default now(),
  unique (user_id, event_id, kind)
);

create index if not exists idx_alert_log_user on public.alert_log (user_id, sent_at desc);

-- 普通用户/匿名不可见（仅 service role 使用）
revoke all on public.alert_log from anon, authenticated;
