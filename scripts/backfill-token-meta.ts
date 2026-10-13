/**
 * Phase 6.5：代币元数据回填（CoinGecko）——补上 tokens.market_cap / max_supply / total_supply。
 *
 *   pnpm meta                       # 默认：上币事件涉及的全部符号
 *   pnpm meta --limit 50            # 小批量试跑
 *   pnpm meta --symbols HEMI,APT    # 指定符号
 *
 * 说明：
 *   - Free/Demo 档限制历史市值（365 天），所以只取「当前」供应量与市值；
 *     上币 FDV 用「上币时价格 × 当前最大/总供应」近似（粗粒度规模档，见 0018 注释）
 *   - 30 次/分钟限流：默认每次请求间隔 2.1s；429 自动退避重试
 *   - 符号→CoinGecko id：优先从市值前 N（默认 2500）里选市值最大的同名；找不到再查 /coins/list，
 *     多候选时跳过（不猜）
 */
import { createClient } from "@supabase/supabase-js";

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

const CG = "https://api.coingecko.com/api/v3";
const CG_KEY = process.env.COINGECKO_API_KEY ?? "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const limit = Number(arg("--limit") ?? Infinity);
const symbolsArg = arg("--symbols");
const topPages = Number(arg("--top-pages") ?? 10);

async function cg<T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T | null> {
  const u = new URL(`${CG}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(u, {
      headers: CG_KEY ? { "x-cg-demo-api-key": CG_KEY } : {},
    });
    if (res.status === 429) {
      await sleep(8000 * (attempt + 1));
      continue;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  }
  return null;
}

interface MarketRow {
  id: string;
  symbol: string;
  name: string;
  market_cap: number | null;
}

interface CoinDetail {
  id: string;
  symbol: string;
  market_data?: {
    market_cap?: { usd?: number };
    max_supply?: number | null;
    total_supply?: number | null;
  };
}

async function main() {
  // 1) 目标符号：上币事件涉及的全部（或指定）
  let symbols: string[];
  if (symbolsArg) {
    symbols = symbolsArg
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  } else {
    const { data, error } = await db
      .from("events")
      .select("token_symbol")
      .eq("event_type", "listing_cex");
    if (error) throw error;
    symbols = [
      ...new Set((data ?? []).map((r: any) => String(r.token_symbol).toUpperCase())),
    ].sort();
  }
  symbols = symbols.slice(0, Number.isFinite(limit) ? limit : undefined);
  console.log(
    `代币元数据回填：${symbols.length} 个符号 · CoinGecko ${CG_KEY ? "Demo key" : "无 key"}`,
  );

  // 2) 市值前 N：symbol → 市值最大的 id
  const bySymbol = new Map<string, { id: string; market_cap: number }>();
  for (let page = 1; page <= topPages; page++) {
    const rows = await cg<MarketRow[]>("/coins/markets", {
      vs_currency: "usd",
      order: "market_cap_desc",
      per_page: 250,
      page,
      sparkline: false,
    });
    if (!rows?.length) break;
    for (const r of rows) {
      const sym = r.symbol?.toUpperCase();
      if (!sym) continue;
      const prev = bySymbol.get(sym);
      const mc = r.market_cap ?? 0;
      if (!prev || mc > prev.market_cap) bySymbol.set(sym, { id: r.id, market_cap: mc });
    }
    console.log(`  markets page ${page}: 累计 ${bySymbol.size} 个符号`);
    await sleep(2100);
  }

  // 3) 兜底 /coins/list（仅当有符号没覆盖到）
  const needFallback = symbols.some((s) => !bySymbol.has(s));
  let listIndex: Map<string, string[]> | null = null;
  if (needFallback) {
    const list = await cg<Array<{ id: string; symbol: string }>>("/coins/list");
    listIndex = new Map();
    for (const c of list ?? []) {
      const sym = c.symbol?.toUpperCase();
      if (!sym) continue;
      const arr = listIndex.get(sym) ?? [];
      arr.push(c.id);
      listIndex.set(sym, arr);
    }
    console.log(`  /coins/list: ${list?.length ?? 0} 个币，已建索引`);
    await sleep(2100);
  }

  // 4) 逐个拉详情并写 tokens
  let updated = 0;
  let skipped = 0;
  const unresolved: string[] = [];
  for (const sym of symbols) {
    let id = bySymbol.get(sym)?.id ?? null;
    if (!id && listIndex) {
      const cands = listIndex.get(sym) ?? [];
      if (cands.length === 1) id = cands[0]!;
    }
    if (!id) {
      unresolved.push(sym);
      skipped++;
      continue;
    }
    const detail = await cg<CoinDetail>(`/coins/${id}`, {
      localization: "false",
      tickers: "false",
      community_data: "false",
      developer_data: "false",
      sparkline: "false",
    });
    await sleep(2100);
    if (!detail) {
      skipped++;
      continue;
    }
    const md = detail.market_data ?? {};
    const { error } = await db.from("tokens").upsert(
      {
        symbol: sym,
        coingecko_id: detail.id,
        market_cap: md.market_cap?.usd ?? null,
        max_supply: md.max_supply ?? null,
        total_supply: md.total_supply ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "symbol" },
    );
    if (error) {
      console.error(`  · ${sym} 写入失败：${error.message}`);
      skipped++;
    } else {
      updated++;
      if (updated % 25 === 0) console.log(`  已更新 ${updated}/${symbols.length}（${sym}）`);
    }
  }

  console.log(`\n✓ 完成：更新 ${updated} 个，跳过 ${skipped} 个`);
  if (unresolved.length) {
    console.log(
      `  无法映射（已跳过，不猜）：${unresolved.slice(0, 30).join(", ")}${unresolved.length > 30 ? " …" : ""}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
