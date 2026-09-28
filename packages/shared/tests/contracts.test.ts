/**
 * 契约测试（无需数据库）：
 * 解析 0004_contract_views.sql，提取 api.* 视图的列，和 zod schema 比对。
 * 任何一侧改了列形状而另一侧没同步 → CI 失败。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENTS_V1_COLUMNS, TOKENS_V1_COLUMNS } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const SQL = readFileSync(
  resolve(here, "../../../supabase/migrations/0004_contract_views.sql"),
  "utf8",
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 按顶层逗号切分 select 列表（忽略括号内逗号） */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function aliasOf(expr: string): string | null {
  const asMatch = expr.match(/\bas\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*$/);
  if (asMatch) return asMatch[1] ?? null;
  const idMatch = expr.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*$/);
  return idMatch ? (idMatch[1] ?? null) : null;
}

function extractViewColumns(sql: string, viewName: string): string[] {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+view\\s+${escapeRe(viewName)}\\s+as\\s*select([\\s\\S]*?)\\nfrom\\s`,
    "i",
  );
  const m = sql.match(re);
  if (!m?.[1]) throw new Error(`view not found in SQL: ${viewName}`);
  const cols: string[] = [];
  for (const part of splitTopLevel(m[1])) {
    const expr = part.trim();
    if (!expr) continue;
    if (expr.endsWith(".*")) {
      // v.* → 展开为 events_v1 全部列
      cols.push(...extractViewColumns(sql, "api.events_v1"));
      continue;
    }
    const a = aliasOf(expr);
    if (a) cols.push(a);
  }
  return cols;
}

describe("契约：api.* 视图列与 zod schema 一致", () => {
  it("api.events_v1", () => {
    const cols = extractViewColumns(SQL, "api.events_v1");
    expect(cols).toEqual([...EVENTS_V1_COLUMNS]);
  });

  it("api.event_detail_v1 = events_v1 + 溯源", () => {
    const cols = extractViewColumns(SQL, "api.event_detail_v1");
    expect(cols).toEqual([...EVENTS_V1_COLUMNS, "provenance_count", "sources"]);
  });

  it("api.tokens_v1", () => {
    const cols = extractViewColumns(SQL, "api.tokens_v1");
    expect(cols).toEqual([...TOKENS_V1_COLUMNS]);
  });
});
