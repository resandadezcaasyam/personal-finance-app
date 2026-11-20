"use client";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { formatIDR } from "@/lib/format";
import type { CategorySpend } from "@/lib/ledger/summary";

// Distinct in both light and dark themes.
const COLORS = ["#0f766e", "#b45309", "#4f46e5", "#be185d", "#0369a1", "#65a30d", "#9333ea", "#64748b"];

export function SpendingChart({ data }: { data: CategorySpend[] }) {
  const total = data.reduce((s, d) => s + d.total, 0);
  // Keep the chart readable: top 7 categories, the rest grouped.
  const top = data.slice(0, 7);
  const rest = data.slice(7).reduce((s, d) => s + d.total, 0);
  const items = rest > 0 ? [...top, { name: "Lainnya (gabungan)", total: rest }] : top;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[11rem_1fr]">
      <div className="mx-auto h-44 w-44" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie rootTabIndex={-1} data={items} dataKey="total" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={1} stroke="none" isAnimationActive={false}>
              {items.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(v: number) => formatIDR(v)} contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--line))", borderRadius: 8, color: "hsl(var(--ink))" }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1.5 text-sm" aria-label="Pengeluaran per kategori">
        {items.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} aria-hidden />
            <span className="flex-1 truncate">{d.name}</span>
            <span className="num text-muted">{Math.round((d.total / total) * 100)}%</span>
            <span className="num w-28 text-right">{formatIDR(d.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
