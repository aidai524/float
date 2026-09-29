/**
 * 预期 vs 实际（隐含波动率）。
 *
 * 思路：用 Deribit DVOL（年化隐含波动率指数，如 35 表示 35%）推导"市场预期在某个
 * 窗口内会动多少"，再和实际偏离比较，得到惊讶度。
 *
 *   implied_move(window) = DVOL/100 × sqrt(window / 一年)
 *   actual_move(window)  = [anchor, anchor+window] 内相对 base 的最大绝对偏离
 *   surprise             = actual_move / implied_move
 *
 * surprise > 1 表示实际波动超过市场定价（事件比预期更"响"）；
 * surprise < 1 表示市场已充分定价。
 */

export const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
export const MINUTE_MS = 60_000;

export interface VolPoint {
  ts: number;
  value: number; // 年化隐含波动率，百分数（35 = 35%）
}

/** 年化隐含波动率 → 指定窗口的隐含波动幅度（小数） */
export function impliedMoveFromDvol(dvolPercent: number, windowMs: number): number {
  if (!(dvolPercent > 0) || !(windowMs > 0)) return 0;
  return (dvolPercent / 100) * Math.sqrt(windowMs / YEAR_MS);
}

/** 找 ts <= target 的最后一个波动率点 */
export function volAt(points: VolPoint[], target: number): VolPoint | null {
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  let ans: VolPoint | null = null;
  for (const p of sorted) {
    if (p.ts <= target) ans = p;
    else break;
  }
  return ans;
}

/** 惊讶度 = 实际 / 隐含（隐含为 0 时返回 null） */
export function surpriseRatio(actualMove: number, impliedMove: number): number | null {
  if (!(impliedMove > 0) || !Number.isFinite(actualMove)) return null;
  return actualMove / impliedMove;
}

export interface SurpriseSet {
  implied1h: number | null;
  implied4h: number | null;
  implied24h: number | null;
  surprise1h: number | null;
  surprise4h: number | null;
  surprise24h: number | null;
}

/**
 * 由"窗口内最大绝对偏离"与 DVOL 计算惊讶度。
 * @param excursionOf 给定窗口分钟数，返回 [anchor, anchor+h] 内相对 base 的最大绝对偏离
 */
export function computeSurprise(
  dvolPercent: number | null,
  excursionOf: (minutes: number) => number | null,
): SurpriseSet {
  const empty: SurpriseSet = {
    implied1h: null,
    implied4h: null,
    implied24h: null,
    surprise1h: null,
    surprise4h: null,
    surprise24h: null,
  };
  if (dvolPercent == null || !(dvolPercent > 0)) return empty;

  const mk = (h: number) => {
    const implied = impliedMoveFromDvol(dvolPercent, h * MINUTE_MS);
    const actual = excursionOf(h);
    return {
      implied,
      surprise: actual == null ? null : surpriseRatio(actual, implied),
    };
  };
  const a = mk(60);
  const b = mk(240);
  const c = mk(1440);
  return {
    implied1h: a.implied,
    implied4h: b.implied,
    implied24h: c.implied,
    surprise1h: a.surprise,
    surprise4h: b.surprise,
    surprise24h: c.surprise,
  };
}
