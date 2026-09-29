/**
 * 反应计算引擎（纯函数，可单测）。
 * 口径见 PLAN.md §1.5 与 DATA-LAYER.md。
 *
 *   base   = T0 前最近一根 1m 收盘（无则退化为 T0 后第一根）
 *   ret_Δ  = price(T0+Δ) / base - 1        Δ ∈ {5m,15m,1h,4h,24h}
 *   vol_Δ  = 窗口内 1m 对数收益标准差
 *   vol_ratio = 事件后 1h 成交量 / 事件前 30 天同长度窗口成交量中位数
 *   max_favorable / max_drawdown = [T0, T0+4h] 内相对 base 的最大涨/跌幅
 *   adv_30d = 事件前 30 天日均成交额（USD），用于流动性过滤
 */

export const METHODOLOGY_VERSION = "v1";

/** 收益/波动的时间窗（分钟） */
export const HORIZONS_MIN = [5, 15, 60, 240, 1440] as const;
export type HorizonMin = (typeof HORIZONS_MIN)[number];

/** 最大涨跌幅的计算窗口（分钟） */
export const EXTREME_WINDOW_MIN = 240;

/** 接受报价的时间容差（分钟）：找不到刚好落在 T0+Δ 的 K 线时允许的偏差 */
export const TOLERANCE_MIN = 10;

export const DEFAULT_ADV_THRESHOLD_USD = 500_000;

/** 少于这个天数的基准历史 → 流动性判定为 unknown（null），而非 low */
export const MIN_BASELINE_DAYS = 7;

export const MINUTE = 60_000;
export const DAY_MS = 86_400_000;

