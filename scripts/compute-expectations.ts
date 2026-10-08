/**
 * Phase 4.2/4.3 v2：为已有反应的事件计算「市场调整收益 + 波动标准化」。
 *
 *   pnpm expectations                    # 默认 unlock 前缀 · float 稀释 ≥ 0.5%
 *   pnpm expectations --limit 100        # 小批量试跑
 *   pnpm expectations --min-float 0.01
 *   pnpm expectations --recompute        # 重算已存在的
 *
 * 口径见 packages/data-layer/src/expectations.ts：
 *   excess_ret_h = token ret_h − BTC 同期 ret_h
 *   z_h          = excess_ret_h / (事前 30 天日波动 × sqrt(h/24h))
 *
 * 只写 event_expectation，不落 K 线（BTC 1m / token 1h 仅计算用）。
 */
import { createClient } from "@supabase/supabase-js";
import {
  baselineDailyVol,
  computeExcess,
  computeLongWindows,
  EXPECTATION_VERSION,
} from "../packages/data-layer/src/expectations";
import { DAY_MS, MINUTE, type Candle } from "../packages/data-layer/src/reactions";

if (!process.env.SUPABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    // 没有 .env 就继续，下面会给出清晰的缺参报错
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const BINANCE = "https://api.binance.com";
const BENCHMARK = "BTCUSDT";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const typePrefix = arg("--type") ?? "unlock";
const minFloat = Number(arg("--min-float") ?? 0.005);
const limit = Number(arg("--limit") ?? Infinity);
const minAgeHours = Number(arg("--min-age-hours") ?? 4);
const recompute = process.argv.includes("--recompute");

interface EventRow {
  id: number;
  token_symbol: string;
  t0: string;
  magnitude_pct: number | null;
  detail: Record<string, unknown> | null;
}

interface ReactionRow {
  event_id: number;
  ret_1h: number | null;
  ret_4h: number | null;
  ret_24h: number | null;
  base_ts: string | null;
  base_after_t0: boolean | null;
  liquidity_ok: boolean | null;
  events: EventRow | EventRow[];
}

/** float 稀释（占流通量）；缺失或非法时回退 magnitude_pct（占最大供应） */
function floatPct(
  detail: Record<string, unknown> | null,
  magnitudePct: number | null,
): number | null {
  const amount = Number(detail?.token_amount);
  const circ = Number(detail?.circ_supply);
  if (Number.isFinite(amount) && Number.isFinite(circ) && circ > 0 && amount > 0) {
    return amount / circ;
  }
  return magnitudePct ?? null;
}

/** Binance K 线分页拉取（与 compute-reactions 一致；400 = 交易对不存在） */
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
    if (res.status === 400) return null;
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

/** 简单 LRU：按 key 缓存 BTC 1m 窗口 / 事前 1h 窗口，避免重复请求 */
class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private max = 200) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(k, v);
  }
}

