#!/usr/bin/env node
/**
 * Float MCP Server —— 让 Claude Desktop / Cursor / Codex 等直接查询
 * 加密事件（解锁 / 上币 / 宏观）的实测反应数据。
 *
 * 数据来自 Float 公开 API（只读、边缘缓存 5 分钟）：
 *   FLOAT_API_BASE 可覆盖，默认 https://float.aidai524.workers.dev
 *
 * 配置示例（Claude Desktop / Cursor 的 mcpServers）：
 *   {
 *     "mcpServers": {
 *       "float": { "command": "node", "args": ["/path/to/float/packages/mcp/bin/float-mcp.mjs"] }
 *     }
 *   }
 *
 * 注意：stdio 协议下 stdout 只能输出协议消息，日志一律走 stderr。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 若环境里配了 HTTP(S)_PROXY 但 Node fetch 默认不走代理，自动装上 undici 的 env-proxy
if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  try {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent());
  } catch {
    console.error("提示：检测到代理但未安装 undici；若请求失败请设 NODE_USE_ENV_PROXY=1");
  }
}

const BASE = (process.env.FLOAT_API_BASE || "https://float.aidai524.workers.dev").replace(
  /\/$/,
  "",
);

async function api(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Float API ${res.status}: 非 JSON 响应`);
  }
  if (!res.ok || body.ok === false) {
    throw new Error(`Float API ${res.status}: ${body.error ?? "unknown error"}`);
  }
  return body;
}

const asText = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });

const server = new McpServer({ name: "float", version: "0.1.0" });

server.tool(
  "search_events",
  "搜索加密事件（解锁 / 上币 / 宏观）及其实测反应。返回含样本量与口径版本。",
  {
    event_type: z
      .string()
      .optional()
      .describe("事件类型或前缀，如 unlock_cliff、unlock*、listing*、macro*"),
    symbol: z.string().optional().describe("代币符号，如 HEMI"),
    from: z.string().optional().describe("ISO 时间下界"),
    to: z.string().optional().describe("ISO 时间上界"),
    has_reaction: z.boolean().optional().describe("只看已计算反应的"),
    limit: z.number().int().min(1).max(200).optional().describe("默认 50，最大 200"),
  },
  async (args) =>
    asText(
      await api("/api/v1/events", {
        event_type: args.event_type,
        symbol: args.symbol,
        from: args.from,
        to: args.to,
        has_reaction: args.has_reaction ? 1 : undefined,
        limit: args.limit,
      }),
    ),
);

server.tool(
  "get_event",
  "获取单个事件详情：反应指标、同类分位、市场调整（剔除 BTC）与 placebo 净效应、数据溯源。",
  { id: z.number().int().describe("事件 ID（从 search_events 获取）") },
  async ({ id }) => asText(await api(`/api/v1/events/${id}`)),
);

server.tool(
  "get_calendar",
  "未来 N 天的已排期事件：解锁、上币、宏观（FOMC/CPI/非农）。",
  { days: z.number().int().min(1).max(90).optional().describe("默认 14 天") },
  async ({ days }) => asText(await api("/api/v1/calendar", { days })),
);

server.tool(
  "get_event_type_stats",
  "按事件类型的历史反应基准：中位收益、上涨占比、样本量 N（含 5m/15m/1h/4h/24h）。",
  { min_n: z.number().int().optional().describe("最小样本量，默认 1") },
  async ({ min_n }) => asText(await api("/api/v1/stats/event-types", { min_n })),
);

server.tool(
  "get_unlock_stats",
  "解锁 v2 统计：按 float 稀释分桶 / 接收方类别的反应分布，以及剔除 BTC 与 placebo 后的净效应。",
  {},
  async () => asText(await api("/api/v1/stats/unlocks")),
);

server.tool(
  "get_listing_stats",
  "上币统计：按上币形式（现货新币/合约/Seed Tag/RWA）、代币类别、FDV 档的反应区间。",
  {},
  async () => asText(await api("/api/v1/stats/listings")),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`float-mcp 已启动（API: ${BASE}）`);
