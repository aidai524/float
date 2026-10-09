-- ============================================================
-- 0016_listing_expectation.sql
-- Phase 4.4：上币特征化预期（类别 × 规模 × 上币形式 → 反应区间）
--
-- 口径：
--   - 事件：listing_cex（Binance 公告；含现货新币 / 合约 / Seed Tag / RWA bStock / 产品位）
--   - 上币形式 listing_form：由标题规则判定（public.listing_form，纯函数、可复算）
--   - 规模：FDV ≈ 上币时基准价（event_reactions.base_price）× 最大供应
--     最大供应来自 DefiLlama 解锁事件 detail（覆盖约 1/3 标的；其余为 unknown，不猜测）
--   - 反应：原始收益（上币常为 T0 后首个成交价起算，base_after_t0 标注）
--
-- 读侧仍只依赖 api.*；本文件的 public.listing_form / public.token_supply 是数据层工具。
-- ============================================================

-- ---------- 工具：上币形式（标题规则） ----------
create or replace function public.listing_form(p_title text)
returns text
language sql immutable as $$
  select case
    when p_title is null then 'unknown'
    when p_title ilike '%bstock%' then 'rwa_bstock'
    when p_title ilike '%seed tag%' then 'seed_tag'
    when p_title ilike '%launchpool%' or p_title ilike '%hodler%' then 'launchpool'
    when p_title ilike '%perpetual%' or p_title ilike '%futures%' then 'futures'
    when p_title ilike '%earn%' or p_title ilike '%convert%' or p_title ilike '%margin%' then 'product_add'
    when p_title ilike '%will list%' or p_title ~* '\mlists\M' then 'new_listing'
    else 'other'
  end;
$$;

-- ---------- 工具：代币供应（来自 DefiLlama 解锁事件的快照，只做规模档） ----------
create or replace view public.token_supply as
select
  token_symbol,
  max((detail->>'max_supply')::numeric) as max_supply,
  max((detail->>'circ_supply')::numeric) as circ_supply
from events
where detail ? 'max_supply'
  and (detail->>'max_supply')::numeric > 0
group by token_symbol;

-- ---------- 契约：上币事件队列（每事件一行） ----------
create or replace view api.listing_cohort_v1 as
select
  e.id                                                                    as event_id,
  e.token_symbol,
  e.t0,
  coalesce(t.category, 'other')                                          as token_category,
  coalesce(e.asset_class, 'unknown')                                     as asset_class,
  public.listing_form(e.title)                                           as listing_form,
  case when r.base_price is not null and s.max_supply > 0
       then r.base_price * s.max_supply end                              as fdv_usd,
  case
    when r.base_price is null or s.max_supply is null or s.max_supply <= 0 then 'unknown'
    when r.base_price * s.max_supply >= 5e9 then '>=5B'
    when r.base_price * s.max_supply >= 1e9 then '1-5B'
    else '<1B'
  end                                                                    as fdv_bucket,
  r.ret_5m,
  r.ret_15m,
  r.ret_1h,
  r.ret_4h,
  r.ret_24h,
  r.max_drawdown,
  r.max_favorable,
  r.base_after_t0
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
left join tokens t on t.symbol = e.token_symbol
left join public.token_supply s on s.token_symbol = e.token_symbol
where e.event_type = 'listing_cex';

-- ---------- 契约：按上币形式 ----------
create or replace view api.listing_form_stats_v1 as
select
  public.listing_form(e.title)                                            as listing_form,
  count(*)                                                                as n,
  count(r.ret_1h)                                                         as n_1h,
  count(r.ret_4h)                                                         as n_4h,
  count(r.ret_24h)                                                        as n_24h,
  round(percentile_cont(0.5) within group (order by r.ret_1h)::numeric, 5) as median_1h,
  round(percentile_cont(0.5) within group (order by r.ret_4h)::numeric, 5) as median_4h,
  round(percentile_cont(0.5) within group (order by r.ret_24h)::numeric, 5) as median_24h,
  round(percentile_cont(0.25) within group (order by r.ret_4h)::numeric, 5) as p25_4h,
  round(percentile_cont(0.75) within group (order by r.ret_4h)::numeric, 5) as p75_4h,
  round(percentile_cont(0.25) within group (order by r.ret_24h)::numeric, 5) as p25_24h,
  round(percentile_cont(0.75) within group (order by r.ret_24h)::numeric, 5) as p75_24h,
  round((count(*) filter (where r.ret_1h > 0))::numeric / nullif(count(r.ret_1h), 0), 4) as pos_1h,
  round((count(*) filter (where r.ret_4h > 0))::numeric / nullif(count(r.ret_4h), 0), 4) as pos_4h,
  round((count(*) filter (where r.ret_24h > 0))::numeric / nullif(count(r.ret_24h), 0), 4) as pos_24h,
  round(percentile_cont(0.5) within group (order by r.max_drawdown)::numeric, 5) as median_max_dd
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
where e.event_type = 'listing_cex'
group by 1;

