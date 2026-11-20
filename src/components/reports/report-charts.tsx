"use client";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactIDR, formatIDR, formatMonthID } from "@/lib/format";

const INCOME = "#0f766e", EXPENSE = "#b45309", NET = "#4f46e5", DEBT = "#be123c";
const tip = { background: "hsl(var(--surface))", border: "1px solid hsl(var(--line))", borderRadius: 8, color: "hsl(var(--ink))" };
const axis = { fontSize: 11, fill: "currentColor" } as const;
const mt = (m: string) => `${m.slice(5)}/${m.slice(2, 4)}`;

export function IncomeExpenseChart({ data }: { data: { month: string; income: number; expense: number; net: number }[] }) {
  const names: Record<string, string> = { income: "Pemasukan", expense: "Pengeluaran", net: "Selisih" };
  return (
    <div className="h-72 w-full" role="img" aria-label="Grafik pemasukan dan pengeluaran per bulan beserta selisihnya. Datanya ada di tabel ringkasan bulanan di bawah.">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} />
          <XAxis dataKey="month" tickFormatter={mt} tick={axis} stroke="currentColor" strokeOpacity={0.3} />
          <YAxis tickFormatter={(v: number) => formatCompactIDR(v)} width={78} tick={axis} stroke="currentColor" strokeOpacity={0.3} />
          <Tooltip contentStyle={tip} labelFormatter={(m: string) => formatMonthID(m)} formatter={(v: number, n: string) => [formatIDR(v), names[n] ?? n]} />
          <Legend formatter={(n: string) => names[n] ?? n} />
          <Bar dataKey="income" name="income" fill={INCOME} isAnimationActive={false} radius={[3, 3, 0, 0]} />
          <Bar dataKey="expense" name="expense" fill={EXPENSE} isAnimationActive={false} radius={[3, 3, 0, 0]} />
          <Line type="monotone" dataKey="net" name="net" stroke={NET} strokeWidth={2.2} strokeDasharray="6 4" dot={{ r: 3 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PerformanceChart({ data }: { data: { month: string; cash: number; debt: number; net: number }[] }) {
  const names: Record<string, string> = { cash: "Kas", debt: "Sisa utang", net: "Kas − utang" };
  return (
    <div className="h-72 w-full" role="img" aria-label="Grafik kas, sisa utang, dan selisihnya di akhir tiap bulan. Datanya ada di tabel kondisi keuangan di bawah.">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.12} />
          <XAxis dataKey="month" tickFormatter={mt} tick={axis} stroke="currentColor" strokeOpacity={0.3} />
          <YAxis tickFormatter={(v: number) => formatCompactIDR(v)} width={78} tick={axis} stroke="currentColor" strokeOpacity={0.3} />
          <Tooltip contentStyle={tip} labelFormatter={(m: string) => formatMonthID(m)} formatter={(v: number, n: string) => [formatIDR(v), names[n] ?? n]} />
          <Legend formatter={(n: string) => names[n] ?? n} />
          <Line type="monotone" dataKey="cash" name="cash" stroke={INCOME} strokeWidth={2.4} dot={{ r: 3 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="debt" name="debt" stroke={DEBT} strokeWidth={2.4} strokeDasharray="7 5" dot={{ r: 3 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="net" name="net" stroke={NET} strokeWidth={2.4} strokeDasharray="2 4" dot={{ r: 3 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
