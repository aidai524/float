/**
 * 公开只读 API v1（/api/v1/*）——把 api.* 契约视图暴露给开发者与 AI Agent。
 *
 * 设计：
 *   - 只读、无需 key（v0）；边缘缓存 5 分钟，避免打爆 Supabase
 *   - 服务端用 service role 读 api.* 视图；key 永不出 Worker
 *   - 统一响应：{ ok: true, ... } / { ok: false, error }
 *   - 文档：GET /api/v1/ 与 /api/v1/openapi.json
 */
export interface ApiEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  API_METER?: AnalyticsEngineDataset;
}

interface AnalyticsEngineDataset {
  writeDataPoint: (point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }) => void;
}
export type { AnalyticsEngineDataset };

const CACHE_TTL_SECONDS = 300;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, x-api-key, authorization",
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...CORS,
      ...(init.headers ?? {}),
    },
  });
}

function fail(status: number, error: string, detail?: string): Response {
  return json({ ok: false, error, ...(detail ? { detail } : {}) }, { status });
}

/** 一个通用的 Supabase PostgREST 读：始终读 api schema，返回数组 */
async function sb(
  env: ApiEnv,
  view: string,
  params: Record<string, string | undefined>,
  extraHeaders: Record<string, string> = {},
  profile = "api",
): Promise<{ rows: any[]; count: number | null; status: number }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("supabase_not_configured");
  }
  const url = new URL(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${view}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: "application/json",
      "accept-profile": profile,
      ...extraHeaders,
    },
  });
  const text = await res.text();
  let rows: any[] = [];
  try {
    rows = text ? JSON.parse(text) : [];
  } catch {
    rows = [];
  }
  let count: number | null = null;
  const range = res.headers.get("content-range");
  const m = range?.match(/\/(\d+)$/);
  if (m) count = Number(m[1]);
  return { rows, count, status: res.status };
}

const intParam = (v: string | null, def: number, max: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
};

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type KeyInfo = { id: number; plan: string } | "anon" | "invalid";

/** 可选 API key：x-api-key 或 Authorization: Bearer float_...；匿名可用 */
async function resolveApiKey(request: Request, env: ApiEnv): Promise<KeyInfo> {
  const auth = request.headers.get("authorization") ?? "";
  const raw =
    request.headers.get("x-api-key") ??
    (auth.startsWith("Bearer float_") ? auth.slice("Bearer ".length) : null);
  if (!raw) return "anon";

  const hash = await sha256Hex(raw);
  const cache = caches.default;
  const cacheKey = new Request(`https://float.internal/api-key/${hash}`);
  const hit = await cache.match(cacheKey);
  if (hit) {
    const cached = (await hit.json()) as { valid: boolean; id?: number; plan?: string };
    return cached.valid ? { id: cached.id!, plan: cached.plan! } : "invalid";
  }

  const { rows } = await sb(
    env,
    "api_keys",
    { key_hash: `eq.${hash}`, revoked: "eq.false", select: "id,plan", limit: "1" },
    {},
    "public",
  );
  const ok = rows.length ? { id: rows[0].id as number, plan: rows[0].plan as string } : null;
  await cache.put(
    cacheKey,
    json(
      { valid: !!ok, id: ok?.id, plan: ok?.plan },
      { headers: { "cache-control": "max-age=60" } },
    ),
  );
  return ok ?? "invalid";
}

