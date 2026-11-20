"use client";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactIDR, formatDateID, formatIDR, formatMonthID } from "@/lib/format";

const A = "#0f766e";
const B = "#b45309";
const tickDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const tip = { background: "hsl(var(--surface))", border: "1px solid hsl(var(--line))", borderRadius: 8, color: "hsl(var(--ink))" };

export interface ScenarioPoint { date: string; a: number; b: number }

/** Scenario A (continue, solid) vs scenario B (settle early, dashed) over the next 12 months. */
export function ScenarioChart({ points, repayDate }: { points: ScenarioPoint[]; repayDate: string }) {
  const step = Math.max(1, Math.floor(points.length / 8));
  return (
    <div>
      <div className="h-80 w-full" role="img" aria-label="Grafik saldo kas 12 bulan: garis padat adalah skenario lanjut mencicil, garis putus-putus adalah skenario pelunasan dini. Datanya ada di tabel perbandingan bulanan.">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} />
            <XAxis dataKey="date" tickFormatter={tickDate} interval={step} tick={{ fontSize: 11, fill: "currentColor" }} stroke="currentColor" strokeOpacity={0.3} />
            <YAxis tickFormatter={(v: number) => formatCompactIDR(v)} width={78} tick={{ fontSize: 11, fill: "currentColor" }} stroke="currentColor" strokeOpacity={0.3} />
            <Tooltip contentStyle={tip} labelFormatter={(d: string) => formatDateID(d)} formatter={(v: number, n: string) => [formatIDR(v), n === "a" ? "A: lanjut mencicil" : "B: pelunasan dini"]} />
            <ReferenceLine y={0} stroke="#be123c" strokeOpacity={0.7} />
            <ReferenceLine x={repayDate} stroke="currentColor" strokeOpacity={0.5} strokeDasharray="2 2" label={{ value: "Pelunasan", position: "insideTopRight", fontSize: 11, fill: "currentColor" }} />
            <Line type="monotone" dataKey="a" name="a" stroke={A} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="b" name="b" stroke={B} strokeWidth={2.5} strokeDasharray="7 5" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-2"><svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke={A} strokeWidth="2.5" /></svg>A: lanjut mencicil sesuai jadwal</li>
        <li className="flex items-center gap-2"><svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke={B} strokeWidth="2.5" strokeDasharray="7 5" /></svg>B: pelunasan dini (proyeksi)</li>
      </ul>
    </div>
  );
}

const COLORS: Record<string, { c: string; d?: string }> = { minimum: { c: "#64748b", d: "2 4" }, snowball: { c: "#0f766e" }, avalanche: { c: "#b45309", d: "7 5" }, custom: { c: "#4f46e5", d: "10 3 2 3" } };
const NAMES: Record<string, string> = { minimum: "Cicilan minimum", snowball: "Snowball", avalanche: "Avalanche", custom: "Kustom" };

/** Remaining debt per month under each strategy. Different dash patterns so it is readable without color. */
export function StrategyChart({ rows }: { rows: Record<string, string | number>[] }) {
  const keys = Object.keys(COLORS);
  return (
    <div>
      <div className="h-72 w-full" role="img" aria-label="Grafik sisa utang per bulan untuk tiap strategi pelunasan. Datanya ada di tabel perbandingan strategi.">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} />
            <XAxis dataKey="month" tickFormatter={(m: string) => `${m.slice(5)}/${m.slice(2, 4)}`} tick={{ fontSize: 11, fill: "currentColor" }} stroke="currentColor" strokeOpacity={0.3} />
            <YAxis tickFormatter={(v: number) => formatCompactIDR(v)} width={78} tick={{ fontSize: 11, fill: "currentColor" }} stroke="currentColor" strokeOpacity={0.3} />
            <Tooltip contentStyle={tip} labelFormatter={(m: string) => formatMonthID(m)} formatter={(v: number, n: string) => [formatIDR(v), NAMES[n] ?? n]} />
            {keys.map((k) => <Line key={k} type="stepAfter" dataKey={k} name={k} stroke={COLORS[k].c} strokeDasharray={COLORS[k].d} strokeWidth={2.2} dot={false} isAnimationActive={false} connectNulls />)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        {keys.map((k) => <li key={k} className="flex items-center gap-2"><svg width="28" height="6" aria-hidden><line x1="0" y1="3" x2="28" y2="3" stroke={COLORS[k].c} strokeWidth="2.5" strokeDasharray={COLORS[k].d} /></svg>{NAMES[k]}</li>)}
      </ul>
    </div>
  );
}
