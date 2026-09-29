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
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
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

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toISOString().replace("T", " ").slice(0, 16);
}

function sparkline(prices: number[], width = 900, height = 160): string {
  if (prices.length < 2) return "";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const step = width / (prices.length - 1);
  const pts = prices
    .map(
      (p, i) =>
        `${(i * step).toFixed(1)},${(height - ((p - min) / span) * (height - 20) - 10).toFixed(1)}`,
    )
    .join(" ");
  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="spark">
    <polyline points="${pts}" fill="none" stroke="#22d3ee" stroke-width="1.5" />
  </svg>`;
}

async function main() {
  const [{ data: events }, { data: candles }] = await Promise.all([
    api.from("events_v1").select("*").order("t0", { ascending: false }).limit(100),
    db
      .from("price_candles")
      .select("ts,close")
      .eq("symbol", "BTC")
      .eq("interval", "1m")
      .order("ts", { ascending: true })
      .limit(500),
  ]);

  const rows = events ?? [];
  const prices = (candles ?? []).map((c: any) => Number(c.close));

  const byClass: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const e of rows) {
    byClass[e.asset_class] = (byClass[e.asset_class] ?? 0) + 1;
    byType[e.event_type] = (byType[e.event_type] ?? 0) + 1;
  }

  const statCards = [
    { label: "事件总数", value: String(rows.length) },
    ...Object.entries(byClass).map(([k, v]) => ({ label: `asset_class: ${k}`, value: String(v) })),
    ...Object.entries(byType).map(([k, v]) => ({ label: `type: ${k}`, value: String(v) })),
    { label: "BTC 1m K线", value: String(prices.length) },
  ];

  const tableRows = rows
    .map(
      (e: any) => `<tr>
      <td class="mono">${fmtTs(e.t0)}</td>
      <td><strong>${esc(e.token_symbol)}</strong></td>
      <td><span class="badge" style="background:${ASSET_BADGE[e.asset_class] ?? "#64748b"}">${esc(
        e.asset_class,
      )}</span></td>
      <td class="mono">${esc(e.event_type)}</td>
      <td class="title">${esc(e.title ?? "")}</td>
      <td class="num">${e.ret_15m == null ? "—" : (e.ret_15m * 100).toFixed(2) + "%"}</td>
      <td class="num">${e.source_count}</td>
      <td class="num">${e.confidence.toFixed(2)}</td>
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
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial}
  header{padding:20px 24px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  h1{margin:0;font-size:18px}
  .mut{color:var(--mut);font-size:12px}
  main{padding:20px 24px;max-width:1280px;margin:0 auto}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:20px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px}
  .card .v{font-size:20px;font-weight:600}
  .card .l{color:var(--mut);font-size:11px;margin-top:2px}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:18px}
  .panel h2{margin:0 0 10px;font-size:13px;color:var(--mut);font-weight:600;letter-spacing:.04em;text-transform:uppercase}
  .spark{width:100%;height:150px;display:block}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;position:sticky;top:0;background:var(--panel)}
  tr:hover td{background:#16223c}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--mut);white-space:nowrap}
  .num{text-align:right;font-family:ui-monospace,Menlo,monospace}
  .title{max-width:420px}
  .badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;color:#fff;font-weight:600}
  footer{padding:16px 24px;color:var(--mut);font-size:11px;border-top:1px solid var(--line)}
</style></head>
<body>
<header>
  <h1>MoonEvent · 加密事件研究引擎 <span class="mut">数据预览</span></h1>
  <span class="mut">生成于 ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC · 数据源 Supabase</span>
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
    <h2>BTC 1m 价格（最近 ${prices.length} 根）</h2>
    ${sparkline(prices)}
  </div>

  <div class="panel">
    <h2>事件（api.events_v1，最近 ${rows.length} 条）</h2>
    <table>
      <thead><tr>
        <th>T0 (UTC)</th><th>代币</th><th>资产类别</th><th>事件类型</th><th>标题</th>
        <th class="num">15m 反应</th><th class="num">源数</th><th class="num">置信度</th>
      </tr></thead>
      <tbody>${tableRows || '<tr><td colspan="8" class="mut">暂无事件</td></tr>'}</tbody>
    </table>
  </div>
</main>
<footer>基于历史市场数据，非 AI 生成 · 15m 反应列待 Phase 2 反应引擎填充 · 本页仅供内部预览，非投资建议</footer>
</body></html>`;

  const outDir = resolve(process.cwd(), "preview");
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, "index.html");
  writeFileSync(outFile, html);
  console.log(`✓ 预览已生成: ${outFile}`);
  console.log(`  事件 ${rows.length} 条 · BTC K线 ${prices.length} 根`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
