/**
 * 个性化告警派发（VPS daily 调用，或手动 `pnpm alerts`）：
 *   - 对每个配置了 Telegram 的用户，检查其 Watchlist 代币的：
 *       T-7 / T-3 / T-1（事件前）与 post（事件后 24h 内实测反应）
 *   - alert_log 唯一键去重（user_id, event_id, kind）：同一条只发一次
 *   - 内容带同类基准与样本量；无基准时明说不编造
 *
 * 依赖：`alert_prefs.telegram_chat_id`（用户在 /account 填写）+ `TELEGRAM_BOT_TOKEN`
 */
import { createClient } from "@supabase/supabase-js";
import { sendTelegram } from "./lib/digest";

if (!process.env.SUPABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    // 继续走缺参报错
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const api = db.schema("api");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (v: number | null | undefined, digits = 2): string =>
  v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
const usd = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

const TYPE_LABEL: Record<string, string> = {
  unlock_cliff: "悬崖解锁",
  unlock_linear: "线性解锁",
  listing_cex: "现货/合约上币",
  listing_futures: "合约上币",
  listing_dex: "DEX 上线",
  macro_fomc: "FOMC",
  macro_cpi: "CPI",
  macro_nfp: "非农",
};

interface UserPref {
  user_id: string;
  telegram_chat_id: string | null;
  horizons: number[] | null;
}

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

function floatBucket(p: number | null): string | null {
  if (p == null) return null;
  if (p >= 0.1) return ">=10%";
  if (p >= 0.05) return "5-10%";
  if (p >= 0.02) return "2-5%";
  if (p >= 0.01) return "1-2%";
  if (p >= 0.005) return "0.5-1%";
  return null;
}

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.log("未配置 TELEGRAM_BOT_TOKEN，跳过告警派发（dry）");
    return;
  }

  const { data: prefs, error: pErr } = await db
    .from("alert_prefs")
    .select("user_id,telegram_chat_id,horizons")
    .eq("enabled", true)
    .not("telegram_chat_id", "is", null);
  if (pErr) throw pErr;
  if (!prefs?.length) {
    console.log("没有启用告警的用户");
    return;
  }

  const { data: watch, error: wErr } = await db.from("watchlists").select("user_id,token_symbol");
  if (wErr) throw wErr;
  const byUser = new Map<string, string[]>();
  for (const w of (watch ?? []) as Array<{ user_id: string; token_symbol: string }>) {
    const arr = byUser.get(w.user_id) ?? [];
    arr.push(w.token_symbol);
    byUser.set(w.user_id, arr);
  }

  // 基准：类型 × 资产类别 → 聚合（与首页同一套口径）
  const { data: typeStats } = await api
    .from("event_type_stats_v1")
    .select("event_type,n,median_1h,median_24h,pos_24h")
    .gte("n", 5);
  const statByType = new Map<
    string,
    { n: number; med1h: number[]; med24h: number[]; pos24h: number[] }
  >();
  for (const s of (typeStats ?? []) as any[]) {
    const a = statByType.get(s.event_type) ?? { n: 0, med1h: [], med24h: [], pos24h: [] };
    a.n += s.n;
    if (s.median_1h != null) a.med1h.push(s.median_1h);
    if (s.median_24h != null) a.med24h.push(s.median_24h);
    if (s.pos_24h != null) a.pos24h.push(s.pos_24h);
    statByType.set(s.event_type, a);
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const { data: bucketRows } = await api
    .from("unlock_float_stats_v2")
    .select("bucket,n_excess,median_excess_24h,median_abn_168h");
  const buckets = new Map<string, any>(((bucketRows ?? []) as any[]).map((b) => [b.bucket, b]));

  const now = Date.now();
  let sent = 0;
  let skipped = 0;

  for (const p of prefs as UserPref[]) {
    const symbols = byUser.get(p.user_id) ?? [];
    if (!symbols.length) continue;
    const horizons = (p.horizons?.length ? p.horizons : [7, 3, 1]).filter((h) => h > 0);
    const horizonMax = Math.max(...horizons);

    const { data: events } = await api
      .from("events_v1")
      .select(
        "id,event_type,token_symbol,t0,magnitude_usd,magnitude_pct,source_detail,ret_1h,ret_4h,ret_24h,base_ts",
      )
      .in("token_symbol", symbols)
      .gte("t0", new Date(now - 86400_000).toISOString())
      .lte("t0", new Date(now + horizonMax * 86400_000).toISOString())
      .order("t0", { ascending: true })
      .limit(200);

    for (const e of (events ?? []) as any[]) {
      const t0 = new Date(e.t0).getTime();
      const days = (t0 - now) / 86400_000;
      let kind: string | null = null;
      if (days > 0) {
        const h = horizons.find((h) => Math.abs(days - h) <= 0.5);
        if (h != null) kind = `t-${h}`;
      } else if (e.base_ts && e.ret_1h != null) {
        kind = "post";
      }
      if (!kind) continue;

      // 先占位去重，插不进去说明已发过
      const { data: ins, error: insErr } = await db
        .from("alert_log")
        .upsert(
          { user_id: p.user_id, event_id: e.id, kind },
          { onConflict: "user_id,event_id,kind", ignoreDuplicates: true },
        )
        .select("id");
      if (insErr) {
        console.error(`  · 去重写入失败（#${e.id}）：${insErr.message}`);
        continue;
      }
      if (!ins?.length) {
        skipped++;
        continue;
      }

      const label = TYPE_LABEL[e.event_type] ?? e.event_type;
      const lines: string[] = [];
      if (kind === "post") {
        lines.push(`<b>${esc(e.token_symbol)}</b> ${esc(label)} · 已发生`);
        lines.push(`实测：1h ${pct(e.ret_1h)} · 4h ${pct(e.ret_4h)} · 24h ${pct(e.ret_24h)}`);
      } else {
        lines.push(
          `<b>${esc(e.token_symbol)}</b> ${esc(label)} · ${Math.round(days)} 天后（${e.t0.slice(11, 16)} UTC）`,
        );
        const fp = floatPct(e.source_detail, e.magnitude_pct);
        const bits = [
          e.magnitude_usd != null ? usd(e.magnitude_usd) : null,
          fp != null ? `占流通 ${(fp * 100).toFixed(2)}%` : null,
          e.source_detail?.allocation ?? null,
        ].filter(Boolean);
        if (bits.length) lines.push(bits.join(" · "));
      }

      // 同类基准
      if (e.event_type.startsWith("unlock")) {
        const b = floatBucket(floatPct(e.source_detail, e.magnitude_pct));
        const stat = b ? buckets.get(b) : null;
        if (stat && stat.n_excess >= 20) {
          lines.push(
            `同类 ${b} 桶：24h 调整中位 ${pct(stat.median_excess_24h)} · 7 天净 ${pct(stat.median_abn_168h)}（N=${stat.n_excess}）`,
          );
        } else {
          lines.push("稀释 <0.5% 或样本不足：无同类基准");
        }
      } else {
        const s = statByType.get(e.event_type);
        if (s) {
          lines.push(
            `同类历史：1h 中位 ${pct(avg(s.med1h))} · 24h 中位 ${pct(avg(s.med24h))} · 上涨 ${s.pos24h.length ? `${Math.round((avg(s.pos24h) ?? 0) * 100)}%` : "—"}（N=${s.n}）`,
          );
        }
      }
      lines.push(`<i>基于历史数据，非投资建议 · float.aidai524.workers.dev</i>`);

      try {
        await sendTelegram(botToken, p.telegram_chat_id!, lines.join("\n"));
        sent++;
      } catch (err) {
        console.error(`  · 发送失败（${e.token_symbol}）：${(err as Error).message}`);
      }
      await sleep(300);
    }
  }

  console.log(`✓ 告警派发完成：发送 ${sent} 条，跳过已发 ${skipped} 条`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
