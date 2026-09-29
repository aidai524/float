-- ============================================================
-- 0011_volatility_index.sql
-- 隐含波动率指数（Deribit DVOL）——用于"预期 vs 实际"。
-- 形状与 K 线一致（OHLC），但语义是年化波动率百分数（35 = 35%），不是价格。
-- ============================================================

create table if not exists volatility_index (
  source_id text not null,
  currency  text not null,          -- BTC / ETH
  ts        timestamptz not null,
  open      numeric,
  high      numeric,
  low       numeric,
  close     numeric,
  primary key (source_id, currency, ts)
);

create index if not exists idx_volidx_lookup on volatility_index (currency, ts desc);
