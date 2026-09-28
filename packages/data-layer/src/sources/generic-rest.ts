/**
 * Tier A 通用适配器：由 data_sources.config 驱动，零代码接入标准 REST 源。
 * 支持：header/query 鉴权、简单分页、JSON 路径映射。
 */
import type { DataSourceAdapter, FetchContext, NormalizedRecord, RawPayload } from "../types";

/** 极简 JSON 路径取值：支持 $.a.b、[n]、[*] */
function pick(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  const p = path.replace(/^\$\.?/, "");
  if (!p) return obj;
  const tokens = p
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/\[\*\]/g, ".*")
    .split(".")
    .filter(Boolean);
  let cur: unknown = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    if (t === "*") {
      if (!Array.isArray(cur)) return undefined;
      // 展开：后续 token 逐个应用到数组元素
      const rest = tokens.slice(tokens.indexOf(t) + 1).join(".");
      return (cur as unknown[]).map((c) => (rest ? pick(c, "$." + rest) : c));
    }
    cur = (cur as Record<string, unknown>)[t];
  }
  return cur;
}

function first(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

function buildUrl(
  base: string,
  path: string,
  config: any,
  secrets: Record<string, string>,
  params: Record<string, string>,
) {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const auth = config.auth;
  if (auth?.type === "query" && auth.name) {
    const token = secrets[auth.env] ?? "";
    url.searchParams.set(auth.name, token);
  }
  return url.toString();
}

function headers(config: any, secrets: Record<string, string>): Record<string, string> {
  const auth = config.auth;
  const h: Record<string, string> = { accept: "application/json" };
  if (auth?.type === "header" && auth.name) {
    h[auth.name] = secrets[auth.env] ?? "";
  }
  return h;
}

/** 把一条源数据按 map 规则映射成统一字段 */
function applyMap(
  item: unknown,
  map: Record<string, any>,
  categoryMap: Record<string, string>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [field, rule] of Object.entries(map)) {
    if (rule && typeof rule === "object" && "const" in rule) {
      out[field] = (rule as any).const;
    } else if (rule && typeof rule === "object" && (rule as any).from_category) {
      const cat = String(
        first(pick(item, "$.categories[0].name")) ?? first(pick(item, "$.category")) ?? "",
      );
      out[field] = categoryMap[cat.toLowerCase()] ?? "unknown";
    } else if (typeof rule === "string") {
      out[field] = first(pick(item, rule));
    }
  }
  return out;
}

export const genericRestAdapter: DataSourceAdapter = {
  id: "generic-rest",
  type: "news", // 占位；实际按 data_sources.type 路由

  async fetch(ctx: FetchContext): Promise<RawPayload[]> {
    const config = ctx.config as any;
    const entity = (config.kind ?? "event") as RawPayload["entity"];
    const pagination = config.pagination;
    const out: RawPayload[] = [];
    const maxPages = config.max_pages ?? 5;

    let page = 1;
    while (page <= maxPages) {
      const params: Record<string, string> = {};
      if (pagination?.type === "page") {
        params[pagination.param ?? "page"] = String(page);
        params[pagination.size_param ?? "limit"] = String(pagination.size ?? 100);
      }
      const url = buildUrl(config.base_url, config.path ?? "/", config, ctx.secrets, params);
      const res = await fetch(url, { headers: headers(config, ctx.secrets) });
      if (!res.ok) throw new Error(`generic-rest ${res.status} ${url}`);
      const payload = await res.json();
      out.push({ entity, request: { url }, payload });
      if (!pagination) break;
      const rows = pick(payload, config.list_path ?? "$");
      if (!Array.isArray(rows) || rows.length < (pagination.size ?? 100)) break;
      page++;
    }
    return out;
  },

  normalize(raw: RawPayload): NormalizedRecord[] {
    const config = (raw.request as any).__config as any;
    const map = config?.map ?? {};
    const rows = pick(raw.payload, config?.list_path ?? "$");
    const list = Array.isArray(rows) ? rows : [rows];
    const categoryMap = config?.category_map ?? {};
    return list.filter(Boolean).map((item) => {
      const m = applyMap(item, map, categoryMap);
      return {
        record_type: (config?.kind === "token_meta"
          ? "token"
          : config?.kind === "news"
            ? "news"
            : "event") as NormalizedRecord["record_type"],
        ext_id: m.ext_id != null ? String(m.ext_id) : undefined,
        event_type: m.event_type,
        token_symbol: m.token_symbol != null ? String(m.token_symbol).toUpperCase() : undefined,
        chain: m.chain,
        t0: m.t0 != null ? new Date(m.t0 as string).toISOString() : undefined,
        t0_confidence: m.t0_confidence,
        magnitude_usd: m.magnitude_usd != null ? Number(m.magnitude_usd) : undefined,
        magnitude_pct: m.magnitude_pct != null ? Number(m.magnitude_pct) : undefined,
        source_url: m.source_url != null ? String(m.source_url) : undefined,
        detail: { category: m.category, title: m.title, ...config?.extra_detail },
      };
    });
  },
};
