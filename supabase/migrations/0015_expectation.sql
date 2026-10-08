-- ============================================================
-- 0015_expectation.sql
-- Phase 4.2/4.3 v2：解锁稀释以「流通量（float）」为准 + 市场调整反应
--
-- 三层口径（v2）：
--   1) float_pct   = token_amount / circ_supply（占当前流通，产品名 Float 的来源）
--                    缺失时回退 magnitude_pct（占最大供应），float_basis 标注
--   2) excess_ret_h = token ret_h − BTC 同期 ret_h（一阶市场调整，β=1）
--   3) z_h          = excess_ret_h / (事件前 30 天日波动 × sqrt(h/24h))
--                     「相对自身正常波动，偏离了多少个 sigma」
--
-- 时间窗：
--   post 1h/4h/24h  = 1m K 线高精度（compute-expectations 取 BTC 1m）
--   post 72h/168h   = 1h K 线（±1h）
--   pre 24h/72h     = [t0−Δ, t0−1h]，刻意排除事件所在小时，衡量「事前漂移」
--
-- 数据：由 scripts/compute-expectations.ts 写入 event_expectation（口径 v2）。
-- 契约：v1 视图保留不动；v2 是新增视图，不改变既有列语义（只追加列）。
-- ============================================================

-- ---------- 工具：float 稀释（占流通量），缺失时回退占最大供应 ----------
create or replace function public.unlock_float_pct(
  p_token_amount numeric,
  p_circ_supply  numeric,
  p_magnitude_pct numeric
) returns numeric
language sql immutable as $$
  select coalesce(
    case
      when p_token_amount is not null and p_circ_supply is not null and p_circ_supply > 0
        then p_token_amount / p_circ_supply
    end,
    p_magnitude_pct
  );
$$;

-- ---------- L3：事件预期层（市场调整 + 波动标准化） ----------
create table if not exists event_expectation (
  event_id            bigint  not null references events(id) on delete cascade,
  methodology_version text    not null default 'v2',
  benchmark           text    not null default 'BTC',
  anchor_ts           timestamptz not null,
  bench_ret_1h        numeric,
  bench_ret_4h        numeric,
  bench_ret_24h       numeric,
  excess_ret_1h       numeric,
  excess_ret_4h       numeric,
  excess_ret_24h      numeric,
  baseline_vol_daily  numeric,
  z_1h                numeric,
  z_4h                numeric,
  z_24h               numeric,
  -- 长窗口 + 事前漂移（1h K 线分辨率）
  pre_ret_24h         numeric,
  pre_excess_24h      numeric,
  pre_ret_72h         numeric,
  pre_excess_72h      numeric,
  ret_72h             numeric,
  excess_ret_72h      numeric,
  z_72h               numeric,
  ret_168h            numeric,
  excess_ret_168h     numeric,
  z_168h              numeric,
  computed_at         timestamptz not null default now(),
  primary key (event_id, methodology_version)
);

-- 已建过表的库补齐新列（幂等）
alter table event_expectation add column if not exists pre_ret_24h numeric;
alter table event_expectation add column if not exists pre_excess_24h numeric;
alter table event_expectation add column if not exists pre_ret_72h numeric;
alter table event_expectation add column if not exists pre_excess_72h numeric;
alter table event_expectation add column if not exists ret_72h numeric;
alter table event_expectation add column if not exists excess_ret_72h numeric;
alter table event_expectation add column if not exists z_72h numeric;
alter table event_expectation add column if not exists ret_168h numeric;
alter table event_expectation add column if not exists excess_ret_168h numeric;
alter table event_expectation add column if not exists z_168h numeric;

create index if not exists idx_expectation_version
  on event_expectation (methodology_version, benchmark);

