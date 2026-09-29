/**
 * CoinMarketCal 适配器（v2 API，cursor 分页）。
 * 认证：x-api-key。事件类型交给 @cee/judgment 分类，这里只做归一化。
 */
import type { DataSourceAdapter, FetchContext, NormalizedRecord, RawPayload } from "../types";

interface CmcEvent {
  id: string;
  slug?: string;
  title: string;
  description?: string | null;
  date: string;
  dateEnd?: string | null;
  isEstimated?: boolean;
  coins?: Array<{ symbol?: string; name?: string; slug?: string }>;
  impact?: unknown;
  impactSummary?: string | null;
  sourceUrl?: string | null;
  createdAt?: string;
}

export const coinMarketCalAdapter: DataSourceAdapter = {
  id: "coinmarketcal",
  type: "listing",

  async fetch(ctx: FetchContext): Promise<RawPayload[]> {
    const config = ctx.config as any;
    const base: string = config.base_url ?? "https://api.coinmarketcal.com";
    const path: string = config.path ?? "/v2/events";
    const max = config.per_page ?? 20;
    const maxPages: number = config.max_pages ?? 5;
    const apiKey = ctx.secrets.COINMARKETCAL_API_KEY ?? "";

    const out: RawPayload[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const url = new URL(path, base);
      url.searchParams.set("max", String(max));
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url.toString(), {
        headers: { accept: "application/json", "x-api-key": apiKey },
      });
      if (!res.ok) throw new Error(`coinmarketcal ${res.status} ${url}`);
      const payload: any = await res.json();
      out.push({ entity: "event", request: { url: url.toString() }, payload });
      cursor = payload?.meta?.cursor;
      if (!cursor) break;
    }
    return out;
  },

  normalize(raw: RawPayload): NormalizedRecord[] {
    const payload = raw.payload as { data?: CmcEvent[] };
    const rows: CmcEvent[] = payload?.data ?? [];
    const out: NormalizedRecord[] = [];
    for (const e of rows) {
      const symbol = e.coins?.[0]?.symbol?.toUpperCase();
      if (!symbol || !e.date) continue;
      out.push({
        record_type: "event",
        ext_id: String(e.id),
        event_type: "unknown", // Jev 富化阶段判定
        token_symbol: symbol,
        t0: new Date(e.date).toISOString(),
        // 预估日期置信度较低
        t0_confidence: e.isEstimated ? "low" : "medium",
        source_url: e.sourceUrl ?? `https://coinmarketcal.com/en/event/${e.slug ?? e.id}`,
        detail: {
          title: e.title,
          exchange: "coinmarketcal",
          slug: e.slug,
          dateEnd: e.dateEnd ?? null,
          isEstimated: e.isEstimated ?? false,
          impact: e.impact ?? null,
          impactSummary: e.impactSummary ?? null,
          coins: e.coins?.map((c) => c.symbol),
        },
        dedupe_key: `coinmarketcal|${e.id}`,
      });
    }
    return out;
  },
};
