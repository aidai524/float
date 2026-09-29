/**
 * 契约集成测试：连真实 Supabase，校验 api.* 视图列与 zod schema 一致。
 * 未配置 SUPABASE_DB_POOLER_URL 时自动跳过（CI 默认跳过）。
 */
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { EVENTS_V1_COLUMNS, TOKENS_V1_COLUMNS } from "../src/index";

const url = process.env.SUPABASE_DB_POOLER_URL;
const suite = url ? describe : describe.skip;

async function columns(view: string): Promise<string[]> {
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    const { rows } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'api' and table_name = $1
       order by ordinal_position`,
      [view],
    );
    return rows.map((r) => r.column_name);
  } finally {
    await pool.end();
  }
}

suite("契约：线上 Supabase api.* 视图列", () => {
  it("api.events_v1 与 zod 一致", async () => {
    expect(await columns("events_v1")).toEqual([...EVENTS_V1_COLUMNS]);
  });

  it("api.event_detail_v1 = events_v1 + 溯源", async () => {
    expect(await columns("event_detail_v1")).toEqual([
      ...EVENTS_V1_COLUMNS,
      "provenance_count",
      "sources",
    ]);
  });

  it("api.tokens_v1 与 zod 一致", async () => {
    expect(await columns("tokens_v1")).toEqual([...TOKENS_V1_COLUMNS]);
  });
});
