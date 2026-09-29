/**
 * 生成静态预览页（无需部署）：把云端 api.events_v1 + K 线渲染成单文件 HTML。
 *
 *   pnpm preview   →  preview/index.html
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const api = db.schema("api");

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const ASSET_BADGE: Record<string, string> = {
  crypto: "#2563eb",
  rwa: "#7c3aed",
  unknown: "#64748b",
};

const fmtTs = (ts: string | null, withTime = true) =>
  ts
    ? new Date(ts)
        .toISOString()
        .replace("T", " ")
        .slice(0, withTime ? 16 : 10)
    : "—";

const fmtPrice = (v: number) =>
  v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(2);

function hostOf(u: string | null): string {
  if (!u) return "—";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

/** 带坐标轴与事件标注的折线图 */
function lineChart(
  points: { t: number; v: number }[],
  events: { t: number; label: string }[],
  width = 1040,
  height = 340,
): string {
  if (points.length < 2) return '<p class="mut">无价格数据（先跑 pnpm backfill）</p>';
  const pad = { l: 68, r: 20, t: 18, b: 30 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const vMin = Math.min(...points.map((p) => p.v));
  const vMax = Math.max(...points.map((p) => p.v));
  const span = vMax - vMin || 1;
  const lo = vMin - span * 0.06;
  const hi = vMax + span * 0.06;

  const X = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * iw;
  const Y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;

  // Y 轴网格 + 标签
  const yTicks = 5;
  let grid = "";
  for (let i = 0; i < yTicks; i++) {
    const v = lo + ((hi - lo) * i) / (yTicks - 1);
    const y = Y(v);
    grid += `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${pad.l + iw}" y2="${y.toFixed(1)}" stroke="#1e293b"/>`;
    grid += `<text x="${pad.l - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="ax">${fmtPrice(v)}</text>`;
  }
  // X 轴刻度 + 日期
  const xTicks = 5;
  let xAxis = "";
  for (let i = 0; i < xTicks; i++) {
    const t = t0 + ((t1 - t0) * i) / (xTicks - 1);
    const x = X(t);
    const label = new Date(t).toISOString().slice(0, 10);
    xAxis += `<line x1="${x.toFixed(1)}" y1="${pad.t}" x2="${x.toFixed(1)}" y2="${pad.t + ih}" stroke="#16223c"/>`;
    xAxis += `<text x="${x.toFixed(1)}" y="${height - 10}" text-anchor="middle" class="ax">${label}</text>`;
  }

  const line = points.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ");

  // 事件标注（仅在窗口内）
  const markers = events
    .filter((e) => e.t >= t0 && e.t <= t1)
    .map((e, i) => {
      const x = X(e.t);
      const y = pad.t + 12 + (i % 3) * 14;
      const short = e.label.length > 12 ? e.label.slice(0, 11) + "…" : e.label;
      return `<line x1="${x.toFixed(1)}" y1="${pad.t}" x2="${x.toFixed(1)}" y2="${pad.t + ih}" stroke="#f59e0b" stroke-dasharray="3 3" stroke-width="1"/>
        <circle cx="${x.toFixed(1)}" cy="${pad.t + ih}" r="3" fill="#f59e0b"/>
        <text x="${(x + 4).toFixed(1)}" y="${y}" class="evt">${esc(short)}</text>`;
    })
    .join("\n");

  return `<svg viewBox="0 0 ${width} ${height}" class="chart">
    ${grid}${xAxis}
    <polyline points="${line}" fill="none" stroke="#22d3ee" stroke-width="1.8"/>
    ${markers}
  </svg>`;
}

async function main() {
  const { data: events } = await api
    .from("events_v1")
    .select("*")
    .order("t0", { ascending: false })
    .limit(100);

  const rows = events ?? [];

  // 优先用日线（窗口长、能覆盖事件），没有则回退 1m
  const [{ data: daily }, { data: minute }] = await Promise.all([
    db
      .from("price_candles")
      .select("ts,close")
      .eq("symbol", "BTC")
      .eq("interval", "1d")
      .order("ts", { ascending: true })
      .limit(500),
    db
      .from("price_candles")
      .select("ts,close")
      .eq("symbol", "BTC")
      .eq("interval", "1m")
      .order("ts", { ascending: true })
      .limit(500),
  ]);

  const useDaily = (daily ?? []).length > 2;
  const series = ((useDaily ? daily : minute) ?? []).map((c: any) => ({
    t: new Date(c.ts).getTime(),
    v: Number(c.close),
  }));
  const windowLabel = useDaily
    ? `BTC 日线（最近 ${series.length} 天）`
    : `BTC 1m（最近 ${series.length} 分钟）`;

  const byClass: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const e of rows) {
    byClass[e.asset_class] = (byClass[e.asset_class] ?? 0) + 1;
    byType[e.event_type] = (byType[e.event_type] ?? 0) + 1;
  }

  const statCards = [
    { label: "事件总数", value: String(rows.length) },
    { label: "已测量反应", value: String(rows.filter((e: any) => e.ret_1h != null).length) },
    ...Object.entries(byClass).map(([k, v]) => ({ label: `asset_class · ${k}`, value: String(v) })),
    ...Object.entries(byType).map(([k, v]) => ({ label: `type · ${k}`, value: String(v) })),
    { label: useDaily ? "日线" : "1m 线", value: String(series.length) },
  ];

  const pct = (v: number | null) =>
    v == null
      ? '<span class="nil">—</span>'
      : `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%</span>`;
  const liqCell = (v: boolean | null) =>
    v == null
      ? '<span class="nil" title="基准历史不足，无法判定">?</span>'
      : v
        ? '<span class="ok">Y</span>'
        : '<span class="warn" title="30 天日均成交额低于阈值">低</span>';

  const tableRows = rows
    .map(
      (e: any) => `<tr>
      <td class="mono">${fmtTs(e.t0)}${
        e.base_after_t0
          ? '<span class="flag" title="T0 时还没有市场数据，基准取自 T0 之后">*</span>'
          : ""
      }</td>
      <td><strong>${esc(e.token_symbol)}</strong></td>
      <td><span class="badge" style="background:${ASSET_BADGE[e.asset_class] ?? "#64748b"}">${esc(
        e.asset_class,
      )}</span></td>
      <td class="mono">${esc(e.event_type)}</td>
      <td class="title">${esc(e.title ?? "")}</td>
      <td>${
        e.source_url
          ? `<a class="lnk" href="${esc(e.source_url)}" target="_blank" rel="noopener">${esc(
              hostOf(e.source_url),
            )} ↗</a>`
          : "—"
      }</td>
      <td class="num">${pct(e.ret_5m)}</td>
      <td class="num">${pct(e.ret_15m)}</td>
      <td class="num">${pct(e.ret_1h)}</td>
      <td class="num">${pct(e.ret_4h)}</td>
      <td class="num">${pct(e.ret_24h)}</td>
      <td class="num">${e.vol_ratio == null ? '<span class="nil">—</span>' : e.vol_ratio.toFixed(2) + "×"}</td>
      <td class="num">${liqCell(e.liquidity_ok)}</td>
      <td class="num">${Number(e.confidence).toFixed(2)}</td>
    </tr>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>MoonEvent · 数据预览</title>
<style>
  :root{--bg:#0b1120;--panel:#111a2e;--line:#1e293b;--fg:#e2e8f0;--mut:#94a3b8;--acc:#22d3ee}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial}
  header{padding:18px 24px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  h1{margin:0;font-size:18px}
  .mut{color:var(--mut);font-size:12px}
  main{padding:20px 24px;max-width:1320px;margin:0 auto}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:18px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px}
  .card .v{font-size:20px;font-weight:600}
  .card .l{color:var(--mut);font-size:11px;margin-top:2px}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:18px}
  .panel h2{margin:0 0 4px;font-size:13px;color:var(--fg);font-weight:600}
  .panel .sub{color:var(--mut);font-size:12px;margin-bottom:10px}
  .chart{width:100%;height:340px;display:block}
  .ax{fill:#64748b;font-size:11px;font-family:ui-monospace,Menlo,monospace}
  .evt{fill:#f59e0b;font-size:10px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  tr:hover td{background:#16223c}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--mut);white-space:nowrap}
  .num{text-align:right;font-family:ui-monospace,Menlo,monospace}
  .title{max-width:360px}
  .lnk{color:var(--acc);text-decoration:none;white-space:nowrap}
  .lnk:hover{text-decoration:underline}
  .badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;color:#fff;font-weight:600}
  .up{color:#34d399}.down{color:#f87171}.nil{color:#475569}
  .ok{color:#34d399}.warn{color:#f59e0b}
  .flag{color:#f59e0b;margin-left:2px;font-weight:700}
  footer{padding:16px 24px;color:var(--mut);font-size:11px;border-top:1px solid var(--line)}
</style></head>
<body>
<header>
  <h1>MoonEvent · 加密事件研究引擎 <span class="mut">数据预览</span></h1>
  <span class="mut">生成于 ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC</span>
</header>
<main>
  <div class="cards">
    ${statCards
      .map(
        (c) =>
          `<div class="card"><div class="v">${esc(c.value)}</div><div class="l">${esc(c.label)}</div></div>`,
      )
      .join("")}
  </div>

  <div class="panel">
    <h2>${windowLabel}</h2>
    <div class="sub">用途：验证价格采集是否正常，并把事件 T0（橙色虚线）与价格放在同一时间轴上看。此图不是最终图表，Phase 3 会用 TradingView Lightweight Charts 重做。</div>
    ${lineChart(
      series,
      rows.map((e: any) => ({
        t: new Date(e.t0).getTime(),
        label: `${e.token_symbol} ${e.event_type}`,
      })),
    )}
  </div>

  <div class="panel">
    <h2>事件（api.events_v1，最近 ${rows.length} 条）</h2>
    <div class="sub">数据来源：Binance / Bybit 公告 API、CoinMarketCal。反应口径 methodology v1：base = T0 前最近一根 1m 收盘；5m/15m/1h/4h/24h 为相对 base 的收益。标记 <span class="flag">*</span> 表示 T0 时尚无市场数据（如新币上线），基准取自 T0 之后；流动性 <span class="nil">?</span> 表示基准历史不足无法判定。</div>
    <table>
      <thead><tr>
        <th>T0 (UTC)</th><th>代币</th><th>资产类别</th><th>事件类型</th><th>标题</th><th>来源</th>
        <th class="num">5m</th><th class="num">15m</th><th class="num">1h</th><th class="num">4h</th><th class="num">24h</th>
        <th class="num">量比</th><th class="num">流动性</th><th class="num">置信度</th>
      </tr></thead>
      <tbody>${tableRows || '<tr><td colspan="14" class="mut">暂无事件</td></tr>'}</tbody>
    </table>
  </div>
</main>
<footer>基于历史市场数据，非 AI 生成 · 反应口径 methodology v1 · 本页仅供内部预览，非投资建议</footer>
</body></html>`;

  const outDir = resolve(process.cwd(), "preview");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "index.html");
  writeFileSync(outFile, html);
  console.log(`✓ 预览已生成: ${outFile}`);
  console.log(`  事件 ${rows.length} 条 · 图表 ${useDaily ? "日线" : "1m"} ${series.length} 根`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
