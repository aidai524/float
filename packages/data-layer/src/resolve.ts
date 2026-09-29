/**
 * L2 实体解析：把多个源的 source_records 合并成唯一 events 黄金记录，
 * 并写 event_provenance 溯源。读侧只看到 events，不感知来源。
 */
import type { DB } from "./pipeline";

interface SourceRec {
  id: number;
  source_id: string;
  event_type: string | null;
  token_symbol: string | null;
  chain: string | null;
  t0: string | null;
  t0_confidence: "high" | "medium" | "low" | null;
  magnitude_usd: number | null;
  magnitude_pct: number | null;
  source_url: string | null;
  detail: Record<string, unknown> | null;
}

/** 与 SQL 函数 canonical_dedupe_key 保持完全一致 */
export function canonicalKey(
  eventType: string | null,
  token: string | null,
  t0: string | null,
  magnitude: number | null,
): string {
  const d = t0 ? new Date(t0) : new Date(0);
  const ymdh =
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(d.getUTCDate()).padStart(2, "0")}` +
    `${String(d.getUTCHours()).padStart(2, "0")}`;
  const bucket =
    magnitude == null
      ? "na"
      : magnitude < 100_000
        ? "lt100k"
        : magnitude < 1_000_000
          ? "lt1m"
          : magnitude < 10_000_000
            ? "lt10m"
            : "gte10m";
  return [eventType ?? "", token ?? "", ymdh, bucket].join("|").toLowerCase();
}

/** 按 priority 升序（越小越优先）取第一个非空值 */
function mergeField<T>(
  records: SourceRec[],
  priority: Record<string, number>,
  key: keyof SourceRec,
): T | null {
  const sorted = [...records].sort(
    (a, b) => (priority[a.source_id] ?? 999) - (priority[b.source_id] ?? 999),
  );
  for (const r of sorted) {
    const v = r[key];
    if (v !== null && v !== undefined && v !== "") return v as T;
  }
  return null;
}

export async function resolveEvents(
  db: DB,
  opts: { since?: string; until?: string; limit?: number } = {},
): Promise<{ events: number; provenance: number }> {
  const limit = opts.limit ?? 5000;

  const { data: sources } = await db.from("data_sources").select("id, priority");
  const priority: Record<string, number> = {};
  for (const s of sources ?? []) priority[s.id] = s.priority ?? 100;

  // 待解析的源事件记录
  let q = db
    .from("source_records")
    .select(
      "id,source_id,event_type,token_symbol,chain,t0,t0_confidence,magnitude_usd,magnitude_pct,source_url,detail",
    )
    .eq("record_type", "event")
    .limit(limit);
  if (opts.since) q = q.gte("ingested_at", opts.since);
  if (opts.until) q = q.lte("ingested_at", opts.until);
  const { data: records } = await q;
  if (!records?.length) return { events: 0, provenance: 0 };

  // 分组
  const groups = new Map<string, SourceRec[]>();
  for (const r of records as SourceRec[]) {
    if (!r.t0 || !r.token_symbol) continue; // 无 T0 或无代币符号不能成为黄金事件
    const key = canonicalKey(r.event_type, r.token_symbol, r.t0, r.magnitude_usd);
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  let eventCount = 0;
  let provCount = 0;

  for (const [key, recs] of groups) {
    const sorted = [...recs].sort(
      (a, b) => (priority[a.source_id] ?? 999) - (priority[b.source_id] ?? 999),
    );
    const primary = sorted[0];
    if (!primary) continue;
    const sourceCount = new Set(recs.map((r) => r.source_id)).size;
    // 多源印证提高置信度，0.6 起步，每个额外源 +0.15，上限 1
    const confidence = Math.min(1, 0.6 + (sourceCount - 1) * 0.15);

    const { data: ev } = await db
      .from("events")
      .upsert(
        {
          event_type: mergeField<string>(recs, priority, "event_type"),
          token_symbol: mergeField<string>(recs, priority, "token_symbol"),
          chain: mergeField<string>(recs, priority, "chain"),
          t0: mergeField<string>(recs, priority, "t0"),
          t0_confidence: mergeField<string>(recs, priority, "t0_confidence") ?? "medium",
          magnitude_usd: mergeField<number>(recs, priority, "magnitude_usd"),
          magnitude_pct: mergeField<number>(recs, priority, "magnitude_pct"),
          title: (primary.detail as any)?.title ?? null,
          source_url: primary.source_url,
          detail: Object.assign({}, ...recs.map((r) => r.detail ?? {}), {
            category: (primary.detail as any)?.category,
          }),
          primary_source: primary.source_id,
          source_count: sourceCount,
          confidence,
          dedupe_key: key,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "dedupe_key" },
      )
      .select("id")
      .maybeSingle();

    if (!ev?.id) continue;
    eventCount++;

    const provRows = recs.map((r) => ({
      event_id: ev.id,
      record_id: r.id,
      source_id: r.source_id,
      is_primary: r.id === primary.id,
    }));
    await db.from("event_provenance").upsert(provRows, { onConflict: "event_id,record_id" });
    provCount += provRows.length;
  }

  return { events: eventCount, provenance: provCount };
}
