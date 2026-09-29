import { useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import type { EventV1 } from "../lib/types";
import {
  ASSET_COLOR,
  eventTypeLabel,
  fmtTs,
  hostOf,
  liquidityLabel,
  pct,
  pctClass,
} from "../lib/format";

const col = createColumnHelper<EventV1>();

const pctCell = (v: number | null) => (
  <span className={`mono text-[12px] ${pctClass(v)}`}>{pct(v)}</span>
);

export default function EventTable({ events }: { events: EventV1[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "t0", desc: true }]);
  const [type, setType] = useState("");
  const [asset, setAsset] = useState("");
  const [q, setQ] = useState("");
  const [onlyMeasured, setOnlyMeasured] = useState(false);

  const types = useMemo(() => [...new Set(events.map((e) => e.event_type))].sort(), [events]);

  const filtered = useMemo(
    () =>
      events.filter((e) => {
        if (type && e.event_type !== type) return false;
        if (asset && e.asset_class !== asset) return false;
        if (onlyMeasured && e.ret_1h == null) return false;
        if (q) {
          const s = `${e.token_symbol} ${e.title ?? ""}`.toLowerCase();
          if (!s.includes(q.toLowerCase())) return false;
        }
        return true;
      }),
    [events, type, asset, q, onlyMeasured],
  );

  const columns = useMemo(
    () => [
      col.accessor("t0", {
        header: "T0 (UTC)",
        cell: (c) => (
          <span className="mono text-[12px] whitespace-nowrap text-[var(--color-mut)]">
            {fmtTs(c.getValue())}
            {c.row.original.base_after_t0 && (
              <span
                className="text-amber-400 ml-1 font-bold"
                title="T0 时还没有市场数据，基准取自 T0 之后"
              >
                *
              </span>
            )}
          </span>
        ),
      }),
      col.accessor("token_symbol", {
        header: "代币",
        cell: (c) => (
          <a
            href={`/token/${c.getValue()}`}
            className="font-semibold no-underline text-[var(--color-fg)] hover:text-[var(--color-acc)]"
          >
            {c.getValue()}
          </a>
        ),
      }),
      col.accessor("asset_class", {
        header: "资产类别",
        cell: (c) => (
          <span
            className="inline-block rounded-full px-2 py-[1px] text-[11px] font-semibold text-white"
            style={{ background: ASSET_COLOR[c.getValue()] ?? "#64748b" }}
          >
            {c.getValue()}
          </span>
        ),
      }),
      col.accessor("event_type", {
        header: "事件类型",
        cell: (c) => (
          <span className="mono text-[12px] text-[var(--color-mut)]">
            {eventTypeLabel(c.getValue())}
          </span>
        ),
      }),
      col.accessor("title", {
        header: "标题",
        enableSorting: false,
        cell: (c) => (
          <a
            href={`/event/${c.row.original.id}`}
            className="no-underline text-[var(--color-fg)] hover:text-[var(--color-acc)]"
          >
            {c.getValue() ?? "—"}
          </a>
        ),
      }),
      col.accessor("source_url", {
        header: "来源",
        enableSorting: false,
        cell: (c) => {
          const host = hostOf(c.getValue());
          return c.getValue() ? (
            <a
              className="no-underline whitespace-nowrap"
              href={c.getValue()!}
              target="_blank"
              rel="noopener"
            >
              {host} ↗
            </a>
          ) : (
            <span className="text-slate-600">—</span>
          );
        },
      }),
      col.accessor("ret_5m", { header: "5m", cell: (c) => pctCell(c.getValue()) }),
      col.accessor("ret_15m", { header: "15m", cell: (c) => pctCell(c.getValue()) }),
      col.accessor("ret_1h", { header: "1h", cell: (c) => pctCell(c.getValue()) }),
      col.accessor("ret_4h", { header: "4h", cell: (c) => pctCell(c.getValue()) }),
      col.accessor("ret_24h", { header: "24h", cell: (c) => pctCell(c.getValue()) }),
      col.accessor("vol_ratio", {
        header: "量比",
        cell: (c) => (
          <span className="mono text-[12px] text-[var(--color-mut)]">
            {c.getValue() == null ? "—" : `${c.getValue()!.toFixed(2)}×`}
          </span>
        ),
      }),
      col.accessor("liquidity_ok", {
        header: "流动性",
        cell: (c) => {
          const l = liquidityLabel(c.getValue());
          return (
            <span className={`text-[12px] ${l.cls}`} title={l.title}>
              {l.text}
            </span>
          );
        },
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const th =
    "px-2 py-2 text-left text-[11px] uppercase tracking-wide text-[var(--color-mut)] font-semibold cursor-pointer select-none whitespace-nowrap";
  const td = "px-2 py-2 border-b border-[var(--color-line)] align-top";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-1"
        >
          <option value="">全部类型</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {eventTypeLabel(t)}
            </option>
          ))}
        </select>
        <select
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
          className="rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-1"
        >
          <option value="">全部资产类别</option>
          <option value="crypto">crypto</option>
          <option value="rwa">rwa</option>
          <option value="unknown">unknown</option>
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索代币 / 标题"
          className="rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-1"
        />
        <label className="flex items-center gap-1 text-[var(--color-mut)]">
          <input
            type="checkbox"
            checked={onlyMeasured}
            onChange={(e) => setOnlyMeasured(e.target.checked)}
          />
          只看已测量
        </label>
        <span className="ml-auto text-[var(--color-mut)]">{filtered.length} 条</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)]">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className={th} onClick={h.column.getToggleSortingHandler()}>
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {{ asc: " ↑", desc: " ↓" }[h.column.getIsSorted() as string] ?? ""}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} className="hover:bg-[#16223c]">
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className={td}>
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td
                  className="px-2 py-6 text-center text-[var(--color-mut)]"
                  colSpan={columns.length}
                >
                  没有匹配的事件
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