-- ---------- 契约：按代币类别 ----------
create or replace view api.listing_category_stats_v1 as
select
  coalesce(t.category, 'other')                                           as token_category,
  count(*)                                                                as n,
  count(r.ret_1h)                                                         as n_1h,
  count(r.ret_4h)                                                         as n_4h,
  count(r.ret_24h)                                                        as n_24h,
  round(percentile_cont(0.5) within group (order by r.ret_1h)::numeric, 5) as median_1h,
  round(percentile_cont(0.5) within group (order by r.ret_4h)::numeric, 5) as median_4h,
  round(percentile_cont(0.5) within group (order by r.ret_24h)::numeric, 5) as median_24h,
  round(percentile_cont(0.25) within group (order by r.ret_4h)::numeric, 5) as p25_4h,
  round(percentile_cont(0.75) within group (order by r.ret_4h)::numeric, 5) as p75_4h,
  round(percentile_cont(0.25) within group (order by r.ret_24h)::numeric, 5) as p25_24h,
  round(percentile_cont(0.75) within group (order by r.ret_24h)::numeric, 5) as p75_24h,
  round((count(*) filter (where r.ret_1h > 0))::numeric / nullif(count(r.ret_1h), 0), 4) as pos_1h,
  round((count(*) filter (where r.ret_4h > 0))::numeric / nullif(count(r.ret_4h), 0), 4) as pos_4h,
  round((count(*) filter (where r.ret_24h > 0))::numeric / nullif(count(r.ret_24h), 0), 4) as pos_24h,
  round(percentile_cont(0.5) within group (order by r.max_drawdown)::numeric, 5) as median_max_dd
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
left join tokens t on t.symbol = e.token_symbol
where e.event_type = 'listing_cex'
group by 1;

-- ---------- 契约：按 FDV 档（覆盖受限，unknown 单列） ----------
create or replace view api.listing_fdv_stats_v1 as
select
  case
    when r.base_price is null or s.max_supply is null or s.max_supply <= 0 then 'unknown'
    when r.base_price * s.max_supply >= 5e9 then '>=5B'
    when r.base_price * s.max_supply >= 1e9 then '1-5B'
    else '<1B'
  end                                                                     as fdv_bucket,
  count(*)                                                                as n,
  count(r.ret_1h)                                                         as n_1h,
  count(r.ret_4h)                                                         as n_4h,
  count(r.ret_24h)                                                        as n_24h,
  round(percentile_cont(0.5) within group (order by r.ret_1h)::numeric, 5) as median_1h,
  round(percentile_cont(0.5) within group (order by r.ret_4h)::numeric, 5) as median_4h,
  round(percentile_cont(0.5) within group (order by r.ret_24h)::numeric, 5) as median_24h,
  round(percentile_cont(0.25) within group (order by r.ret_4h)::numeric, 5) as p25_4h,
  round(percentile_cont(0.75) within group (order by r.ret_4h)::numeric, 5) as p75_4h,
  round(percentile_cont(0.25) within group (order by r.ret_24h)::numeric, 5) as p25_24h,
  round(percentile_cont(0.75) within group (order by r.ret_24h)::numeric, 5) as p75_24h,
  round((count(*) filter (where r.ret_1h > 0))::numeric / nullif(count(r.ret_1h), 0), 4) as pos_1h,
  round((count(*) filter (where r.ret_4h > 0))::numeric / nullif(count(r.ret_4h), 0), 4) as pos_4h,
  round((count(*) filter (where r.ret_24h > 0))::numeric / nullif(count(r.ret_24h), 0), 4) as pos_24h,
  round(percentile_cont(0.5) within group (order by r.max_drawdown)::numeric, 5) as median_max_dd
from events e
join event_reactions r
  on r.event_id = e.id
 and r.methodology_version = api.methodology_version()
left join public.token_supply s on s.token_symbol = e.token_symbol
where e.event_type = 'listing_cex'
group by 1;

-- ---------- 契约：单事件在「同类代币类别」中的分位 ----------
create or replace view api.listing_baseline_v1 as
select
  c.event_id,
  c.token_category,
  c.listing_form,
  percent_rank() over (partition by c.token_category order by c.ret_1h)  as pct_1h,
  percent_rank() over (partition by c.token_category order by c.ret_4h)  as pct_4h,
  percent_rank() over (partition by c.token_category order by c.ret_24h) as pct_24h
from api.listing_cohort_v1 c;

grant select on api.listing_cohort_v1 to anon, authenticated, service_role;
grant select on api.listing_form_stats_v1 to anon, authenticated, service_role;
grant select on api.listing_category_stats_v1 to anon, authenticated, service_role;
grant select on api.listing_fdv_stats_v1 to anon, authenticated, service_role;
grant select on api.listing_baseline_v1 to anon, authenticated, service_role;
