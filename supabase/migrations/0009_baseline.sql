-- ============================================================
-- 0009_baseline.sql
-- 事件类型基准层：把"单个事件的一个数字"变成"vs 同类历史的信号"。
--
-- 三层：
--   api.event_cohort_v1       同一批可用于统计的事件（剔 unknown / 低流动性）
--   api.event_type_stats_v1   按事件类型(×资产类别)的聚合：N / 中位数 / 上涨占比
--   api.event_baseline_v1     每个事件在同类中的百分位
-- ============================================================

-- 可用于统计的样本：必须有反应，且不是已知低流动性，且已分类
create or replace view api.event_cohort_v1 as
select
  e.id as event_id,
  e.event_type,
  e.asset_class,
  e.token_symbol,
  e.t0,
  r.ret_5m,
  r.ret_15m,
  r.ret_1h,
  r.ret_4h,
  r.ret_24h
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
where e.event_type <> 'unknown'
  and r.liquidity_ok is not false;

-- 按事件类型 × 资产类别的聚合
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

-- 每个事件在同类（同 event_type）中的百分位
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

grant usage on schema api to anon, authenticated, service_role;
grant select on all tables in schema api to anon, authenticated, service_role;