const isoOrNull = (v: string | null): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** events 列表：支持类型 / 代币 / 时间范围 / 是否有反应 */
function buildEventsParams(url: URL): Record<string, string> {
  const p: Record<string, string> = {
    select: "*",
    order: url.searchParams.get("order") === "asc" ? "t0.asc" : "t0.desc",
    limit: String(intParam(url.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT)),
    offset: String(Math.max(0, Number(url.searchParams.get("offset")) || 0)),
  };
  const type = url.searchParams.get("event_type");
  if (type) {
    const types = type
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (types.length === 1 && types[0]!.endsWith("*")) {
      p.event_type = `like.${types[0]!.slice(0, -1)}*`;
    } else if (types.length === 1) {
      p.event_type = `eq.${types[0]}`;
    } else {
      p.event_type = `in.(${types.join(",")})`;
    }
  }
  const symbol = url.searchParams.get("symbol");
  if (symbol) p.token_symbol = `eq.${symbol.toUpperCase()}`;
  const from = isoOrNull(url.searchParams.get("from"));
  if (from) p.t0 = `gte.${from}`;
  const to = isoOrNull(url.searchParams.get("to"));
  if (to) p["and"] = `(t0.lte.${to})`; // 与 t0=gte 组合（PostgREST 用 and 包裹）
  if (url.searchParams.get("has_reaction") === "1") p.base_ts = "not.is.null";
  const minPct = Number(url.searchParams.get("min_magnitude_pct"));
  if (Number.isFinite(minPct) && minPct > 0) p.magnitude_pct = `gte.${minPct}`;
  return p;
}

function endpointList(): Record<string, string> {
  return {
    "GET /api/v1/": "本列表",
    "GET /api/v1/openapi.json": "OpenAPI 风格端点说明",
    "GET /api/v1/events": "事件列表（type/symbol/from/to/has_reaction/limit/offset/order）",
    "GET /api/v1/events/:id": "单事件详情（含市场调整与溯源）",
    "GET /api/v1/calendar?days=14": "未来 N 天的解锁 / 上币 / 宏观事件",
    "GET /api/v1/stats/event-types?min_n=20": "按事件类型的反应基准（中位/上涨占比/N）",
    "GET /api/v1/stats/unlocks": "解锁 v2 统计（float 分桶 / 接收方 / 净效应斜率）",
    "GET /api/v1/stats/listings": "上币统计（形式 / 类别 / FDV 档）",
    auth: "可选 x-api-key（或 Authorization: Bearer float_...）；匿名可用，带 key 走计量",
  };
}

async function handleEvents(env: ApiEnv, url: URL): Promise<Response> {
  const params = buildEventsParams(url);
  const { rows, count } = await sb(env, "events_v1", params, { prefer: "count=exact" });
  return json({
    ok: true,
    count,
    limit: Number(params.limit),
    offset: Number(params.offset),
    data: rows,
  });
}

async function handleEventDetail(env: ApiEnv, id: string): Promise<Response> {
  if (!/^\d+$/.test(id)) return fail(400, "invalid_id");
  const { rows } = await sb(env, "event_detail_v1", { id: `eq.${id}`, limit: "1" });
  if (!rows.length) return fail(404, "event_not_found");
  const [expectation] = await Promise.all([
    sb(env, "event_expectation_v1", { event_id: `eq.${id}`, limit: "1" }).then(
      (r) => r.rows[0] ?? null,
    ),
  ]);
  return json({ ok: true, event: rows[0], expectation });
}

async function handleCalendar(env: ApiEnv, url: URL): Promise<Response> {
  const days = intParam(url.searchParams.get("days"), 14, 90);
  const now = new Date();
  const params: Record<string, string> = {
    select: "id,event_type,token_symbol,t0,title,magnitude_usd,magnitude_pct,source_url",
    t0: `gte.${now.toISOString()}`,
    and: `(t0.lte.${new Date(now.getTime() + days * 86400_000).toISOString()})`,
    event_type: "in.(unlock_cliff,unlock_linear,listing_cex,macro_fomc,macro_cpi,macro_nfp)",
    order: "t0.asc",
    limit: "200",
  };
  const { rows } = await sb(env, "events_v1", params);
  return json({ ok: true, days, data: rows });
}

