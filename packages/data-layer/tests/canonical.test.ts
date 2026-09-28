import { describe, expect, it } from "vitest";
import { canonicalKey } from "../src/resolve";
import { recordDedupeKey } from "../src/pipeline";

describe("canonicalKey（与 SQL 函数 canonical_dedupe_key 对齐）", () => {
  it("同小时、同规模桶 → 同一 key", () => {
    const a = canonicalKey("listing_cex", "SOL", "2026-09-28T10:05:00Z", 250_000);
    const b = canonicalKey("listing_cex", "SOL", "2026-09-28T10:55:00Z", 260_000);
    expect(a).toBe(b);
  });

  it("跨小时 → 不同 key", () => {
    const a = canonicalKey("listing_cex", "SOL", "2026-09-28T10:55:00Z", 250_000);
    const b = canonicalKey("listing_cex", "SOL", "2026-09-28T11:01:00Z", 250_000);
    expect(a).not.toBe(b);
  });

  it("规模分桶边界不同 → 不同 key", () => {
    const a = canonicalKey("unlock_cliff", "ARB", "2026-09-28T00:00:00Z", 99_000);
    const b = canonicalKey("unlock_cliff", "ARB", "2026-09-28T00:00:00Z", 150_000);
    expect(a).not.toBe(b);
    expect(a).toContain("lt100k");
    expect(b).toContain("lt1m");
  });

  it("大小写与空值归一", () => {
    expect(canonicalKey("Listing_CEX", "sol", "2026-09-28T10:00:00Z", null)).toBe(
      canonicalKey("listing_cex", "SOL", "2026-09-28T10:00:00Z", null),
    );
  });
});

describe("recordDedupeKey（源内幂等）", () => {
  it("相同输入稳定", () => {
    const r = {
      record_type: "event" as const,
      event_type: "listing_cex",
      token_symbol: "SOL",
      t0: "2026-09-28T10:00:00.000Z",
      ext_id: "42",
    };
    expect(recordDedupeKey(r)).toBe(recordDedupeKey(r));
  });
});
