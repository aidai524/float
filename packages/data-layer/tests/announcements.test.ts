import { describe, expect, it } from "vitest";
import {
  binanceAnnouncementsAdapter,
  bybitAnnouncementsAdapter,
  extractSymbol,
  isListingAnnouncement,
} from "../src/sources/announcements";

describe("公告文本工具", () => {
  it("识别上币公告", () => {
    expect(
      isListingAnnouncement("Binance Will List Hyperliquid (HYPE) with Seed Tag Applied"),
    ).toBe(true);
    expect(isListingAnnouncement("Binance Will Add Hyperliquid (HYPE) on Earn, Margin")).toBe(true);
    // 合约上线不算现货代币上线（另立一类，本轮不纳入）
    expect(
      isListingAnnouncement("Binance Futures Will Launch Multiple TradFi Perpetual Contracts"),
    ).toBe(false);
    expect(isListingAnnouncement("Bybit Copy Trading now supports TradFi Perpetuals")).toBe(false);
    expect(isListingAnnouncement("Binance Adds 5 Stocks on Stock Trading")).toBe(false);
    expect(
      isListingAnnouncement("Binance Will Add 3 bStocks Tokenized Securities as Collateral Asset"),
    ).toBe(false);
  });

  it("抽取代币符号", () => {
    expect(extractSymbol("Binance Will List Hyperliquid (HYPE)")).toBe("HYPE");
    expect(extractSymbol("Listing of $ARB")).toBe("ARB");
    expect(extractSymbol("No symbol here")).toBeNull();
  });
});

describe("Binance 公告适配器", () => {
  it("normalize 过滤出上币事件", () => {
    const payload = {
      data: {
        catalogs: [
          {
            articles: [
              {
                id: 1,
                code: "abc",
                title: "Binance Will List Foo (FOO)",
                releaseDate: 1790235038608,
              },
              { id: 2, code: "def", title: "Binance Adds 5 Stocks", releaseDate: 1790589613103 },
              { id: 3, code: "ghi", title: "Some maintenance notice", releaseDate: 1790589613103 },
            ],
          },
        ],
      },
    };
    const recs = binanceAnnouncementsAdapter.normalize({
      entity: "event",
      request: {},
      payload,
    });
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      record_type: "event",
      event_type: "listing_cex",
      token_symbol: "FOO",
      t0_confidence: "high",
    });
    expect(recs[0]?.source_url).toContain("/abc");
  });
});

describe("Bybit 公告适配器", () => {
  it("normalize 过滤出上币事件", () => {
    const payload = {
      result: {
        list: [
          {
            title: "Bybit Lists New Token (NEW)",
            url: "https://announcements.bybit.com/xx",
            publishTime: 1790590228000,
            type: { key: "new_crypto" },
          },
          {
            title: "Campaign: share prize pool",
            url: "u2",
            publishTime: 1,
            type: { key: "campaign" },
          },
        ],
      },
    };
    const recs = bybitAnnouncementsAdapter.normalize({ entity: "event", request: {}, payload });
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ token_symbol: "NEW", event_type: "listing_cex" });
  });
});