async function handleUnlockStats(env: ApiEnv): Promise<Response> {
  const [float, category, slope] = await Promise.all([
    sb(env, "unlock_float_stats_v2", {}),
    sb(env, "unlock_category_stats_v2", { order: "n.desc" }),
    sb(env, "unlock_slope_v2", { limit: "1" }),
  ]);
  return json({
    ok: true,
    methodology: "v2（float 稀释 + 剔除 BTC + placebo 净效应）",
    float_buckets: float.rows,
    by_receiver: category.rows,
    slope: slope.rows[0] ?? null,
  });
}

async function handleListingStats(env: ApiEnv): Promise<Response> {
  const [forms, categories, fdv] = await Promise.all([
    sb(env, "listing_form_stats_v1", { order: "n.desc" }),
    sb(env, "listing_category_stats_v1", { order: "n.desc" }),
    sb(env, "listing_fdv_stats_v1", { order: "n.desc" }),
  ]);
  return json({
    ok: true,
    by_form: forms.rows,
    by_category: categories.rows,
    by_fdv: fdv.rows,
  });
}

async function openapi(): Promise<Response> {
  const spec = {
    openapi: "3.0.3",
    info: {
      title: "Float API",
      version: "1.0.0",
      description:
        "加密事件（解锁 / 上币 / 宏观）实测反应数据。只读、无需 key、边缘缓存 5 分钟。所有统计带样本量 N。",
    },
    servers: [{ url: "https://float.aidai524.workers.dev" }],
    paths: Object.fromEntries(
      Object.entries(endpointList()).map(([k, summary]) => {
        const [method = "get", path = "/"] = k.split(" ");
        return [
          path.replace(":id", "{id}"),
          { [method.toLowerCase()]: { summary, responses: { "200": { description: "OK" } } } },
        ];
      }),
    ),
  };
  return json(spec);
}

/**
 * 返回 Response 表示已处理；null 表示不是 /api/v1 路由。
 * GET 请求命中 Cloudflare 边缘缓存（5 分钟）。
 */
export async function handleApi(request: Request, env: ApiEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/v1")) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "GET") return fail(405, "method_not_allowed");

  // 可选 API key + 计量（匿名仍可用；无效 key 直接 401）
  const keyInfo = await resolveApiKey(request, env);
  if (keyInfo === "invalid") return fail(401, "invalid_api_key");
  env.API_METER?.writeDataPoint({
    indexes: [keyInfo === "anon" ? "anon" : String(keyInfo.id)],
    blobs: [url.pathname],
    doubles: [1],
  });

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let res: Response;
  try {
    const path = url.pathname.replace(/^\/api\/v1/, "") || "/";
    if (path === "/") res = json({ ok: true, endpoints: endpointList() });
    else if (path === "/openapi.json") res = await openapi();
    else if (path === "/events") res = await handleEvents(env, url);
    else if (path.startsWith("/events/")) res = await handleEventDetail(env, path.slice(8));
    else if (path === "/calendar") res = await handleCalendar(env, url);
    else if (path === "/stats/event-types") {
      const minN = intParam(url.searchParams.get("min_n"), 1, 100000);
      const { rows } = await sb(env, "event_type_stats_v1", {
        n: `gte.${minN}`,
        order: "n.desc",
      });
      res = json({ ok: true, data: rows });
    } else if (path === "/stats/unlocks") res = await handleUnlockStats(env);
    else if (path === "/stats/listings") res = await handleListingStats(env);
    else res = fail(404, "not_found", `unknown endpoint: ${path}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res = fail(msg === "supabase_not_configured" ? 500 : 502, "upstream_error", msg);
  }

  if (res.status === 200) {
    const headers = new Headers(res.headers);
    headers.set("cache-control", `public, max-age=${CACHE_TTL_SECONDS}`);
    res = new Response(res.body, { status: res.status, headers });
    try {
      await cache.put(cacheKey, res.clone());
    } catch {
      // 缓存写失败不影响响应
    }
  }
  return res;
}
