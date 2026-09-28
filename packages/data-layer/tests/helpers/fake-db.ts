/**
 * 内存假 DB：实现 packages/data-layer 用到的最小 Supabase 客户端接口。
 * 用于单测与 dry-run，不连真实数据库。
 */
export type Row = Record<string, any>;

type Filter = [op: "eq" | "gte" | "lte", col: string, val: any];

interface QueryState {
  table: string;
  op: "select" | "insert" | "upsert" | "update";
  rows: Row[];
  patch?: Row;
  filters: Filter[];
  order?: { col: string; asc: boolean };
  limit?: number;
  single: boolean;
  conflict: string[];
  returning: boolean;
}

export interface FakeDb {
  from(table: string): any;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: any; error: null }>;
  dump(table: string): Row[];
  tables: Record<string, Row[]>;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(([op, col, val]) => {
    const rv = row[col];
    if (op === "eq") return rv === val;
    if (op === "gte") return rv != null && rv >= val;
    if (op === "lte") return rv != null && rv <= val;
    return false;
  });
}

function conflictKey(row: Row, cols: string[]): string {
  return cols.map((c) => String(row[c] ?? "")).join("|");
}

export function createFakeDb(): FakeDb {
  const tables: Record<string, Row[]> = {};

  function exec(s: QueryState): { data: any; error: null } {
    const t = (tables[s.table] ??= []);
    if (s.op === "insert" || s.op === "upsert") {
      const out: Row[] = [];
      for (const row of s.rows) {
        if (s.op === "upsert" && s.conflict.length) {
          const k = conflictKey(row, s.conflict);
          const idx = t.findIndex((r) => conflictKey(r, s.conflict) === k);
          if (idx >= 0) {
            t[idx] = { ...t[idx], ...row };
            out.push(t[idx] as Row);
            continue;
          }
        }
        const stored = { id: t.length + 1, ...row };
        t.push(stored);
        out.push(stored);
      }
      return { data: s.returning ? out : null, error: null };
    }

    let rows = t.filter((r) => matches(r, s.filters));
    if (s.order) {
      const { col, asc } = s.order;
      rows = [...rows].sort(
        (a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1),
      );
    }
    if (s.limit != null) rows = rows.slice(0, s.limit);

    if (s.op === "update") {
      for (const r of rows) Object.assign(r, s.patch ?? {});
      return { data: s.returning ? rows : null, error: null };
    }
    return { data: s.single ? (rows[0] ?? null) : rows, error: null };
  }

  function from(table: string): any {
    const s: QueryState = {
      table,
      op: "select",
      rows: [],
      filters: [],
      single: false,
      conflict: [],
      returning: false,
    };

    const api: any = {
      select(cols?: string) {
        if (s.op !== "insert" && s.op !== "upsert") s.op = s.op === "update" ? "update" : "select";
        if (cols) s.returning = true;
        return api;
      },
      insert(rows: Row | Row[]) {
        s.op = "insert";
        s.rows = Array.isArray(rows) ? rows : [rows];
        return api;
      },
      upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        s.op = "upsert";
        s.rows = Array.isArray(rows) ? rows : [rows];
        s.conflict = (opts?.onConflict ?? "")
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean);
        return api;
      },
      update(patch: Row) {
        s.op = "update";
        s.patch = patch;
        return api;
      },
      eq(col: string, val: any) {
        s.filters.push(["eq", col, val]);
        return api;
      },
      gte(col: string, val: any) {
        s.filters.push(["gte", col, val]);
        return api;
      },
      lte(col: string, val: any) {
        s.filters.push(["lte", col, val]);
        return api;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        s.order = { col, asc: opts?.ascending ?? true };
        return api;
      },
      limit(n: number) {
        s.limit = n;
        return api;
      },
      maybeSingle() {
        s.single = true;
        return api;
      },
      then(resolve: (v: any) => any, reject?: (e: any) => any) {
        return Promise.resolve(exec(s)).then(resolve, reject);
      },
    };
    return api;
  }

  return {
    from,
    tables,
    rpc: async () => ({ data: null, error: null }),
    dump: (table: string) => tables[table] ?? [],
  };
}