-- ---------- 契约：事件级「预期 vs 实际」（市场调整版） ----------
create or replace view api.event_expectation_v1 as
select
  x.event_id,
  x.benchmark,
  x.anchor_ts,
  x.bench_ret_1h,
  x.bench_ret_4h,
  x.bench_ret_24h,
  x.excess_ret_1h,
  x.excess_ret_4h,
  x.excess_ret_24h,
  x.baseline_vol_daily,
  x.z_1h,
  x.z_4h,
  x.z_24h,
  x.methodology_version,
  x.pre_ret_24h,
  x.pre_excess_24h,
  x.pre_ret_72h,
  x.pre_excess_72h,
  x.ret_72h,
  x.excess_ret_72h,
  x.z_72h,
  x.ret_168h,
  x.excess_ret_168h,
  x.z_168h
from event_expectation x
where x.methodology_version = 'v2';

-- ---------- 契约：解锁 v2 队列（每事件一行，供统计与前端散点） ----------
create or replace view api.unlock_cohort_v2 as
select
  e.id                                                                    as event_id,
  e.token_symbol,
  e.t0,
  coalesce(e.detail->>'category', 'unknown')                              as category,
  coalesce(e.detail->>'allocation', '')                                   as allocation,
  public.unlock_float_pct(
    (e.detail->>'token_amount')::numeric,
    (e.detail->>'circ_supply')::numeric,
    e.magnitude_pct
  )                                                                       as float_pct,
  case when (e.detail->>'circ_supply')::numeric > 0 then 'circ' else 'max' end as float_basis,
  e.magnitude_pct,
  e.magnitude_usd,
  r.ret_1h,
  r.ret_4h,
  r.ret_24h,
  x.excess_ret_1h,
  x.excess_ret_4h,
  x.excess_ret_24h,
  x.z_1h,
  x.z_4h,
  x.z_24h,
  r.liquidity_ok,
  r.base_after_t0
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
left join event_expectation x
  on x.event_id = e.id
 and x.methodology_version = 'v2'
where e.event_type = 'unlock_cliff'
  and r.liquidity_ok is not false
  and public.unlock_float_pct(
        (e.detail->>'token_amount')::numeric,
        (e.detail->>'circ_supply')::numeric,
        e.magnitude_pct
      ) >= 0.005;

-- ---------- 契约：解锁 v2 按 float 稀释分桶 ----------
create or replace view api.unlock_float_stats_v2 as
select
  case
    when public.unlock_float_pct(
           (e.detail->>'token_amount')::numeric,
           (e.detail->>'circ_supply')::numeric,
           e.magnitude_pct
         ) >= 0.10 then '>=10%'
    when public.unlock_float_pct(
           (e.detail->>'token_amount')::numeric,
           (e.detail->>'circ_supply')::numeric,
           e.magnitude_pct
         ) >= 0.05 then '5-10%'
    when public.unlock_float_pct(
           (e.detail->>'token_amount')::numeric,
           (e.detail->>'circ_supply')::numeric,
           e.magnitude_pct
         ) >= 0.02 then '2-5%'
    when public.unlock_float_pct(
           (e.detail->>'token_amount')::numeric,
           (e.detail->>'circ_supply')::numeric,
           e.magnitude_pct
         ) >= 0.01 then '1-2%'
    else '0.5-1%'
  end                                                                     as bucket,
  count(*)                                                                as n,
  count(x.excess_ret_4h)                                                  as n_excess,
  round(avg(public.unlock_float_pct(
    (e.detail->>'token_amount')::numeric,
    (e.detail->>'circ_supply')::numeric,
    e.magnitude_pct
  ))::numeric, 5)                                                         as avg_float_pct,
  round(percentile_cont(0.5) within group (order by r.ret_4h)::numeric, 5) as median_ret_4h,
  round(percentile_cont(0.5) within group (order by x.excess_ret_4h)::numeric, 5) as median_excess_4h,
  round(percentile_cont(0.25) within group (order by x.excess_ret_4h)::numeric, 5) as p25_excess_4h,
  round(percentile_cont(0.75) within group (order by x.excess_ret_4h)::numeric, 5) as p75_excess_4h,
  round(percentile_cont(0.5) within group (order by x.z_4h)::numeric, 3)  as median_z_4h,
  round((count(*) filter (where x.excess_ret_4h > 0))::numeric / nullif(count(x.excess_ret_4h), 0), 4) as pos_excess_4h,
  round(percentile_cont(0.5) within group (order by r.ret_24h)::numeric, 5) as median_ret_24h,
  round(percentile_cont(0.5) within group (order by x.excess_ret_24h)::numeric, 5) as median_excess_24h,
  round(percentile_cont(0.5) within group (order by x.z_24h)::numeric, 3) as median_z_24h,
  round(percentile_cont(0.5) within group (order by x.pre_excess_24h)::numeric, 5) as median_pre_excess_24h,
  round(percentile_cont(0.5) within group (order by x.pre_excess_72h)::numeric, 5) as median_pre_excess_72h,
  round(percentile_cont(0.5) within group (order by x.excess_ret_72h)::numeric, 5) as median_excess_72h,
  round(percentile_cont(0.5) within group (order by x.excess_ret_168h)::numeric, 5) as median_excess_168h
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
left join event_expectation x
  on x.event_id = e.id
 and x.methodology_version = 'v2'
