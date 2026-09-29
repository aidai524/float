/**
 * 读侧契约：与 supabase/migrations/0004_contract_views.sql 中的 api.events_v1 列一一对应。
 * 规则：只增列，不删列 / 不改类型 / 不改语义。破坏性变更请新建 events_v2。
 */
import { z } from "zod";

export const METHODOLOGY_VERSION = "v1" as const;

export const T0ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type T0Confidence = z.infer<typeof T0ConfidenceSchema>;

/** 资产类别：crypto 原生 vs 代币化的现实世界资产（RWA，含代币化股票） */
export const AssetClassSchema = z.enum(["crypto", "rwa", "unknown"]);
export type AssetClass = z.infer<typeof AssetClassSchema>;

export const EventTypeSchema = z.enum([
  "unlock_cliff",
  "unlock_linear",
  "listing_cex",
  "listing_dex",
  "tge",
  "airdrop",
  "upgrade",
  "halving",
  "macro_fomc",
  "macro_cpi",
  "etf",
  "governance",
  "exploit",
  "unknown",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

/** api.events_v1 */
export const EventV1Schema = z.object({
  id: z.number().int(),
  event_type: z.string(),
  token_symbol: z.string(),
  chain: z.string().nullable(),
  t0: z.string(),
  t0_confidence: T0ConfidenceSchema,
  magnitude_usd: z.number().nullable(),
  magnitude_pct: z.number().nullable(),
  title: z.string().nullable(),
  category: z.string(),
  asset_class: AssetClassSchema,
  confidence: z.number(),
  source_count: z.number().int(),
  base_price: z.number().nullable(),
  ret_5m: z.number().nullable(),
  ret_15m: z.number().nullable(),
  ret_1h: z.number().nullable(),
  ret_4h: z.number().nullable(),
  ret_24h: z.number().nullable(),
  vol_1h: z.number().nullable(),
  vol_ratio: z.number().nullable(),
  max_drawdown: z.number().nullable(),
  max_favorable: z.number().nullable(),
  liquidity_ok: z.boolean().nullable(),
  price_source: z.string().nullable(),
  methodology_version: z.string(),
  source_detail: z.record(z.unknown()),
  first_seen_at: z.string(),
  updated_at: z.string(),
});
export type EventV1 = z.infer<typeof EventV1Schema>;

/** api.event_detail_v1 = events_v1 + 溯源 */
export const EventDetailV1Schema = EventV1Schema.extend({
  provenance_count: z.number().int(),
  sources: z.array(z.string()).nullable(),
});
export type EventDetailV1 = z.infer<typeof EventDetailV1Schema>;

export const EVENTS_V1_COLUMNS = Object.keys(EventV1Schema.shape) as ReadonlyArray<keyof EventV1>;
