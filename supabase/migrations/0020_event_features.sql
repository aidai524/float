-- ============================================================
-- 0020_event_features.sql
-- Phase 7.4：可比事件（pgvector KNN）
--
-- 思路：把事件的特征编码为 24 维向量（规模 / 稀释 / 资产类别 / 代币类别 / 流动性），
--   「最像的历史事件」= 余弦距离最近的 K 条 —— 用于回答「这次和历史上哪次最像，它们怎么走」。
--
-- 注意：特征只使用事件发生时可得的属性，不包含结果（收益）以避免泄漏。
-- ============================================================

-- 复用 0003 已建的 public.event_features（vector(32)，created_at）；本迁移只补函数。
-- 24 维：1 规模(usd) · 2 占最大供应 · 3 float 稀释 · 4-5 资产类别 · 6-18 代币类别 · 19 流动性 · 20-32 预留
create or replace function public.refresh_event_features()
returns integer
language sql as $$
  with src as (
    select
      e.id as event_id,
      least(1, greatest(0, (log(10, coalesce(e.magnitude_usd, 0) + 1)) / 9.0))            as f_usd,
      least(1, greatest(0, coalesce(e.magnitude_pct, 0) / 0.2))                            as f_pct,
      least(1, greatest(0, coalesce(public.unlock_float_pct(
        (e.detail->>'token_amount')::numeric,
        (e.detail->>'circ_supply')::numeric,
        e.magnitude_pct), 0) / 0.2))                                                       as f_float,
      coalesce(e.asset_class, 'unknown')                                                   as asset_class,
      coalesce(t.category, 'other')                                                        as category,
      case when r.liquidity_ok is true then 1.0 when r.liquidity_ok is false then 0.0 else 0.5 end as f_liq
    from public.events e
    join public.event_reactions r
      on r.event_id = e.id
     and r.methodology_version = api.methodology_version()
    left join public.tokens t on t.symbol = e.token_symbol
  ),
  vec as (
    select
      event_id,
      array[
        f_usd, f_pct, f_float,
        case when asset_class = 'crypto' then 1 else 0 end,
        case when asset_class = 'rwa' then 1 else 0 end,
        case when category = 'defi' then 1 else 0 end,
        case when category = 'l1' then 1 else 0 end,
        case when category = 'l2' then 1 else 0 end,
        case when category = 'meme' then 1 else 0 end,
        case when category = 'infrastructure' then 1 else 0 end,
        case when category = 'rwa' then 1 else 0 end,
        case when category = 'stablecoin' then 1 else 0 end,
        case when category = 'gaming' then 1 else 0 end,
        case when category = 'ai' then 1 else 0 end,
        case when category = 'exchange' then 1 else 0 end,
        case when category = 'payment' then 1 else 0 end,
        case when category = 'privacy' then 1 else 0 end,
        case when category = 'other' then 1 else 0 end,
        f_liq,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
      ]::float8[] as a,
      jsonb_build_object(
        'magnitude_usd_norm', f_usd,
        'magnitude_pct', f_pct,
        'float_pct', f_float,
        'asset_class', asset_class,
        'category', category,
        'liquidity', f_liq
      ) as j
    from src
  ),
  up as (
    insert into public.event_features (event_id, feature_vec, feature_json)
    select event_id, a::vector, j
    from vec
    on conflict (event_id) do update
      set feature_vec = excluded.feature_vec,
          feature_json = excluded.feature_json
    returning 1
  )
  select count(*)::int from up;
$$;

-- 相似事件（余弦距离；只返回事件发生时的属性 + 事后收益，便于对照）
create or replace function public.similar_events(p_event_id bigint, p_k int default 5)
returns table (
  event_id     bigint,
  token_symbol text,
  event_type   text,
  t0           timestamptz,
  similarity   real,
  ret_1h       numeric,
  ret_4h       numeric,
  ret_24h      numeric,
  magnitude_usd numeric,
  magnitude_pct numeric
)
language sql stable as $$
  with target as (
    select feature_vec from public.event_features where event_id = p_event_id
  )
  select
    e.id,
    e.token_symbol,
    e.event_type,
    e.t0,
    (1 - (f.feature_vec <=> (select feature_vec from target)))::real as similarity,
    r.ret_1h,
    r.ret_4h,
    r.ret_24h,
    e.magnitude_usd,
    e.magnitude_pct
  from public.event_features f
  join public.events e on e.id = f.event_id
  left join public.event_reactions r
    on r.event_id = f.event_id
   and r.methodology_version = api.methodology_version()
  where f.event_id <> p_event_id
    and exists (select 1 from public.event_features t2 where t2.event_id = p_event_id)
  order by f.feature_vec <=> (select feature_vec from target)
  limit greatest(1, least(p_k, 20));
$$;

grant execute on function public.refresh_event_features() to service_role;
grant execute on function public.similar_events(bigint, int) to anon, authenticated, service_role;