where e.event_type = 'unlock_cliff'
  and r.liquidity_ok is not false
  and public.unlock_float_pct(
        (e.detail->>'token_amount')::numeric,
        (e.detail->>'circ_supply')::numeric,
        e.magnitude_pct
      ) >= 0.005
group by 1;

-- ---------- 契约：解锁 v2 按接收方类别 ----------
create or replace view api.unlock_category_stats_v2 as
select
  coalesce(e.detail->>'category', 'unknown')                              as category,
  count(*)                                                                as n,
  count(x.excess_ret_4h)                                                  as n_excess,
  round(avg(public.unlock_float_pct(
    (e.detail->>'token_amount')::numeric,
    (e.detail->>'circ_supply')::numeric,
    e.magnitude_pct
  ))::numeric, 5)                                                         as avg_float_pct,
  round(percentile_cont(0.5) within group (order by r.ret_4h)::numeric, 5) as median_ret_4h,
  round(percentile_cont(0.5) within group (order by x.excess_ret_4h)::numeric, 5) as median_excess_4h,
  round(percentile_cont(0.25) within group (order by x.excess_ret_4h)::numeric, 5) as p25_excess_4h,
  round(percentile_cont(0.75) within group (order by x.excess_ret_4h)::numeric, 5) as p75_excess_4h,
  round(percentile_cont(0.5) within group (order by x.z_4h)::numeric, 3)  as median_z_4h,
  round((count(*) filter (where x.excess_ret_4h > 0))::numeric / nullif(count(x.excess_ret_4h), 0), 4) as pos_excess_4h,
  round(percentile_cont(0.5) within group (order by r.ret_24h)::numeric, 5) as median_ret_24h,
  round(percentile_cont(0.5) within group (order by x.excess_ret_24h)::numeric, 5) as median_excess_24h,
  round(percentile_cont(0.5) within group (order by x.z_24h)::numeric, 3) as median_z_24h,
  round(percentile_cont(0.5) within group (order by x.pre_excess_24h)::numeric, 5) as median_pre_excess_24h,
  round(percentile_cont(0.5) within group (order by x.pre_excess_72h)::numeric, 5) as median_pre_excess_72h,
  round(percentile_cont(0.5) within group (order by x.excess_ret_72h)::numeric, 5) as median_excess_72h,
  round(percentile_cont(0.5) within group (order by x.excess_ret_168h)::numeric, 5) as median_excess_168h
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
left join event_expectation x
  on x.event_id = e.id
 and x.methodology_version = 'v2'
where e.event_type = 'unlock_cliff'
  and r.liquidity_ok is not false
  and public.unlock_float_pct(
        (e.detail->>'token_amount')::numeric,
        (e.detail->>'circ_supply')::numeric,
        e.magnitude_pct
      ) >= 0.005
