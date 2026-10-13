/**
 * 每日简报：构建 + 推送（Telegram）。
 *
 * 内容三块（都带样本量 N 与口径；不预测方向）：
 *   1) 未来 24h 解锁（按金额，附同类 float 桶的历史调整后中位）
 *   2) 未来 7 天宏观（附同类历史中位与 DVOL 惊讶中位）
 *   3) 过去 24h 实际 vs 预期（上币 / 解锁 / 宏观）
 *
 * 未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 时自动 dry-run（只打印不发送）。
 * Telegram 消息上限 4096 字符：超出时按优先级截断。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

const TELEGRAM_LIMIT = 4096;
const STATE_PATH = resolve(process.cwd(), ".devsession/telegram-state.json");

const LISTING_FORM_LABEL: Record<string, string> = {
  new_listing: "现货新币",
  futures: "合约",
  product_add: "产品位",
  rwa_bstock: "RWA bStock",
  seed_tag: "Seed Tag",
  launchpool: "Launchpool",
  other: "其他",
};

const MACRO_LABEL: Record<string, string> = {
  macro_cpi: "CPI",
  macro_nfp: "非农",
  macro_fomc: "FOMC",
};

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

/** 与 SQL public.unlock_float_pct 一致：占流通量，缺失回退占最大供应 */
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

const hm = (t0: string): string => `${t0.slice(11, 16)} UTC`;
const md = (t0: string): string => t0.slice(5, 10);

interface DigestSection {
  title: string;
  lines: string[];
  priority: number;
}

