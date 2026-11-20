"use client";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { formatCompactIDR, formatIDR, formatMonthID, formatMonthShortID } from "@/lib/format";

export interface TrendPoint { month: string; income: number; expense: number; net: number }

// Chart colors are literal hex (SVG attributes cannot read CSS variables). Chosen to read on both light and dark surfaces.
const INCOME = "#10B981", EXPENSE = "#EF4444", NET = "#14B8A6";
const NAMES: Record<string, string> = { income: "Pemasukan", expense: "Pengeluaran", net: "Selisih" };

function Tip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const by = Object.fromEntries(payload.map((p) => [String(p.dataKey), Number(p.value)]));
  return (
    <div className="min-w-[11rem] rounded-lg border border-line bg-surface p-3 text-xs shadow-pop">
      <p className="mb-2 font-semibold text-ink">{formatMonthID(String(label))}</p>
      {(["income", "expense", "net"] as const).map((k) => (
        <p key={k} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: k === "income" ? INCOME : k === "expense" ? EXPENSE : NET }} aria-hidden />{NAMES[k]}</span>
          <span className="num font-medium text-ink">{formatIDR(by[k] ?? 0)}</span>
        </p>
      ))}
    </div>
  );
}

/** Income, expenses and the difference per month. Real ledger totals only. */
export function CashFlowChart({ data }: { data: TrendPoint[] }) {
  return (
    <div>
      <div className="h-[280px] w-full text-muted" role="img" aria-label={`Grafik arus kas ${data.length} bulan: pemasukan, pengeluaran, dan selisih per bulan. Angka lengkapnya ada di tabel di bawah grafik dan di halaman Laporan.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.14} />
            <XAxis dataKey="month" tickFormatter={formatMonthShortID} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "currentColor" }} tickMargin={8} />
            <YAxis tickFormatter={(v: number) => formatCompactIDR(v)} width={64} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "currentColor" }} />
            <Tooltip content={<Tip />} cursor={{ stroke: "currentColor", strokeOpacity: 0.25, strokeDasharray: "3 3" }} />
            <Area type="monotone" dataKey="income" stroke={INCOME} strokeWidth={2} fill={INCOME} fillOpacity={0.1} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Area type="monotone" dataKey="expense" stroke={EXPENSE} strokeWidth={2} fill={EXPENSE} fillOpacity={0.08} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="net" stroke={NET} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2.5, strokeWidth: 0, fill: NET }} activeDot={{ r: 4 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted hover:text-ink">Lihat angka per bulan</summary>
        <div tabIndex={0} role="region" aria-label="Tabel arus kas per bulan, dapat digulir" className="mt-2 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <caption className="sr-only">Pemasukan, pengeluaran, dan selisih per bulan</caption>
            <thead><tr className="border-b border-line text-left"><th scope="col" className="px-3 py-2">Bulan</th><th scope="col" className="px-3 py-2 text-right">Pemasukan</th><th scope="col" className="px-3 py-2 text-right">Pengeluaran</th><th scope="col" className="px-3 py-2 text-right">Selisih</th></tr></thead>
            <tbody>{data.map((d) => <tr key={d.month} className="border-b border-line last:border-0"><th scope="row" className="px-3 py-1.5 text-left font-medium">{formatMonthID(d.month)}</th><td className="num px-3 py-1.5 text-right">{formatIDR(d.income)}</td><td className="num px-3 py-1.5 text-right">{formatIDR(d.expense)}</td><td className="num px-3 py-1.5 text-right">{formatIDR(d.net)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