group by 1;

-- ---------- 契约：解锁 v2 归一化斜率（市场调整后） ----------
create or replace view api.unlock_slope_v2 as
select
  count(*)                                                                as n,
  count(x.excess_ret_4h)                                                  as n_excess,
  round(regr_slope(
    x.excess_ret_4h,
    public.unlock_float_pct(
      (e.detail->>'token_amount')::numeric,
      (e.detail->>'circ_supply')::numeric,
      e.magnitude_pct
    ) * 100
  )::numeric, 6)                                                          as slope_excess_4h_per_pct,
  round(regr_r2(
    x.excess_ret_4h,
    public.unlock_float_pct(
      (e.detail->>'token_amount')::numeric,
      (e.detail->>'circ_supply')::numeric,
      e.magnitude_pct
    ) * 100
  )::numeric, 4)                                                          as r2,
  round(regr_slope(
    r.ret_4h,
    public.unlock_float_pct(
      (e.detail->>'token_amount')::numeric,
      (e.detail->>'circ_supply')::numeric,
      e.magnitude_pct
    ) * 100
  )::numeric, 6)                                                          as slope_ret_4h_per_pct,
  round(regr_r2(
    r.ret_4h,
    public.unlock_float_pct(
      (e.detail->>'token_amount')::numeric,
      (e.detail->>'circ_supply')::numeric,
      e.magnitude_pct
    ) * 100
  )::numeric, 4)                                                          as r2_ret,
  round(percentile_cont(0.5) within group (
    order by public.unlock_float_pct(
      (e.detail->>'token_amount')::numeric,
      (e.detail->>'circ_supply')::numeric,
      e.magnitude_pct
    ) * 100
  )::numeric, 4)                                                          as median_float_pct,
  round(percentile_cont(0.5) within group (order by x.excess_ret_4h)::numeric, 5) as median_excess_4h,
  round(regr_slope(
    x.pre_excess_72h,
    public.unlock_float_pct(
      (e.detail->>'token_amount')::numeric,
      (e.detail->>'circ_supply')::numeric,
      e.magnitude_pct
    ) * 100
  )::numeric, 6)                                                          as slope_pre_excess_72h_per_pct,
  round(regr_r2(
    x.pre_excess_72h,
    public.unlock_float_pct(
      (e.detail->>'token_amount')::numeric,
      (e.detail->>'circ_supply')::numeric,
      e.magnitude_pct
    ) * 100
  )::numeric, 4)                                                          as r2_pre_excess_72h,
  round(regr_slope(
    x.excess_ret_168h,
    public.unlock_float_pct(
      (e.detail->>'token_amount')::numeric,
      (e.detail->>'circ_supply')::numeric,
      e.magnitude_pct
    ) * 100
  )::numeric, 6)                                                          as slope_excess_168h_per_pct,
  round(regr_r2(
    x.excess_ret_168h,
    public.unlock_float_pct(
      (e.detail->>'token_amount')::numeric,
      (e.detail->>'circ_supply')::numeric,
      e.magnitude_pct
    ) * 100
  )::numeric, 4)                                                          as r2_excess_168h
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
left join event_expectation x
  on x.event_id = e.id
 and x.methodology_version = 'v2'
where e.event_type = 'unlock_cliff'
  and r.liquidity_ok is not false
  and public.unlock_float_pct(
        (e.detail->>'token_amount')::numeric,
        (e.detail->>'circ_supply')::numeric,
        e.magnitude_pct
      ) >= 0.005;

grant select on api.event_expectation_v1 to anon, authenticated, service_role;
grant select on api.unlock_cohort_v2 to anon, authenticated, service_role;
grant select on api.unlock_float_stats_v2 to anon, authenticated, service_role;
grant select on api.unlock_category_stats_v2 to anon, authenticated, service_role;
grant select on api.unlock_slope_v2 to anon, authenticated, service_role;