async function main() {
  const cutoff = new Date(Date.now() - minAgeHours * 3600_000).toISOString();

  // 从反应出发内嵌事件，避免全表 events（21k+，含大 detail）被 PostgREST max_rows 截断。
  const { data: reactions, error: rErr } = await db
    .from("event_reactions")
    .select(
      "event_id,ret_1h,ret_4h,ret_24h,base_ts,base_after_t0,liquidity_ok," +
        "events!inner(id,token_symbol,t0,magnitude_pct,detail,event_type)",
    )
    .eq("methodology_version", "v1")
    .like("events.event_type", `${typePrefix}%`)
    .lte("events.t0", cutoff);
  if (rErr) throw rErr;

  const rmap = new Map<number, ReactionRow>();
  const evmap = new Map<number, EventRow>();
  for (const row of (reactions ?? []) as unknown as ReactionRow[]) {
    if (rmap.has(row.event_id)) continue; // 同一事件多价格源时取首条
    const ev = Array.isArray(row.events) ? row.events[0] : row.events;
    if (!ev) continue;
    rmap.set(row.event_id, row);
    evmap.set(row.event_id, ev);
  }

  const { data: done } = await db
    .from("event_expectation")
    .select("event_id")
    .eq("methodology_version", EXPECTATION_VERSION);
  const doneSet = new Set((done ?? []).map((r: any) => r.event_id as number));

  const scope = [...evmap.values()]
    .filter((e) => {
      const r = rmap.get(e.id)!;
      if (r.ret_1h == null && r.ret_4h == null && r.ret_24h == null) return false;
      if (r.liquidity_ok === false) return false;
      const fp = floatPct(e.detail, e.magnitude_pct);
      return fp != null && fp >= minFloat;
    })
    .filter((e) => recompute || !doneSet.has(e.id))
    .sort((a, b) => new Date(a.t0).getTime() - new Date(b.t0).getTime())
    .slice(0, Number.isFinite(limit) ? limit : undefined);

  if (!scope.length) {
    console.log("✓ 没有待计算的事件（可能已全部完成；加 --recompute 强制重算）");
    return;
  }
  console.log(
    `市场调整计算 ${scope.length} 条 · ${typePrefix}* · float ≥ ${(minFloat * 100).toFixed(2)}% · 基准 ${BENCHMARK}`,
  );

  // ---------- 1) 事前 30 天日波动 + 长窗口用 1h K 线（按事件懒加载） ----------
  const volCache = new LruCache<Candle[] | null>(40);
  let volOk = 0;
  async function baselineWindowFor(
    symbol: string,
    t0: number,
  ): Promise<{ hourly: Candle[] | null; vol: number | null }> {
    const key = `${symbol}|${new Date(t0).toISOString().slice(0, 10)}`;
    let hourly = volCache.get(key);
    if (hourly === undefined) {
      try {
        // 覆盖事前 31 天 + 事后 8 天（长窗口 7d 需要事后数据）
        hourly = await fetchKlines(`${symbol}USDT`, "1h", t0 - 31 * DAY_MS, t0 + 8 * DAY_MS);
      } catch {
        hourly = null;
      }
      volCache.set(key, hourly);
      await sleep(100);
    }
    return { hourly, vol: hourly ? baselineDailyVol(hourly, t0) : null };
  }

  // BTC 1h：全区间一次取完（长窗口与事前漂移的基准）
  const scopeTimes = scope.map((e) => new Date(e.t0).getTime());
  console.log("  拉取 BTC 1h 基准序列…");
  const btc1h =
    (await fetchKlines(
      BENCHMARK,
      "1h",
      Math.min(...scopeTimes) - 4 * DAY_MS,
      Math.max(...scopeTimes) + 8 * DAY_MS,
    )) ?? [];
  console.log(`  BTC 1h ${btc1h.length} 根`);

  // ---------- 2) 逐事件：BTC 1m（短窗）+ 长窗口 + 事前漂移 ----------
  const btcCache = new LruCache<Candle[]>(200);
  const rows: Array<Record<string, unknown>> = [];
  let computed = 0;
  let failed = 0;

  for (const e of scope) {
    const r = rmap.get(e.id)!;
    const anchor = r.base_after_t0
      ? r.base_ts
        ? new Date(r.base_ts).getTime()
        : null
      : new Date(e.t0).getTime();
    if (anchor == null) {
      failed++;
      continue;
    }

    const cacheKey = String(Math.round(anchor / MINUTE));
    let bench = btcCache.get(cacheKey);
    if (!bench) {
      try {
        bench =
          (await fetchKlines(
            BENCHMARK,
            "1m",
            anchor - 2 * 60 * MINUTE,
            anchor + 26 * 60 * MINUTE,
          )) ?? [];
      } catch (err) {
        console.log(`  · BTC 基准获取失败（#${e.id}）：${(err as Error).message}`);
        failed++;
        await sleep(300);
        continue;
      }
      btcCache.set(cacheKey, bench);
      await sleep(100);
    }
    if (!bench.length) {
      failed++;
      continue;
    }

    const { hourly, vol } = await baselineWindowFor(e.token_symbol, new Date(e.t0).getTime());
    if (vol != null) volOk++;

    const x = computeExcess({
      bench1m: bench,
      anchor,
      baseAfterT0: Boolean(r.base_after_t0),
      tokenRet1h: r.ret_1h,
      tokenRet4h: r.ret_4h,
      tokenRet24h: r.ret_24h,
      baselineVolDaily: vol,
    });
    const long = computeLongWindows({
      token1h: hourly ?? [],
      bench1h: btc1h,
      t0: new Date(e.t0).getTime(),
      anchor,
      baselineVolDaily: vol,
    });

    rows.push({
      event_id: e.id,
      methodology_version: EXPECTATION_VERSION,
      benchmark: "BTC",
      anchor_ts: new Date(anchor).toISOString(),
      bench_ret_1h: x.benchRet1h,
      bench_ret_4h: x.benchRet4h,
      bench_ret_24h: x.benchRet24h,
      excess_ret_1h: x.excessRet1h,
      excess_ret_4h: x.excessRet4h,
      excess_ret_24h: x.excessRet24h,
      baseline_vol_daily: x.baselineVolDaily,
      z_1h: x.z1h,
      z_4h: x.z4h,
      z_24h: x.z24h,
      pre_ret_24h: long.preRet24h,
      pre_excess_24h: long.preExcess24h,
      pre_ret_72h: long.preRet72h,
      pre_excess_72h: long.preExcess72h,
      ret_72h: long.ret72h,
      excess_ret_72h: long.excessRet72h,
      z_72h: long.z72h,
      ret_168h: long.ret168h,
      excess_ret_168h: long.excessRet168h,
      z_168h: long.z168h,
      computed_at: new Date().toISOString(),
    });
    computed++;

    if (rows.length >= 200) {
      const { error: upErr } = await db
        .from("event_expectation")
        .upsert(rows, { onConflict: "event_id,methodology_version" });
      if (upErr) throw upErr;
      rows.length = 0;
    }
    if (computed % 50 === 0) {
      const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
      console.log(
        `  [${computed}/${scope.length}] #${e.id} ${e.token_symbol} pre3d ${pct(long.preExcess72h)} · 4h ${pct(x.excessRet4h)} · 7d ${pct(long.excessRet168h)}`,
      );
    }
  }

  if (rows.length) {
    const { error: upErr } = await db
      .from("event_expectation")
      .upsert(rows, { onConflict: "event_id,methodology_version" });
    if (upErr) throw upErr;
  }

  console.log(
    `\n✓ 完成：写入 ${computed} 条（失败 ${failed}）· 事前波动可用 ${volOk}/${scope.length} · 口径 ${EXPECTATION_VERSION}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
