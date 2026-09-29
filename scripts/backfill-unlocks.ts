/**
 * 回填 DefiLlama 解锁历史（+ 未来）。
 *
 *   pnpm unlocks:import                       # 读 .cache/defillama-unlocks-nextdata.json
 *   pnpm unlocks:import --file path.json
 *   pnpm unlocks:import --url https://defillama.com/unlocks
 *
 * 流程：__NEXT_DATA__ → NormalizedRecord → source_records（批量）
 *       → resolve_source_events() 批量解析成 events（psql；无 psql 时回退 RPC）。
 *
 * 本机 Node 通常取不到 defillama.com（ECONNRESET），所以默认从本地快照读；
 * 快照由浏览器抓取（见 docs / 手动流程），Worker 环境可直接用 --url。
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  extractNextData,
  parseDefiLlamaUnlocks,
  type DlNextData,
} from "../packages/data-layer/src/sources/defillama-unlocks";

if (!process.env.SUPABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    /* 继续，下面会报缺参 */
  }
}

const SOURCE_ID = "defillama-unlocks";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } }) as any;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadNextData(): Promise<DlNextData> {
  const file = arg("--file") ?? ".cache/defillama-unlocks-nextdata.json";
  const urlArg = arg("--url");
  if (urlArg) {
    const res = await fetch(urlArg, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new Error(`fetch ${urlArg} → ${res.status}`);
    return extractNextData(await res.text());
  }
  console.log(`读取快照：${file}`);
  return JSON.parse(readFileSync(file, "utf8")) as DlNextData;
}

async function upsertInBatches(rows: any[], batch = 500): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const { error } = await db
      .from("source_records")
      .upsert(slice, { onConflict: "source_id,record_type,dedupe_key" });
    if (error) throw new Error(`source_records upsert: ${error.message}`);
    n += slice.length;
    process.stdout.write(`\r  写入 source_records ${n}/${rows.length}`);
  }
  process.stdout.write("\n");
  return n;
}

/**
 * 通过 psql 跑解析：绕过 PostgREST 的短 statement_timeout（批量回填会超时）。
 * 找不到 psql 时返回 null，由 RPC 回退。
 */
function resolveViaPsql(): { events: number; provenance: number } | null {
  const dbUrl = process.env.SUPABASE_DB_POOLER_URL;
  if (!dbUrl) return null;
  const bins = [process.env.PSQL_BIN, "/opt/homebrew/opt/libpq/bin/psql", "psql"].filter(
    Boolean,
  ) as string[];
  const sql = `set statement_timeout='0'; select * from resolve_source_events('${SOURCE_ID}');`;
  for (const bin of bins) {
    try {
      const out = execFileSync(
        bin,
        [dbUrl, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-F", ",", "-c", sql],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      const [e, p] = (out.trim().split("\n").pop() ?? "").split(",").map(Number);
      if (Number.isFinite(e)) return { events: e, provenance: Number.isFinite(p) ? p : 0 };
    } catch (err: any) {
      if (err?.code === "ENOENT") continue;
      throw err;
    }
  }
  return null;
}

async function resolveViaRpc(): Promise<{ events: number; provenance: number }> {
  console.log("  （未找到 psql，改用 RPC——大批量可能触发 statement timeout）");
  const { data, error } = await db.rpc("resolve_source_events", { p_source_id: SOURCE_ID });
  if (error) throw new Error(`resolve_source_events: ${error.message}`);
  const r = Array.isArray(data) ? data[0] : data;
  return { events: r?.events_upserted ?? 0, provenance: r?.provenance_rows ?? 0 };
}

async function main() {
  const t0 = Date.now();
  console.log(`\n===== DefiLlama 解锁回填 ${new Date().toISOString().slice(0, 16)} UTC =====`);

  const next = await loadNextData();
  const records = parseDefiLlamaUnlocks(next);
  const cliff = records.filter((r) => r.event_type === "unlock_cliff").length;
  const linear = records.length - cliff;
  const withPct = records.filter((r) => r.magnitude_pct != null).length;
  console.log(
    `解析：${records.length} 个解锁事件（cliff ${cliff} / linear ${linear}），含供应占比 ${withPct}`,
  );

  const rows = records.map((r) => ({
    source_id: SOURCE_ID,
    raw_id: null,
    record_type: r.record_type,
    ext_id: r.ext_id,
    event_type: r.event_type,
    token_symbol: r.token_symbol,
    chain: r.chain ?? null,
    t0: r.t0,
    t0_confidence: r.t0_confidence,
    magnitude_usd: r.magnitude_usd ?? null,
    magnitude_pct: r.magnitude_pct ?? null,
    source_url: r.source_url,
    detail: r.detail ?? {},
    dedupe_key: r.dedupe_key,
  }));

  await upsertInBatches(rows);

  console.log("解析 L2（resolve_source_events → events + provenance）…");
  const resolved = resolveViaPsql() ?? (await resolveViaRpc());
  console.log(`  events 写入/更新：${resolved.events}，provenance：${resolved.provenance}`);

  console.log(`\n✓ 完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
