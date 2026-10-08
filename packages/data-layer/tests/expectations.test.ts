import { describe, expect, it } from "vitest";
import {
  baselineDailyVol,
  computeExcess,
  BASELINE_WINDOW_DAYS,
  EXPECTATION_VERSION,
} from "../src/expectations";
import { DAY_MS, MINUTE, type Candle } from "../src/reactions";

const T0 = Date.UTC(2026, 8, 1, 12, 0, 0); // 2026-09-01T12:00:00Z

/** 生成从 from 开始、每 stepMs 一根、价格由 fn 决定的 K 线 */
function makeCandles(
  from: number,
  count: number,
  price: (i: number) => number,
  stepMs = MINUTE,
): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const p = price(i);
    out.push({ ts: from + i * stepMs, open: p, high: p, low: p, close: p, volume: 1 });
  }
  return out;
}

describe("baselineDailyVol", () => {
  it("交替 ±0.1% 小时收益 → 日波动约 0.1% × sqrt(24)", () => {
    // 30 天 1h K 线：close 在 100 与 100·e^0.001 之间交替 → 对数收益 ±0.1%
    const hourly = makeCandles(
      T0 - BASELINE_WINDOW_DAYS * DAY_MS,
      BASELINE_WINDOW_DAYS * 24,
      (i) => 100 * Math.exp(0.001 * (i % 2)),
      60 * MINUTE,
    );
    const vol = baselineDailyVol(hourly, T0);
    expect(vol).not.toBeNull();
    expect(vol!).toBeCloseTo(0.001 * Math.sqrt(24), 5);
  });

  it("历史不足 7 天 → null", () => {
    const hourly = makeCandles(T0 - 3 * DAY_MS, 72, () => 100, 60 * MINUTE);
    expect(baselineDailyVol(hourly, T0)).toBeNull();
  });

  it("样本太少 → null", () => {
    const hourly = makeCandles(T0 - 10 * DAY_MS, 12, () => 100, 60 * MINUTE);
    expect(baselineDailyVol(hourly, T0)).toBeNull();
  });
});

describe("computeExcess", () => {
  const VOL = 0.05; // 日波动 5%

  /** 基准：anchor-1min 收盘 100；每分钟 +0.01（1h +0.6%，4h +2.4%，24h +14.4%） */
  function benchAround(anchor: number): Candle[] {
    return makeCandles(anchor - 60 * MINUTE, 60 + 1441, (i) => 100 + i * 0.01);
  }

  it("超常收益 = token 收益 − 基准收益", () => {
    const anchor = T0;
    const bench = benchAround(anchor);
    // 基准 4h：100.24 / 99.99 − 1（base 是 anchor-1min 那根）
    const base = 100 + 59 * 0.01;
    const bench4h = (100 + (60 + 240) * 0.01) / base - 1;
    const r = computeExcess({
      bench1m: bench,
      anchor,
      baseAfterT0: false,
      tokenRet1h: 0.01,
      tokenRet4h: 0.01,
      tokenRet24h: 0.01,
      baselineVolDaily: VOL,
    });
    expect(r.benchRet4h).toBeCloseTo(bench4h, 10);
    expect(r.excessRet4h).toBeCloseTo(0.01 - bench4h, 10);
  });

  it("z 值 = excess / (日波动 × sqrt(h/1d))", () => {
    const anchor = T0;
    const bench = makeCandles(anchor - 60 * MINUTE, 60 + 1441, () => 100); // 基准不动
    const r = computeExcess({
      bench1m: bench,
      anchor,
      baseAfterT0: false,
      tokenRet1h: 0.01,
      tokenRet4h: 0.02,
      tokenRet24h: -0.03,
      baselineVolDaily: VOL,
    });
    expect(r.excessRet4h).toBeCloseTo(0.02, 12);
    expect(r.z4h).toBeCloseTo(0.02 / (VOL * Math.sqrt(4 / 24)), 10);
    expect(r.z24h).toBeCloseTo(-0.03 / VOL, 10);
  });

  it("缺 token 收益或基准时输出 null，不回退成 0", () => {
    const anchor = T0;
    const r = computeExcess({
      bench1m: makeCandles(anchor - 60 * MINUTE, 60, () => 100), // 只有 base，没有未来
      anchor,
      baseAfterT0: false,
      tokenRet1h: 0.01,
      tokenRet4h: 0.01,
      tokenRet24h: null,
      baselineVolDaily: VOL,
    });
    expect(r.benchRet4h).toBeNull();
    expect(r.excessRet4h).toBeNull();
    expect(r.excessRet24h).toBeNull();

    const r2 = computeExcess({
      bench1m: makeCandles(anchor - 60 * MINUTE, 60 + 1441, () => 100),
      anchor,
      baseAfterT0: false,
      tokenRet1h: null,
      tokenRet4h: null,
      tokenRet24h: null,
      baselineVolDaily: VOL,
    });
    expect(r2.excessRet4h).toBeNull();
  });

  it("无波动基准 → z 为 null，但 excess 仍可算", () => {
    const anchor = T0;
    const r = computeExcess({
      bench1m: makeCandles(anchor - 60 * MINUTE, 60 + 1441, () => 100),
      anchor,
      baseAfterT0: false,
      tokenRet1h: 0.01,
      tokenRet4h: 0.02,
      tokenRet24h: 0.02,
      baselineVolDaily: null,
    });
    expect(r.excessRet4h).toBeCloseTo(0.02, 12);
    expect(r.z4h).toBeNull();
  });

  it("baseAfterT0：基准从 anchor 那一刻起算", () => {
    const anchor = T0 + 2 * MINUTE; // 模拟 token 第一根成交
    const bench = makeCandles(anchor - 60 * MINUTE, 60 + 1441, (i) => 100 + i * 0.01);
    const r = computeExcess({
      bench1m: bench,
      anchor,
      baseAfterT0: true,
      tokenRet1h: 0,
      tokenRet4h: 0,
      tokenRet24h: 0,
      baselineVolDaily: VOL,
    });
    const base = 100 + 60 * 0.01; // anchor 当根（index 60）收盘
    const bench4h = (100 + (60 + 240) * 0.01) / base - 1;
    expect(r.benchRet4h).toBeCloseTo(bench4h, 10);
    expect(r.excessRet4h).toBeCloseTo(-bench4h, 10);
  });

  it("版本号固定为 v2", () => {
    expect(EXPECTATION_VERSION).toBe("v2");
  });
});
