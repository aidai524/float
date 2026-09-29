-- ============================================================
-- 0013_defillama_unlocks.sql
-- DefiLlama 解锁（免费历史 + 未来）来源注册 + 通用「按源解析 L2」函数
-- ============================================================

-- 富度最高的解锁源，优先于 CMC 的滚动窗口
insert into data_sources (id, type, auth, cost_tier, priority, rate_limit, refresh, fallback, config) values
('defillama-unlocks', 'unlock', 'none', 'free', 4,
 '{"rpm": 6, "dailyQuota": 50}', '1d', '{}',
 '{"base_url":"https://defillama.com/unlocks"}')
on conflict (id) do nothing;

-- ---------- 通用：把某个源的 source_records 解析成 events ----------
-- 与 resolve.ts 一样，用 canonical_dedupe_key 分组；批量 SQL，适合大规模回填。
-- 幂等：重复调用不会重复计数，source_count / confidence 由 provenance 重算。
create or replace function resolve_source_events(p_source_id text)
returns table(events_upserted int, provenance_rows int)
language plpgsql as $$
declare
  v_ids bigint[];
  v_events int := 0;
  v_prov int := 0;
begin
  -- 1) 每个 canonical key 取一条（按 t0 最早），写入 events，并记住受影响的 id
  with src as (
    select distinct on (canonical_dedupe_key(sr.event_type, sr.token_symbol, sr.t0, sr.magnitude_usd))
      sr.event_type, sr.token_symbol, sr.chain, sr.t0, sr.t0_confidence,
      sr.magnitude_usd, sr.magnitude_pct, sr.detail,
      canonical_dedupe_key(sr.event_type, sr.token_symbol, sr.t0, sr.magnitude_usd) as ck
    from source_records sr
    where sr.source_id = p_source_id
      and sr.record_type = 'event'
      and sr.t0 is not null
      and sr.token_symbol is not null
    order by canonical_dedupe_key(sr.event_type, sr.token_symbol, sr.t0, sr.magnitude_usd),
             sr.t0 asc, sr.id asc
  ),
  up as (
    insert into events (
      event_type, token_symbol, chain, t0, t0_confidence,
      magnitude_usd, magnitude_pct, title, detail,
      primary_source, source_count, confidence, dedupe_key, updated_at
    )
    select
      event_type, token_symbol, chain, t0, coalesce(t0_confidence, 'medium'),
      magnitude_usd, magnitude_pct, detail->>'title', detail,
      p_source_id, 1, 0.6, ck, now()
    from src
    on conflict (dedupe_key) do update set
      magnitude_usd = coalesce(events.magnitude_usd, excluded.magnitude_usd),
      magnitude_pct = coalesce(events.magnitude_pct, excluded.magnitude_pct),
      title         = coalesce(events.title, excluded.title),
      detail        = events.detail || excluded.detail,
      updated_at    = now()
    returning id
  )
  select coalesce(array_agg(id), '{}'), count(*) into v_ids, v_events from up;

  -- 2) 溯源
  with ins as (
    insert into event_provenance (event_id, record_id, source_id, is_primary)
    select e.id, sr.id, sr.source_id, (e.primary_source = sr.source_id)
    from source_records sr
    join events e
      on e.dedupe_key = canonical_dedupe_key(sr.event_type, sr.token_symbol, sr.t0, sr.magnitude_usd)
    where sr.source_id = p_source_id
      and sr.record_type = 'event'
    on conflict (event_id, record_id) do nothing
    returning 1
  )
  select count(*) into v_prov from ins;

  -- 3) 只对本次受影响的 event 按 provenance 重算 source_count / confidence（幂等）
  update events e
  set source_count = agg.n,
      confidence   = least(1, 0.6 + (agg.n - 1) * 0.15),
      updated_at   = now()
  from (
    select p.event_id, count(distinct p.source_id) as n
    from event_provenance p
    where p.event_id = any(v_ids)
    group by p.event_id
  ) agg
  where e.id = agg.event_id;

  return query select v_events, v_prov;
end;
$$;

grant execute on function resolve_source_events(text) to service_role;
