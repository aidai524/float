/**
 * 数据层核心类型
 * 只被 packages/data-layer 内部使用；前后端永不 import 这里。
 */

export type SourceType = "price" | "unlock" | "listing" | "macro" | "news" | "token";

export type T0Confidence = "high" | "medium" | "low";

export type RecordType = "event" | "kline" | "token" | "news";

/** 外部源的原始响应（原样，含 request 便于回放） */
export interface RawPayload {
  entity: RecordType;
  request: Record<string, unknown>;
  payload: unknown;
}

/** 归一化后的源记录（L1），会写入 source_records */
export interface NormalizedRecord {
  record_type: RecordType;
  ext_id?: string;
  event_type?: string;
  token_symbol?: string;
  chain?: string;
  t0?: string; // ISO 8601
  t0_confidence?: T0Confidence;
  magnitude_usd?: number;
  magnitude_pct?: number;
  source_url?: string;
  detail?: Record<string, unknown>;
  /** 仅 record_type = 'kline' 时使用 */
  candle?: { ts: string; open: number; high: number; low: number; close: number; volume: number };
  /** 源内幂等键；缺省由 pipeline 生成 */
  dedupe_key?: string;
}

export interface FetchContext {
  /** 增量游标（上次成功时间等） */
  since?: string;
  until?: string;
  /** data_sources.config */
  config: Record<string, unknown>;
  /** 解析后的密钥（由 pipeline 注入） */
  secrets: Record<string, string>;
}

/** 适配器契约：加一个源 = 实现这个接口 + register() */
export interface DataSourceAdapter {
  id: string;
  type: SourceType;
  fetch(ctx: FetchContext): Promise<RawPayload[]>;
  normalize(raw: RawPayload): NormalizedRecord[];
}

/** data_sources 行 */
export interface DataSourceRow {
  id: string;
  type: SourceType;
  auth: "none" | "api_key" | "header" | "query";
  cost_tier: "free" | "paid";
  priority: number;
  rate_limit: { rpm?: number; dailyQuota?: number } | null;
  refresh: string | null;
  fallback: string[];
  config: Record<string, unknown>;
  enabled: boolean;
}
