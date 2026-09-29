/**
 * Jev 富化：对 event_type='unknown' 的事件做语义判定。
 * 一次请求并行问两件事：事件类型 + 是否为加密代币（排除代币化股票/ETF）。
 *
 *   pnpm enrich [limit]
 */
import { createClient } from "@supabase/supabase-js";
import { JevClient, EVENT_TYPE_CRITERIA } from "../packages/judgment/src/index";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.TYPESAFE_API_KEY;
if (!url || !key || !apiKey) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TYPESAFE_API_KEY");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const jev = new JevClient({ apiKey });

const limit = Number(process.argv[2] ?? 20);

async function main() {
  const { data: events, error } = await db
    .from("events")
    .select("id,event_type,token_symbol,title,detail")
    .eq("event_type", "unknown")
    .limit(limit);
  if (error) throw error;
  if (!events?.length) {
    console.log("没有待富化的 unknown 事件");
    return;
  }

  console.log(`待富化 ${events.length} 条…`);
  let updated = 0;
  let irrelevant = 0;

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
      is_crypto_token: {
        type: "noul",
        instructions:
          "Does this announcement list/trade a crypto token, rather than a tokenized stock, ETF, or TradFi instrument?",
        criteria: {
          true: "A crypto token listing/trading",
          false: "Tokenized stock/ETF/TradFi instrument, or unrelated",
        },
      },
    })) as any;

    const eventType: string = answers.event_type?.choice ?? "unknown";
    const isCrypto: number = answers.is_crypto_token?.noul ?? 0;
    const cryptoOk = isCrypto >= 0.5;

    const nextType = cryptoOk ? eventType : "unknown";
    const nextDetail = {
      ...((e.detail as any) ?? {}),
      judged: {
        event_type: eventType,
        event_type_confidence: answers.event_type?.confidence ?? null,
        is_crypto_token: isCrypto,
        judged_at: new Date().toISOString(),
      },
    };

    await db
      .from("events")
      .update({ event_type: nextType, detail: nextDetail, updated_at: new Date().toISOString() })
      .eq("id", e.id);

    updated++;
    if (!cryptoOk) irrelevant++;
    console.log(
      `  #${e.id} ${e.token_symbol} → ${nextType} (crypto=${isCrypto.toFixed(2)}, conf=${(
        answers.event_type?.confidence ?? 0
      ).toFixed(2)})`,
    );
  }

  console.log(`✓ 富化 ${updated} 条，其中非加密标的 ${irrelevant} 条`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
