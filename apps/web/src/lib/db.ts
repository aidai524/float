/**
 * 前端数据访问层：只读 api.* 契约视图 + price_candles。
 * 服务端使用（构建期 / SSR），密钥只走服务端。
 */
import { createClient } from "@supabase/supabase-js";
import type {
  Candle,
  CategoryStatsV1,
  EventExpectationV1,
  EventTypeStatsV1,
  EventV1,
  ListingBaselineV1,
  ListingCategoryStat,
  ListingFdvStat,
  ListingFormStat,
  TokenV1,
  UnlockCategoryStat,
  UnlockCategoryStatV2,
  UnlockDilutionStat,
  UnlockFloatStat,
  UnlockSlope,
  UnlockSlopeV2,
} from "./types";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("缺少 SUPABASE_URL / SUPABASE_ANON_KEY（见根目录 .env）");
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const api = supabase.schema("api");

export async function listEvents(limit = 1000): Promise<EventV1[]> {
  const { data, error } = await api
    .from("events_v1")
    .select("*")
    .order("t0", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as EventV1[];
}

export async function getEvent(id: number): Promise<EventV1 | null> {
  const { data, error } = await api.from("event_detail_v1").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as EventV1) ?? null;
}

/**
 * 事件静态路径：最新的 limit 条 ∪ 所有有反应的事件。
 * 只用「最新 N 条」会漏掉历史上币/宏观等有详情面板的事件（t0 早但功能完整）。
 */
export async function listEventsForPaths(limit = 1000): Promise<EventV1[]> {
  const newest = await listEvents(limit);
  const seen = new Set(newest.map((e) => e.id));

  const { data, error } = await api
    .from("events_v1")
    .select("id")
    .not("base_ts", "is", null)
    .limit(100000);
  if (error) throw error;
  const extraIds = ((data ?? []) as Array<{ id: number }>)
    .map((r) => r.id)
    .filter((id) => !seen.has(id));

  const extra: EventV1[] = [];
  for (let i = 0; i < extraIds.length; i += 300) {
    const chunk = extraIds.slice(i, i + 300);
    const { data: rows, error: e2 } = await api.from("events_v1").select("*").in("id", chunk);
    if (e2) throw e2;
    extra.push(...((rows ?? []) as EventV1[]));
  }
  return [...newest, ...extra];
}

