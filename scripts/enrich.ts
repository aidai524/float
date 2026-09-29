/**
 * Jev 富化：对未定类的事件做语义判定。
 * 一次请求并行问两件事：事件类型 + 资产类别（crypto / rwa / unknown）。
 * RWA（含代币化股票）不会被排除，而是归入 asset_class='rwa'。
 *
 *   pnpm enrich [limit]
 */
import { createClient } from "@supabase/supabase-js";
import {
  JevClient,
  EVENT_TYPE_CRITERIA,
  ASSET_CLASS_CRITERIA,
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

const limit = Number(process.argv[2] ?? 50);

async function main() {
  const { data: events, error } = await db
    .from("events")
    .select("id,event_type,asset_class,token_symbol,title,detail")
    .or("event_type.eq.unknown,asset_class.eq.unknown")
    .limit(limit);
  if (error) throw error;
  if (!events?.length) {
    console.log("没有待富化事件");
    return;
  }

  console.log(`待富化 ${events.length} 条…`);
  const byClass: Record<string, number> = {};

  for (const e of events) {
    const state = {
      title: e.title,
      symbol: e.token_symbol,
      exchange: (e.detail as any)?.exchange,
    };
    const answers = (await jev.ask(state, {
      event_type: {
        type: "choice",
        instructions: "Which single event type best describes this announcement?",
        criteria: EVENT_TYPE_CRITERIA,
      },
      asset_class: {
        type: "choice",
        instructions: "What asset class does this announcement concern?",
        criteria: ASSET_CLASS_CRITERIA,
      },
    })) as any;

    const eventType: string = answers.event_type?.choice ?? "unknown";
    const assetClass: string = answers.asset_class?.choice ?? "unknown";
    byClass[assetClass] = (byClass[assetClass] ?? 0) + 1;

    const nextDetail = {
      ...((e.detail as any) ?? {}),
      judged: {
        event_type: eventType,
        event_type_confidence: answers.event_type?.confidence ?? null,
        asset_class: assetClass,
        asset_class_confidence: answers.asset_class?.confidence ?? null,
        judged_at: new Date().toISOString(),
      },
    };

    await db
      .from("events")
      .update({
        event_type: eventType,
        asset_class: assetClass,
        detail: nextDetail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", e.id);

    console.log(
      `  #${e.id} ${String(e.token_symbol).padEnd(9)} → ${eventType.padEnd(12)} [${assetClass}] ` +
        `(evt ${(answers.event_type?.confidence ?? 0).toFixed(2)}, cls ${(
          answers.asset_class?.confidence ?? 0
        ).toFixed(2)})`,
    );
  }

  console.log(`✓ 富化 ${events.length} 条：${JSON.stringify(byClass)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
