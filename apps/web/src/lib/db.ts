/**
 * 前端数据访问层：只读 api.* 契约视图 + price_candles。
 * 服务端使用（构建期 / SSR），密钥只走服务端。
 */
import { createClient } from "@supabase/supabase-js";
import type {
  Candle,
  CategoryStatsV1,
  EventTypeStatsV1,
  EventV1,
  TokenV1,
  UnlockCategoryStat,
  UnlockDilutionStat,
  UnlockSlope,
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
