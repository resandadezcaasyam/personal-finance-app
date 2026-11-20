import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { addMonthsClamped, formatCompactIDR, formatMonthID, shiftDate } from "@/lib/format";
import type { DayRow } from "@/lib/forecast/engine";

const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/** Month grid of PROJECTED cash movements with the projected closing balance of each day. Server component. */
export function ForecastCalendar({ month, days, today, hrefFor, prev, next }: { month: string; days: DayRow[]; today: string; hrefFor: (m: string) => string; prev: string | null; next: string | null }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => shiftDate(first, i))];
  while (cells.length % 7) cells.push(null);
  const btn = "inline-flex h-9 w-9 items-center justify-center rounded-md border border-line hover:bg-sunken";
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {prev ? <Link href={hrefFor(prev)} className={btn} aria-label="Bulan sebelumnya"><ChevronLeft className="h-4 w-4" aria-hidden /></Link> : <span className={cn(btn, "opacity-30")} aria-hidden><ChevronLeft className="h-4 w-4" /></span>}
        <h3 className="min-w-40 text-center font-display text-lg font-semibold">{formatMonthID(month)}</h3>
        {next ? <Link href={hrefFor(next)} className={btn} aria-label="Bulan berikutnya"><ChevronRight className="h-4 w-4" aria-hidden /></Link> : <span className={cn(btn, "opacity-30")} aria-hidden><ChevronRight className="h-4 w-4" /></span>}
      </div>
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <div className="min-w-[46rem]" role="grid" aria-label={`Kalender proyeksi ${month}`}>
          <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted" role="row">{DAYS.map((d) => <div key={d} className="py-2" role="columnheader">{d}</div>)}</div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const row = d ? byDate.get(d) : undefined;
              return (
                <div key={i} role="gridcell" className={cn("min-h-28 border-b border-r border-line p-1.5 text-xs [&:nth-child(7n)]:border-r-0", !d && "bg-sunken/50", row && row.closing < 0 && "bg-loss/5")}>
                  {d && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1", d === today && "bg-brand font-semibold text-brand-ink")}>{Number(d.slice(8))}</span>
                        {row && <span className={cn("num text-[10px]", row.closing < 0 ? "font-semibold text-loss" : "text-muted")} title="Saldo akhir hari (proyeksi)">{formatCompactIDR(row.closing)}</span>}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {row?.events.slice(0, 3).map((e, k) => (
                          <li key={k} title={`${e.label}${e.note ? ` · ${e.note}` : ""}`} className={cn("truncate rounded px-1 py-0.5", e.kind === "income" ? "bg-gain/15 text-gain" : e.overdue ? "bg-loss/15 text-loss" : e.kind === "installment" ? "bg-warn/15 text-warn" : "bg-sunken")}>
                            {e.kind === "income" ? "+" : "−"}{formatCompactIDR(e.amount).replace("Rp ", "")} {e.label}
                          </li>
                        ))}
                        {row && row.events.length > 3 && <li className="px-1 text-muted">+{row.events.length - 3} lagi</li>}
                      </ul>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Semua angka di kalender adalah proyeksi. Angka kecil di pojok kanan atas tiap hari adalah perkiraan saldo akhir hari itu; merah berarti negatif.</p>
    </div>
  );
}

export const calMonthRange = (today: string, displayDays: number) => {
  const months: string[] = [];
  const end = shiftDate(today, displayDays).slice(0, 7);
  for (let k = 0; ; k++) { const m = addMonthsClamped(`${today.slice(0, 7)}-01`, k).slice(0, 7); months.push(m); if (m >= end || k > 14) break; }
  return months;
};
