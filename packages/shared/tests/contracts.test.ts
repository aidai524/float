/**
 * 契约测试（无需数据库）：
 * 扫描 supabase/migrations/*.sql，取每个 api.* 视图的**最后一次**定义，
 * 提取列并与 zod schema 比对。任一侧改了列形状而另一侧没同步 → CI 失败。
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENTS_V1_COLUMNS, TOKENS_V1_COLUMNS } from "../src/index";
import {
  EVENT_BASELINE_V1_COLUMNS,
  EVENT_COHORT_V1_COLUMNS,
  EVENT_TYPE_STATS_V1_COLUMNS,
} from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../../../supabase/migrations");

const SQL = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n\n");

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

/** 取视图最后一次定义的 select 列表 */
function extractViewColumns(sql: string, viewName: string): string[] {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+view\\s+${escapeRe(viewName)}\\s+as\\s*select([\\s\\S]*?)\\nfrom\\s`,
    "gi",
  );
  const matches = [...sql.matchAll(re)];
  const last = matches[matches.length - 1];
  if (!last?.[1]) throw new Error(`view not found in SQL: ${viewName}`);
  const cols: string[] = [];
  for (const part of splitTopLevel(last[1])) {
    const expr = part.trim();
    if (!expr || expr.startsWith("--")) continue;
    if (expr.endsWith(".*")) {
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
    expect(extractViewColumns(SQL, "api.events_v1")).toEqual([...EVENTS_V1_COLUMNS]);
  });

  it("api.event_detail_v1 = events_v1 + 溯源", () => {
    expect(extractViewColumns(SQL, "api.event_detail_v1")).toEqual([
      ...EVENTS_V1_COLUMNS,
      "provenance_count",
      "sources",
    ]);
  });

  it("api.tokens_v1", () => {
    expect(extractViewColumns(SQL, "api.tokens_v1")).toEqual([...TOKENS_V1_COLUMNS]);
  });

  it("api.event_cohort_v1", () => {
    expect(extractViewColumns(SQL, "api.event_cohort_v1")).toEqual([...EVENT_COHORT_V1_COLUMNS]);
  });

  it("api.event_type_stats_v1", () => {
    expect(extractViewColumns(SQL, "api.event_type_stats_v1")).toEqual([
      ...EVENT_TYPE_STATS_V1_COLUMNS,
    ]);
  });

  it("api.event_baseline_v1", () => {
    expect(extractViewColumns(SQL, "api.event_baseline_v1")).toEqual([
      ...EVENT_BASELINE_V1_COLUMNS,
    ]);
  });
});
