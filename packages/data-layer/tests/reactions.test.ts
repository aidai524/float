import { describe, expect, it } from "vitest";
import {
  computeReactions,
  METHODOLOGY_VERSION,
  type Candle,
  MINUTE,
  DAY_MS,
} from "../src/reactions";

const T0 = Date.UTC(2026, 8, 1, 12, 0, 0); // 2026-09-01T12:00:00Z

/** 生成从 from 开始、每分钟一根、价格由 fn 决定的 1m K 线 */
function makeCandles(
  from: number,
  count: number,
  price: (i: number) => number,
  volume = (_i: number) => 100,
  stepMs = MINUTE,
): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const p = price(i);
    out.push({
      ts: from + i * stepMs,
      open: p,
      high: p * 1.001,
      low: p * 0.999,
      close: p,
      volume: volume(i),
    });
  }
  return out;
}

// 事件前 1 小时 + 事件后 24 小时
const PRE = makeCandles(T0 - 60 * MINUTE, 60, () => 100);
const POST = makeCandles(T0, 1441, (i) => 100 + i * 0.1); // 每分钟 +0.1
const CANDLES_1M = [...PRE, ...POST];

// 30 天小时线，成交量恒为 60（= 1m 量 100 的 60%），用于基准
const HOURLY = makeCandles(
  T0 - 30 * DAY_MS,
  720,
  () => 100,
  () => 6000,
  60 * MINUTE,
);

describe("computeReactions", () => {
  it("base 取 T0 前最后一根", () => {
    const r = computeReactions(CANDLES_1M, HOURLY, T0, { priceSource: "binance" })!;
    expect(r).not.toBeNull();
    expect(r.basePrice).toBeCloseTo(100);
    expect(r.baseTs).toBe(T0 - MINUTE);
    expect(r.baseAfterT0).toBe(false);
  });

  it("各时间窗收益正确", () => {
    const r = computeReactions(CANDLES_1M, HOURLY, T0, { priceSource: "binance" })!;
    // T0+5m 收盘 = 100 + 5*0.1 = 100.5 → +0.5%
    expect(r.ret5m!).toBeCloseTo(0.005, 4);
    expect(r.ret15m!).toBeCloseTo(0.015, 3);
    expect(r.ret1h!).toBeCloseTo(0.06, 3);
    expect(r.ret4h!).toBeCloseTo(0.24, 3);
    expect(r.ret24h!).toBeCloseTo(1.44, 2);
  });

  it("最大冲高 / 回撤基于 [T0, T0+4h]", () => {
    const r = computeReactions(CANDLES_1M, HOURLY, T0, { priceSource: "binance" })!;
    // 4h 时价格 124 → high 124*1.001
    expect(r.maxFavorable!).toBeCloseTo((124 * 1.001) / 100 - 1, 4);
    // 回撤：最低出现在最早，low 100*0.999
    expect(r.maxDrawdown!).toBeCloseTo((100 * 0.999) / 100 - 1, 4);
  });

  it("vol_ratio = 事件后 1h 量 / 基准小时量", () => {
    const r = computeReactions(CANDLES_1M, HOURLY, T0, { priceSource: "binance" })!;
    // 事件后 1h：60 根 × 100 = 6000；基准小时量 6000 → 1.0
    expect(r.volRatio!).toBeCloseTo(1.0, 3);
  });

  it("流动性过滤", () => {
    const low = computeReactions(CANDLES_1M, HOURLY, T0, {
      priceSource: "binance",
      advThresholdUsd: 1e12,
    })!;
    expect(low.liquidityOk).toBe(false);
    const ok = computeReactions(CANDLES_1M, HOURLY, T0, {
      priceSource: "binance",
      advThresholdUsd: 0,
    })!;
    expect(ok.liquidityOk).toBe(true);
    expect(ok.adv30d).toBeGreaterThan(0);
  });

  it("基准历史不足 7 天 → 流动性未知（null）", () => {
    // 只有 2 天小时线（新币上线的情形）
    const shortHistory = makeCandles(
      T0 - 2 * DAY_MS,
      48,
      () => 100,
      () => 6000,
      60 * MINUTE,
    );
    const r = computeReactions(CANDLES_1M, shortHistory, T0, { priceSource: "binance" })!;
    expect(r.liquidityOk).toBeNull();
  });

  it("缺少 T0 前数据时退化为 T0 后第一根", () => {
    const r = computeReactions(POST, [], T0, { priceSource: "binance" })!;
    expect(r.baseAfterT0).toBe(true);
    expect(r.baseTs).toBe(T0);
  });

  it("数据不足以覆盖 24h 时该窗口为 null", () => {
    const short = makeCandles(T0 - 10 * MINUTE, 70, () => 100); // 只到 T0+1h
    const r = computeReactions(short, [], T0, { priceSource: "binance" })!;
    expect(r.ret5m).not.toBeNull();
    expect(r.ret24h).toBeNull();
  });

  it("无数据返回 null", () => {
    expect(computeReactions([], [], T0, { priceSource: "binance" })).toBeNull();
  });

  it("methodology 版本写入", () => {
    const r = computeReactions(CANDLES_1M, HOURLY, T0, { priceSource: "binance" })!;
    expect(r.methodologyVersion).toBe(METHODOLOGY_VERSION);
  });
});
