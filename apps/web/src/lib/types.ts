/**
 * 读侧契约类型（与 packages/shared 的 zod schema 对应）。
 * 前端只依赖这些字段，不感知任何数据源。
 * 新增事件类型（如 unlock）时此文件无需改动——字段是通用的。
 */
export type AssetClass = "crypto" | "rwa" | "unknown";

export interface EventV1 {
  id: number;
  event_type: string;
  token_symbol: string;
  chain: string | null;
  t0: string;
  t0_confidence: "high" | "medium" | "low";
  magnitude_usd: number | null;
  magnitude_pct: number | null;
  title: string | null;
  source_url: string | null;
  category: string;
  asset_class: AssetClass;
  confidence: number;
  source_count: number;
  base_price: number | null;
  base_ts: string | null;
  base_after_t0: boolean | null;
  ret_5m: number | null;
  ret_15m: number | null;
  ret_1h: number | null;
  ret_4h: number | null;
  ret_24h: number | null;
  vol_1h: number | null;
  vol_ratio: number | null;
  max_drawdown: number | null;
  max_favorable: number | null;
  liquidity_ok: boolean | null;
  implied_move_1h: number | null;
  implied_move_4h: number | null;
  implied_move_24h: number | null;
  surprise_1h: number | null;
  surprise_4h: number | null;
  surprise_24h: number | null;
  price_source: string | null;
  methodology_version: string;
  source_detail: Record<string, unknown>;
  first_seen_at: string;
  updated_at: string;
}

export interface TokenV1 {
  id: number;
  symbol: string;
  name: string | null;
  chain: string | null;
  category: string | null;
  asset_class: AssetClass;
  market_cap: number | null;
  adv_30d: number | null;
  event_count: number;
  last_event_at: string | null;
}

