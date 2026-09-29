/**
 * Phase 2：批量计算事件反应，写入 event_reactions。
 *
 *   pnpm reactions                 # 全部事件
 *   pnpm reactions --limit 20
 *
 * 数据：Binance 1m（事件窗口）+ 1h（30 天基准量/ADV），cached into price_candles。
 */
import { createClient } from "@supabase/supabase-js";
import {
  computeReactions,
  METHODOLOGY_VERSION,
  MINUTE,
  DAY_MS,
  type Candle,
} from "../packages/data-layer/src/reactions";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const SOURCE = "binance";
const BINANCE = "https://api.binance.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const argLimit = (() => {
  const i = process.argv.indexOf("--limit");
  return i >= 0 ? Number(process.argv[i + 1]) : Infinity;
})();

/** 只算已经过去足够久的事件（默认至少 4h），否则事后价格还不存在 */
const minAgeHours = (() => {
  const i = process.argv.indexOf("--min-age-hours");
  return i >= 0 ? Number(process.argv[i + 1]) : 4;
})();

/** 回填场景不落 K 线，避免撑爆免费额度 */
const noStore = process.argv.includes("--no-store");

/** 跳过已算过（当前口径）的事件（默认开启，加快重跑） */
const skipExisting = !process.argv.includes("--recompute");

interface EventRow {
  id: number;
  token_symbol: string;
  t0: string;
}

/** Binance K 线分页拉取 */
async function fetchKlines(
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
): Promise<Candle[] | null> {
  const out: Candle[] = [];
  let start = startTime;
  while (start < endTime) {
    const u = `${BINANCE}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${start}&endTime=${endTime}&limit=1000`;
    const res = await fetch(u);
    if (res.status === 400) return null; // 交易对不存在
    if (!res.ok) throw new Error(`binance ${res.status} ${symbol} ${interval}`);
    const rows = (await res.json()) as unknown[][];
    if (!rows.length) break;
    for (const k of rows) {
      out.push({
        ts: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
      });
    }
    const last = Number(rows[rows.length - 1]![0]);
    if (rows.length < 1000) break;
    start = last + 1;
    await sleep(60);
  }
  return out;
}

