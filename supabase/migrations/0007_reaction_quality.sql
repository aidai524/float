-- ============================================================
-- 0007_reaction_quality.sql
-- 1) tokens.symbol 唯一约束（用于 upsert ADV）
-- 2) event_reactions.base_after_t0：标记"基准价取自 T0 之后"
--    （例如新币上线，公告时还没有市场）
-- 3) 契约视图暴露 base_ts / base_after_t0
-- ============================================================

-- 1) tokens.symbol 唯一（先清理可能的重复）
delete from tokens a using tokens b where a.id > b.id and a.symbol = b.symbol;
alter table tokens drop constraint if exists tokens_symbol_key;
alter table tokens add constraint tokens_symbol_key unique (symbol);

-- 2) 反应质量标记
alter table event_reactions add column if not exists base_after_t0 boolean;
-- 允许 liquidity_ok = null（基准历史不足，无法判定）
alter table event_reactions alter column liquidity_ok drop not null;
alter table event_reactions alter column liquidity_ok drop default;

-- 3) 重建契约视图
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
  e.source_url,
  coalesce(e.detail->>'category', 'unknown') as category,
  e.asset_class,
  e.confidence,
  e.source_count,
  r.base_price,
  r.base_ts,
  r.base_after_t0,
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
