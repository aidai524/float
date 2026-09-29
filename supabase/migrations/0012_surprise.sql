-- ============================================================
-- 0012_surprise.sql
-- 预期 vs 实际：隐含波动幅度 + 惊讶度
--   implied_move_h = DVOL/100 × sqrt(h / 一年)
--   actual_move_h  = [T0, T0+h] 内相对 base 的最大绝对偏离
--   surprise_h     = actual_move_h / implied_move_h
-- 因为要在 events_v1 中间插入列，先 drop 依赖视图再重建。
-- ============================================================

alter table event_reactions add column if not exists implied_move_1h numeric;
alter table event_reactions add column if not exists implied_move_4h numeric;
alter table event_reactions add column if not exists implied_move_24h numeric;
alter table event_reactions add column if not exists surprise_1h numeric;
alter table event_reactions add column if not exists surprise_4h numeric;
alter table event_reactions add column if not exists surprise_24h numeric;

drop view if exists api.event_detail_v1;
drop view if exists api.events_v1;
drop view if exists api.tokens_v1;
drop view if exists api.event_baseline_v1;
drop view if exists api.event_type_stats_v1;
drop view if exists api.category_stats_v1;
drop view if exists api.event_cohort_v1;

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
  r.implied_move_1h,
  r.implied_move_4h,
  r.implied_move_24h,
  r.surprise_1h,
  r.surprise_4h,
  r.surprise_24h,
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

create or replace view api.event_cohort_v1 as
select
  e.id as event_id,
  e.event_type,
  e.asset_class,
  e.token_symbol,
  e.t0,
  coalesce(t.category, 'other') as token_category,
  r.ret_5m,
  r.ret_15m,
  r.ret_1h,
  r.ret_4h,
  r.ret_24h
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
left join tokens t on t.symbol = e.token_symbol
where e.event_type <> 'unknown'
  and r.liquidity_ok is not false;

create or replace view api.event_type_stats_v1 as
select
  c.event_type,
  c.asset_class,
  count(*) as n,
  count(c.ret_5m) as n_5m,
  count(c.ret_1h) as n_1h,
  count(c.ret_4h) as n_4h,
  count(c.ret_24h) as n_24h,
  percentile_cont(0.5) within group (order by c.ret_5m) as median_5m,
  percentile_cont(0.5) within group (order by c.ret_15m) as median_15m,
  percentile_cont(0.5) within group (order by c.ret_1h) as median_1h,
  percentile_cont(0.5) within group (order by c.ret_4h) as median_4h,
  percentile_cont(0.5) within group (order by c.ret_24h) as median_24h,
  avg((c.ret_5m > 0)::int) as pos_5m,
  avg((c.ret_15m > 0)::int) as pos_15m,
  avg((c.ret_1h > 0)::int) as pos_1h,
  avg((c.ret_4h > 0)::int) as pos_4h,
  avg((c.ret_24h > 0)::int) as pos_24h
from api.event_cohort_v1 c
group by c.event_type, c.asset_class;

create or replace view api.event_baseline_v1 as
select
  c.event_id,
  c.event_type,
  c.asset_class,
  percent_rank() over (partition by c.event_type order by c.ret_5m) as pct_5m,
  percent_rank() over (partition by c.event_type order by c.ret_15m) as pct_15m,
  percent_rank() over (partition by c.event_type order by c.ret_1h) as pct_1h,
  percent_rank() over (partition by c.event_type order by c.ret_4h) as pct_4h,
  percent_rank() over (partition by c.event_type order by c.ret_24h) as pct_24h
from api.event_cohort_v1 c;

create or replace view api.category_stats_v1 as
select
  c.event_type,
  c.token_category,
  count(*) as n,
  count(c.ret_5m) as n_5m,
  count(c.ret_1h) as n_1h,
  count(c.ret_4h) as n_4h,
  count(c.ret_24h) as n_24h,
  percentile_cont(0.5) within group (order by c.ret_5m) as median_5m,
  percentile_cont(0.5) within group (order by c.ret_15m) as median_15m,
  percentile_cont(0.5) within group (order by c.ret_1h) as median_1h,
  percentile_cont(0.5) within group (order by c.ret_4h) as median_4h,
  percentile_cont(0.5) within group (order by c.ret_24h) as median_24h,
  avg((c.ret_5m > 0)::int) as pos_5m,
  avg((c.ret_15m > 0)::int) as pos_15m,
  avg((c.ret_1h > 0)::int) as pos_1h,
  avg((c.ret_4h > 0)::int) as pos_4h,
  avg((c.ret_24h > 0)::int) as pos_24h
from api.event_cohort_v1 c
group by c.event_type, c.token_category;

grant usage on schema api to anon, authenticated, service_role;
grant select on all tables in schema api to anon, authenticated, service_role;
