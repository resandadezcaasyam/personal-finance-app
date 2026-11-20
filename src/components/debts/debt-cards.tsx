import Link from "next/link";
import { CreditCard, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { daysBetween, formatDateID, formatIDR } from "@/lib/format";
import type { DebtSummary } from "@/lib/debts/debts";

const STATUS_BADGE = { active: ["Aktif", "brand"], settled: ["Lunas", "gain"], cancelled: ["Dibatalkan", "loss"] } as const;

/** One card per debt: what is owed, how far along it is, and when the next payment is due. The whole card is the link. */
export function DebtCards({ debts, today }: { debts: DebtSummary[]; today: string }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {debts.map((d) => {
        const [statusLabel, tone] = STATUS_BADGE[d.status];
        const pct = d.total_rows ? (d.paid_rows / d.total_rows) * 100 : 0;
        const days = d.status === "active" && d.next_due_date ? daysBetween(today, d.next_due_date) : null;
        return (
          <li key={d.id}>
            <Link href={`/debts/${d.id}`} className="group flex h-full flex-col rounded-card border border-line bg-surface p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand/40">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tint text-brand-text"><CreditCard className="h-5 w-5" aria-hidden /></span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold group-hover:text-brand-text">{d.provider}</h3>
                    {d.label && <p className="truncate text-xs text-muted">{d.label}</p>}
                  </div>
                </div>
                <Badge tone={tone}>{statusLabel}</Badge>
              </div>
              <p className="mt-5 text-xs text-muted">Sisa kewajiban</p>
              <p className="num text-[26px] font-semibold leading-8 tracking-tight">{formatIDR(d.outstanding)}</p>
              <p className="mt-1 text-xs text-muted">Sisa pokok <span className="num">{formatIDR(d.remaining_principal)}</span></p>
              <div className="mt-4"><Progress value={pct} label={`Progres ${d.provider}`} /><p className="mt-1.5 flex justify-between text-xs text-muted"><span>{d.paid_rows} dari {d.total_rows} cicilan lunas</span><span className="num">{Math.round(pct)}%</span></p></div>
              {d.status === "active" && d.next_due_date && (
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs text-muted" style={{ marginTop: "1.25rem" }}>
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  <span>Jatuh tempo {formatDateID(d.next_due_date)}</span>
                  {d.overdue_count > 0 ? <Badge tone="loss">Terlambat {d.overdue_count} cicilan</Badge>
                    : days !== null && days <= 3 ? <Badge tone="warn">{days === 0 ? "Hari ini" : `${days} hari lagi`}</Badge>
                    : days !== null ? <Badge>{days} hari lagi</Badge> : null}
                </div>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
