-- ============================================================
-- 0002_raw_and_records.sql
-- L0 Raw 落地（append-only） + L1 归一化记录
-- ============================================================

-- ---------- L0：原始响应，只增不改，可回放 ----------
create table if not exists raw_payloads (
  id           bigserial primary key,
  source_id    text not null,
  entity       text not null,
  fetched_at   timestamptz not null default now(),
  request      jsonb,
  payload      jsonb not null,
  payload_hash text not null,
  unique (source_id, entity, payload_hash)
);
create index if not exists idx_raw_payloads_source on raw_payloads (source_id, entity, fetched_at desc);

-- ---------- L1：每个源的影子记录 ----------
create table if not exists source_records (
  id            bigserial primary key,
  source_id     text not null references data_sources(id),
  raw_id        bigint references raw_payloads(id),
  record_type   text not null,                    -- event|kline|token
  ext_id        text,
  event_type    text,
  token_symbol  text,
  chain         text,
  t0            timestamptz,
  t0_confidence text check (t0_confidence in ('high','medium','low')),
  magnitude_usd numeric,
  magnitude_pct numeric,
  source_url    text,
  detail        jsonb not null default '{}',
  dedupe_key    text not null,
  ingested_at   timestamptz not null default now(),
  unique (source_id, record_type, dedupe_key)
);
create index if not exists idx_source_records_event on source_records (record_type, t0);
create index if not exists idx_source_records_token on source_records (token_symbol, t0);

-- ---------- L1：价格 K 线（独立表，量大） ----------
create table if not exists price_candles (
  source_id text not null,
  symbol    text not null,
  interval  text not null,            -- '1m' | '1d'
  ts        timestamptz not null,     -- K 线开盘时间（UTC）
  open      numeric not null,
  high      numeric not null,
  low       numeric not null,
  close     numeric not null,
  volume    numeric not null,
  primary key (source_id, symbol, interval, ts)
);
create index if not exists idx_candles_lookup on price_candles (symbol, interval, ts);
