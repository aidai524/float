import type { AssetClass, EventV1 } from "./types";

export const ASSET_COLOR: Record<AssetClass, string> = {
  crypto: "#2563eb",
  rwa: "#7c3aed",
  unknown: "#64748b",
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  unlock_cliff: "解锁（悬崖）",
  unlock_linear: "解锁（线性）",
  tge: "TGE",
  airdrop: "空投",
  burn: "销毁 / 回购",
  migration: "代币迁移",
  listing_cex: "中心化上币",
  listing_dex: "DEX 上线",
  listing_futures: "合约上线",
  delisting: "下架",
  mainnet_launch: "主网上线",
  testnet: "测试网",
  upgrade: "升级",
  halving: "减半",
  incentive: "激励 / 质押",
  partnership: "合作",
  integration: "集成",
  governance: "治理",
  macro_fomc: "FOMC",
  macro_cpi: "CPI",
  macro_nfp: "非农就业",
  etf: "ETF",
  exploit: "安全事件",
  unknown: "未分类",
};

export function eventTypeLabel(t: string): string {
  return EVENT_TYPE_LABEL[t] ?? t;
}

/** 代币类别（Jev 分类）中文名 */
export const TOKEN_CATEGORY_LABEL: Record<string, string> = {
  defi: "DeFi",
  l1: "L1",
  l2: "L2",
  meme: "Meme",
  infrastructure: "基础设施",
  rwa: "RWA",
  stablecoin: "稳定币",
  gaming: "游戏",
  ai: "AI",
  exchange: "交易所",
  payment: "支付",
  privacy: "隐私",
  other: "其他",
};

/** 上币形式（由公告标题规则判定）中文名 */
export const LISTING_FORM_LABEL: Record<string, string> = {
  new_listing: "现货新币",
  futures: "合约（永续）",
  product_add: "产品位（Earn/Convert/Margin）",
  rwa_bstock: "RWA bStock",
  seed_tag: "现货新币 · Seed Tag",
  launchpool: "Launchpool / HODLer",
  other: "其他",
};

export function fmtTs(ts: string | null, withTime = true): string {
  if (!ts) return "—";
  return new Date(ts)
    .toISOString()
    .replace("T", " ")
    .slice(0, withTime ? 16 : 10);
}

export function pct(v: number | null): string {
  return v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
}

export function pctClass(v: number | null): string {
  if (v == null) return "text-slate-600";
  return v >= 0 ? "text-emerald-400" : "text-red-400";
}

export function fmtPrice(v: number | null): string {
  if (v == null) return "—";
  return v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(4);
}

export function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function hostOf(u: string | null): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

export function liquidityLabel(v: boolean | null): { text: string; cls: string; title: string } {
  if (v === null) return { text: "?", cls: "text-slate-500", title: "基准历史不足，无法判定" };
  if (v) return { text: "充足", cls: "text-emerald-400", title: "30 天日均成交额达标" };
  return { text: "偏低", cls: "text-amber-400", title: "30 天日均成交额低于阈值" };
}

/**
 * 通用"关键事实"：按事件类型决定展示哪些字段。
 * 这样新增事件类型（如 unlock）时，前端无需改结构——
 * 只要契约里已有对应字段（magnitude_usd / magnitude_pct 等）就能自动显示。
 */
export interface Fact {
  label: string;
  value: string;
}

export function eventFacts(e: EventV1): Fact[] {
  const d = (e.source_detail ?? {}) as Record<string, unknown>;
  const facts: Fact[] = [];

  // 通用
  facts.push({ label: "资产类别", value: e.asset_class });
  facts.push({ label: "事件时间 (UTC)", value: fmtTs(e.t0) });
  facts.push({ label: "时间置信度", value: e.t0_confidence });

  // 规模（解锁/空投/TGE 等有）
  if (e.magnitude_usd != null) facts.push({ label: "规模", value: fmtUsd(e.magnitude_usd) });
  if (e.magnitude_pct != null)
    facts.push({ label: "占流通比例", value: `${(e.magnitude_pct * 100).toFixed(2)}%` });

  // 上币类
  if (d.exchange) facts.push({ label: "交易所", value: String(d.exchange) });
  if (d.type) facts.push({ label: "公告类型", value: String(d.type) });
  if (d.dateEnd) facts.push({ label: "结束时间", value: fmtTs(String(d.dateEnd)) });

  // 数据来源
  facts.push({ label: "印证源数", value: String(e.source_count) });
  facts.push({ label: "置信度", value: e.confidence.toFixed(2) });

  return facts;
}
