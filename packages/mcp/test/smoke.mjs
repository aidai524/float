/**
 * MCP 冒烟测试：用官方 SDK 客户端拉起 stdio server，列出工具并调用一个真实 API。
 *   pnpm --filter @cee/mcp test
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(here, "../bin/float-mcp.mjs")],
  // 继承父进程环境（代理 / NODE_USE_ENV_PROXY 等）
  env: Object.fromEntries(Object.entries(process.env).filter((entry) => entry[1] != null)),
});
const client = new Client({ name: "float-mcp-smoke", version: "0.0.0" });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));

  const cal = await client.callTool({ name: "get_calendar", arguments: { days: 3 } });
  const text = cal.content?.[0]?.text ?? "";
  const parsed = JSON.parse(text);
  console.log("get_calendar ok: days=", parsed.days, "events=", parsed.data?.length);

  const stats = await client.callTool({ name: "get_listing_stats", arguments: {} });
  const parsed2 = JSON.parse(stats.content?.[0]?.text ?? "{}");
  console.log("get_listing_stats ok: forms=", parsed2.by_form?.length);

  console.log("✓ smoke 通过");
} finally {
  await client.close().catch(() => {});
}
