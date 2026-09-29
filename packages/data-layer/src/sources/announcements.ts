/**
 * 交易所公告 → 上币事件适配器（免 key）。
 * - Binance CMS 公告 API（需要浏览器 UA）
 * - Bybit 官方公告 API
 *
 * 事件类型的最终判定由 @cee/judgment 的 classifyEventType 在富化阶段完成；
 * 这里只做高召回的预筛（regex），命中即标 listing_cex，否则 unknown。
 */
import type { DataSourceAdapter, FetchContext, NormalizedRecord, RawPayload } from "../types";

const UA = {
  "User-Agent": "Mozilla/5.0 (compatible; MoonEventBot/0.1)",
  accept: "application/json",
};

const LISTING_RE =
  /\bwill list\b|\blists\b|\blisted\b|\bnew listing\b|\bwill launch\b[^.]*\b(perpetual|contract|futures)\b|\bwill add\b[^.]*\b(spot|trading|margin|perpetual)\b|\blaunchpool\b|\bhodler airdrop\b/i;

export function isListingAnnouncement(title: string): boolean {
  return LISTING_RE.test(title);
}

/** 从标题里抽代币符号：优先括号，其次 $SYMBOL */
export function extractSymbol(title: string): string | null {
  const paren = title.match(/\(([A-Za-z0-9]{1,12})\)/);
  if (paren?.[1]) return paren[1].toUpperCase();
  const dollar = title.match(/\$([A-Za-z0-9]{1,12})\b/);
  if (dollar?.[1]) return dollar[1].toUpperCase();
  return null;
}

function priceEventType(title: string): "listing_cex" | "unknown" {
  return isListingAnnouncement(title) ? "listing_cex" : "unknown";
}

// ---------------- Binance ----------------
export const binanceAnnouncementsAdapter: DataSourceAdapter = {
  id: "binance-announcements",
  type: "listing",

  async fetch(ctx: FetchContext): Promise<RawPayload[]> {
    const config = ctx.config as any;
    const base = config.base_url ?? "https://www.binance.com";
    const catalogId = config.catalog_id ?? 48; // New Cryptocurrency Listing
    const pageSize = config.page_size ?? 50;
    const url = `${base}/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=${catalogId}&pageNo=1&pageSize=${pageSize}`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`binance-announcements ${res.status}`);
    return [{ entity: "event", request: { url }, payload: await res.json() }];
  },

  normalize(raw: RawPayload): NormalizedRecord[] {
    const payload = raw.payload as any;
    const articles: any[] = payload?.data?.catalogs?.flatMap((c: any) => c.articles ?? []) ?? [];
    const base = "https://www.binance.com/en/support/announcement/detail/";
    const out: NormalizedRecord[] = [];
    for (const a of articles) {
      const title: string = a.title ?? "";
      const symbol = extractSymbol(title);
      if (!title || !symbol) continue;
      out.push({
        record_type: "event",
        ext_id: String(a.id),
        event_type: priceEventType(title),
        token_symbol: symbol,
        t0: new Date(a.releaseDate).toISOString(),
        t0_confidence: "high",
        source_url: `${base}${a.code}`,
        detail: { title, exchange: "binance" },
        dedupe_key: `binance-announcements|${a.code ?? a.id}`,
      });
    }
    return out;
  },
};

// ---------------- Bybit ----------------
export const bybitAnnouncementsAdapter: DataSourceAdapter = {
  id: "bybit-announcements",
  type: "listing",

  async fetch(ctx: FetchContext): Promise<RawPayload[]> {
    const config = ctx.config as any;
    const base = config.base_url ?? "https://api.bybit.com";
    const limit = config.limit ?? 50;
    const url = `${base}/v5/announcements/index?locale=en-US&limit=${limit}`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`bybit-announcements ${res.status}`);
    return [{ entity: "event", request: { url }, payload: await res.json() }];
  },

  normalize(raw: RawPayload): NormalizedRecord[] {
    const payload = raw.payload as any;
    const list: any[] = payload?.result?.list ?? [];
    const out: NormalizedRecord[] = [];
    for (const a of list) {
      const title: string = a.title ?? "";
      if (!title || !isListingAnnouncement(title)) continue;
      const symbol = extractSymbol(title);
      if (!symbol) continue;
      out.push({
        record_type: "event",
        ext_id: a.url,
        event_type: "listing_cex",
        token_symbol: symbol,
        t0: new Date(a.publishTime).toISOString(),
        t0_confidence: "high",
        source_url: a.url,
        detail: { title, exchange: "bybit", type: a.type?.key },
        dedupe_key: `bybit-announcements|${a.url}`,
      });
    }
    return out;
  },
};
