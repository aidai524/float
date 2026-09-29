import { describe, expect, it } from "vitest";
import {
  computeSurprise,
  impliedMoveFromDvol,
  surpriseRatio,
  volAt,
  YEAR_MS,
} from "../src/implied";

describe("impliedMoveFromDvol", () => {
  it("年化 35% → 1 小时隐含幅度约 0.374%", () => {
    expect(impliedMoveFromDvol(35, 60 * 60_000)).toBeCloseTo(0.00374, 5);
  });

  it("年化 35% → 24 小时隐含幅度约 1.83%", () => {
    expect(impliedMoveFromDvol(35, 24 * 60 * 60_000)).toBeCloseTo(0.0183, 4);
  });

  it("窗口为一年时等于年化波动率", () => {
    expect(impliedMoveFromDvol(50, YEAR_MS)).toBeCloseTo(0.5, 6);
  });

  it("按时间平方根缩放（4 倍窗口 → 2 倍幅度）", () => {
    const a = impliedMoveFromDvol(40, 60 * 60_000);
    const b = impliedMoveFromDvol(40, 4 * 60 * 60_000);
    expect(b / a).toBeCloseTo(2, 6);
  });

  it("非法输入返回 0", () => {
    expect(impliedMoveFromDvol(0, 3600_000)).toBe(0);
    expect(impliedMoveFromDvol(-5, 3600_000)).toBe(0);
  });
});

describe("volAt", () => {
  const pts = [
    { ts: 1000, value: 30 },
    { ts: 2000, value: 35 },
    { ts: 3000, value: 40 },
  ];
  it("取 at/before 的最后一个点", () => {
    expect(volAt(pts, 2500)?.value).toBe(35);
    expect(volAt(pts, 3000)?.value).toBe(40);
  });
  it("早于全部点时返回 null", () => {
    expect(volAt(pts, 500)).toBeNull();
  });
  it("乱序输入也能正确", () => {
    expect(volAt([pts[2]!, pts[0]!, pts[1]!], 2500)?.value).toBe(35);
  });
});

describe("surpriseRatio", () => {
  it("实际是隐含的 2 倍 → 2.0", () => {
    expect(surpriseRatio(0.04, 0.02)).toBeCloseTo(2);
  });
  it("隐含为 0 返回 null", () => {
    expect(surpriseRatio(0.04, 0)).toBeNull();
  });
});

describe("computeSurprise", () => {
  it("无 DVOL 时全为 null", () => {
    const s = computeSurprise(null, () => 0.01);
    expect(s.implied1h).toBeNull();
    expect(s.surprise1h).toBeNull();
  });

  it("DVOL=35，实际偏离 4h 为 4% → 惊讶度约 2.73", () => {
    // implied_4h = 0.35 * sqrt(4/8760) = 0.35 * 0.02137 = 0.00748
    const s = computeSurprise(35, (h) => (h === 240 ? 0.04 : null));
    expect(s.implied4h!).toBeCloseTo(0.00748, 5);
    expect(s.surprise4h!).toBeCloseTo(0.04 / 0.00748, 2);
    expect(s.surprise1h).toBeNull();
  });

  it("窗口无数据时惊讶度为 null 但隐含值仍返回", () => {
    const s = computeSurprise(40, () => null);
    expect(s.implied1h).not.toBeNull();
    expect(s.surprise1h).toBeNull();
    expect(s.surprise24h).toBeNull();
  });
});