export async function listTokens(limit = 400): Promise<TokenV1[]> {
  const { data, error } = await api
    .from("tokens_v1")
    .select("*")
    .order("event_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as TokenV1[];
}

/** 事件类型基准（样本 >= minN 才返回） */
export async function listTypeStats(minN = 5): Promise<EventTypeStatsV1[]> {
  const { data, error } = await api
    .from("event_type_stats_v1")
    .select("*")
    .gte("n", minN)
    .order("n", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EventTypeStatsV1[];
}

/** 按代币类别的基准（默认只看某个事件类型） */
export async function listCategoryStats(
  eventType = "listing_cex",
  minN = 10,
): Promise<CategoryStatsV1[]> {
  const { data, error } = await api
    .from("category_stats_v1")
    .select("*")
    .eq("event_type", eventType)
    .gte("n", minN)
    .order("n", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CategoryStatsV1[];
}

/** 某事件在同类中的百分位 */
export async function getBaseline(eventId: number): Promise<any | null> {
  const { data, error } = await api
    .from("event_baseline_v1")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function listEventsForToken(symbol: string): Promise<EventV1[]> {
  const { data, error } = await api
    .from("events_v1")
    .select("*")
    .eq("token_symbol", symbol)
    .order("t0", { ascending: false });
  if (error) throw error;
  return (data ?? []) as EventV1[];
}

export async function getCandles(
  symbol: string,
  interval: string,
  limit = 500,
  opts: { from?: string; to?: string } = {},
): Promise<Candle[]> {
  let q = supabase
    .from("price_candles")
    .select("ts,open,high,low,close,volume")
    .eq("symbol", symbol)
    .eq("interval", interval)
    .order("ts", { ascending: true })
    .limit(limit);
  if (opts.from) q = q.gte("ts", opts.from);
  if (opts.to) q = q.lte("ts", opts.to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Candle[];
}

/** 事件附近的 1m K 线；没有则回退 1h / 1d */
export async function getEventCandles(
  symbol: string,
  t0: string,
  beforeMin = 60,
  afterMin = 24 * 60,
): Promise<{ interval: string; candles: Candle[] }> {
  const t = new Date(t0).getTime();
  const from = new Date(t - beforeMin * 60_000).toISOString();
  const to = new Date(t + afterMin * 60_000).toISOString();

  const m1 = await getCandles(symbol, "1m", 5000, { from, to });
  if (m1.length > 10) return { interval: "1m", candles: m1 };

  const h1 = await getCandles(symbol, "1h", 2000, {
    from: new Date(t - 7 * 86_400_000).toISOString(),
    to: new Date(t + 3 * 86_400_000).toISOString(),
  });
  if (h1.length > 10) return { interval: "1h", candles: h1 };

  const d1 = await getCandles(symbol, "1d", 400);
  return { interval: "1d", candles: d1 };
}

/** api.unlock_dilution_stats_v1 —— 解锁按稀释规模分桶 */
export async function listUnlockDilutionStats(): Promise<UnlockDilutionStat[]> {
  const { data, error } = await api.from("unlock_dilution_stats_v1").select("*");
  if (error) throw error;
  return (data ?? []) as UnlockDilutionStat[];
}

/** api.unlock_category_stats_v1 —— 解锁按接收方类别（样本 >= minN） */
export async function listUnlockCategoryStats(minN = 5): Promise<UnlockCategoryStat[]> {
  const { data, error } = await api
    .from("unlock_category_stats_v1")
    .select("*")
    .gte("n", minN)
    .order("n", { ascending: false });
  if (error) throw error;
  return (data ?? []) as UnlockCategoryStat[];
}

/** api.unlock_slope_v1 —— 每 1% 稀释对应的 4h 收益 */
export async function getUnlockSlope(): Promise<UnlockSlope | null> {
  const { data, error } = await api.from("unlock_slope_v1").select("*").maybeSingle();
  if (error) throw error;
  return (data as UnlockSlope) ?? null;
}

// ---------- v2：float 稀释 + 市场调整（剔除 BTC） ----------

/** api.unlock_float_stats_v2 —— 按 float 稀释（占流通）分桶 */
export async function listUnlockFloatStats(): Promise<UnlockFloatStat[]> {
  const { data, error } = await api.from("unlock_float_stats_v2").select("*");
  if (error) throw error;
  return (data ?? []) as UnlockFloatStat[];
}

/** api.unlock_category_stats_v2 —— 按接收方类别（样本 >= minN） */
export async function listUnlockCategoryStatsV2(minN = 5): Promise<UnlockCategoryStatV2[]> {
  const { data, error } = await api
    .from("unlock_category_stats_v2")
    .select("*")
    .gte("n", minN)
    .order("n", { ascending: false });
  if (error) throw error;
  return (data ?? []) as UnlockCategoryStatV2[];
}

/** api.unlock_slope_v2 —— 每 1% float 稀释对应的市场调整后 4h 收益 */
export async function getUnlockSlopeV2(): Promise<UnlockSlopeV2 | null> {
  const { data, error } = await api.from("unlock_slope_v2").select("*").maybeSingle();
  if (error) throw error;
  return (data as UnlockSlopeV2) ?? null;
}

/** api.event_expectation_v1 —— 单事件的市场调整反应与 z 值 */
export async function getEventExpectation(eventId: number): Promise<EventExpectationV1 | null> {
  const { data, error } = await api
    .from("event_expectation_v1")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return (data as EventExpectationV1) ?? null;
}

// ---------- Phase 4.4：上币特征化预期 ----------

/** api.listing_form_stats_v1 —— 按上币形式 */
export async function listListingFormStats(minN = 5): Promise<ListingFormStat[]> {
  const { data, error } = await api
    .from("listing_form_stats_v1")
    .select("*")
    .gte("n", minN)
    .order("n", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ListingFormStat[];
}

/** api.listing_category_stats_v1 —— 按代币类别 */
export async function listListingCategoryStats(minN = 5): Promise<ListingCategoryStat[]> {
  const { data, error } = await api
    .from("listing_category_stats_v1")
    .select("*")
    .gte("n", minN)
    .order("n", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ListingCategoryStat[];
}

/** api.listing_fdv_stats_v1 —— 按 FDV 档（覆盖受限） */
export async function listListingFdvStats(minN = 5): Promise<ListingFdvStat[]> {
  const { data, error } = await api
    .from("listing_fdv_stats_v1")
    .select("*")
    .gte("n", minN)
    .order("n", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ListingFdvStat[];
}

/** api.listing_baseline_v1 —— 单事件在同类代币类别中的分位 */
export async function getListingBaseline(eventId: number): Promise<ListingBaselineV1 | null> {
  const { data, error } = await api
    .from("listing_baseline_v1")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return (data as ListingBaselineV1) ?? null;
}

/** api.listing_category_stats_v1 —— 单个类别的统计（事件详情用） */
export async function getListingCategoryStat(
  category: string,
): Promise<ListingCategoryStat | null> {
  const { data, error } = await api
    .from("listing_category_stats_v1")
    .select("*")
    .eq("token_category", category)
    .maybeSingle();
  if (error) throw error;
  return (data as ListingCategoryStat) ?? null;
}
