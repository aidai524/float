/**
 * Jev 批量分类：
 *   1) 代币 → category（l1/l2/defi/rwa/meme/...），并由此推导 asset_class
 *   2) 事件 → event_type（仅未分类的）
 *   3) 用代币的 asset_class 回填事件的 asset_class
 *
 * 利用 TypeSafe 的"并行提问"：一次请求里对多条数据各提一个问题。
 *
 *   pnpm classify
 *   pnpm classify --batch 25
 *   pnpm classify --events all      # 重新分类全部事件（校验规则分类）
 */
import { createClient } from "@supabase/supabase-js";
import {
  JevClient,
  EVENT_TYPE_CRITERIA,
  TOKEN_CATEGORY_CRITERIA,
  TOKEN_CATEGORY_IDS,
  tokenCategoryQuestion,
} from "../packages/judgment/src/index";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.TYPESAFE_API_KEY;
if (!url || !key || !apiKey) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TYPESAFE_API_KEY");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const jev = new JevClient({ apiKey });

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? def) : def;
}
const batchSize = Number(arg("batch", "25"));
const eventMode = arg("events", "unknown"); // unknown | all | none
const retryOther = process.argv.includes("--retry-other");

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ---------------- 0) 补全 tokens 行（事件里出现但 tokens 表没有的符号）----------------
async function ensureTokens() {
  const { data: evs } = await db.from("events").select("token_symbol").limit(5000);
  const { data: toks } = await db.from("tokens").select("symbol").limit(5000);
  const have = new Set((toks ?? []).map((t: any) => t.symbol));
  const missing = [...new Set((evs ?? []).map((e: any) => e.token_symbol))].filter(
    (s: string) => s && !have.has(s),
  );
  if (!missing.length) {
    console.log("· tokens 行已齐");
    return;
  }
  console.log(`· 补建 tokens 行：${missing.length} 个`);
  for (const symbol of missing) {
    await db.from("tokens").upsert({ symbol }, { onConflict: "symbol", ignoreDuplicates: true });
  }
}

/** symbol → 最近的事件标题（作为分类上下文） */
async function titlesBySymbol(): Promise<Map<string, string[]>> {
  const { data } = await db
    .from("events")
    .select("token_symbol,title,t0")
    .order("t0", { ascending: false })
    .limit(5000);
  const map = new Map<string, string[]>();
  for (const e of data ?? []) {
    const s = (e as any).token_symbol as string;
    const t = (e as any).title as string | null;
    if (!s || !t) continue;
    const arr = map.get(s) ?? [];
    if (arr.length < 3) arr.push(t);
    map.set(s, arr);
  }
  return map;
}

// ---------------- 1) 代币分类 ----------------
async function classifyTokens(retryOther: boolean) {
  const ctx = await titlesBySymbol();
  const { data: tokens, error } = await db
    .from("tokens")
    .select("symbol,name,category")
    .limit(2000);
  if (error) throw error;
  const todo = (tokens ?? []).filter((t: any) =>
    retryOther ? t.category === "other" || t.category == null : t.category == null,
  );
  if (!todo.length) {
    console.log("· 代币：无需分类");
    return { done: 0 };
  }
  console.log(`· 代币：待分类 ${todo.length} 个（batch=${batchSize}）`);

  let done = 0;
  const dist: Record<string, number> = {};
  for (const group of chunk(todo, batchSize)) {
    const questions: Record<string, unknown> = {};
    group.forEach((t, i) => {
      const q = tokenCategoryQuestion(t.symbol as string, (t.name as string) ?? null);
      const titles = ctx.get(t.symbol as string);
      if (titles?.length) {
        (q.instructions as any).recent_announcements = titles;
      }
      questions[`t${i}`] = q;
    });
    const answers = (await jev.ask({}, questions as any)) as any;
    for (let i = 0; i < group.length; i++) {
      const t = group[i]!;
      const a = answers[`t${i}`];
      const choice: string = a?.choice ?? "other";
      const category = (TOKEN_CATEGORY_IDS as string[]).includes(choice) ? choice : "other";
      const assetClass = category === "rwa" ? "rwa" : "crypto";
      dist[category] = (dist[category] ?? 0) + 1;
      await db
        .from("tokens")
        .update({ category, asset_class: assetClass, updated_at: new Date().toISOString() })
        .eq("symbol", t.symbol);
      done++;
    }
    console.log(`   已分类 ${done}/${todo.length}`);
  }
  console.log(`✓ 代币分类完成：${JSON.stringify(dist)}`);
  return { done };
}

// ---------------- 2) 事件分类 ----------------
async function classifyEvents() {
  if (eventMode === "none") return { done: 0 };
  let q = db
    .from("events")
    .select("id,token_symbol,title,event_type,asset_class,detail")
    .order("t0", { ascending: false })
    .limit(3000);
  if (eventMode === "unknown") q = q.eq("event_type", "unknown");
  const { data: events, error } = await q;
  if (error) throw error;
  if (!events?.length) {
    console.log("· 事件：无需分类");
    return { done: 0 };
  }
  console.log(`· 事件：待分类 ${events.length} 条（mode=${eventMode}, batch=${batchSize}）`);

  let done = 0;
  const dist: Record<string, number> = {};
  for (const group of chunk(events, batchSize)) {
    const questions: Record<string, unknown> = {};
    group.forEach((e, i) => {
      questions[`e${i}`] = {
        type: "choice",
        instructions: {
          title: e.title,
          symbol: e.token_symbol,
          question: "Which single event type best describes this announcement?",
        },
        criteria: EVENT_TYPE_CRITERIA,
      };
    });
    const answers = (await jev.ask({}, questions as any)) as any;
    for (let i = 0; i < group.length; i++) {
      const e = group[i]!;
      const a = answers[`e${i}`];
      const choice: string = a?.choice ?? "unknown";
      const eventType = choice in EVENT_TYPE_CRITERIA ? choice : "unknown";
      dist[eventType] = (dist[eventType] ?? 0) + 1;
      await db
        .from("events")
        .update({
          event_type: eventType,
          detail: {
            ...((e.detail as any) ?? {}),
            judged: {
              event_type: eventType,
              confidence: a?.confidence ?? null,
              model: "jev",
              judged_at: new Date().toISOString(),
            },
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", e.id);
      done++;
    }
    console.log(`   已分类 ${done}/${events.length}`);
  }
  console.log(`✓ 事件分类完成：${JSON.stringify(dist)}`);
  return { done };
}

// ---------------- 3) 用代币资产类别回填事件 ----------------
async function syncEventAssetClass() {
  const { data: tokens } = await db
    .from("tokens")
    .select("symbol,asset_class")
    .not("asset_class", "is", null);
  const map = new Map<string, string>((tokens ?? []).map((t: any) => [t.symbol, t.asset_class]));
  const { data: events } = await db.from("events").select("id,token_symbol,asset_class");
  let updated = 0;
  for (const e of events ?? []) {
    const want = map.get((e as any).token_symbol);
    if (want && want !== (e as any).asset_class) {
      await db
        .from("events")
        .update({ asset_class: want })
        .eq("id", (e as any).id);
      updated++;
    }
  }
  console.log(`✓ 事件 asset_class 回填：${updated} 条`);
}

async function main() {
  await ensureTokens();
  await classifyTokens(retryOther);
  await classifyEvents();
  await syncEventAssetClass();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
