-- ============================================================
-- 0005_asset_class.sql
-- 新增 asset_class 维度（crypto | rwa | unknown）。
-- RWA 包含代币化股票/ETF/商品等——属于 web3 场景，不排除。
-- 因为要给 events_v1 中间插入列，需先 drop 依赖视图再重建。
-- ============================================================

alter table tokens add column if not exists asset_class text;
alter table events add column if not exists asset_class text not null default 'unknown';
create index if not exists idx_events_asset_class on events (asset_class);

drop view if exists api.event_detail_v1;
drop view if exists api.events_v1;
drop view if exists api.tokens_v1;

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
  e.asset_class,
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

create or replace view api.event_detail_v1 as
select
  v.*,
  (select count(*) from event_provenance p where p.event_id = v.id)            as provenance_count,
  (select array_agg(distinct p.source_id) from event_provenance p where p.event_id = v.id) as sources
from api.events_v1 v;

create or replace view api.tokens_v1 as
select
  t.id,
  t.symbol,
  t.name,
  t.chain,
  t.category,
  coalesce(t.asset_class, 'unknown') as asset_class,
  t.market_cap,
  t.adv_30d,
  (select count(*) from events e where e.token_symbol = t.symbol)              as event_count,
  (select max(e.t0) from events e where e.token_symbol = t.symbol)             as last_event_at
from tokens t;

grant usage on schema api to anon, authenticated, service_role;
grant select on all tables in schema api to anon, authenticated, service_role;
