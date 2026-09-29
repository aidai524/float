/**
 * DefiLlama 代币解锁（免费，历史 + 未来）。
 *
 * 数据来源：https://defillama.com/unlocks 的服务端渲染页里内嵌的
 * `__NEXT_DATA__`（Next.js Pages Router）。它包含 300+ 协议的完整
 * emissions 事件：cliff / linear、时间戳、数量、category（接收方类别）
 * 以及 description 里的分配名。
 *
 * 为什么不用官方 API：`api.llama.fi/emissions*` 返回 402（付费 API 档），
 * 而 Spreadsheet Functions 插件不含解锁指标。官网 SSR 是唯一免费的完整来源。
 *
 * 注意：defillama.com 对非浏览器客户端可能返回 Cloudflare 质询；本机
 * Node/curl 直接取会 ECONNRESET，Worker/浏览器环境通常可通。抓取属网页
 * 数据，使用需署名 DefiLlama。
 */
import type { DataSourceAdapter, FetchContext, NormalizedRecord, RawPayload } from "../types";

const DL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const SOURCE_ID = "defillama-unlocks";

/**
 * v1 只导入 cliff（离散稀释冲击，带接收方、金额确定）。
 * linear 的 `noOfTokens` 是「每周速率 [from, to]」，不是单次额度；把它按
 * 速率×时长换算成金额会严重高估（如 BEAM 算出 99.97% 供应）。linear 需要
 * 单独的「速率」表达，留待后续版本。
 */
const INCLUDE_LINEAR = false;

export interface DlUnlockEvent {
  description?: string;
  category?: string;
  timestamp: number;
  unlockType?: "cliff" | "linear" | string;
  noOfTokens?: (number | null)[] | null;
  rateDurationDays?: number | null;
  hasUnknownTokenAmount?: boolean;
}

export interface DlProtocol {
  protocolSlug?: string;
  name?: string;
  gecko_id?: string | null;
  tSymbol?: string;
  maxSupply?: number | null;
  circSupply?: number | null;
  totalLocked?: number | null;
  tokenPrice?: Array<{ price?: number; symbol?: string; timestamp?: number }> | null;
  historicalPrice?: Array<[number, number]> | null;
  events?: DlUnlockEvent[] | null;
}

export interface DlNextData {
  props: { pageProps: { data: DlProtocol[]; generatedAtSec?: number } };
}

/** 从页面 HTML 中提取并解析 __NEXT_DATA__ */
export function extractNextData(html: string): DlNextData {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("defillama-unlocks: __NEXT_DATA__ not found");
  return JSON.parse(m[1] ?? "") as DlNextData;
}

/** 从 description 里抽出分配名（如 "Initial Core Contributors"、"Early Backers Seed"） */
export function allocationFromDescription(desc: string | undefined | null): string | null {
  if (!desc) return null;
  // 1) "On {timestamp} {tokens[0]} of R&D & Ecosystem tokens were/will be unlocked"
  let m = desc.match(
    /\bof (?!(?:\{|tokens))(.+?) tokens (?:will be|will|were|are|was|is)?\s*(?:unlocked|unlock)/i,
  );
  if (m) return (m[1] ?? "").trim() || null;
  // 2) "A cliff of {tokens[0]} tokens was unlocked from Public Allocation on {timestamp}"
  m = desc.match(/unlocked from (?!\{[^}]*\})(.+?) on \{timestamp\}/i);
  if (m) return (m[1] ?? "").trim() || null;
  // 3) "... will unlock from Early Contributors on {timestamp}"
  m = desc.match(/unlock from (?!\{[^}]*\})(.+?) on \{timestamp\}/i);
  if (m) return (m[1] ?? "").trim() || null;
  return null;
}

function pickPrice(
  p: DlProtocol,
  tsSec: number,
  currentPrice: number | null,
): { price: number | null; basis: string } {
  const hist = p.historicalPrice;
  if (Array.isArray(hist) && hist.length) {
    // [ [tsMs, price], ... ]，取 <= t0 的最近一点
    let best: number | null = null;
    let bestTs = -Infinity;
    for (const point of hist) {
      if (!Array.isArray(point)) continue;
      const [ms, price] = point;
      if (typeof ms !== "number" || typeof price !== "number") continue;
      if (ms / 1000 <= tsSec && ms > bestTs) {
        bestTs = ms;
        best = price;
      }
    }
    if (best != null) return { price: best, basis: "historical_price" };
  }
  return { price: currentPrice, basis: currentPrice != null ? "current_price_fallback" : "none" };
}

interface Aggregate {
  ts: number;
  unlockType: string;
  amount: number;
  allocations: Set<string>;
  categories: Set<string>;
  descriptions: string[];
}

