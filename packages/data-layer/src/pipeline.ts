/**
 * 采集流水线：fetch → L0 raw → L1 normalized。
 * 只依赖 Supabase 客户端 + KV 两个抽象，方便在 Workers 或本地脚本复用。
 */
import { getAdapter } from "./registry";
import { hasQuota, bump } from "./quota";
import type { KVLike } from "./quota";
import type { DataSourceRow, FetchContext, NormalizedRecord, RawPayload } from "./types";

/** 最小 Supabase 客户端接口（避免绑定生成类型） */
export interface DB {
  from(table: string): any;
  rpc(fn: string, args: Record<string, unknown>): any;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 生成源内幂等键（与 canonical_dedupe_key 不同，这里只在单个源内去重） */
export function recordDedupeKey(r: NormalizedRecord): string {
  return [
    r.record_type,
    r.event_type ?? "",
    (r.token_symbol ?? "").toLowerCase(),
    r.t0 ?? "",
    r.ext_id ?? "",
  ].join("|");
}

async function writeRaw(
  db: DB,
  sourceId: string,
  payloads: RawPayload[],
): Promise<Array<{ id: number; raw: RawPayload }>> {
  const rows = await Promise.all(
    payloads.map(async (p) => ({
      source_id: sourceId,
      entity: p.entity,
      request: p.request,
      payload: p.payload,
      payload_hash: await sha256(JSON.stringify(p.payload)),
    })),
  );
  const { data } = await db
    .from("raw_payloads")
    .upsert(rows, { onConflict: "source_id,entity,payload_hash", ignoreDuplicates: true })
    .select("id, request");
  void data;
  // 回放时需要原始 payload；这里按 hash 再取一次以拿到 id 映射
  const mapped: Array<{ id: number; raw: RawPayload }> = [];
  for (const p of payloads) {
    const hash = await sha256(JSON.stringify(p.payload));
    const { data: hit } = await db
      .from("raw_payloads")
      .select("id")
      .eq("source_id", sourceId)
      .eq("entity", p.entity)
      .eq("payload_hash", hash)
      .maybeSingle();
    if (hit?.id) mapped.push({ id: hit.id, raw: p });
  }
  return mapped;
}

async function persistRecords(
  db: DB,
  sourceId: string,
  rawId: number,
  records: NormalizedRecord[],
): Promise<number> {
  let n = 0;
  for (const r of records) {
    const dedupe = r.dedupe_key ?? recordDedupeKey(r);
    if (r.record_type === "kline" && r.candle) {
      await db.from("price_candles").upsert(
        {
          source_id: sourceId,
          symbol: r.token_symbol,
          interval: (r.detail as any)?.interval ?? "1m",
          ts: r.candle.ts,
          open: r.candle.open,
          high: r.candle.high,
          low: r.candle.low,
          close: r.candle.close,
          volume: r.candle.volume,
        },
        { onConflict: "source_id,symbol,interval,ts" },
      );
      n++;
      continue;
    }
    await db.from("source_records").upsert(
      {
        source_id: sourceId,
        raw_id: rawId,
        record_type: r.record_type,
        ext_id: r.ext_id,
        event_type: r.event_type,
        token_symbol: r.token_symbol,
        chain: r.chain,
        t0: r.t0,
        t0_confidence: r.t0_confidence,
        magnitude_usd: r.magnitude_usd,
        magnitude_pct: r.magnitude_pct,
        source_url: r.source_url,
        detail: r.detail ?? {},
        dedupe_key: dedupe,
      },
      { onConflict: "source_id,record_type,dedupe_key" },
    );
    n++;
  }
  return n;
}

/** 跑单个源（带 fallback 链） */
export async function runSource(
  db: DB,
  kv: KVLike,
  source: DataSourceRow,
  secrets: Record<string, string>,
  baseCtx: Partial<FetchContext> = {},
): Promise<{ ok: number; failed: boolean; error?: string }> {
  const started = new Date().toISOString();
  const quota = source.rate_limit?.dailyQuota;
  if (!(await hasQuota(kv, source.id, quota))) {
    return { ok: 0, failed: true, error: "quota_exceeded" };
  }

  const chain = [source.id, ...(source.fallback ?? [])];
  let lastError: string | undefined;

  for (const id of chain) {
    const adapter = getAdapter(id);
    if (!adapter) continue;
    try {
      const ctx: FetchContext = { ...baseCtx, config: source.config, secrets };
      const payloads = await adapter.fetch(ctx);
      await bump(kv, source.id, payloads.length);
      const rawRows = await writeRaw(db, source.id, payloads);
      let ok = 0;
      for (const { id: rawId, raw } of rawRows) {
        // Tier A 需要把 config 带给 normalize
        (raw.request as any).__config = source.config;
        ok += await persistRecords(db, source.id, rawId, adapter.normalize(raw));
      }
      await db.from("ingest_runs").insert({
        source_id: source.id,
        entity: source.type,
        started_at: started,
        finished_at: new Date().toISOString(),
        ok_count: ok,
        fail_count: 0,
        meta: { via: id, payloads: payloads.length },
      });
      return { ok, failed: false };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  await db.from("ingest_runs").insert({
    source_id: source.id,
    entity: source.type,
    started_at: started,
    finished_at: new Date().toISOString(),
    ok_count: 0,
    fail_count: 1,
    error: lastError ?? "all_sources_failed",
  });
  return { ok: 0, failed: true, error: lastError };
}

/** 跑所有 enabled 源，供 Cron 调用 */
export async function runAll(db: DB, kv: KVLike, secrets: Record<string, string>) {
  const { data: sources } = await db
    .from("data_sources")
    .select("*")
    .eq("enabled", true)
    .order("priority", { ascending: true });

  const results: Record<string, unknown> = {};
  for (const s of sources ?? []) {
    results[s.id] = await runSource(db, kv, s as DataSourceRow, secrets);
  }
  return results;
}
