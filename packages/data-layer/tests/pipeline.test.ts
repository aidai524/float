import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDb } from "./helpers/fake-db";
import { runSource } from "../src/pipeline";
import type { DataSourceRow } from "../src/types";

// Binance kline: [openTime, open, high, low, close, volume, closeTime, ...]
const KLINES = [
  [1_730_000_000_000, "100", "110", "90", "105", "1000", 1_730_000_059_999, "0", 10, "0", "0", "0"],
  [
    1_730_000_060_000,
    "105",
    "115",
    "100",
    "112",
    "1200",
    1_730_000_119_999,
    "0",
    10,
    "0",
    "0",
    "0",
  ],
];

const source: DataSourceRow = {
  id: "binance",
  type: "price",
  auth: "none",
  cost_tier: "free",
  priority: 10,
  rate_limit: { dailyQuota: 1000 },
  refresh: "15m",
  fallback: [],
  enabled: true,
  config: { base_url: "https://api.binance.com", symbols: ["BTCUSDT"], kline_interval: "1m" },
};

const kv = { get: async () => null, put: async () => {} };

afterEach(() => vi.unstubAllGlobals());

describe("pipeline.runSource（Binance 价格路径）", () => {
  it("写入 price_candles 且幂等", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => KLINES })),
    );
    const db = createFakeDb();

    const r1 = await runSource(db, kv, source, {});
    expect(r1.failed).toBe(false);
    expect(r1.ok).toBe(2);
    expect(db.dump("price_candles")).toHaveLength(2);
    expect((db.dump("price_candles")[0] as any).close).toBe(105);

    // 再跑一次：主键冲突应 upsert，不新增行
    await runSource(db, kv, source, {});
    expect(db.dump("price_candles")).toHaveLength(2);
    expect(db.dump("ingest_runs")).toHaveLength(2);
  });

  it("外部失败时记录 fail 且降级到 fallback", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call++;
        if (call === 1) throw new Error("network down");
        return { ok: true, json: async () => KLINES };
      }),
    );
    const db = createFakeDb();
    const withFallback = { ...source, fallback: ["binance"] }; // 自身作为可重试源

    const r = await runSource(db, kv, withFallback, {});
    expect(r.failed).toBe(false);
    expect(db.dump("price_candles")).toHaveLength(2);
  });

  it("配额耗尽直接返回 quota_exceeded", async () => {
    const db = createFakeDb();
    const exhausted = { get: async () => "999999", put: async () => {} };
    const r = await runSource(db, exhausted, source, {});
    expect(r.failed).toBe(true);
    expect(r.error).toBe("quota_exceeded");
  });
});
