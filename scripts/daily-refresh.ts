/**
 * 每日刷新：把"需要定时做"的事串成一条。
 *
 *   pnpm daily
 *
 * 做四件事：
 *   1. 刷新即将解锁（CMC 只给未来约 24h，必须天天抓）
 *   2. 重新解析成黄金事件（去重/合并）
 *   3. 对"已经发生且还没算"的事件补算反应（含惊讶度）
 *   4. 打印当日简报（未来 24h 解锁 + 未来 7 天宏观）
 *
 * 设计为可反复执行（幂等）：重复跑不会产生重复数据。
 */
import { createClient } from "@supabase/supabase-js";
import {
  runSource,
  resolveEvents,
  type DataSourceRow,
  type DB,
} from "../packages/data-layer/src/index";

// 允许直接 `pnpm daily` / launchd 裸跑：环境变量未注入时，从仓库根的 .env 读取。
// 显式注入的进程环境优先（loadEnvFile 只在缺失时调用）。
if (!process.env.SUPABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    // 没有 .env 就继续，下面会给出清晰的缺参报错
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as DB;
const raw = createClient(url, key, { auth: { persistSession: false } });
const kv = { get: async () => null, put: async () => {} };

const secrets = {
  COINGECKO_API_KEY: process.env.COINGECKO_API_KEY ?? "",
  COINMARKETCAL_API_KEY: process.env.COINMARKETCAL_API_KEY ?? "",
  CRYPTOPANIC_API_KEY: process.env.CRYPTOPANIC_API_KEY ?? "",
  FRED_API_KEY: process.env.FRED_API_KEY ?? "",
};

async function refreshSource(id: string) {
  const { data } = await raw.from("data_sources").select("*").eq("id", id).maybeSingle();
  if (!data) {
    console.log(`  · ${id} 未注册，跳过`);
    return;
  }
  const r = await runSource(db, kv, data as DataSourceRow, secrets);
  console.log(`  ✓ ${id}: ${JSON.stringify(r)}`);
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

async function brief() {
  const now = Date.now();
  const in24 = new Date(now + 86400_000).toISOString();
  const in7d = new Date(now + 7 * 86400_000).toISOString();

  const { data: unlocks } = await raw
    .schema("api")
    .from("events_v1")
    .select("token_symbol,t0,magnitude_usd,magnitude_pct,event_type,source_detail")
    .like("event_type", "unlock%")
    .gte("t0", new Date(now).toISOString())
    .lte("t0", in24)
    .order("magnitude_usd", { ascending: false })
    .limit(40);

  const { data: macro } = await raw
    .schema("api")
    .from("events_v1")
    .select("token_symbol,t0,event_type")
    .like("event_type", "macro%")
    .gte("t0", new Date(now).toISOString())
    .lte("t0", in7d)
    .order("t0", { ascending: true })
    .limit(10);

  const { data: types } = await raw
    .schema("api")
    .from("event_type_stats_v1")
    .select("event_type,n,median_1h,median_24h,pos_24h")
    .gte("n", 20);

  const stat = new Map((types ?? []).map((t: any) => [t.event_type, t]));

  console.log("\n——— 未来 24 小时解锁（按金额）———");
  const top = (unlocks ?? []).slice(0, 8);
  if (!top.length) console.log("  （无）");
  for (const u of top as any[]) {
    const alloc = (u.source_detail as any)?.allocation ?? "";
    console.log(
      `  ${String(u.token_symbol).padEnd(9)} ${String(u.t0).slice(11, 16)} UTC  ` +
        `${fmtUsd(u.magnitude_usd).padStart(8)}  占供应 ${((u.magnitude_pct ?? 0) * 100).toFixed(2)}%  ${alloc}`,
    );
  }

  console.log("\n——— 未来 7 天宏观（含历史基准）———");
  if (!(macro ?? []).length) console.log("  （无）");
  for (const m of macro ?? []) {
    const s = stat.get((m as any).event_type) as any;
    const base = s
      ? `1h 中位 ${((s.median_1h ?? 0) * 100).toFixed(2)}% · 24h 中位 ${((s.median_24h ?? 0) * 100).toFixed(2)}% · 上涨 ${Math.round((s.pos_24h ?? 0) * 100)}%（N=${s.n}）`
      : "基准积累中";
    console.log(
      `  ${String((m as any).t0).slice(0, 10)}  ${String((m as any).event_type).padEnd(11)} ${base}`,
    );
  }
}

async function main() {
  console.log(`\n===== Float 每日刷新 ${new Date().toISOString().slice(0, 16)} UTC =====`);
  console.log("1) 刷新数据源");
  await refreshSource("coinmarketcap-unlocks");
  await refreshSource("binance-announcements");
  await refreshSource("bybit-announcements");
  await refreshSource("coinmarketcal");

  console.log("2) 解析事件");
  const resolved = await resolveEvents(db, { limit: 20000 });
  console.log(`  ${JSON.stringify(resolved)}`);

  console.log("3) 生成简报");
  await brief();

  console.log("\n✓ 完成。补算反应请跑：pnpm reactions --no-store\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
