/**
 * 回填 Deribit DVOL（年化隐含波动率指数）——"预期 vs 实际"的输入。
 *
 *   pnpm backfill:dvol                 # BTC + ETH，从 2022-01-01 起，1h 分辨率
 *   pnpm backfill:dvol --currency BTC --since 2023-01-01
 *
 * 分页：接口每次最多返回 1000 点且以 end_timestamp 结尾，因此把 end 往前推。
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const SOURCE = "deribit-dvol";
const API = "https://www.deribit.com/api/v2/public/get_volatility_index_data";

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
}
const currencies = arg("currency", "BTC,ETH").split(",");
const since = Date.parse(arg("since", "2022-01-01T00:00:00Z"));
const resolution = Number(arg("resolution", "3600")); // 秒

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(currency: string, start: number, end: number): Promise<number[][]> {
  const u = `${API}?currency=${currency}&start_timestamp=${start}&end_timestamp=${end}&resolution=${resolution}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error(`deribit ${res.status}`);
  const j: any = await res.json();
  return j?.result?.data ?? [];
}

async function backfill(currency: string) {
  let end = Date.now();
  let total = 0;
  let guard = 0;
  while (end > since && guard++ < 200) {
    const rows = await fetchPage(currency, since, end);
    if (!rows.length) break;
    const values = rows
      .filter((r) => r[0] >= since)
      .map((r) => ({
        source_id: SOURCE,
        currency,
        ts: new Date(Number(r[0])).toISOString(),
        open: r[1],
        high: r[2],
        low: r[3],
        close: r[4],
      }));
    if (values.length) {
      for (let i = 0; i < values.length; i += 500) {
        const { error } = await db
          .from("volatility_index")
          .upsert(values.slice(i, i + 500), { onConflict: "source_id,currency,ts" });
        if (error) throw error;
      }
      total += values.length;
    }
    const earliest = Number(rows[0]![0]);
    if (!Number.isFinite(earliest) || earliest <= since) break;
    end = earliest;
    process.stdout.write(
      `\r  ${currency}: ${total} 点，已回溯到 ${new Date(earliest).toISOString().slice(0, 10)}`,
    );
    await sleep(150);
  }
  console.log(`\n✓ ${currency}: ${total} 点`);
}

async function main() {
  for (const c of currencies) await backfill(c.trim().toUpperCase());
  const { count } = await db.from("volatility_index").select("*", { count: "exact", head: true });
  console.log(`✓ volatility_index 共 ${count} 行`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
