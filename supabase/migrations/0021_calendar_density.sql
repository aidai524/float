-- ============================================================
-- 0021_calendar_density.sql
-- Phase 7.3：日历密度（热力图数据）
-- ============================================================

create or replace view api.calendar_density_v1 as
select
  date_trunc('day', t0)::date as day,
  case
    when event_type like 'unlock%' then 'unlock'
    when event_type like 'listing%' then 'listing'
    when event_type like 'macro%' then 'macro'
    else 'other'
  end                          as category,
  count(*)                     as n,
  count(*) filter (where event_type = 'unlock_cliff')  as n_cliff,
  count(*) filter (where event_type = 'listing_cex')   as n_listing,
  sum(magnitude_usd)           as magnitude_usd
from events
where t0 >= now() - interval '30 days'
  and t0 <= now() + interval '90 days'
group by 1, 2;

grant select on api.calendar_density_v1 to anon, authenticated, service_role;
