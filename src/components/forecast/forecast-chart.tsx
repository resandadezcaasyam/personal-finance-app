"use client";
import { CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactIDR, formatDateID, formatIDR } from "@/lib/format";
import { CHART } from "@/lib/chart-colors";

// Two clearly different line styles: ACTUAL is solid, FORECAST is dashed. Colors work in light and dark themes.
const ACTUAL = CHART.primary;   // recorded balance
const FORECAST = CHART.cyan;    // projection

export interface ChartPoint { date: string; actual: number | null; forecast: number | null }

const tick = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function ForecastChart({ points, today, lowest }: { points: ChartPoint[]; today: string; lowest: { date: string; balance: number } }) {
  const step = Math.max(1, Math.floor(points.length / 8));
  return (
    <div>
      <div className="h-80 w-full" role="img" aria-label="Grafik saldo kas: garis padat adalah saldo aktual, garis putus-putus adalah proyeksi. Datanya tersedia pada tabel proyeksi bulanan di bawah.">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} />
            <XAxis dataKey="date" tickFormatter={tick} interval={step} tick={{ fontSize: 11, fill: "currentColor" }} stroke="currentColor" strokeOpacity={0.3} />
            <YAxis tickFormatter={(v: number) => formatCompactIDR(v)} width={78} tick={{ fontSize: 11, fill: "currentColor" }} stroke="currentColor" strokeOpacity={0.3} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--line))", borderRadius: 8, color: "hsl(var(--ink))" }}
              labelFormatter={(d: string) => formatDateID(d)}
              formatter={(v: number, name: string) => [formatIDR(v), name === "actual" ? "Aktual" : "Proyeksi"]}
            />
            <ReferenceLine y={0} stroke={CHART.loss} strokeOpacity={0.7} />
            <ReferenceLine x={today} stroke="currentColor" strokeOpacity={0.5} strokeDasharray="2 2" label={{ value: "Hari ini", position: "insideTopRight", fontSize: 11, fill: "currentColor" }} />
            <Line type="monotone" dataKey="actual" name="actual" stroke={ACTUAL} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="forecast" name="forecast" stroke={FORECAST} strokeWidth={2.5} strokeDasharray="7 5" dot={false} connectNulls={false} isAnimationActive={false} />
            <ReferenceDot x={lowest.date} y={lowest.balance} r={5} fill={lowest.balance < 0 ? CHART.loss : FORECAST} stroke="none" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-2"><svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke={ACTUAL} strokeWidth="2.5" /></svg>Saldo aktual (dari catatan Anda)</li>
        <li className="flex items-center gap-2"><svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke={FORECAST} strokeWidth="2.5" strokeDasharray="7 5" /></svg>Proyeksi (perkiraan, bukan catatan)</li>
        <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: lowest.balance < 0 ? CHART.loss : FORECAST }} aria-hidden />Saldo terendah</li>
      </ul>
    </div>
  );
}