/** 解析 __NEXT_DATA__ → 归一化解锁事件（按 协议 × 时间 × 类型 聚合）。 */
export function parseDefiLlamaUnlocks(next: DlNextData): NormalizedRecord[] {
  const protocols = next?.props?.pageProps?.data ?? [];
  const out: NormalizedRecord[] = [];

  for (const p of protocols) {
    const symbol = p.tSymbol?.toUpperCase();
    const slug = p.protocolSlug ?? p.gecko_id ?? p.name;
    if (!symbol || !slug) continue;
    const maxSupply = p.maxSupply ?? null;
    const currentPrice = p.tokenPrice?.[0]?.price ?? null;
    const events = p.events ?? [];
    if (!events.length) continue;

    // 按 (timestamp, unlockType) 聚合同一时刻的多个分配
    const groups = new Map<string, Aggregate>();
    for (const e of events) {
      if (!e.timestamp) continue;
      const type = e.unlockType === "linear" ? "linear" : "cliff";
      if (type === "linear" && !INCLUDE_LINEAR) continue;
      const toks = Array.isArray(e.noOfTokens) ? e.noOfTokens : [];
      let amount: number | null = null;
      if (type === "cliff") {
        amount = Number(toks[0] ?? 0);
      } else {
        // linear 的 noOfTokens 是「每周速率」[from, to]；本事件释放量 = to × 持续天数 / 7
        const rate = Number(toks[1] ?? toks[0] ?? 0);
        const days = Number(e.rateDurationDays ?? 7);
        amount = rate * (days / 7);
      }
      if (amount == null || !isFinite(amount) || amount <= 0) continue;

      const key = `${e.timestamp}|${type}`;
      const g = groups.get(key) ?? {
        ts: e.timestamp,
        unlockType: type,
        amount: 0,
        allocations: new Set<string>(),
        categories: new Set<string>(),
        descriptions: [],
      };
      g.amount += amount;
      const alloc = allocationFromDescription(e.description);
      if (alloc) g.allocations.add(alloc);
      if (e.category) g.categories.add(e.category);
      if (e.description) g.descriptions.push(e.description);
      groups.set(key, g);
    }

    for (const g of groups.values()) {
      const pct = maxSupply && maxSupply > 0 ? g.amount / maxSupply : null;
      const { price, basis } = pickPrice(p, g.ts, currentPrice);
      // 历史事件用「当前价」估值会失真，宁可为空，后续可用 K 线回填真实价
      const isFuture = g.ts * 1000 > Date.now();
      const usd =
        price != null && (isFuture || basis === "historical_price") ? g.amount * price : null;
      const allocations = [...g.allocations];
      const categories = [...g.categories];
      const label = allocations[0] ?? categories[0] ?? "";
      const isCliff = g.unlockType === "cliff";

      out.push({
        record_type: "event",
        ext_id: `${slug}:${g.ts}:${g.unlockType}`,
        event_type: isCliff ? "unlock_cliff" : "unlock_linear",
        token_symbol: symbol,
        t0: new Date(g.ts * 1000).toISOString(),
        t0_confidence: "high",
        magnitude_usd: usd ?? undefined,
        magnitude_pct: pct ?? undefined,
        source_url: `https://defillama.com/unlocks/${slug}`,
        detail: {
          title: `${symbol} ${isCliff ? "悬崖" : "线性"}解锁${label ? ` ${label}` : ""}`,
          exchange: SOURCE_ID,
          category: categories[0] ?? null,
          allocation: label || null,
          allocations,
          categories,
          vesting_type: g.unlockType,
          token_amount: g.amount,
          pct_of_total_supply: pct,
          max_supply: maxSupply,
          circ_supply: p.circSupply ?? null,
          total_locked: p.totalLocked ?? null,
          protocol_slug: slug,
          gecko_id: p.gecko_id ?? null,
          usd_basis: basis,
          descriptions: g.descriptions.slice(0, 5),
          asset_class_hint: "crypto",
        },
        dedupe_key: `${SOURCE_ID}|${slug}|${g.ts}|${g.unlockType}`,
      });
    }
  }

  return out;
}

export const defiLlamaUnlocksAdapter: DataSourceAdapter = {
  id: SOURCE_ID,
  type: "unlock",

  async fetch(ctx: FetchContext): Promise<RawPayload[]> {
    const config = ctx.config as any;
    const url: string = config.base_url ?? "https://defillama.com/unlocks";
    const res = await fetch(url, {
      headers: {
        "User-Agent": config.user_agent ?? DL_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`defillama-unlocks ${res.status} ${url}`);
    const html = await res.text();
    const next = extractNextData(html);
    return [{ entity: "event", request: { url }, payload: next }];
  },

  normalize(raw: RawPayload): NormalizedRecord[] {
    return parseDefiLlamaUnlocks(raw.payload as DlNextData);
  },
};
