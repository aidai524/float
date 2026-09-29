/**
 * 回填 K 线（用于让图表窗口与事件时间重叠）。
 *
 *   pnpm backfill                                    # BTC/ETH/SOL 日线 200 根
 *   pnpm backfill BTCUSDT,ETHUSDT 1d 365
 */
import { createClient } from "@supabase/supabase-js";
import { runSource, type DataSourceRow } from "../packages/data-layer/src/index";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const kv = { get: async () => null, put: async () => {} };

const symbols = (process.argv[2] ?? "BTCUSDT,ETHUSDT,SOLUSDT").split(",");
const interval = process.argv[3] ?? "1d";
const limit = Number(process.argv[4] ?? 200);

const source: DataSourceRow = {
  id: "binance",
  type: "price",
  auth: "none",
  cost_tier: "free",
  priority: 10,
  rate_limit: { dailyQuota: 1_000_000 },
  refresh: "1d",
  fallback: [],
  enabled: true,
  config: { base_url: "https://api.binance.com", symbols, kline_interval: interval, limit },
};

async function main() {
  console.log(`回填 ${symbols.join(",")} ${interval} × ${limit} …`);
  const r = await runSource(db, kv, source, {});
  console.log("runSource:", r);
  if (r.failed) process.exit(1);
  console.log("✓ 回填完成");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
