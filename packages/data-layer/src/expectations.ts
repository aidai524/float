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

/** 长窗口（1h K 线分辨率，±1h）；pre = 事件前漂移，post = 解锁后漂移 */
export interface LongWindowSet {
  preRet24h: number | null;
  preExcess24h: number | null;
  preRet72h: number | null;
  preExcess72h: number | null;
  ret72h: number | null;
  excessRet72h: number | null;
  z72h: number | null;
  ret168h: number | null;
  excessRet168h: number | null;
  z168h: number | null;
}

/** placebo 窗口偏移：事件前 21 天（同一代币的非事件窗口） */
export const PLACEBO_OFFSET_MS = 21 * DAY_MS;

/** 净效应（difference-in-differences）：事件窗口超常收益 − placebo 窗口超常收益 */
export interface AbnormalSet {
  abnPre24h: number | null;
  abnPre72h: number | null;
  abn72h: number | null;
  abn168h: number | null;
}

/** 逐事件相减（配对）；任一侧缺失则净值为 null，不回退 */
export function computeAbnormal(treated: LongWindowSet, placebo: LongWindowSet): AbnormalSet {
  const diff = (a: number | null, b: number | null): number | null =>
    a != null && b != null ? a - b : null;
  return {
    abnPre24h: diff(treated.preExcess24h, placebo.preExcess24h),
    abnPre72h: diff(treated.preExcess72h, placebo.preExcess72h),
    abn72h: diff(treated.excessRet72h, placebo.excessRet72h),
    abn168h: diff(treated.excessRet168h, placebo.excessRet168h),
  };
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
 */ export function computeExcess(opts: ComputeExcessOptions): ExcessSet {
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

/** 长窗口端点允许的偏差（1h K 线分辨率） */
export const LONG_TOLERANCE_MS = 90 * MINUTE;

/** 最后一根「时间 ≤ target 且在容差内」的 K 线收盘价；否则 null（不静默回退） */
function closeAt(candles: Candle[], target: number, tolMs: number): number | null {
  const c = lastAtOrBefore(candles, target);
  if (!c || target - c.ts > tolMs) return null;
  return c.close;
}

/**
 * 长窗口：事件前漂移（pre）与解锁后漂移（post），用 1h K 线（±1h 分辨率）。
 *
 * pre 窗口为 [t0−Δ, t0−1h]——刻意排除包含事件的那根小时线，避免前视；
 * post 窗口为 [anchor, anchor+Δ]。两者都减去 BTC 同期收益。
 */
export function computeLongWindows(opts: {
  token1h: Candle[];
  bench1h: Candle[];
  t0: number;
  anchor: number;
  baselineVolDaily: number | null;
}): LongWindowSet {
  const token = [...opts.token1h].filter((c) => c.close > 0).sort((a, b) => a.ts - b.ts);
  const bench = [...opts.bench1h].filter((c) => c.close > 0).sort((a, b) => a.ts - b.ts);

  const windowRet = (candles: Candle[], from: number, to: number): number | null => {
    const a = closeAt(candles, from, LONG_TOLERANCE_MS);
    const b = closeAt(candles, to, LONG_TOLERANCE_MS);
    return a != null && b != null && a > 0 ? b / a - 1 : null;
  };

  const pre = (hours: number) => {
    const from = opts.t0 - hours * 3600_000;
    const to = opts.t0 - 3600_000; // 排除事件所在小时
    const ret = windowRet(token, from, to);
    const b = windowRet(bench, from, to);
    return { ret, excess: ret != null && b != null ? ret - b : null };
  };

  const post = (hours: number) => {
    const from = opts.anchor;
    const to = opts.anchor + hours * 3600_000;
    const ret = windowRet(token, from, to);
    const b = windowRet(bench, from, to);
    const excess = ret != null && b != null ? ret - b : null;
    return { ret, excess, z: zScore(excess, hours * 60, opts.baselineVolDaily) };
  };

  const pre24 = pre(24);
  const pre72 = pre(72);
  const post72 = post(72);
  const post168 = post(168);

  return {
    preRet24h: pre24.ret,
    preExcess24h: pre24.excess,
    preRet72h: pre72.ret,
    preExcess72h: pre72.excess,
    ret72h: post72.ret,
    excessRet72h: post72.excess,
    z72h: post72.z,
    ret168h: post168.ret,
    excessRet168h: post168.excess,
    z168h: post168.z,
  };
}
