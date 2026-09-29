import { describe, expect, it } from "vitest";
import {
  allocationFromDescription,
  extractNextData,
  parseDefiLlamaUnlocks,
  type DlNextData,
} from "../src/sources/defillama-unlocks";

describe("allocationFromDescription", () => {
  it("解析 'A cliff ... was unlocked from X on {timestamp}'", () => {
    expect(
      allocationFromDescription(
        "A cliff of {tokens[0]} tokens was unlocked from Public Allocation on {timestamp}",
      ),
    ).toBe("Public Allocation");
  });

  it("解析 'On {timestamp} {tokens[0]} of X tokens were unlocked'", () => {
    expect(
      allocationFromDescription(
        "On {timestamp} {tokens[0]} of R&D & Ecosystem tokens were unlocked",
      ),
    ).toBe("R&D & Ecosystem");
  });

  it("解析 '... of X tokens will be unlocked'", () => {
    expect(
      allocationFromDescription(
        "On {timestamp} {tokens[0]} of Early Backers Seed tokens will be unlocked",
      ),
    ).toBe("Early Backers Seed");
  });

  it("解析 'will unlock from X on {timestamp}'", () => {
    expect(
      allocationFromDescription(
        "A cliff of {tokens[0]} tokens will unlock from Early Contributors on {timestamp}",
      ),
    ).toBe("Early Contributors");
  });

  it("不把占位符 {tokens[0]} 当分配名", () => {
    expect(allocationFromDescription("A cliff of {tokens[0]} tokens on {timestamp}")).toBeNull();
    expect(allocationFromDescription(null)).toBeNull();
  });
});

function fixture(): DlNextData {
  return {
    props: {
      pageProps: {
        data: [
          {
            protocolSlug: "celestia",
            tSymbol: "TIA",
            gecko_id: "celestia",
            maxSupply: 1_000_000_000,
            circSupply: 800_000_000,
            tokenPrice: [{ price: 5 }],
            events: [
              // 同一时刻两个 cliff 分配 → 应聚合成一条
              {
                description:
                  "A cliff of {tokens[0]} tokens was unlocked from Public Allocation on {timestamp}",
                category: "airdrop",
                timestamp: 1_600_000_000,
                unlockType: "cliff",
                noOfTokens: [10_000_000],
              },
              {
                description:
                  "A cliff of {tokens[0]} tokens was unlocked from Ecosystem on {timestamp}",
                category: "ecosystem",
                timestamp: 1_600_000_000,
                unlockType: "cliff",
                noOfTokens: [30_000_000],
              },
              // linear 应被跳过（v1 只导 cliff）
              {
                description:
                  "Linear unlock was increased from {tokens[0]} to {tokens[1]} tokens per week from Inflation on {timestamp}",
                category: "staking",
                timestamp: 1_600_100_000,
                unlockType: "linear",
                noOfTokens: [0, 1_000_000],
                rateDurationDays: 365,
              },
            ],
          },
        ],
      },
    },
  };
}

describe("parseDefiLlamaUnlocks", () => {
  const out = parseDefiLlamaUnlocks(fixture());

  it("只导出 cliff，并把同时刻分配聚合为一条", () => {
    expect(out).toHaveLength(1);
    expect(out[0]!.event_type).toBe("unlock_cliff");
    expect(out[0]!.token_symbol).toBe("TIA");
  });

  it("数量为聚合总额，占比按 maxSupply 计算", () => {
    expect(out[0]!.detail!.token_amount).toBe(40_000_000);
    expect(out[0]!.magnitude_pct).toBeCloseTo(0.04, 6);
  });

  it("保留全部分配名与类别", () => {
    expect(out[0]!.detail!.allocations).toEqual(["Public Allocation", "Ecosystem"]);
    expect(out[0]!.detail!.categories).toEqual(["airdrop", "ecosystem"]);
    expect(out[0]!.detail!.category).toBe("airdrop");
  });

  it("历史事件不用当前价编造 USD", () => {
    expect(out[0]!.magnitude_usd).toBeUndefined();
    expect(out[0]!.detail!.usd_basis).toBe("current_price_fallback");
  });

  it("去重键稳定", () => {
    expect(out[0]!.dedupe_key).toBe("defillama-unlocks|celestia|1600000000|cliff");
  });
});

describe("extractNextData", () => {
  it("从 HTML 中取出 __NEXT_DATA__", () => {
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"data":[]}}}</script></body></html>`;
    expect(extractNextData(html)).toEqual({ props: { pageProps: { data: [] } } });
  });

  it("缺失时报错", () => {
    expect(() => extractNextData("<html></html>")).toThrow(/__NEXT_DATA__/);
  });
});
