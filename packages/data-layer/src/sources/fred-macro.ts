/**
 * 宏观日历适配器（FRED）。
 *
 * FRED 的 /fred/release/dates 只给日期、不给时间，因此按官方固定发布时间换算：
 *   - CPI / 非农就业（Employment Situation）: 08:30 America/New_York
 *   - FOMC 声明                              : 14:00 America/New_York
 * 夏令时由 etToUtc() 处理。
 *
 * 事件主体用 BTC（宏观事件是市场级的，取加密市场代表）。
 */
import type { DataSourceAdapter, FetchContext, NormalizedRecord, RawPayload } from "../types";

export interface MacroRelease {
  release_id: number;
  event_type: string;
  /** 美东时间 HH:mm */
  time_et: string;
  label: string;
}

export const DEFAULT_MACRO_RELEASES: MacroRelease[] = [
  { release_id: 10, event_type: "macro_cpi", time_et: "08:30", label: "CPI" },
  { release_id: 50, event_type: "macro_nfp", time_et: "08:30", label: "非农就业" },
  { release_id: 101, event_type: "macro_fomc", time_et: "14:00", label: "FOMC" },
];

/** 取某时刻 America/New_York 相对 UTC 的偏移（分钟） */
function etOffsetMinutes(date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUTC - date.getTime()) / 60000;
}

/** 把"美东墙上时间"转成 UTC Date（迭代两次以稳妥处理夏令时切换） */
export function etToUtc(dateStr: string, timeEt: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const [hh, mm] = timeEt.split(":").map(Number) as [number, number];
  let guess = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) {
    guess = Date.UTC(y, m - 1, d, hh, mm) - etOffsetMinutes(new Date(guess)) * 60_000;
  }
  return new Date(guess);
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fred ${res.status} ${url.slice(0, 90)}`);
  return await res.json();
}

export const fredMacroAdapter: DataSourceAdapter = {
  id: "fred-macro",
  type: "macro",

  async fetch(ctx: FetchContext): Promise<RawPayload[]> {
    const config = ctx.config as any;
    const base = config.base_url ?? "https://api.stlouisfed.org";
    const apiKey = ctx.secrets.FRED_API_KEY ?? "";
    if (!apiKey) throw new Error("fred-macro: 缺少 FRED_API_KEY");
    const releases: MacroRelease[] = config.releases ?? DEFAULT_MACRO_RELEASES;

    const out: RawPayload[] = [];
    for (const r of releases) {
      const url =
        `${base}/fred/release/dates?release_id=${r.release_id}` +
        `&api_key=${apiKey}&file_type=json&include_release_dates_with_no_data=true` +
        `&sort_order=asc&limit=1000`;
      const payload = await fetchJson(url);
      out.push({
        entity: "event",
        request: { url: url.replace(apiKey, "***"), release: r },
        payload: { release: r, ...payload },
      });
      await new Promise((res) => setTimeout(res, 300));
    }
    return out;
  },

  normalize(raw: RawPayload): NormalizedRecord[] {
    const payload = raw.payload as any;
    const release: MacroRelease = payload?.release ?? (raw.request as any).release;
    const config = (raw.request as any).__config as any;
    const symbol: string = config?.symbol ?? "BTC";
    const since: string = config?.since ?? "2021-01-01";

    const dates: Array<{ date: string }> = payload?.release_dates ?? [];
    const out: NormalizedRecord[] = [];
    for (const d of dates) {
      if (!d.date || d.date < since) continue;
      const t0 = etToUtc(d.date, release.time_et);
      out.push({
        record_type: "event",
        ext_id: `${release.release_id}:${d.date}`,
        event_type: release.event_type,
        token_symbol: symbol,
        t0: t0.toISOString(),
        t0_confidence: "high",
        source_url: `https://fred.stlouisfed.org/release?rid=${release.release_id}`,
        detail: {
          title: `${release.label}（${d.date}）`,
          exchange: "fred",
          release_id: release.release_id,
          release_date: d.date,
          time_et: release.time_et,
          macro: true,
        },
        dedupe_key: `fred-macro|${release.release_id}|${d.date}|${symbol}`,
      });
    }
    return out;
  },
};