export interface Candle {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** api.event_type_stats_v1 —— 事件类型基准 */
export interface EventTypeStatsV1 {
  event_type: string;
  asset_class: AssetClass;
  n: number;
  n_5m: number;
  n_1h: number;
  n_4h: number;
  n_24h: number;
  median_5m: number | null;
  median_15m: number | null;
  median_1h: number | null;
  median_4h: number | null;
  median_24h: number | null;
  pos_5m: number | null;
  pos_15m: number | null;
  pos_1h: number | null;
  pos_4h: number | null;
  pos_24h: number | null;
}

/** api.category_stats_v1 —— 按（事件类型 × 代币类别）的基准 */
export interface CategoryStatsV1 {
  event_type: string;
  token_category: string;
  n: number;
  n_5m: number;
  n_1h: number;
  n_4h: number;
  n_24h: number;
  median_5m: number | null;
  median_15m: number | null;
  median_1h: number | null;
  median_4h: number | null;
  median_24h: number | null;
  pos_5m: number | null;
  pos_15m: number | null;
  pos_1h: number | null;
  pos_4h: number | null;
  pos_24h: number | null;
}

/** api.event_baseline_v1 —— 事件在同类中的百分位 */
export interface EventBaselineV1 {
  event_id: number;
  event_type: string;
  asset_class: AssetClass;
  pct_5m: number | null;
  pct_15m: number | null;
  pct_1h: number | null;
  pct_4h: number | null;
  pct_24h: number | null;
}

/** api.unlock_dilution_stats_v1 —— 解锁按稀释规模（占供应）分桶 */
export interface UnlockDilutionStat {
  bucket: string;
  n: number;
  n_4h: number;
  avg_pct: number | null;
  median_ret_1h: number | null;
  median_ret_4h: number | null;
  median_ret_24h: number | null;
  median_max_dd: number | null;
  pos_4h: number | null;
}

/** api.unlock_category_stats_v1 —— 解锁按接收方类别 */
export interface UnlockCategoryStat {
  category: string;
  n: number;
  n_4h: number;
  avg_pct: number | null;
  median_ret_1h: number | null;
  median_ret_4h: number | null;
  median_ret_24h: number | null;
  p25_ret_4h: number | null;
  p75_ret_4h: number | null;
  median_max_dd: number | null;
  pos_4h: number | null;
}

/** api.unlock_slope_v1 —— 每 1% 供应稀释对应的 4h 收益（归一化斜率） */
export interface UnlockSlope {
  n: number;
  slope_4h_per_pct: number | null;
  r2: number | null;
  median_ret_4h: number | null;
  median_pct: number | null;
}

/** api.event_expectation_v1 —— 单事件的市场调整反应与标准化（口径 v2） */
export interface EventExpectationV1 {
  event_id: number;
  benchmark: string;
  anchor_ts: string;
  bench_ret_1h: number | null;
  bench_ret_4h: number | null;
  bench_ret_24h: number | null;
  excess_ret_1h: number | null;
  excess_ret_4h: number | null;
  excess_ret_24h: number | null;
  baseline_vol_daily: number | null;
  z_1h: number | null;
  z_4h: number | null;
  z_24h: number | null;
  methodology_version: string;
  pre_ret_24h: number | null;
  pre_excess_24h: number | null;
  pre_ret_72h: number | null;
  pre_excess_72h: number | null;
  ret_72h: number | null;
  excess_ret_72h: number | null;
  z_72h: number | null;
  ret_168h: number | null;
  excess_ret_168h: number | null;
  z_168h: number | null;
  placebo_ts: string | null;
  placebo_pre_excess_24h: number | null;
  placebo_pre_excess_72h: number | null;
  placebo_excess_72h: number | null;
  placebo_excess_168h: number | null;
  abn_pre_24h: number | null;
  abn_pre_72h: number | null;
  abn_72h: number | null;
  abn_168h: number | null;
}

/** api.unlock_float_stats_v2 —— 解锁按 float 稀释分桶（市场调整后） */
export interface UnlockFloatStat {
  bucket: string;
  n: number;
  n_excess: number;
  avg_float_pct: number | null;
  median_ret_4h: number | null;
  median_excess_4h: number | null;
  p25_excess_4h: number | null;
  p75_excess_4h: number | null;
  median_z_4h: number | null;
  pos_excess_4h: number | null;
  median_ret_24h: number | null;
  median_excess_24h: number | null;
  median_z_24h: number | null;
  median_pre_excess_24h: number | null;
  median_pre_excess_72h: number | null;
  median_excess_72h: number | null;
  median_excess_168h: number | null;
  median_placebo_excess_168h: number | null;
  median_abn_pre_24h: number | null;
  median_abn_pre_72h: number | null;
  median_abn_72h: number | null;
  median_abn_168h: number | null;
}

/** api.unlock_category_stats_v2 —— 解锁按接收方（市场调整后） */
export interface UnlockCategoryStatV2 {
  category: string;
  n: number;
  n_excess: number;
  avg_float_pct: number | null;
  median_ret_4h: number | null;
  median_excess_4h: number | null;
  p25_excess_4h: number | null;
  p75_excess_4h: number | null;
  median_z_4h: number | null;
  pos_excess_4h: number | null;
  median_ret_24h: number | null;
  median_excess_24h: number | null;
  median_z_24h: number | null;
  median_pre_excess_24h: number | null;
  median_pre_excess_72h: number | null;
  median_excess_72h: number | null;
  median_excess_168h: number | null;
  median_placebo_excess_168h: number | null;
  median_abn_pre_24h: number | null;
  median_abn_pre_72h: number | null;
  median_abn_72h: number | null;
  median_abn_168h: number | null;
}

/** api.unlock_slope_v2 —— 每 1% float 稀释对应的市场调整后 4h 收益 */
export interface UnlockSlopeV2 {
  n: number;
  n_excess: number;
  slope_excess_4h_per_pct: number | null;
  r2: number | null;
  slope_ret_4h_per_pct: number | null;
  r2_ret: number | null;
  median_float_pct: number | null;
  median_excess_4h: number | null;
  slope_pre_excess_72h_per_pct: number | null;
  r2_pre_excess_72h: number | null;
  slope_excess_168h_per_pct: number | null;
  r2_excess_168h: number | null;
  slope_abn_pre_72h_per_pct: number | null;
  r2_abn_pre_72h: number | null;
  slope_abn_168h_per_pct: number | null;
  r2_abn_168h: number | null;
}
