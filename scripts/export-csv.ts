/**
 * 数据集导出（CSV）——契约视图 → exports/*.csv，便于离线分析 / BI。
 *
 *   pnpm export                 # 默认导出事件 + 统计 + 预期层
 *   pnpm export --no-events     # 跳过 2.4 万条事件（只导统计）
 *   pnpm export --views events_v1,unlock_float_stats_v2
 *
 * 只读 api.* 契约视图；大表自动分页（1000/页）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    // 继续走缺参报错
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_ANON_KEY");
  process.exit(1);
}
const api = createClient(url, key, { auth: { persistSession: false } }).schema("api");

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const DEFAULT_VIEWS = [
  "events_v1",
  "event_type_stats_v1",
  "category_stats_v1",
  "event_expectation_v1",
  "unlock_cohort_v2",
  "unlock_float_stats_v2",
  "unlock_category_stats_v2",
  "unlock_slope_v2",
  "listing_cohort_v1",
  "listing_form_stats_v1",
  "listing_category_stats_v1",
  "listing_fdv_stats_v1",
];

const noEvents = process.argv.includes("--no-events");
const views = (arg("--views")
  ?.split(",")
  .map((v) => v.trim())
  .filter(Boolean) ?? DEFAULT_VIEWS.filter((v) => !(noEvents && v === "events_v1"))) as string[];

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown): string => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
  return lines.join("\n") + "\n";
}

async function main() {
  const outDir = resolve(process.cwd(), "exports");
  mkdirSync(outDir, { recursive: true });

  for (const view of views) {
    const rows: Record<string, unknown>[] = [];
    const pageSize = 1000;
    for (let page = 0; ; page++) {
      const from = page * pageSize;
      const { data, error } = await api
        .from(view)
        .select("*")
        .range(from, from + pageSize - 1);
      if (error) {
        console.error(`  ✗ ${view}: ${error.message}`);
        rows.length = 0;
        break;
      }
      rows.push(...((data ?? []) as Record<string, unknown>[]));
      if (!data || data.length < pageSize) break;
    }
    if (!rows.length) continue;
    const file = resolve(outDir, `${view}.csv`);
    writeFileSync(file, toCsv(rows), "utf8");
    console.log(`  ✓ ${view}: ${rows.length} 行 → exports/${view}.csv`);
  }
  console.log(`\n✓ 导出完成：${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
