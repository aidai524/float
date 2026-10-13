-- ============================================================
-- 0019_api_keys.sql
-- Phase 10.1：公开 API 的 key 与计量
--
-- 设计：
--   - key 只存 SHA-256 哈希（明文仅创建时展示一次）
--   - 匿名仍可访问（边缘缓存兜底）；带 key 的请求按 key 计量（Analytics Engine）
--   - 表不进契约层；只有 service role / Worker 可读（RLS 关闭 + 显式 revoke）
-- ============================================================

create table if not exists public.api_keys (
  id           bigserial primary key,
  name         text not null,
  email        text,
  key_hash     text not null unique,
  plan         text not null default 'free',
  revoked      boolean not null default false,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_api_keys_hash on public.api_keys (key_hash) where revoked = false;

revoke all on public.api_keys from anon, authenticated;
