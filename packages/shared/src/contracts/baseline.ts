/**
 * 读侧契约：基准层（api.event_cohort_v1 / event_type_stats_v1 / event_baseline_v1）。
 * 这层把"单个事件的数字"变成"vs 同类历史的信号"。
 */
import { z } from "zod";
import { AssetClassSchema } from "./events";

const num = z.coerce.number();

/** api.event_type_stats_v1 —— 按事件类型 × 资产类别的基准 */
export const EventTypeStatsV1Schema = z.object({
  event_type: z.string(),
  asset_class: AssetClassSchema,
  n: num,
  n_5m: num,
  n_1h: num,
  n_4h: num,
  n_24h: num,
  median_5m: num.nullable(),
  median_15m: num.nullable(),
  median_1h: num.nullable(),
  median_4h: num.nullable(),
  median_24h: num.nullable(),
  pos_5m: num.nullable(),
  pos_15m: num.nullable(),
  pos_1h: num.nullable(),
  pos_4h: num.nullable(),
  pos_24h: num.nullable(),
});
export type EventTypeStatsV1 = z.infer<typeof EventTypeStatsV1Schema>;

/** api.event_baseline_v1 —— 每个事件在同类中的百分位 */
export const EventBaselineV1Schema = z.object({
  event_id: num,
  event_type: z.string(),
  asset_class: AssetClassSchema,
  pct_5m: num.nullable(),
  pct_15m: num.nullable(),
  pct_1h: num.nullable(),
  pct_4h: num.nullable(),
  pct_24h: num.nullable(),
});
export type EventBaselineV1 = z.infer<typeof EventBaselineV1Schema>;

export const EVENT_TYPE_STATS_V1_COLUMNS = Object.keys(
  EventTypeStatsV1Schema.shape,
) as ReadonlyArray<keyof EventTypeStatsV1>;

export const EVENT_BASELINE_V1_COLUMNS = Object.keys(EventBaselineV1Schema.shape) as ReadonlyArray<
  keyof EventBaselineV1
>;

export const EVENT_COHORT_V1_COLUMNS = [
  "event_id",
  "event_type",
  "asset_class",
  "token_symbol",
  "t0",
  "token_category",
  "ret_5m",
  "ret_15m",
  "ret_1h",
  "ret_4h",
  "ret_24h",
] as const;

/** api.category_stats_v1 —— 按（事件类型 × 代币类别）的基准 */
export const CategoryStatsV1Schema = z.object({
  event_type: z.string(),
  token_category: z.string(),
  n: num,
  n_5m: num,
  n_1h: num,
  n_4h: num,
  n_24h: num,
  median_5m: num.nullable(),
  median_15m: num.nullable(),
  median_1h: num.nullable(),
  median_4h: num.nullable(),
  median_24h: num.nullable(),
  pos_5m: num.nullable(),
  pos_15m: num.nullable(),
  pos_1h: num.nullable(),
  pos_4h: num.nullable(),
  pos_24h: num.nullable(),
});
export type CategoryStatsV1 = z.infer<typeof CategoryStatsV1Schema>;

export const CATEGORY_STATS_V1_COLUMNS = Object.keys(CategoryStatsV1Schema.shape) as ReadonlyArray<
  keyof CategoryStatsV1
>;
