/**
 * 每日数据质量报告（P6.6）——给 daily 一个可读的自检输出：
 *   - 事件总量与反应覆盖（按类型）
 *   - 最近 30 天待算反应（含无交易对的「不可算」）
 *   - 数据新鲜度：各源最近一次 ingest、reactions / expectations 最近计算时间
 *   - 元数据覆盖：代币分类 / 市值 / 供应量
 *
 *   pnpm quality            # 打印报告
 *   pnpm quality --json     # 输出 JSON（便于告警/存档）
 */
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    // 继续走缺参报错
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const api = db.schema("api");
const asJson = process.argv.includes("--json");

const line = (s = "") => console.log(s);

async function main() {
  const report: Record<string, unknown> = {};

  // 事件与反应覆盖（分页取全量，避开 PostgREST max_rows）
  const allRows: Array<{ event_type: string; base_ts: string | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await api
      .from("events_v1")
      .select("event_type,base_ts")
      .range(from, from + 999);
    if (error) throw error;
    allRows.push(...((data ?? []) as Array<{ event_type: string; base_ts: string | null }>));
    if (!data || data.length < 1000) break;
  }
  const stats = new Map<string, { total: number; measured: number }>();
  for (const e of allRows) {
    const s = stats.get(e.event_type) ?? { total: 0, measured: 0 };
    s.total++;
    if (e.base_ts) s.measured++;
    stats.set(e.event_type, s);
  }
  const totals = [...stats.values()].reduce(
    (a, s) => ({ total: a.total + s.total, measured: a.measured + s.measured }),
    { total: 0, measured: 0 },
  );
  report.events = {
    total: totals.total,
    measured: totals.measured,
    by_type: Object.fromEntries(stats),
  };

  // 最近 30 天待算
  const { data: pending } = await db
    .from("events")
    .select("event_type")
    .lte("t0", new Date(Date.now() - 4 * 3600_000).toISOString())
    .gte("t0", new Date(Date.now() - 30 * 86400_000).toISOString());
  const { data: done } = await db
    .from("event_reactions")
    .select("event_id")
    .eq("methodology_version", "v1");
  const doneSet = new Set((done ?? []).map((r: any) => r.event_id));
  const { data: pendingEvents } = await db
    .from("events")
    .select("id,event_type")
    .lte("t0", new Date(Date.now() - 4 * 3600_000).toISOString())
    .gte("t0", new Date(Date.now() - 30 * 86400_000).toISOString());
  const pendingIds = (pendingEvents ?? []).filter((e: any) => !doneSet.has(e.id));
  report.pending_30d = pendingIds.length;
  void pending;

  // 新鲜度
  const { data: runs } = await db
    .from("ingest_runs")
    .select("source_id,started_at,ok_count,fail_count")
    .order("started_at", { ascending: false })
    .limit(40);
  const lastBySource = new Map<string, any>();
  for (const r of (runs ?? []) as any[]) {
    if (!lastBySource.has(r.source_id)) lastBySource.set(r.source_id, r);
  }
  const { data: lastReaction } = await db
    .from("event_reactions")
    .select("computed_at")
    .eq("methodology_version", "v1")
    .order("computed_at", { ascending: false })
    .limit(1);
  const { data: lastExpectation } = await db
    .from("event_expectation")
    .select("computed_at")
    .eq("methodology_version", "v2")
    .order("computed_at", { ascending: false })
    .limit(1);
  report.freshness = {
    sources: Object.fromEntries(
      [...lastBySource.entries()].map(([k, v]) => [
        k,
        { at: v.started_at, ok: v.ok_count, fail: v.fail_count },
      ]),
    ),
    last_reaction_at: (lastReaction?.[0] as any)?.computed_at ?? null,
    last_expectation_at: (lastExpectation?.[0] as any)?.computed_at ?? null,
  };

  // 元数据覆盖
  const { count: tokens } = await db.from("tokens").select("id", { count: "exact", head: true });
  const { count: cat } = await db
    .from("tokens")
    .select("id", { count: "exact", head: true })
    .not("category", "is", null);
  const { count: mcap } = await db
    .from("tokens")
    .select("id", { count: "exact", head: true })
    .not("coingecko_id", "is", null);
  const { count: supply } = await db
    .from("tokens")
    .select("id", { count: "exact", head: true })
    .not("total_supply", "is", null);
  report.tokens = {
    total: tokens ?? 0,
    categorized: cat ?? 0,
    with_gecko: mcap ?? 0,
    with_supply: supply ?? 0,
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  line(`\n===== Float 数据质量报告 ${new Date().toISOString().slice(0, 16)} UTC =====`);
  line(`\n事件与反应覆盖（总 ${totals.total} / 已测量 ${totals.measured}）：`);
  const rows = [...stats.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
  for (const [t, s] of rows) {
    const pct = s.total ? Math.round((s.measured / s.total) * 100) : 0;
    line(
      `  ${t.padEnd(16)} ${String(s.total).padStart(6)} · 已测量 ${String(s.measured).padStart(5)}（${pct}%）`,
    );
  }
  line(`\n最近 30 天待算反应：${pendingIds.length}（多数为无 Binance 交易对的冷门标的）`);
  line(`\n数据新鲜度：`);
  for (const [src, v] of lastBySource) {
    line(
      `  ${src.padEnd(22)} ${String(v.started_at).slice(0, 16)}  ok=${v.ok_count} fail=${v.fail_count}`,
    );
  }
  line(`  ${"reactions(v1)".padEnd(22)} ${report.freshness.last_reaction_at ?? "—"}`);
  line(`  ${"expectations(v2)".padEnd(22)} ${report.freshness.last_expectation_at ?? "—"}`);
  line(`\n代币元数据：总 ${tokens} · 有分类 ${cat} · 有 CoinGecko ${mcap} · 有供应量 ${supply}`);
  line();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
