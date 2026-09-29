/**
 * FOMC 会议日历适配器（美联储官网）。
 *
 * FRED 的 "FOMC Press Release"(101) 每天都有流水，不是会议日历，因此改抓
 * https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 *
 * 规则：声明在会议**最后一天**发布，时间 14:00 America/New_York。
 * 跨月会议在页面里写作 "Jan/Feb" + "31-1"。
 */
import type { DataSourceAdapter, FetchContext, NormalizedRecord, RawPayload } from "../types";
import { etToUtc } from "./fred-macro";

const FED_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthNum(s: string | undefined): number | null {
  if (!s) return null;
  const k = s.toLowerCase().slice(0, 3);
  const i = MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(k));
  return i >= 0 ? i + 1 : null;
}

export interface FomcMeeting {
  date: string; // YYYY-MM-DD（声明发布日）
}

/** 从美联储日历页解析所有会议声明日（纯函数，可单测） */
export function parseFomcCalendar(html: string): FomcMeeting[] {
  const years = [...html.matchAll(/<a id="\d+">(\d{4}) FOMC Meetings<\/a>/g)].map((m) => ({
    year: Number(m[1]),
    idx: m.index ?? 0,
  }));
  const re =
    /fomc-meeting__month[^>]*><strong>([A-Za-z]+)(?:\/([A-Za-z]+))?<\/strong><\/div>\s*<div class="fomc-meeting__date[^>]*>(\d{1,2})(?:-(\d{1,2}))?\*?<\/div>/g;

  const out: FomcMeeting[] = [];
  for (let i = 0; i < years.length; i++) {
    const seg = html.slice(years[i]!.idx, i + 1 < years.length ? years[i + 1]!.idx : html.length);
    for (const m of seg.matchAll(re)) {
      const mon = monthNum(m[1]);
      const mon2 = monthNum(m[2]);
      const d1 = Number(m[3]);
      const d2 = m[4] ? Number(m[4]) : d1;
      const month = mon2 ?? (d2 < d1 ? (mon === 12 ? 1 : (mon ?? 0) + 1) : mon);
      if (!month) continue;
      out.push({
        date: `${years[i]!.year}-${String(month).padStart(2, "0")}-${String(d2).padStart(2, "0")}`,
      });
    }
  }
  // 去重 + 排序
  const seen = new Set<string>();
  return out
    .filter((m) => (seen.has(m.date) ? false : (seen.add(m.date), true)))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export const fedFomcAdapter: DataSourceAdapter = {
  id: "fed-fomc",
  type: "macro",

  async fetch(ctx: FetchContext): Promise<RawPayload[]> {
    const config = ctx.config as any;
    const url = config.url ?? "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
    const res = await fetch(url, { headers: { "User-Agent": FED_UA, accept: "text/html" } });
    if (!res.ok) throw new Error(`fed-fomc ${res.status}`);
    return [{ entity: "event", request: { url }, payload: { html: await res.text() } }];
  },

  normalize(raw: RawPayload): NormalizedRecord[] {
    const html: string = (raw.payload as any)?.html ?? "";
    const config = (raw.request as any).__config as any;
    const symbol: string = config?.symbol ?? "BTC";
    const since: string = config?.since ?? "2021-01-01";
    const timeEt: string = config?.time_et ?? "14:00";

    const meetings = parseFomcCalendar(html);
    const out: NormalizedRecord[] = [];
    for (const m of meetings) {
      if (m.date < since) continue;
      out.push({
        record_type: "event",
        ext_id: `fomc:${m.date}`,
        event_type: "macro_fomc",
        token_symbol: symbol,
        t0: etToUtc(m.date, timeEt).toISOString(),
        t0_confidence: "high",
        source_url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        detail: {
          title: `FOMC 利率决议（${m.date}）`,
          exchange: "federalreserve",
          release_date: m.date,
          time_et: timeEt,
          macro: true,
        },
        dedupe_key: `fed-fomc|${m.date}|${symbol}`,
      });
    }
    return out;
  },
};
