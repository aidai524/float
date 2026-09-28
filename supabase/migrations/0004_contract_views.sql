-- ============================================================
-- 0004_contract_views.sql
-- L4 契约层：读侧唯一入口。形状冻结，只增不改。
-- 任何数据源变化都不得改变本文件里已有视图的列。
-- ============================================================

create schema if not exists api;

-- 当前口径版本（可在连接/事务里 set local app.methodology = 'v1'）
create or replace function api.methodology_version() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('app.methodology', true), ''), 'v1');
$$;

-- ---------- 契约：事件（日历 + 反应摘要） ----------
create or replace view api.events_v1 as
select
  e.id,
  e.event_type,
  e.token_symbol,
  e.chain,
  e.t0,
  e.t0_confidence,
  e.magnitude_usd,
  e.magnitude_pct,
  e.title,
  coalesce(e.detail->>'category', 'unknown') as category,
  e.confidence,
  e.source_count,
  r.base_price,
  r.ret_5m,
  r.ret_15m,
  r.ret_1h,
  r.ret_4h,
  r.ret_24h,
  r.vol_1h,
  r.vol_ratio,
  r.max_drawdown,
  r.max_favorable,
  r.liquidity_ok,
  r.price_source,
  coalesce(r.methodology_version, 'v1') as methodology_version,
  e.detail as source_detail,
  e.first_seen_at,
  e.updated_at
from events e
left join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version();

-- ---------- 契约：单事件详情（含溯源数量） ----------
create or replace view api.event_detail_v1 as
select
  v.*,
  (select count(*) from event_provenance p where p.event_id = v.id)            as provenance_count,
  (select array_agg(distinct p.source_id) from event_provenance p where p.event_id = v.id) as sources
from api.events_v1 v;

-- ---------- 契约：代币 ----------
create or replace view api.tokens_v1 as
select
  t.id,
  t.symbol,
  t.name,
  t.chain,
  t.category,
  t.market_cap,
  t.adv_30d,
  (select count(*) from events e where e.token_symbol = t.symbol)              as event_count,
  (select max(e.t0) from events e where e.token_symbol = t.symbol)             as last_event_at
from tokens t;

-- ---------- 读权限 ----------
grant usage on schema api to anon, authenticated;
grant select on all tables in schema api to anon, authenticated;
-- 注意：基础表（events/source_records/raw_payloads）不授予 anon。
