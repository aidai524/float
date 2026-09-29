/**
 * 真实采集：把外部数据写入云端 Supabase。
 *
 *   pnpm ingest binance        # 只跑指定源
 *   pnpm ingest                # 跑全部 enabled 源
 *
 * 之后自动执行 L2 实体解析（resolveEvents）。
 */
import { createClient } from "@supabase/supabase-js";
import {
  runSource,
  runAll,
  resolveEvents,
  type DB,
  type DataSourceRow,
} from "../packages/data-layer/src/index";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（见 .env）");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as DB;

// 本地无 KV，配额守卫退化为不限（Worker 上会用真的 KV）
const kv = { get: async () => null, put: async () => {} };

const secrets = {
  COINGECKO_API_KEY: process.env.COINGECKO_API_KEY ?? "",
  COINMARKETCAL_API_KEY: process.env.COINMARKETCAL_API_KEY ?? "",
  CRYPTOPANIC_API_KEY: process.env.CRYPTOPANIC_API_KEY ?? "",
  FRED_API_KEY: process.env.FRED_API_KEY ?? "",
};

async function main() {
  const only = process.argv[2];

  if (only) {
    const { data } = await db.from("data_sources").select("*").eq("id", only).maybeSingle();
    if (!data) throw new Error(`data_source 不存在: ${only}`);
    const r = await runSource(db, kv, data as DataSourceRow, secrets);
    console.log(`${only}:`, r);
  } else {
    const r = await runAll(db, kv, secrets);
    console.log("runAll:", r);
  }

  const resolved = await resolveEvents(db);
  console.log("resolveEvents:", resolved);
  console.log("✓ 采集完成");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
