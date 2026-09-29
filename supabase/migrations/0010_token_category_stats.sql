-- ============================================================
-- 0010_token_category_stats.sql
-- 把 Jev 分类出的"代币类别"接进基准层：
--   - event_cohort_v1 增加 token_category
--   - 新增 api.category_stats_v1：按 (事件类型 × 代币类别) 的聚合
-- 因为要在 cohort 中间插列，先 drop 依赖视图再重建。
-- ============================================================

drop view if exists api.event_baseline_v1;
drop view if exists api.event_type_stats_v1;
drop view if exists api.category_stats_v1;
drop view if exists api.event_cohort_v1;

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

-- 按 (事件类型 × 代币类别) 的聚合
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
