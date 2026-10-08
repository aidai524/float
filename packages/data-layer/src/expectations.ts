/**
 * Phase 4.2/4.3 v2：市场调整与波动标准化（纯函数，可单测）。
 *
 * 为什么需要它：
 *   解锁的原始收益中位数在各稀释桶都 ≈ 0 —— 加密市场的 beta 噪声盖过了事件效应。
 *   这一层把「代币相对市场的超常收益」和「相对自身正常波动的偏离」拆出来。
 *
 * 口径（v2）：
 *   bench_ret_h  = BTC(T0+h) / BTC(T0) - 1     （与 token 相同的 anchor / 容差逻辑）
 *   excess_ret_h = ret_h - bench_ret_h         （一阶市场调整，β=1）
 *   z_h          = excess_ret_h / (σ_daily × sqrt(h/1d))
 *   σ_daily      = 事件前 30 天 1h 对数收益标准差 × sqrt(24)
 *
 * 注意：z 用代币自身事前波动做标准化，不是回归残差波动；口径变更新建版本。
 */
import {
  firstAtOrAfter,
  lastAtOrBefore,
  nearest,
  DAY_MS,
  MINUTE,
  TOLERANCE_MIN,
  type Candle,
} from "./reactions";

export const EXPECTATION_VERSION = "v2";

/** 事前波动回看窗口（天） */
export const BASELINE_WINDOW_DAYS = 30;
/** 少于这个天数的基准历史 → 无法标准化（返回 null） */
export const MIN_BASELINE_DAYS = 7;
/** 至少需要的小时收益样本数（3 天） */
export const MIN_BASELINE_HOURLY = 72;
/** 市场调整覆盖的窗口（分钟）——与事件反应对齐 */
export const EXCESS_HORIZONS_MIN = [60, 240, 1440] as const;

/**
 * 事件前 30 天日波动：1h 对数收益样本标准差 × sqrt(24)。
 * 历史不足（新币）或数据太少 → null。
 */
export function baselineDailyVol(hourly: Candle[], t0: number): number | null {
  const from = t0 - BASELINE_WINDOW_DAYS * DAY_MS;
  const rows = [...hourly]
    .filter((c) => c.close > 0 && c.ts >= from && c.ts < t0)
    .sort((a, b) => a.ts - b.ts);
  if (rows.length < MIN_BASELINE_HOURLY) return null;
  if (t0 - rows[0]!.ts < MIN_BASELINE_DAYS * DAY_MS) return null;

  const rets: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    rets.push(Math.log(rows[i]!.close / rows[i - 1]!.close));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(24);
}

export interface ExcessSet {
  benchRet1h: number | null;
  benchRet4h: number | null;
  benchRet24h: number | null;
  excessRet1h: number | null;
  excessRet4h: number | null;
  excessRet24h: number | null;
  baselineVolDaily: number | null;
  z1h: number | null;
  z4h: number | null;
  z24h: number | null;
}

export interface ComputeExcessOptions {
  /** 覆盖 [anchor-1h, anchor+25h] 的基准 1m K 线（如 BTCUSDT） */
  bench1m: Candle[];
  /** 与事件反应相同的锚点（base_after_t0 ? base_ts : t0），epoch ms */
  anchor: number;
  baseAfterT0: boolean;
  tokenRet1h: number | null;
  tokenRet4h: number | null;
  tokenRet24h: number | null;
  baselineVolDaily: number | null;
}

/** 基准在 anchor 处的收盘价（镜像反应引擎的 base 规则） */
function benchmarkBase(bench: Candle[], anchor: number, baseAfterT0: boolean): Candle | null {
  if (baseAfterT0) return lastAtOrBefore(bench, anchor) ?? firstAtOrAfter(bench, anchor);
  return lastAtOrBefore(bench, anchor - MINUTE) ?? firstAtOrAfter(bench, anchor);
}

/** 把 h 分钟窗口的超常收益标准化为 sigma 倍数 */
function zScore(excess: number | null, minutes: number, dailyVol: number | null): number | null {
  if (excess == null || dailyVol == null || !(dailyVol > 0)) return null;
  const expected = dailyVol * Math.sqrt(minutes / 1440);
  return expected > 0 ? excess / expected : null;
}

/**
 * 计算基准收益、超常收益（市场调整后）与 z 值。
 * 任一输入缺失时对应字段为 null，绝不回退成 0。
 */
export function computeExcess(opts: ComputeExcessOptions): ExcessSet {
  const bench = [...opts.bench1m].filter((c) => c.close > 0).sort((a, b) => a.ts - b.ts);
  const base = benchmarkBase(bench, opts.anchor, opts.baseAfterT0);

  const benchRet = (minutes: number): number | null => {
    if (!base) return null;
    const c = nearest(bench, opts.anchor + minutes * MINUTE, TOLERANCE_MIN * MINUTE);
    return c ? c.close / base.close - 1 : null;
  };

  const mk = (
    minutes: number,
    tokenRet: number | null,
  ): { bench: number | null; excess: number | null; z: number | null } => {
    const b = benchRet(minutes);
    const excess = b != null && tokenRet != null ? tokenRet - b : null;
    return { bench: b, excess, z: zScore(excess, minutes, opts.baselineVolDaily) };
  };

  const h1 = mk(60, opts.tokenRet1h);
  const h4 = mk(240, opts.tokenRet4h);
  const h24 = mk(1440, opts.tokenRet24h);

  return {
    benchRet1h: h1.bench,
    benchRet4h: h4.bench,
    benchRet24h: h24.bench,
    excessRet1h: h1.excess,
    excessRet4h: h4.excess,
    excessRet24h: h24.excess,
    baselineVolDaily: opts.baselineVolDaily,
    z1h: h1.z,
    z4h: h4.z,
    z24h: h24.z,
  };
}
