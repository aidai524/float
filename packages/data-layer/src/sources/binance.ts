/**
 * Tier B 示例：Binance K 线适配器。
 * 免 key 主价格源。加新价格源时照抄这个文件的形状即可。
 */
import type { DataSourceAdapter, FetchContext, NormalizedRecord, RawPayload } from "../types";

export const binanceAdapter: DataSourceAdapter = {
  id: "binance",
  type: "price",

  async fetch(ctx: FetchContext): Promise<RawPayload[]> {
    const config = ctx.config as any;
    const base = (config.base_url as string) ?? "https://api.binance.com";
    const symbols: string[] = config.symbols ?? ["BTCUSDT"];
    const interval: string = config.kline_interval ?? "1m";
    const limit = config.limit ?? 500;

    const out: RawPayload[] = [];
    for (const symbol of symbols) {
      const url = `${base}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`binance ${res.status} ${symbol}`);
      out.push({ entity: "kline", request: { url, symbol, interval }, payload: await res.json() });
    }
    return out;
  },

  normalize(raw: RawPayload): NormalizedRecord[] {
    const req = raw.request as { symbol: string; interval: string };
    const rows = raw.payload as unknown[][];
    const [base] = req.symbol.split("USDT");
    return rows.map((k) => ({
      record_type: "kline",
      token_symbol: base,
      detail: { price_source: "binance", interval: req.interval },
      candle: {
        ts: new Date(Number(k[0])).toISOString(),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
      },
      dedupe_key: `${req.interval}:${k[0]}`,
    }));
  },
};
