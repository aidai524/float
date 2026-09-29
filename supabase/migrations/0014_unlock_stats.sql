-- ============================================================
-- 0014_unlock_stats.sql
-- Phase 4.2 / 4.3：解锁稀释斜率 + 按接收方分类的反应差异
--
-- 口径：
--   - 只取 cliff 解锁（linear 是速率，未纳入 v1）
--   - 稀释占比 magnitude_pct ≥ 0.5%（过滤掉日度农场排放这类噪声）
--   - 反应按当前 methodology_version 关联，剔除流动性不足的样本
-- ============================================================

-- ---------- 4.3 按接收方分类 ----------
create or replace view api.unlock_category_stats_v1 as
select
  coalesce(e.detail->>'category', 'unknown')                             as category,
  count(*)                                                               as n,
  count(r.ret_4h)                                                        as n_4h,
  round(avg(e.magnitude_pct)::numeric, 6)                                as avg_pct,
  round(percentile_cont(0.5) within group (order by r.ret_1h)::numeric, 5)  as median_ret_1h,
  round(percentile_cont(0.5) within group (order by r.ret_4h)::numeric, 5)  as median_ret_4h,
  round(percentile_cont(0.5) within group (order by r.ret_24h)::numeric, 5) as median_ret_24h,
  round(percentile_cont(0.25) within group (order by r.ret_4h)::numeric, 5) as p25_ret_4h,
  round(percentile_cont(0.75) within group (order by r.ret_4h)::numeric, 5) as p75_ret_4h,
  round(percentile_cont(0.5) within group (order by r.max_drawdown)::numeric, 5) as median_max_dd,
  round((count(*) filter (where r.ret_4h > 0))::numeric / nullif(count(r.ret_4h), 0), 4) as pos_4h
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
where e.event_type = 'unlock_cliff'
  and e.magnitude_pct >= 0.005
  and r.liquidity_ok is not false
group by 1;

-- ---------- 4.2 按稀释规模分桶 ----------
create or replace view api.unlock_dilution_stats_v1 as
with x as (
  select
    case
      when e.magnitude_pct >= 0.10 then '>=10%'
      when e.magnitude_pct >= 0.03 then '3-10%'
      when e.magnitude_pct >= 0.01 then '1-3%'
      when e.magnitude_pct >= 0.003 then '0.3-1%'
      else '0.1-0.3%'
    end                                                                     as bucket,
    e.magnitude_pct,
    r.ret_1h, r.ret_4h, r.ret_24h, r.max_drawdown
  from events e
  join event_reactions r
    on r.event_id = e.id
   and r.methodology_version = api.methodology_version()
  where e.event_type = 'unlock_cliff'
    and e.magnitude_pct >= 0.005
    and r.liquidity_ok is not false
)
select
  bucket,
  count(*)                                                                as n,
  count(ret_4h)                                                           as n_4h,
  round(avg(magnitude_pct)::numeric, 5)                                   as avg_pct,
  round(percentile_cont(0.5) within group (order by ret_1h)::numeric, 5)  as median_ret_1h,
  round(percentile_cont(0.5) within group (order by ret_4h)::numeric, 5)  as median_ret_4h,
  round(percentile_cont(0.5) within group (order by ret_24h)::numeric, 5) as median_ret_24h,
  round(percentile_cont(0.5) within group (order by max_drawdown)::numeric, 5) as median_max_dd,
  round((count(*) filter (where ret_4h > 0))::numeric / nullif(count(ret_4h), 0), 4) as pos_4h
from x
group by 1;

-- ---------- 4.2 归一化斜率（单行汇总）----------
-- 每 1% 供应稀释对应的 4h 收益（回归斜率），以及样本量与拟合度
create or replace view api.unlock_slope_v1 as
select
  count(*)                                                    as n,
  round((regr_slope(ret_4h, magnitude_pct * 100))::numeric, 6) as slope_4h_per_pct,
  round((regr_r2(ret_4h, magnitude_pct * 100))::numeric, 4)    as r2,
  round(percentile_cont(0.5) within group (order by ret_4h)::numeric, 5) as median_ret_4h,
  round(percentile_cont(0.5) within group (order by magnitude_pct * 100)::numeric, 4) as median_pct
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
where e.event_type = 'unlock_cliff'
  and e.magnitude_pct >= 0.005
  and r.liquidity_ok is not false
  and r.ret_4h is not null;

grant select on api.unlock_category_stats_v1 to anon, authenticated;
grant select on api.unlock_dilution_stats_v1 to anon, authenticated;
grant select on api.unlock_slope_v1 to anon, authenticated;
