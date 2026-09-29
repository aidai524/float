import type { AssetClass, EventV1 } from "./types";

export const ASSET_COLOR: Record<AssetClass, string> = {
  crypto: "#2563eb",
  rwa: "#7c3aed",
  unknown: "#64748b",
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  unlock_cliff: "解锁（悬崖）",
  unlock_linear: "解锁（线性）",
  listing_cex: "中心化上币",
  listing_dex: "DEX 上线",
  tge: "TGE",
  airdrop: "空投",
  upgrade: "升级",
  halving: "减半",
  macro_fomc: "FOMC",
  macro_cpi: "CPI",
  etf: "ETF",
  governance: "治理",
  exploit: "安全事件",
  unknown: "未分类",
};

export function eventTypeLabel(t: string): string {
  return EVENT_TYPE_LABEL[t] ?? t;
}

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