async function upsertCandles(symbol: string, interval: string, candles: Candle[]) {
  if (noStore) return; // 回填模式：只算不存
  const rows = candles.map((c) => ({
    source_id: SOURCE,
    symbol,
    interval,
    ts: new Date(c.ts).toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from("price_candles")
      .upsert(rows.slice(i, i + 500), { onConflict: "source_id,symbol,interval,ts" });
    if (error) throw error;
  }
}

async function loadCandles(
  symbol: string,
  interval: string,
  from: number,
  to: number,
): Promise<Candle[]> {
  const { data } = await db
    .from("price_candles")
    .select("ts,open,high,low,close,volume")
    .eq("source_id", SOURCE)
    .eq("symbol", symbol)
    .eq("interval", interval)
    .gte("ts", new Date(from).toISOString())
    .lte("ts", new Date(to).toISOString())
    .order("ts", { ascending: true })
    .limit(100000);
  return (data ?? []).map((c: any) => ({
    ts: new Date(c.ts).getTime(),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume),
  }));
}

async function main() {
  const cutoff = new Date(Date.now() - minAgeHours * 3600_000).toISOString();
  const { data: events, error } = await db
    .from("events")
    .select("id,token_symbol,t0")
    .lte("t0", cutoff)
    .order("t0", { ascending: true });
  if (error) throw error;
  const list = (events ?? []).slice(0, argLimit === Infinity ? undefined : argLimit) as EventRow[];
  if (!list.length) {
    console.log(`没有可计算的事件（需 T0 ≤ ${cutoff}，即至少 ${minAgeHours}h 前）`);
    return;
  }

  // 已有反应的事件（当前口径）直接跳过
  let todo = list;
  if (skipExisting) {
    const { data: done } = await db
      .from("event_reactions")
      .select("event_id")
      .eq("methodology_version", METHODOLOGY_VERSION);
    const doneSet = new Set((done ?? []).map((r: any) => r.event_id));
    todo = list.filter((e) => !doneSet.has(e.id));
    if (!todo.length) {
      console.log(`✓ 全部已完成（${list.length} 条，口径 ${METHODOLOGY_VERSION}）`);
      return;
    }
    console.log(`待计算 ${todo.length} 条（已跳过 ${list.length - todo.length} 条已完成）`);
  }
  console.log(`可计算事件 ${list.length} 条 · methodology ${METHODOLOGY_VERSION} · 截止 ${cutoff}`);

  // 按代币分组，1h 基准线按代币取并集范围
  const bySymbol = new Map<string, EventRow[]>();
  for (const e of todo) {
    const arr = bySymbol.get(e.token_symbol) ?? [];
    arr.push(e);
    bySymbol.set(e.token_symbol, arr);
  }

  let computed = 0;
  const skipped: Record<string, number> = {};

  for (const [symbol, evs] of bySymbol) {
    const pair = `${symbol}USDT`;
    const times = evs.map((e) => new Date(e.t0).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);

    // --- 1h 基准线（覆盖最早事件前 31 天 ~ 最晚事件）---
    const hrFrom = minT - 31 * DAY_MS;
    const hrTo = maxT;
    let hourly = await loadCandles(symbol, "1h", hrFrom, hrTo);
    const expectedHourly = Math.floor((hrTo - hrFrom) / (60 * MINUTE));
    if (hourly.length < expectedHourly * 0.8) {
      const fetched = await fetchKlines(pair, "1h", hrFrom, hrTo);
      if (!fetched) {
        skipped[symbol] = (skipped[symbol] ?? 0) + evs.length;
        console.log(`  · ${symbol} 无 ${pair} 交易对，跳过 ${evs.length} 条`);
        await sleep(120);
        continue;
      }
      await upsertCandles(symbol, "1h", fetched);
      hourly = fetched;
      await sleep(120);
    }

    for (const e of evs) {
      const t0 = new Date(e.t0).getTime();
      // --- 1m 事件窗口 ---
      const m1From = t0 - 60 * MINUTE;
      const m1To = t0 + 25 * 60 * MINUTE;
      let m1 = await loadCandles(symbol, "1m", m1From, m1To);
      if (m1.length < 1400) {
        const fetched = await fetchKlines(pair, "1m", m1From, m1To);
        if (!fetched) {
          skipped[symbol] = (skipped[symbol] ?? 0) + 1;
          continue;
        }
        await upsertCandles(symbol, "1m", fetched);
        m1 = fetched;
        await sleep(120);
      }

      const r = computeReactions(m1, hourly, t0, { priceSource: SOURCE });
      if (!r) {
        skipped[symbol] = (skipped[symbol] ?? 0) + 1;
        continue;
      }

      const { error: upErr } = await db.from("event_reactions").upsert(
        {
          event_id: e.id,
          price_source: SOURCE,
          base_price: r.basePrice,
          base_ts: new Date(r.baseTs).toISOString(),
          base_after_t0: r.baseAfterT0,
          ret_5m: r.ret5m,
          ret_15m: r.ret15m,
          ret_1h: r.ret1h,
          ret_4h: r.ret4h,
          ret_24h: r.ret24h,
          vol_5m: r.vol5m,
          vol_1h: r.vol1h,
          vol_ratio: r.volRatio,
          max_drawdown: r.maxDrawdown,
          max_favorable: r.maxFavorable,
          liquidity_ok: r.liquidityOk,
          methodology_version: METHODOLOGY_VERSION,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "event_id,price_source,methodology_version" },
      );
      if (upErr) throw upErr;

      await db
        .from("tokens")
        .upsert(
          { symbol, adv_30d: r.adv30d, updated_at: new Date().toISOString() },
          { onConflict: "symbol" },
        );

      computed++;
      const pct = (v: number | null) =>
        v == null ? "  —  " : `${(v * 100).toFixed(2)}%`.padStart(7);
      const liq = r.liquidityOk === null ? "?" : r.liquidityOk ? "Y" : "n";
      console.log(
        `  ✓ #${String(e.id).padStart(3)} ${symbol.padEnd(9)} 5m${pct(r.ret5m)} 1h${pct(r.ret1h)} 4h${pct(r.ret4h)} liq=${liq}`,
      );
    }
  }

  console.log(`\n✓ 完成：计算 ${computed} 条`);
  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
  if (skippedTotal) {
    console.log(`  跳过 ${skippedTotal} 条（无交易对/无数据）：${JSON.stringify(skipped)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
