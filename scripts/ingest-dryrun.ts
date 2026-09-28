/**
 * Phase 1 dry-run：用真实外部 API（Binance，免 key）跑通
 * fetch -> L0 raw -> L1 normalized -> price_candles，全程写入内存假 DB，不连数据库。
 *
 *   pnpm tsx scripts/ingest-dryrun.ts
 */
import { createFakeDb } from "../packages/data-layer/tests/helpers/fake-db";
import { runSource } from "../packages/data-layer/src/pipeline";
import type { DataSourceRow } from "../packages/data-layer/src/types";

const binance: DataSourceRow = {
  id: "binance",
  type: "price",
  auth: "none",
  cost_tier: "free",
  priority: 10,
  rate_limit: { rpm: 1200, dailyQuota: 1_000_000 },
  refresh: "15m",
  fallback: [],
  enabled: true,
  config: {
    base_url: "https://api.binance.com",
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    kline_interval: "1m",
    limit: 5,
  },
};

const kv = {
  get: async () => null,
  put: async () => {},
};

async function main() {
  const db = createFakeDb();
  console.log("→ 采集 Binance 1m K 线（真实网络）…");
  const result = await runSource(db, kv, binance, {});
  console.log("runSource:", result);

  const candles = db.dump("price_candles");
  console.log(`\nprice_candles 行数: ${candles.length}`);
  for (const c of candles.slice(0, 6)) {
    console.log(
      `  ${c.symbol} ${c.interval} ${new Date(c.ts).toISOString()} close=${c.close} vol=${c.volume}`,
    );
  }
  console.log("\ningest_runs:", JSON.stringify(db.dump("ingest_runs"), null, 1));

  if (result.failed || candles.length === 0) {
    console.error("✗ dry-run 失败");
    process.exit(1);
  }
  console.log("\n✓ Phase 1 dry-run 通过：真实数据已走完 L0→L1 落库路径");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
