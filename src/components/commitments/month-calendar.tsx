import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatCompactIDR, shiftDate } from "@/lib/format";
import type { AgendaItem } from "@/lib/obligations";

export const STATUS_STYLE: Record<AgendaItem["status"], string> = {
  paid: "bg-brand/15 text-brand-text line-through decoration-1",
  partial: "bg-warn/15 text-warn",
  overdue: "bg-loss/15 text-loss",
  due: "bg-sunken text-ink",
  projected: "border border-dashed border-line text-muted",
};
export const STATUS_LABEL: Record<AgendaItem["status"], string> = { paid: "Lunas", partial: "Sebagian", overdue: "Terlambat", due: "Belum dibayar", projected: "Proyeksi" };

const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/** Monday-first month grid. Server component: items arrive already computed. */
export function MonthCalendar({ month, items, today }: { month: string; items: AgendaItem[]; today: string }) {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => shiftDate(first, i))];
  while (cells.length % 7) cells.push(null);
  const byDate = new Map<string, AgendaItem[]>();
  for (const it of items) byDate.set(it.date, [...(byDate.get(it.date) ?? []), it]);

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface">
      <div className="min-w-[44rem]" role="grid" aria-label={`Kalender ${month}`}>
        <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted" role="row">{DAYS.map((d) => <div key={d} className="py-2" role="columnheader">{d}</div>)}</div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const list = d ? byDate.get(d) ?? [] : [];
            return (
              <div key={i} role="gridcell" className={cn("min-h-24 border-b border-r border-line p-1.5 text-xs [&:nth-child(7n)]:border-r-0", !d && "bg-sunken/50")}>
                {d && (
                  <>
                    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1", d === today && "bg-brand text-brand-ink font-semibold")}>{Number(d.slice(8))}</span>
                    <ul className="mt-1 space-y-1">
                      {list.slice(0, 3).map((it, k) => (
                        <li key={k}>
                          <Link href={it.href} title={`${it.title} · ${it.subtitle} · ${STATUS_LABEL[it.status]}`} className={cn("block truncate rounded px-1 py-0.5", STATUS_STYLE[it.status])}>
                            {it.title}{it.amount > 0 && <span className="num"> · {formatCompactIDR(it.amount)}</span>}
                          </Link>
                        </li>
                      ))}
                      {list.length > 3 && <li className="px-1 text-muted">+{list.length - 3} lagi</li>}
                    </ul>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
