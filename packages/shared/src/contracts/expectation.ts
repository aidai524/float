/**
 * 读侧契约：预期层 v2（市场调整 + 波动标准化）与解锁 v2 统计。
 *
 * 口径见 supabase/migrations/0015_expectation.sql：
 *   excess_ret_h = 代币收益 − BTC 同期收益（一阶市场调整）
 *   z_h          = excess_ret_h / (事前 30 天日波动 × sqrt(h/24h))
 * 破坏性变更请新建 _v3 / _v2 版本，不要改本文件已有列的语义。
 */
import { z } from "zod";

const num = z.coerce.number();

/** api.event_expectation_v1 —— 单事件的市场调整反应与标准化 */
export const EventExpectationV1Schema = z.object({
  event_id: num,
  benchmark: z.string(),
  anchor_ts: z.string(),
  bench_ret_1h: num.nullable(),
  bench_ret_4h: num.nullable(),
  bench_ret_24h: num.nullable(),
  excess_ret_1h: num.nullable(),
  excess_ret_4h: num.nullable(),
  excess_ret_24h: num.nullable(),
  baseline_vol_daily: num.nullable(),
  z_1h: num.nullable(),
  z_4h: num.nullable(),
  z_24h: num.nullable(),
  methodology_version: z.string(),
  pre_ret_24h: num.nullable(),
  pre_excess_24h: num.nullable(),
  pre_ret_72h: num.nullable(),
  pre_excess_72h: num.nullable(),
  ret_72h: num.nullable(),
  excess_ret_72h: num.nullable(),
  z_72h: num.nullable(),
  ret_168h: num.nullable(),
  excess_ret_168h: num.nullable(),
  z_168h: num.nullable(),
  placebo_ts: z.string().nullable(),
  placebo_pre_excess_24h: num.nullable(),
  placebo_pre_excess_72h: num.nullable(),
  placebo_excess_72h: num.nullable(),
  placebo_excess_168h: num.nullable(),
  abn_pre_24h: num.nullable(),
  abn_pre_72h: num.nullable(),
  abn_72h: num.nullable(),
  abn_168h: num.nullable(),
});
export type EventExpectationV1 = z.infer<typeof EventExpectationV1Schema>;

export const EVENT_EXPECTATION_V1_COLUMNS = Object.keys(
  EventExpectationV1Schema.shape,
) as ReadonlyArray<keyof EventExpectationV1>;

/** api.unlock_cohort_v2 —— 解锁 v2 队列（每事件一行） */
export const UnlockCohortV2Schema = z.object({
  event_id: num,
  token_symbol: z.string(),
  t0: z.string(),
  category: z.string(),
  allocation: z.string(),
  float_pct: num.nullable(),
  float_basis: z.enum(["circ", "max"]),
  magnitude_pct: num.nullable(),
  magnitude_usd: num.nullable(),
  ret_1h: num.nullable(),
  ret_4h: num.nullable(),
  ret_24h: num.nullable(),
  excess_ret_1h: num.nullable(),
  excess_ret_4h: num.nullable(),
  excess_ret_24h: num.nullable(),
  z_1h: num.nullable(),
  z_4h: num.nullable(),
  z_24h: num.nullable(),
  liquidity_ok: z.boolean().nullable(),
  base_after_t0: z.boolean().nullable(),
});
export type UnlockCohortV2 = z.infer<typeof UnlockCohortV2Schema>;

export const UNLOCK_COHORT_V2_COLUMNS = Object.keys(UnlockCohortV2Schema.shape) as ReadonlyArray<
  keyof UnlockCohortV2
>;

/** api.unlock_float_stats_v2 —— 按 float 稀释分桶（含市场调整后分布） */
export const UnlockFloatStatsV2Schema = z.object({
  bucket: z.string(),
  n: num,
  n_excess: num,
  avg_float_pct: num.nullable(),
  median_ret_4h: num.nullable(),
  median_excess_4h: num.nullable(),
  p25_excess_4h: num.nullable(),
  p75_excess_4h: num.nullable(),
  median_z_4h: num.nullable(),
  pos_excess_4h: num.nullable(),
  median_ret_24h: num.nullable(),
  median_excess_24h: num.nullable(),
  median_z_24h: num.nullable(),
  median_pre_excess_24h: num.nullable(),
  median_pre_excess_72h: num.nullable(),
  median_excess_72h: num.nullable(),
  median_excess_168h: num.nullable(),
  median_placebo_excess_168h: num.nullable(),
  median_abn_pre_24h: num.nullable(),
  median_abn_pre_72h: num.nullable(),
  median_abn_72h: num.nullable(),
  median_abn_168h: num.nullable(),
});
export type UnlockFloatStatsV2 = z.infer<typeof UnlockFloatStatsV2Schema>;

export const UNLOCK_FLOAT_STATS_V2_COLUMNS = Object.keys(
  UnlockFloatStatsV2Schema.shape,
) as ReadonlyArray<keyof UnlockFloatStatsV2>;

/** api.unlock_category_stats_v2 —— 按接收方类别的市场调整反应 */
export const UnlockCategoryStatsV2Schema = z.object({
  category: z.string(),
  n: num,
  n_excess: num,
  avg_float_pct: num.nullable(),
  median_ret_4h: num.nullable(),
  median_excess_4h: num.nullable(),
  p25_excess_4h: num.nullable(),
  p75_excess_4h: num.nullable(),
  median_z_4h: num.nullable(),
  pos_excess_4h: num.nullable(),
  median_ret_24h: num.nullable(),
  median_excess_24h: num.nullable(),
  median_z_24h: num.nullable(),
  median_pre_excess_24h: num.nullable(),
  median_pre_excess_72h: num.nullable(),
  median_excess_72h: num.nullable(),
  median_excess_168h: num.nullable(),
  median_placebo_excess_168h: num.nullable(),
  median_abn_pre_24h: num.nullable(),
  median_abn_pre_72h: num.nullable(),
  median_abn_72h: num.nullable(),
  median_abn_168h: num.nullable(),
});
export type UnlockCategoryStatsV2 = z.infer<typeof UnlockCategoryStatsV2Schema>;

export const UNLOCK_CATEGORY_STATS_V2_COLUMNS = Object.keys(
  UnlockCategoryStatsV2Schema.shape,
) as ReadonlyArray<keyof UnlockCategoryStatsV2>;

/** api.unlock_slope_v2 —— 每 1% float 稀释对应的市场调整后 4h 收益 */
export const UnlockSlopeV2Schema = z.object({
  n: num,
  n_excess: num,
  slope_excess_4h_per_pct: num.nullable(),
  r2: num.nullable(),
  slope_ret_4h_per_pct: num.nullable(),
  r2_ret: num.nullable(),
  median_float_pct: num.nullable(),
  median_excess_4h: num.nullable(),
  slope_pre_excess_72h_per_pct: num.nullable(),
  r2_pre_excess_72h: num.nullable(),
  slope_excess_168h_per_pct: num.nullable(),
  r2_excess_168h: num.nullable(),
  slope_abn_pre_72h_per_pct: num.nullable(),
  r2_abn_pre_72h: num.nullable(),
  slope_abn_168h_per_pct: num.nullable(),
  r2_abn_168h: num.nullable(),
});
export type UnlockSlopeV2 = z.infer<typeof UnlockSlopeV2Schema>;

export const UNLOCK_SLOPE_V2_COLUMNS = Object.keys(UnlockSlopeV2Schema.shape) as ReadonlyArray<
  keyof UnlockSlopeV2
>;
