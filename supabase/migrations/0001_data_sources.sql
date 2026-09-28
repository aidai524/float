-- ============================================================
-- 0001_data_sources.sql
-- L0 层配套：数据源注册表 + 采集日志
-- ============================================================

create table if not exists data_sources (
  id           text primary key,                 -- 'binance','coinmarketcal','fred'
  type         text not null,                    -- price|unlock|listing|macro|news|token
  auth         text not null default 'none',      -- none|api_key|header|query
  cost_tier    text not null default 'free',      -- free|paid
  priority     int  not null default 100,         -- 越小越优先（字段合并/降级用）
  rate_limit   jsonb,                             -- {rpm: 60, dailyQuota: 10000}
  refresh      text,                              -- '15m' | '1h' | '1d'
  fallback     text[] default '{}',               -- 回退源 id 顺序
  config       jsonb not null default '{}',       -- base_url / map / pagination
  enabled      boolean not null default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists ingest_runs (
  id          bigserial primary key,
  source_id   text references data_sources(id),
  entity      text,                               -- kline|event|token|news
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok_count    int not null default 0,
  fail_count  int not null default 0,
  error       text,
  meta        jsonb
);
create index if not exists idx_ingest_runs_source on ingest_runs (source_id, started_at desc);
