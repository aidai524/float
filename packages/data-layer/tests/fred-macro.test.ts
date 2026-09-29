import { describe, expect, it } from "vitest";
import { etToUtc, fredMacroAdapter } from "../src/sources/fred-macro";

describe("etToUtc（美东 → UTC，含夏令时）", () => {
  it("冬季 EST（UTC-5）：08:30 ET → 13:30 UTC", () => {
    expect(etToUtc("2026-01-15", "08:30").toISOString()).toBe("2026-01-15T13:30:00.000Z");
  });

  it("夏季 EDT（UTC-4）：08:30 ET → 12:30 UTC", () => {
    expect(etToUtc("2026-07-15", "08:30").toISOString()).toBe("2026-07-15T12:30:00.000Z");
  });

  it("FOMC 14:00 ET 冬季 → 19:00 UTC", () => {
    expect(etToUtc("2026-12-09", "14:00").toISOString()).toBe("2026-12-09T19:00:00.000Z");
  });

  it("夏令时开始当天（2026-03-08）已是 EDT", () => {
    expect(etToUtc("2026-03-08", "08:30").toISOString()).toBe("2026-03-08T12:30:00.000Z");
  });

  it("夏令时结束当天（2026-11-01）已是 EST", () => {
    expect(etToUtc("2026-11-01", "08:30").toISOString()).toBe("2026-11-01T13:30:00.000Z");
  });
});

describe("FRED 宏观适配器", () => {
  it("normalize 产出 BTC 事件并按 since 过滤", () => {
    const raw = {
      entity: "event" as const,
      request: {
        release: { release_id: 10, event_type: "macro_cpi", time_et: "08:30", label: "CPI" },
      },
      payload: {
        release: { release_id: 10, event_type: "macro_cpi", time_et: "08:30", label: "CPI" },
        release_dates: [
          { release_id: 10, date: "2019-05-10" },
          { release_id: 10, date: "2026-07-15" },
        ],
      },
    };
    (raw.request as any).__config = { symbol: "BTC", since: "2021-01-01" };
    const recs = fredMacroAdapter.normalize(raw as any);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      event_type: "macro_cpi",
      token_symbol: "BTC",
      t0: "2026-07-15T12:30:00.000Z",
      t0_confidence: "high",
    });
  });
});
