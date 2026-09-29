/**
 * CoinMarketCap 代币解锁适配器（免费、无需 key）。
 *
 * 端点：
 *   GET /data-api/v3/token-unlock/listing
 *       ?start=1&limit=100&sort=next_unlocked_date&direction=desc&enableSmallUnlocks=true
 *
 * 已知限制（实测）：
 *   - 只返回"即将解锁"的约 99 条（滚动窗口，约未来 24 小时）
 *   - start>1 分页返回空；sort/date 参数被忽略
 *   - 无历史数据
 * → 需要定期轮询累积；历史基准要么靠累积，要么用付费源。
 */
import type { DataSourceAdapter, FetchContext, NormalizedRecord, RawPayload } from "../types";

const CMC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface UnlockItem {
  symbol: string;
  slug?: string;
  name?: string;
  cryptoId?: number;
  totalSupply?: number;
  circulatingSupply?: number;
  totalUnlockedPercentage?: number;
  nextUnlocked?: {
    tokenAmount?: number;
    tokenAmountUsd?: number;
    tokenAmountPercentage?: number; // 单位是 %（0.03 表示 0.03%）
    date?: number; // epoch ms
  };
  nextUnlockedDetail?: Array<{
    tokenAmount?: number;
    tokenAmountUsd?: number;
    allocationName?: string;
    vestingType?: string;
  }>;
}

async function fetchWithRetry(url: string, attempts = 3): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": CMC_UA,
          accept: "application/json",
          referer: "https://coinmarketcap.com/token-unlocks/",
        },
      });
      if (res.ok) return await res.json();
      lastErr = new Error(`cmc-unlocks ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error("cmc-unlocks failed");
}

export const coinMarketCapUnlocksAdapter: DataSourceAdapter = {
  id: "coinmarketcap-unlocks",
  type: "unlock",

  async fetch(ctx: FetchContext): Promise<RawPayload[]> {
    const config = ctx.config as any;
    const base = config.base_url ?? "https://api.coinmarketcap.com";
    const limit = config.limit ?? 100;
    const url = `${base}/data-api/v3/token-unlock/listing?start=1&limit=${limit}&sort=next_unlocked_date&direction=desc&enableSmallUnlocks=true`;
    const payload = await fetchWithRetry(url);
    return [{ entity: "event", request: { url }, payload }];
  },

  normalize(raw: RawPayload): NormalizedRecord[] {
    const list: UnlockItem[] = (raw.payload as any)?.data?.tokenUnlockList ?? [];
    const out: NormalizedRecord[] = [];
    for (const t of list) {
      const n = t.nextUnlocked;
      if (!n?.date || !t.symbol) continue;
      const amountPctOfTotal = n.tokenAmountPercentage ?? null; // 单位 %
      const allocation = t.nextUnlockedDetail?.[0]?.allocationName ?? null;
      const vestingType = t.nextUnlockedDetail?.[0]?.vestingType ?? null;
      const isCliff = String(vestingType ?? "")
        .toLowerCase()
        .includes("cliff");
      out.push({
        record_type: "event",
        ext_id: `${t.symbol}:${n.date}`,
        event_type: isCliff ? "unlock_cliff" : "unlock_linear",
        token_symbol: t.symbol.toUpperCase(),
        t0: new Date(n.date).toISOString(),
        t0_confidence: "high",
        // 我们的 magnitude_pct 是"占比"（0.01 = 1%），CMC 给的是百分数
        magnitude_pct: amountPctOfTotal == null ? undefined : amountPctOfTotal / 100,
        magnitude_usd: n.tokenAmountUsd ?? undefined,
        source_url: `https://coinmarketcap.com/currencies/${t.slug ?? t.symbol}/`,
        detail: {
          title: `${t.symbol} ${isCliff ? "悬崖" : "线性"}解锁 ${allocation ?? ""}`.trim(),
          exchange: "coinmarketcap",
          allocation,
          vesting_type: vestingType,
          token_amount: n.tokenAmount ?? null,
          pct_of_total_supply: amountPctOfTotal,
          total_unlocked_pct: t.totalUnlockedPercentage ?? null,
          circulating_supply: t.circulatingSupply ?? null,
          total_supply: t.totalSupply ?? null,
        },
        dedupe_key: `cmc-unlocks|${t.symbol.toUpperCase()}|${n.date}`,
      });
    }
    return out;
  },
};
