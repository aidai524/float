/**
 * Float Worker —— 静态站点（Astro 产物）+ /api 接口 + Cron。
 *
 * 路由：/api/* 由本 Worker 处理，其余由静态资源（ASSETS）直接返回。
 * 数据源解析（解锁/公告）后续迁移到此处的 scheduled()。
 */
export interface Env {
  ASSETS: Fetcher;
  // Secrets / vars（部署后用 `wrangler secret put` 或 vars 注入）
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

const VERSION = "0.1.0";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
  });
}

/**
 * 诊断：Worker 是否能直连 defillama.com/unlocks（本机 Node 会 ECONNRESET），
 * 并确认 __NEXT_DATA__ 解析可用。仅用于部署后验证。
 */
async function diagDefiLlama(): Promise<Response> {
  const started = Date.now();
  try {
    const res = await fetch("https://defillama.com/unlocks", {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
    });
    const text = await res.text();
    const m = text.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
    );
    let protocols: number | null = null;
    let events: number | null = null;
    if (m?.[1]) {
      try {
        const data = JSON.parse(m[1]).props.pageProps.data as Array<{ events?: unknown[] }>;
        protocols = data.length;
        events = data.reduce((n, p) => n + (p.events?.length ?? 0), 0);
      } catch {
        /* 解析失败留 null */
      }
    }
    return json({
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type"),
      ms: Date.now() - started,
      bytes: text.length,
      hasNextData: Boolean(m),
      protocols,
      events,
      sample: res.ok ? undefined : text.slice(0, 200),
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started },
      { status: 502 },
    );
  }
}

/**
 * 诊断：从 Cloudflare 网络探测各数据源可达性（本机很多源被墙，Worker 不一定同样）。
 */
async function diagSources(): Promise<Response> {
  const targets: Array<{ id: string; url: string; headers?: Record<string, string> }> = [
    {
      id: "defillama-unlocks",
      url: "https://defillama.com/unlocks",
      headers: { "user-agent": UA },
    },
    { id: "llama-api-emissions", url: "https://api.llama.fi/emissions" },
    {
      id: "cmc-unlocks",
      url: "https://api.coinmarketcap.com/data-api/v3/token-unlock/listing?start=1&limit=5&sort=next_unlocked_date&direction=desc&enableSmallUnlocks=true",
      headers: { "user-agent": UA, referer: "https://coinmarketcap.com/token-unlocks/" },
    },
    {
      id: "binance-announcements",
      url: "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=48&pageNo=1&pageSize=5",
      headers: { "user-agent": UA },
    },
    {
      id: "bybit-announcements",
      url: "https://api.bybit.com/v5/announcements/index?limit=5",
    },
    { id: "binance-price", url: "https://api.binance.com/api/v3/time" },
    { id: "coingecko", url: "https://api.coingecko.com/api/v3/ping" },
  ];

  const out = await Promise.all(
    targets.map(async (t) => {
      const started = Date.now();
      try {
        const res = await fetch(t.url, { headers: t.headers });
        const text = await res.text();
        return {
          id: t.id,
          status: res.status,
          ok: res.ok,
          ms: Date.now() - started,
          snippet: text.slice(0, 80).replace(/\s+/g, " "),
        };
      } catch (e) {
        return {
          id: t.id,
          status: 0,
          ok: false,
          ms: Date.now() - started,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  return json({ time: new Date().toISOString(), results: out });
}

/** 诊断：Worker → Supabase（PostgREST 读 + 可选 resolve RPC 计时）。 */
async function diagDb(env: Env, runResolve: boolean): Promise<Response> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      { ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未配置" },
      { status: 500 },
    );
  }
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const h = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const out: Record<string, unknown> = {};
  try {
    let t = Date.now();
    const r = await fetch(`${base}/rest/v1/events?select=id&limit=1`, { headers: h });
    out.events_read = {
      status: r.status,
      ms: Date.now() - t,
      body: (await r.text()).slice(0, 120),
    };

    t = Date.now();
    if (!runResolve) {
      out.resolve_rpc = { skipped: true, hint: "加 ?resolve=1 才会真的触发（耗时长）" };
    } else {
      const rpc = await fetch(`${base}/rest/v1/rpc/resolve_source_events`, {
        method: "POST",
        headers: { ...h, "content-type": "application/json" },
        body: JSON.stringify({ p_source_id: "defillama-unlocks" }),
      });
      out.resolve_rpc = {
        status: rpc.status,
        ms: Date.now() - t,
        body: (await rpc.text()).slice(0, 160),
      };
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return json(out);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "float", version: VERSION, time: new Date().toISOString() });
    }
    if (url.pathname === "/api/_diag/defillama") {
      return diagDefiLlama();
    }
    if (url.pathname === "/api/_diag/sources") {
      return diagSources();
    }
    if (url.pathname === "/api/_diag/db") {
      return diagDb(env, url.searchParams.get("resolve") === "1");
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "not_found", path: url.pathname }, { status: 404 });
    }

    // 非 /api 路径正常由静态资源直接处理；保留兜底。
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController): Promise<void> {
    console.log(
      JSON.stringify({ msg: "cron_tick", cron: controller.cron, time: new Date().toISOString() }),
    );
    // TODO(phase5.4): 在此调用每日刷新（解锁轮询 → 解析事件 → 简报）。
  },
} satisfies ExportedHandler<Env>;
