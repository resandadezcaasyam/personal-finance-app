"use client";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { formatIDR, formatCompactIDR } from "@/lib/format";
import type { CategorySpend } from "@/lib/ledger/summary";

// One palette for every category chart (teal first, then distinguishable hues). Readable on light and dark surfaces.
const COLORS = ["#0D9488", "#6366F1", "#F59E0B", "#EC4899", "#0EA5E9", "#84CC16", "#A855F7", "#94A3B8"];

/** Category breakdown. `stacked` puts the legend under the donut (narrow cards); the default places it beside it. */
export function SpendingChart({ data, stacked = false }: { data: CategorySpend[]; stacked?: boolean }) {
  const total = data.reduce((s, d) => s + d.total, 0);
  // Keep the chart readable: top categories, the rest grouped.
  const keep = stacked ? 5 : 7;
  const top = data.slice(0, keep);
  const rest = data.slice(keep).reduce((s, d) => s + d.total, 0);
  const items = rest > 0 ? [...top, { name: "Lainnya (gabungan)", total: rest }] : top;
  return (
    <div className={stacked ? "flex flex-col items-center gap-4" : "grid items-center gap-5 sm:grid-cols-[11rem_1fr]"}>
      <div className="relative mx-auto h-44 w-44 shrink-0" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie rootTabIndex={-1} data={items} dataKey="total" nameKey="name" innerRadius={58} outerRadius={84} paddingAngle={2} cornerRadius={3} stroke="none" isAnimationActive={false}>
              {items.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number) => formatIDR(v)} contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--line))", borderRadius: 10, color: "hsl(var(--ink))", fontSize: 12, boxShadow: "0 8px 24px -6px rgb(15 23 42 / 0.18)" }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] text-muted">Total</span>
          <span className="num text-sm font-semibold">{formatCompactIDR(total)}</span>
        </div>
      </div>
      <ul className="w-full space-y-2 text-[13px]" aria-label="Pengeluaran per kategori">
        {items.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: COLORS[i % COLORS.length] }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{d.name}</span>
            <span className="num w-9 text-right text-muted">{Math.round((d.total / total) * 100)}%</span>
            <span className="num w-[6.5rem] text-right font-medium">{formatIDR(d.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