/** 生成完整简报文本（不发送） */
export async function buildDigest(raw: SupabaseClient): Promise<string> {
  const now = Date.now();
  const isoNow = new Date(now).toISOString();
  const in24 = new Date(now + 86400_000).toISOString();
  const in7d = new Date(now + 7 * 86400_000).toISOString();
  const ago24 = new Date(now - 86400_000).toISOString();

  const api = raw.schema("api");
  const [unlockRes, macroRes, typeRes, surpriseRes, recentRes, floatRes, listingRes, cohortRes] =
    await Promise.all([
      api
        .from("events_v1")
        .select("token_symbol,t0,event_type,magnitude_usd,magnitude_pct,source_detail")
        .like("event_type", "unlock%")
        .gte("t0", isoNow)
        .lte("t0", in24)
        .order("magnitude_usd", { ascending: false, nullsFirst: false })
        .limit(40),
      api
        .from("events_v1")
        .select("token_symbol,t0,event_type")
        .like("event_type", "macro%")
        .gte("t0", isoNow)
        .lte("t0", in7d)
        .order("t0", { ascending: true })
        .limit(10),
      api
        .from("event_type_stats_v1")
        .select("event_type,n,median_1h,median_24h,pos_24h")
        .gte("n", 20),
      api.from("events_v1").select("event_type,surprise_24h").not("surprise_24h", "is", null),
      api
        .from("events_v1")
        .select(
          "id,token_symbol,event_type,t0,ret_1h,ret_4h,ret_24h,surprise_24h,magnitude_usd,magnitude_pct,source_detail",
        )
        .gte("t0", ago24)
        .lte("t0", isoNow)
        .not("base_ts", "is", null)
        .order("t0", { ascending: false })
        .limit(80),
      api
        .from("unlock_float_stats_v2")
        .select("bucket,n,n_excess,median_excess_4h,median_excess_24h,median_abn_168h"),
      api.from("listing_form_stats_v1").select("listing_form,n_4h,n_24h,median_4h,median_24h"),
      api.from("listing_cohort_v1").select("event_id,listing_form,fdv_bucket").gte("t0", ago24),
    ]);

  const unlockRows = (unlockRes.data ?? []) as any[];
  const macroRows = (macroRes.data ?? []) as any[];
  const recentRows = (recentRes.data ?? []) as any[];

  const typeStats = new Map<string, any>(
    ((typeRes.data ?? []) as any[]).map((s) => [s.event_type, s]),
  );
  const floatStats = new Map<string, any>(
    ((floatRes.data ?? []) as any[]).map((s) => [s.bucket, s]),
  );
  const listingStats = new Map<string, any>(
    ((listingRes.data ?? []) as any[]).map((s) => [s.listing_form, s]),
  );
  const listingCohort = new Map<number, any>(
    ((cohortRes.data ?? []) as any[]).map((s) => [s.event_id, s]),
  );

  // 惊讶度中位（按事件类型）
  const surpriseBuckets = new Map<string, number[]>();
  for (const s of (surpriseRes.data ?? []) as any[]) {
    const arr = surpriseBuckets.get(s.event_type) ?? [];
    arr.push(Number(s.surprise_24h));
    surpriseBuckets.set(s.event_type, arr);
  }
  const median = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };

  const sections: DigestSection[] = [];

  // ---------- 未来 24h 解锁 ----------
  {
    const lines: string[] = [];
    for (const u of unlockRows.slice(0, 5)) {
      const fp = floatPct(u.source_detail, u.magnitude_pct);
      const b = floatBucket(fp);
      const stat = b ? floatStats.get(b) : null;
      const parts = [
        usd(u.magnitude_usd),
        fp != null ? `占流通 ${(fp * 100).toFixed(2)}%` : null,
        u.source_detail?.allocation ?? null,
      ].filter(Boolean);
      let line = `• <b>${esc(u.token_symbol)}</b> ${esc(u.event_type === "unlock_linear" ? "线性" : "悬崖")}解锁 · ${hm(u.t0)}\n  ${parts.join(" · ")}`;
      if (stat && stat.n_excess >= 20) {
        line += `\n  同类 ${b} 桶：7 天净 ${pct(stat.median_abn_168h)}（N=${stat.n_excess}）`;
      }
      lines.push(line);
    }
    if (lines.length) sections.push({ title: "未来 24h 解锁（按金额）", lines, priority: 1 });
  }

  // ---------- 未来 7 天宏观 ----------
  {
    const lines: string[] = [];
    for (const m of macroRows.slice(0, 5)) {
      const s = typeStats.get(m.event_type);
      const sur = median(surpriseBuckets.get(m.event_type) ?? []);
      const bits: string[] = [];
      if (s) {
        bits.push(`历史 1h ${pct(s.median_1h)} / 24h ${pct(s.median_24h)}`);
        bits.push(
          `上涨 ${s.pos_24h == null ? "—" : `${Math.round(s.pos_24h * 100)}%`}（N=${s.n}）`,
        );
      }
      if (sur != null) bits.push(`惊讶中位 ${sur.toFixed(2)}×`);
      lines.push(
        `• <b>${esc(MACRO_LABEL[m.event_type] ?? m.event_type)}</b> · ${md(m.t0)} ${hm(m.t0)}\n  ${bits.join(" · ") || "基准积累中"}`,
      );
    }
    if (lines.length) sections.push({ title: "未来 7 天宏观", lines, priority: 2 });
  }

  // ---------- 过去 24h：实际 vs 预期 ----------
  {
    const lines: string[] = [];
    // 优先展示上币（信号最强），再解锁，再宏观
    const rank = (t: string) =>
      t.startsWith("listing") ? 0 : t.startsWith("unlock") ? 1 : t.startsWith("macro") ? 2 : 9;
    const cand = recentRows
      .filter((e) => e.ret_1h != null || e.ret_4h != null || e.ret_24h != null)
      .sort((a, b) => {
        const r = rank(a.event_type) - rank(b.event_type);
        if (r !== 0) return r;
        return (Number(b.magnitude_usd) || 0) - (Number(a.magnitude_usd) || 0);
      })
      .slice(0, 8);

    for (const e of cand) {
      const h24 = e.ret_24h != null ? `24h ${pct(e.ret_24h)}` : `4h ${pct(e.ret_4h)}`;
      if (e.event_type.startsWith("listing")) {
        const lc = listingCohort.get(e.id);
        const ls = lc ? listingStats.get(lc.listing_form) : null;
        const formLabel = lc ? (LISTING_FORM_LABEL[lc.listing_form] ?? lc.listing_form) : "上币";
        const tail = ls ? `同类中位 ${pct(ls.median_24h)}（N=${ls.n_24h}）` : "同类样本积累中";
        lines.push(`• <b>${esc(e.token_symbol)}</b> ${esc(formLabel)} · ${h24} · ${tail}`);
      } else if (e.event_type.startsWith("unlock")) {
        const b = floatBucket(floatPct(e.source_detail, e.magnitude_pct));
        const stat = b ? floatStats.get(b) : null;
        const tail = !b
          ? "小额稀释（&lt;0.5%），无同类基准"
          : stat && stat.n_excess >= 20
            ? `同类 ${b} 桶调整中位 ${pct(stat.median_excess_24h)}（N=${stat.n_excess}）`
            : "同类样本不足";
        lines.push(`• <b>${esc(e.token_symbol)}</b> 解锁 · ${h24} · ${tail}`);
      } else if (e.event_type.startsWith("macro")) {
        const sur = e.surprise_24h == null ? "—" : `${Number(e.surprise_24h).toFixed(2)}×`;
        lines.push(
          `• <b>${esc(MACRO_LABEL[e.event_type] ?? e.event_type)}</b> · ${h24} · 惊讶 ${sur}`,
        );
      }
    }
    if (lines.length) sections.push({ title: "过去 24h：实际 vs 预期", lines, priority: 3 });
  }

  // ---------- 组装 + 限长 ----------
  const header = `<b>Float 每日简报</b> · ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const footer = `基于历史市场数据 · 非 AI 生成 · 非投资建议\nfloat.aidai524.workers.dev`;

  const body: string[] = [];
  let len = header.length + footer.length + 8;
  for (const s of sections.sort((a, b) => a.priority - b.priority)) {
    const block = `\n<b>${esc(s.title)}</b>\n${s.lines.join("\n")}`;
    if (len + block.length > TELEGRAM_LIMIT - 50) {
      body.push(`\n<b>${esc(s.title)}</b>\n（内容过长已截断，见网站）`);
      break;
    }
    body.push(block);
    len += block.length;
  }

  return `${header}\n${body.join("\n")}\n\n${footer}`;
}

/** 发送到 Telegram（HTML 模式） */
export async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  if (!res.ok || json.ok !== true) {
    throw new Error(`telegram ${res.status}: ${json.description ?? "unknown error"}`);
  }
}

export interface DigestResult {
  sent: boolean;
  text: string;
  reason?: string;
}

/**
 * 构建并按需发送。未配置凭据 / dryRun → 只返回文本。
 * 同一 UTC 日期默认只发一次（state 文件），--force 可绕过。
 */
export async function maybeSendDigest(
  raw: SupabaseClient,
  opts: { dryRun?: boolean; force?: boolean } = {},
): Promise<DigestResult> {
  const text = await buildDigest(raw);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (opts.dryRun || !token || !chatId) {
    return {
      sent: false,
      text,
      reason:
        !token || !chatId ? "未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID（dry-run）" : "dry-run",
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  if (!opts.force) {
    try {
      const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as { date?: string };
      if (state.date === today) return { sent: false, text, reason: `今日（${today}）已发送` };
    } catch {
      // 无状态文件 → 正常发送
    }
  }

  await sendTelegram(token, chatId, text);
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify({ date: today, sentAt: new Date().toISOString() }));
  } catch {
    // 状态写失败不影响发送结果
  }
  return { sent: true, text };
}
