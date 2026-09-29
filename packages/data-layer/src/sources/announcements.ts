/**
 * 交易所公告 → 上币事件适配器（免 key）。
 * - Binance CMS 公告 API（需要浏览器 UA）
 * - Bybit 官方公告 API
 *
 * 注意：Binance catalog 48 名义上是"新币上线"，实际混有合约上线 / 股票交易 /
 * 代币化证券抵押 / 保证金交易对 等噪音。这里用排除规则 + 分类规则把范围收敛到
 * **现货代币上线（含 bStocks 代币化证券）**。
 *
 * 事件类型最终仍可由 @cee/judgment 复核；这里做高召回的规则预筛。
 */
import type { DataSourceAdapter, FetchContext, NormalizedRecord, RawPayload } from "../types";

const UA = {
  "User-Agent": "Mozilla/5.0 (compatible; MoonEventBot/0.1)",
  accept: "application/json",
};

/** 明确不是"现货代币上线"的公告 */
const EXCLUDE_RE =
  /Stocks on Binance Stock Trading|as Collateral Asset|Cash Dividend|Trading Bots Services|Margin Will Add New Pairs|Quarterly \d+ Delivery Contract|Convert.*New Pairs/i;

/** bStocks / 代币化证券 → RWA */
const RWA_RE = /bStocks|Tokenized Securit/i;

/** 合约上线（另立一类，本轮不纳入 listing_cex） */
const FUTURES_RE = /Futures Will Launch|Perpetual Contract|Pre-IPO Trading/i;

/** 现货上线的典型措辞 */
const SPOT_LISTING_RE =
  /Will List|\bLists\b|\bListed\b|Will Add .* on (Earn|Buy Crypto|Convert|VIP Loan|Margin|Spot)|Adds .* Trading Pair|New Cryptocurrency Listing/i;

export interface ListingClassification {
  event_type: string;
  asset_class_hint: "crypto" | "rwa" | null;
}

/** 判断一条公告是不是现货代币上线；不是则返回 null */
export function classifyListing(title: string): ListingClassification | null {
  if (EXCLUDE_RE.test(title)) return null;
  if (FUTURES_RE.test(title)) return null;
  if (RWA_RE.test(title) && /Trading Pair|Will List|Will Add|Adds/i.test(title)) {
    return { event_type: "listing_cex", asset_class_hint: "rwa" };
  }
  if (SPOT_LISTING_RE.test(title)) {
    return { event_type: "listing_cex", asset_class_hint: "crypto" };
  }
  return null;
}

/**
 * 从标题抽取全部代币符号。
 * 支持：括号符号（含中文名）、多代币公告、XXXUSDT 合约写法、$SYMBOL。
 */
export function extractSymbols(title: string): string[] {
  const out: string[] = [];
  for (const m of title.matchAll(/\(([^()\s]{1,24})\)/g)) {
    const g = m[1]!;
    if (/^\d{4}-\d{2}-\d{2}$/.test(g)) continue; // 排除日期括号
    out.push(g.toUpperCase());
  }
  if (!out.length) {
    const pair = title.match(/\b([A-Z0-9]{2,10})USDT\b/);
    if (pair?.[1]) out.push(pair[1]);
  }
  if (!out.length) {
    const dollar = title.match(/\$([A-Za-z0-9]{1,12})\b/);
    if (dollar?.[1]) out.push(dollar[1].toUpperCase());
  }
  return [...new Set(out)];
}

/** 兼容旧调用：取第一个符号 */
export function extractSymbol(title: string): string | null {
  return extractSymbols(title)[0] ?? null;
}

/** 向后兼容的布尔判断 */
export function isListingAnnouncement(title: string): boolean {
  return classifyListing(title) !== null;
}

// ---------------- Binance ----------------

/** Binance CMS 公告目录：48 = New Cryptocurrency Listing（实际内容较杂） */
export const BINANCE_LISTING_CATALOG = 48;

export const binanceAnnouncementsAdapter: DataSourceAdapter = {
  id: "binance-announcements",
  type: "listing",

  async fetch(ctx: FetchContext): Promise<RawPayload[]> {
    const config = ctx.config as any;
    const base = config.base_url ?? "https://www.binance.com";
    const catalogId = config.catalog_id ?? BINANCE_LISTING_CATALOG;
    const pageSize = config.page_size ?? 50;
    const pageFrom = config.page_from ?? 1;
    const maxPages = config.max_pages ?? 1;

    const out: RawPayload[] = [];
    for (let i = 0; i < maxPages; i++) {
      const pageNo = pageFrom + i;
      const url = `${base}/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=${catalogId}&pageNo=${pageNo}&pageSize=${pageSize}`;
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`binance-announcements ${res.status} page=${pageNo}`);
      const payload: any = await res.json();
      out.push({ entity: "event", request: { url, catalogId, pageNo }, payload });
      const articles: any[] = payload?.data?.catalogs?.flatMap((c: any) => c.articles ?? []) ?? [];
      if (articles.length < pageSize) break; // 最后一页
    }
    return out;
  },

  normalize(raw: RawPayload): NormalizedRecord[] {
    const payload = raw.payload as any;
    const articles: any[] = payload?.data?.catalogs?.flatMap((c: any) => c.articles ?? []) ?? [];
    const base = "https://www.binance.com/en/support/announcement/detail/";
    const out: NormalizedRecord[] = [];
    for (const a of articles) {
      const title: string = a.title ?? "";
      if (!title) continue;
      const cls = classifyListing(title);
      if (!cls) continue;
      const symbols = extractSymbols(title);
      if (!symbols.length) continue;
      const t0 = new Date(a.releaseDate).toISOString();
      for (const symbol of symbols) {
        out.push({
          record_type: "event",
          ext_id: `${a.id}:${symbol}`,
          event_type: cls.event_type,
          token_symbol: symbol,
          t0,
          t0_confidence: "high",
          source_url: `${base}${a.code}`,
          detail: {
            title,
            exchange: "binance",
            catalog_id: BINANCE_LISTING_CATALOG,
            asset_class_hint: cls.asset_class_hint,
          },
          dedupe_key: `binance-announcements|${a.code ?? a.id}|${symbol}`,
        });
      }
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
      if (!title) continue;
      const cls = classifyListing(title);
      if (!cls) continue;
      const symbols = extractSymbols(title);
      if (!symbols.length) continue;
      const t0 = new Date(a.publishTime).toISOString();
      for (const symbol of symbols) {
        out.push({
          record_type: "event",
          ext_id: `${a.url}:${symbol}`,
          event_type: cls.event_type,
          token_symbol: symbol,
          t0,
          t0_confidence: "high",
          source_url: a.url,
          detail: {
            title,
            exchange: "bybit",
            type: a.type?.key,
            asset_class_hint: cls.asset_class_hint,
          },
          dedupe_key: `bybit-announcements|${a.url}|${symbol}`,
        });
      }
    }
    return out;
  },
};