export interface Candle {
  ts: number; // epoch ms（K 线开盘时间）
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ReactionMetrics {
  priceSource: string;
  basePrice: number;
  baseTs: number;
  /** base 是否退化为 T0 之后的 K 线 */
  baseAfterT0: boolean;
  ret5m: number | null;
  ret15m: number | null;
  ret1h: number | null;
  ret4h: number | null;
  ret24h: number | null;
  vol5m: number | null;
  vol1h: number | null;
  volRatio: number | null;
  maxDrawdown: number | null;
  maxFavorable: number | null;
  adv30d: number;
  /** null = 基准历史不足（如新币上线），无法判定 */
  liquidityOk: boolean | null;
  methodologyVersion: string;
}

export interface ComputeOptions {
  priceSource: string;
  advThresholdUsd?: number;
  methodologyVersion?: string;
}

function sortByTs(candles: Candle[]): Candle[] {
  return [...candles].sort((a, b) => a.ts - b.ts);
}

/** 找 ts <= target 的最后一根；找不到返回 null */
function lastAtOrBefore(candles: Candle[], target: number): Candle | null {
  let lo = 0;
  let hi = candles.length - 1;
  let ans: Candle | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = candles[mid]!;
    if (c.ts <= target) {
      ans = c;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function firstAfter(candles: Candle[], target: number): Candle | null {
  for (const c of candles) if (c.ts > target) return c;
  return null;
}

/** 找 ts >= target 的第一根 */
function firstAtOrAfter(candles: Candle[], target: number): Candle | null {
  for (const c of candles) if (c.ts >= target) return c;
  return null;
}

/** 离 target 最近、且偏差在容差内的 K 线 */
function nearest(candles: Candle[], target: number, tolMs: number): Candle | null {
  const a = lastAtOrBefore(candles, target);
  const b = firstAtOrAfter(candles, target);
  const cands = [a, b].filter((c): c is Candle => c !== null);
  if (!cands.length) return null;
  let best = cands[0]!;
  for (const c of cands) if (Math.abs(c.ts - target) < Math.abs(best.ts - target)) best = c;
  return Math.abs(best.ts - target) <= tolMs ? best : null;
}

/** [from, to) 半开窗口：用于“持续 N 分钟”的统计，避免端点重复计数 */
function window(candles: Candle[], from: number, to: number): Candle[] {
  return candles.filter((c) => c.ts >= from && c.ts < to);
}

/** [from, to] 闭区间：用于取区间内极值 */
function windowInclusive(candles: Candle[], from: number, to: number): Candle[] {
  return candles.filter((c) => c.ts >= from && c.ts <= to);
}

/** 窗口内 1m 对数收益标准差 */
function realizedVol(candles: Candle[]): number | null {
  if (candles.length < 3) return null;
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!.close;
    const cur = candles[i]!.close;
    if (prev > 0 && cur > 0) rets.push(Math.log(cur / prev));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * 事件前 30 天「同长度窗口」成交量中位数。
 * 用小时桶近似：把 30 天按 1 小时切分，取各桶成交量中位数。
 */
function baselineHourlyVolume(hourly: Candle[], t0: number): number | null {
  const from = t0 - 30 * DAY_MS;
  const vols = windowInclusive(hourly, from, t0 - 60 * MINUTE).map((c) => c.volume);
  return median(vols);
}

function adv30d(hourly: Candle[], t0: number): number {
  const from = t0 - 30 * DAY_MS;
  const rows = windowInclusive(hourly, from, t0);
  if (!rows.length) return 0;
  const notional = rows.reduce((a, c) => a + c.close * c.volume, 0);
  const spanDays = Math.max(1, (t0 - rows[0]!.ts) / DAY_MS);
  return notional / spanDays;
}

/**
 * 计算一条事件的反应指标。
 * @param candles1m 覆盖 [T0-something, T0+24h] 的 1m K 线
 * @param hourly    覆盖 [T0-30d, T0] 的 1h K 线（用于基准量与 ADV）
 */
export function computeReactions(
  candles1m: Candle[],
  hourly: Candle[],
  t0: number,
  opts: ComputeOptions,
): ReactionMetrics | null {
  const m1 = sortByTs(candles1m.filter((c) => c.close > 0));
  const hr = sortByTs(hourly);
  if (!m1.length) return null;

  // base 取“已在 T0 或之前收盘”的最后一根（避免 T0 那一分钟的前视偏差）
  const before = lastAtOrBefore(m1, t0 - MINUTE);
  const fallback = firstAtOrAfter(m1, t0);
  const base = before ?? fallback;
  if (!base) return null;
  const basePrice = base.close;
  const baseAfterT0 = !before;

  const retAt = (minutes: number): number | null => {
    const c = nearest(m1, t0 + minutes * MINUTE, TOLERANCE_MIN * MINUTE);
    return c ? c.close / basePrice - 1 : null;
  };

  const extrema = windowInclusive(m1, t0, t0 + EXTREME_WINDOW_MIN * MINUTE);
  const maxFavorable = extrema.length
    ? Math.max(...extrema.map((c) => c.high)) / basePrice - 1
    : null;
  const maxDrawdown = extrema.length
    ? Math.min(...extrema.map((c) => c.low)) / basePrice - 1
    : null;

  const vol1hWindow = window(m1, t0, t0 + 60 * MINUTE);
  const vol5mWindow = window(m1, t0, t0 + 5 * MINUTE);
  const eventHourVolume = vol1hWindow.reduce((a, c) => a + c.volume, 0);
  const baseline = baselineHourlyVolume(hr, t0);
  const volRatio =
    baseline && baseline > 0 && vol1hWindow.length ? eventHourVolume / baseline : null;

  const adv = adv30d(hr, t0);
  const threshold = opts.advThresholdUsd ?? DEFAULT_ADV_THRESHOLD_USD;
  // 基准历史不足（新币上线等）→ 不做流动性判定，标为 unknown
  const coverageDays = hr.length ? (t0 - hr[0]!.ts) / DAY_MS : 0;
  const liquidityOk = coverageDays >= MIN_BASELINE_DAYS ? adv >= threshold : null;

  return {
    priceSource: opts.priceSource,
    basePrice,
    baseTs: base.ts,
    baseAfterT0,
    ret5m: retAt(5),
    ret15m: retAt(15),
    ret1h: retAt(60),
    ret4h: retAt(240),
    ret24h: retAt(1440),
    vol5m: realizedVol(vol5mWindow),
    vol1h: realizedVol(vol1hWindow),
    volRatio,
    maxDrawdown,
    maxFavorable,
    adv30d: adv,
    liquidityOk,
    methodologyVersion: opts.methodologyVersion ?? METHODOLOGY_VERSION,
  };
}
