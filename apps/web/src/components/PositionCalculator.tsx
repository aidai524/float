import { useMemo, useState } from "react";

export interface Cohort {
  event_type: string;
  label: string;
  n: number;
  implied24h: number | null; // 小数，如 0.033
  ddP10: number | null; // 历史最大回撤 10 分位（负）
  ddP25: number | null;
  ddMedian: number | null;
}

interface Props {
  cohorts: Cohort[];
  defaultEntry?: number;
}

const pct = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : `${(v * 100).toFixed(digits)}%`;

const usd = (v: number) =>
  Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—";

export default function PositionCalculator({ cohorts, defaultEntry = 0 }: Props) {
  const [type, setType] = useState(cohorts[0]?.event_type ?? "");
  const [mode, setMode] = useState<"implied" | "historical">("historical");
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [risk, setRisk] = useState(1000);
  const [leverage, setLeverage] = useState(1);
  const [entry, setEntry] = useState(defaultEntry);

  const cohort = useMemo(() => cohorts.find((c) => c.event_type === type), [cohorts, type]);

  const stopDistance = useMemo(() => {
    if (!cohort) return null;
    if (mode === "implied") return cohort.implied24h;
    const dd = cohort.ddP10 ?? cohort.ddP25 ?? cohort.ddMedian;
    return dd == null ? null : Math.abs(dd);
  }, [cohort, mode]);

  const out = useMemo(() => {
    if (!stopDistance || stopDistance <= 0) return null;
    const notional = risk / stopDistance;
    const qty = entry > 0 ? notional / entry : null;
    const margin = leverage > 1 ? notional / leverage : notional;
    // 逐仓强平价（维持保证金率按 0.5% 估）
    const mmr = 0.005;
    const liq =
      leverage > 1 && entry > 0
        ? direction === "long"
          ? entry * (1 - 1 / leverage + mmr)
          : entry * (1 + 1 / leverage - mmr)
        : null;
    const liqDistance = liq != null && entry > 0 ? Math.abs(liq / entry - 1) : null;
    const liqBeforeStop = liqDistance != null && stopDistance >= liqDistance;
    return { notional, qty, margin, liq, liqDistance, liqBeforeStop };
  }, [stopDistance, risk, entry, leverage, direction]);

  const row = "flex items-baseline justify-between border-b border-[var(--color-line)] py-2";
  const label = "text-[12px] text-[var(--color-mut)]";
  const val = "mono text-[15px] font-semibold";
  const input =
    "w-full rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-[14px] text-[var(--color-fg)]";

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
        <h2 className="m-0 mb-3 text-[13px] font-semibold">输入</h2>

        <div className="mb-3">
          <div className={label}>事件类型（决定波动假设与历史分布）</div>
          <select className={input} value={type} onChange={(e) => setType(e.target.value)}>
            {cohorts.map((c) => (
              <option key={c.event_type} value={c.event_type}>
                {c.label}（N={c.n}）
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <div className={label}>止损距离依据</div>
          <div className="mt-1 flex gap-2 text-[13px]">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={mode === "historical"}
                onChange={() => setMode("historical")}
              />
              历史最大回撤 10 分位
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={mode === "implied"}
                onChange={() => setMode("implied")}
              />
              事件前隐含波动（24h）
            </label>
          </div>
        </div>

        <div className="mb-3">
          <div className={label}>风险预算（USD，能接受的最大亏损）</div>
          <input
            className={input}
            type="number"
            min={10}
            value={risk}
            onChange={(e) => setRisk(Number(e.target.value))}
          />
        </div>

        <div className="mb-3">
          <div className={label}>入场价（USD）</div>
          <input
            className={input}
            type="number"
            min={0}
            step="any"
            value={entry}
            onChange={(e) => setEntry(Number(e.target.value))}
          />
        </div>

        <div>
          <div className={label}>杠杆（1 = 现货）</div>
          <input
            className={input}
            type="number"
            min={1}
            max={125}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
          />
        </div>

        {leverage > 1 && (
          <div className="mt-3">
            <div className={label}>方向（影响强平价）</div>
            <div className="mt-1 flex gap-3 text-[13px]">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={direction === "long"}
                  onChange={() => setDirection("long")}
                />
                做多
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={direction === "short"}
                  onChange={() => setDirection("short")}
                />
                做空
              </label>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
        <h2 className="m-0 mb-3 text-[13px] font-semibold">结果</h2>

        {!cohort ? (
          <p className={label}>请选择事件类型</p>
        ) : (
          <>
            <div className={row}>
              <span className={label}>
                止损距离
                <span className="ml-1 text-[11px]">
                  （{mode === "implied" ? "隐含 24h" : "历史 10 分位"}）
                </span>
              </span>
              <span className={`${val} text-amber-400`}>{pct(stopDistance)}</span>
            </div>
            <div className={row}>
              <span className={label}>参考名义敞口（按所选分位）</span>
              <span className={val}>{out ? `$${usd(out.notional)}` : "—"}</span>
            </div>
            <div className={row}>
              <span className={label}>币数量</span>
              <span className={val}>{out?.qty ? out.qty.toPrecision(4) : "—"}</span>
            </div>
            <div className={row}>
              <span className={label}>占用保证金</span>
              <span className={val}>{out ? `$${usd(out.margin)}` : "—"}</span>
            </div>
            {out?.liq != null && (
              <>
                <div className={row}>
                  <span className={label}>
                    强平价（逐仓{direction === "long" ? "多" : "空"}单，估，MMR 0.5%）
                  </span>
                  <span className={`${val} text-red-400`}>{out.liq.toFixed(2)}</span>
                </div>
                <div className={row}>
                  <span className={label}>强平距离</span>
                  <span className={`${val} text-red-400`}>{pct(out.liqDistance)}</span>
                </div>
              </>
            )}

            {out?.liqBeforeStop && (
              <div className="mt-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-[12px] text-rose-300">
                警告：止损距离（{pct(stopDistance)}）大于强平距离（{pct(out.liqDistance)}），
                按此设置价格会先触及强平。要么降低杠杆，要么收紧止损分位。
              </div>
            )}

            <div className="mt-4 rounded border border-[var(--color-line)] p-3 text-[12px] text-[var(--color-mut)]">
              <div className="mb-1 font-semibold text-[var(--color-fg)]">
                这个事件类型的历史参考（N={cohort.n}）
              </div>
              <div>隐含 24h 波动：{pct(cohort.implied24h)}</div>
              <div>
                最大回撤：中位 {pct(cohort.ddMedian)} · 25 分位 {pct(cohort.ddP25)} · 10 分位{" "}
                {pct(cohort.ddP10)}
              </div>
              <div className="mt-2 text-[11px]">
                含义：历史上同类事件里，有 10% 的情况跌幅超过 {pct(cohort.ddP10)}。
                用它作为止损距离，等于按"历史极端情况"定仓位。
              </div>
            </div>
          </>
        )}

        <p className="mb-0 mt-3 text-[11px] text-[var(--color-mut)]">
          仅供研究与风险教育，非投资建议。历史分布不代表未来，止损只是风险控制的一种方式。
        </p>
      </section>
    </div>
  );
}
