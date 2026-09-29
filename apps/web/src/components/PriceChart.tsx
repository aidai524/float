import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "../lib/types";

export interface Marker {
  t: number; // epoch ms
  label: string;
  color?: string;
}

interface Props {
  candles: Candle[];
  markers?: Marker[];
  height?: number;
}

export default function PriceChart({ candles, markers = [], height = 360 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current || candles.length === 0) return;

    const chart = createChart(ref.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#94a3b8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#16223c" },
        horzLines: { color: "#16223c" },
      },
      rightPriceScale: { borderColor: "#1e293b" },
      timeScale: { borderColor: "#1e293b", timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      height,
      autoSize: true,
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#34d399",
      downColor: "#f87171",
      borderUpColor: "#34d399",
      borderDownColor: "#f87171",
      wickUpColor: "#34d399",
      wickDownColor: "#f87171",
    });

    series.setData(
      candles.map((c) => ({
        time: Math.floor(new Date(c.ts).getTime() / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    if (markers.length) {
      createSeriesMarkers(
        series,
        markers.map((m) => ({
          time: Math.floor(m.t / 1000) as UTCTimestamp,
          position: "aboveBar" as const,
          color: m.color ?? "#f59e0b",
          shape: "arrowDown" as const,
          text: m.label,
        })),
      );
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: ref.current!.clientWidth }));
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, markers, height]);

  return <div ref={ref} className="w-full" style={{ height }} />;
}
