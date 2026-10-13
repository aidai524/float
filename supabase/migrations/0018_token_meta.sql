-- ============================================================
-- 0018_token_meta.sql
-- Phase 6.5：代币元数据（CoinGecko）——补全市值/供应量，提升上币 FDV 覆盖
--
-- 口径：
--   FDV 供应量优先级 = DefiLlama 快照 max_supply > CoinGecko max_supply > CoinGecko total_supply
--   FDV ≈ 上币时基准价 × 上述供应量（粗粒度规模档；当前供应 vs 上币时供应的偏差已知）
-- ============================================================

-- tokens 扩展（公开元数据，非契约视图，可加列）
alter table tokens add column if not exists max_supply numeric;
alter table tokens add column if not exists total_supply numeric;

-- ---------- 重定义：listing_cohort_v1（FDV 供应兜底） ----------
create or replace view api.listing_cohort_v1 as
select
  e.id                                                                    as event_id,
  e.token_symbol,
  e.t0,
  coalesce(t.category, 'other')                                          as token_category,
  coalesce(e.asset_class, 'unknown')                                     as asset_class,
  public.listing_form(e.title)                                           as listing_form,
  case when r.base_price is not null
         and coalesce(s.max_supply, t.max_supply, t.total_supply) > 0
       then r.base_price * coalesce(s.max_supply, t.max_supply, t.total_supply) end
                                                                         as fdv_usd,
  case
    when r.base_price is null
      or coalesce(s.max_supply, t.max_supply, t.total_supply) is null
      or coalesce(s.max_supply, t.max_supply, t.total_supply) <= 0 then 'unknown'
    when r.base_price * coalesce(s.max_supply, t.max_supply, t.total_supply) >= 5e9 then '>=5B'
    when r.base_price * coalesce(s.max_supply, t.max_supply, t.total_supply) >= 1e9 then '1-5B'
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

-- ---------- 重定义：listing_fdv_stats_v1（同上兜底） ----------
create or replace view api.listing_fdv_stats_v1 as
select
  case
    when r.base_price is null
      or coalesce(s.max_supply, t.max_supply, t.total_supply) is null
      or coalesce(s.max_supply, t.max_supply, t.total_supply) <= 0 then 'unknown'
    when r.base_price * coalesce(s.max_supply, t.max_supply, t.total_supply) >= 5e9 then '>=5B'
    when r.base_price * coalesce(s.max_supply, t.max_supply, t.total_supply) >= 1e9 then '1-5B'
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
left join tokens t on t.symbol = e.token_symbol
left join public.token_supply s on s.token_symbol = e.token_symbol
where e.event_type = 'listing_cex'
group by 1;

grant select on api.listing_cohort_v1 to anon, authenticated, service_role;
grant select on api.listing_fdv_stats_v1 to anon, authenticated, service_role;
