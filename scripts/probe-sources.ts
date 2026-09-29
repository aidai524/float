/**
 * 数据源可达性探测 —— 在任意机器上跑，看看哪些源能通。
 *
 *   pnpm probe          # 读 .env
 *
 * 用途：决定 pipeline 该跑在哪（本机 / VPS / Cloudflare Worker）。
 * 各机器的网络封锁差异很大：
 *   - 本机：Binance 通；CoinGecko / defillama.com 不通
 *   - Cloudflare Worker：CoinGecko / CMC / Bybit 通；Binance / defillama.com 返回 403
 *   - VPS：理论上都通，但 Binance 会按地区封（美国 → 451），defillama 可能仍有 Cloudflare 质询
 */
if (!process.env.SUPABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    /* 没 .env 也能跑，只是少测几个带 key 的源 */
  }
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface Probe {
  id: string;
  url: string;
  headers?: Record<string, string>;
  /** 判定“业务可用”的自定义检查（HTTP 200 也可能是错误 payload） */
  check?: (status: number, text: string) => boolean;
}

const env = process.env;

const probes: Probe[] = [
  {
    id: "binance-price",
    url: "https://api.binance.com/api/v3/time",
    headers: { "user-agent": UA },
  },
  {
    id: "binance-announcements",
    url: "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=48&pageNo=1&pageSize=5",
    headers: { "user-agent": UA },
  },
  { id: "bybit", url: "https://api.bybit.com/v5/market/time" },
  {
    id: "cmc-unlocks",
    url: "https://api.coinmarketcap.com/data-api/v3/token-unlock/listing?start=1&limit=5&sort=next_unlocked_date&direction=desc&enableSmallUnlocks=true",
    headers: { "user-agent": UA, referer: "https://coinmarketcap.com/token-unlocks/" },
    check: (_s, t) => t.includes("tokenUnlockList"),
  },
  {
    id: "coingecko",
    url: "https://api.coingecko.com/api/v3/ping",
    headers: {
      "user-agent": UA,
      ...(env.COINGECKO_API_KEY ? { "x-cg-demo-api-key": env.COINGECKO_API_KEY } : {}),
    },
    check: (_s, t) => t.includes("gecko"),
  },
  {
    id: "defillama-unlocks",
    url: "https://defillama.com/unlocks",
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    check: (_s, t) => t.includes("__NEXT_DATA__"),
  },
  {
    id: "llama-api-emissions",
    url: "https://api.llama.fi/emissions",
    // 402 = 可达但付费
    check: (s, t) => s === 402 || t.includes("Upgrade"),
  },
  ...(env.COINMARKETCAL_API_KEY
    ? [
        {
          id: "coinmarketcal",
          url: "https://api.coinmarketcal.com/v2/events?max=1",
          headers: { "x-api-key": env.COINMARKETCAL_API_KEY, "user-agent": UA },
          check: (_s: number, t: string) => t.includes("data"),
        },
      ]
    : []),
  ...(env.FRED_API_KEY
    ? [
        {
          id: "fred",
          url: `https://api.stlouisfed.org/fred/releases?api_key=${env.FRED_API_KEY}&file_type=json&limit=1`,
        },
      ]
    : []),
  ...(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? [
        {
          id: "supabase",
          url: `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/events?select=id&limit=1`,
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      ]
    : []),
];

async function run(p: Probe) {
  const started = Date.now();
  try {
    const res = await fetch(p.url, { headers: p.headers, redirect: "follow" });
    const text = await res.text();
    const usable = p.check ? p.check(res.status, text) : res.ok;
    return {
      id: p.id,
      status: res.status,
      ms: Date.now() - started,
      ok: usable,
      note:
        res.status === 451
          ? "地区封锁（Binance 常见）"
          : !res.ok && (p.check ? p.check(res.status, text) : false)
            ? "—"
            : text.replace(/\s+/g, " ").slice(0, 60) || "",
    };
  } catch (e) {
    return {
      id: p.id,
      status: 0,
      ms: Date.now() - started,
      ok: false,
      note:
        e instanceof Error
          ? `${e.message}${e.cause ? ` (${(e.cause as any).code ?? ""})` : ""}`
          : String(e),
    };
  }
}

const results = await Promise.all(probes.map(run));

console.log(`\n数据源可达性 —— ${new Date().toISOString().slice(0, 16)} UTC`);
console.log("─".repeat(72));
for (const r of results) {
  const mark = r.ok ? "✅" : "❌";
  console.log(
    `${mark}  ${r.id.padEnd(22)} HTTP ${String(r.status).padEnd(4)} ${String(r.ms).padStart(6)}ms  ${r.note}`,
  );
}
console.log("─".repeat(72));

const core = ["binance-price", "cmc-unlocks", "coingecko"];
const failed = results.filter((r) => core.includes(r.id) && !r.ok);
if (failed.length) {
  console.log(`\n⚠️  核心源不可用：${failed.map((f) => f.id).join(", ")}`);
  process.exit(1);
}
console.log("\n✓ 核心源全部可用");
