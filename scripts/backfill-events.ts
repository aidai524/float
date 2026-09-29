/**
 * 回填历史上币事件（用于建立"事件类型基准"）。
 *
 *   pnpm backfill:events                  # 默认 12 页 × 50 = 600 条
 *   pnpm backfill:events --pages 20       # 更多
 *   pnpm backfill:events --from 1 --pages 12
 *
 * 只回填事件（文本），不拉价格；价格由 `pnpm reactions` 按需拉取。
 */
import { createClient } from "@supabase/supabase-js";
import {
  runSource,
  resolveEvents,
  type DataSourceRow,
  type DB,
} from "../packages/data-layer/src/index";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as DB;
const kv = { get: async () => null, put: async () => {} };

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

const pages = arg("pages", 12);
const from = arg("from", 1);

const source: DataSourceRow = {
  id: "binance-announcements",
  type: "listing",
  auth: "none",
  cost_tier: "free",
  priority: 15,
  rate_limit: { dailyQuota: 10_000_000 },
  refresh: "1d",
  fallback: [],
  enabled: true,
  config: {
    base_url: "https://www.binance.com",
    catalog_id: 48,
    page_size: 50,
    page_from: from,
    max_pages: pages,
  },
};

async function main() {
  console.log(`回填 Binance 上币公告：page ${from} → ${from + pages - 1}（每页 50）…`);
  const r = await runSource(db, kv, source, {});
  console.log("runSource:", r);
  if (r.failed) process.exit(1);

  const resolved = await resolveEvents(db, { limit: 20000 });
  console.log("resolveEvents:", resolved);
  console.log("✓ 回填完成");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
