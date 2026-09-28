-- ============================================================
-- 0003_canonical.sql
-- L2 黄金记录 + 溯源；L3 计算产物
-- 读侧只认 events；source_records 是内部实现，不对外暴露
-- ============================================================

-- ---------- 代币 ----------
create table if not exists tokens (
  id           bigserial primary key,
  symbol       text not null,
  name         text,
  coingecko_id text unique,
  chain        text,
  category     text,                         -- l1|l2|defi|meme|gaming|ai|...
  market_cap   numeric,
  adv_30d      numeric,                      -- 30 天日均成交额（流动性过滤）
  priority     int not null default 100,     -- 监控优先级
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists idx_tokens_symbol on tokens (symbol);

-- ---------- L2：黄金事件记录 ----------
create table if not exists events (
  id             bigserial primary key,
  event_type     text not null,              -- unlock_cliff|listing_cex|macro_fomc|...
  token_id       bigint references tokens(id),
  token_symbol   text not null,
  chain          text,
  t0             timestamptz not null,
  t0_confidence  text not null check (t0_confidence in ('high','medium','low')),
  magnitude_usd  numeric,
  magnitude_pct  numeric,
  title          text,
  detail         jsonb not null default '{}',
  primary_source text not null,
  source_count   int not null default 1,
  confidence     numeric not null default 0.6,
  dedupe_key     text not null unique,       -- 跨源黄金 key
  first_seen_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_events_type_t0 on events (event_type, t0);
create index if not exists idx_events_token_t0 on events (token_symbol, t0);
create index if not exists idx_events_t0 on events (t0);

-- ---------- L2：多对多溯源 ----------
create table if not exists event_provenance (
  event_id   bigint not null references events(id) on delete cascade,
  record_id  bigint not null references source_records(id) on delete cascade,
  source_id  text not null,
  is_primary boolean not null default false,
  primary key (event_id, record_id)
);
create index if not exists idx_prov_event on event_provenance (event_id);

-- ---------- L3：反应测量 ----------
create table if not exists event_reactions (
  id                  bigserial primary key,
  event_id            bigint not null references events(id) on delete cascade,
  price_source        text not null,
  base_price          numeric,
  base_ts             timestamptz,
  ret_5m              numeric,
  ret_15m             numeric,
  ret_1h              numeric,
  ret_4h              numeric,
  ret_24h             numeric,
  vol_5m              numeric,
  vol_1h              numeric,
  vol_ratio           numeric,
  max_drawdown        numeric,
  max_favorable       numeric,
  liquidity_ok        boolean not null default true,
  methodology_version text not null default 'v1',
  computed_at         timestamptz not null default now(),
  unique (event_id, price_source, methodology_version)
);
create index if not exists idx_reactions_event on event_reactions (event_id);

-- ---------- L3：事件特征向量（可比事件） ----------
create extension if not exists vector;
create table if not exists event_features (
  event_id     bigint primary key references events(id) on delete cascade,
  feature_vec  vector(32) not null,
  feature_json jsonb not null,
  created_at   timestamptz not null default now()
);
-- create index on event_features using ivfflat (feature_vec vector_cosine_ops);

-- ---------- 去重键生成（与 resolve.ts 保持一致的唯一实现） ----------
create or replace function canonical_dedupe_key(
  p_event_type text,
  p_token      text,
  p_t0         timestamptz,
  p_magnitude  numeric
) returns text
language sql immutable as $$
  select lower(coalesce(p_event_type,'')) || '|' ||
         lower(coalesce(p_token,'')) || '|' ||
         to_char(date_trunc('hour', p_t0), 'YYYYMMDDHH24') || '|' ||
         -- 规模分桶，容忍跨源的小数值差异
         case
           when p_magnitude is null then 'na'
           when p_magnitude < 100000 then 'lt100k'
           when p_magnitude < 1000000 then 'lt1m'
           when p_magnitude < 10000000 then 'lt10m'
           else 'gte10m'
         end;
$$;
