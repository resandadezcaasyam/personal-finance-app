import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Delta {
  /** Percent change versus the previous month (only passed when the previous month has real data). */
  pct: number;
  /** Is an increase good (income, net) or bad (expenses)? */
  upIsGood: boolean;
  vs: string;
}

/**
 * Financial KPI: restrained icon chip, one large tabular number, and context. Direction is always spelled out with an
 * arrow and a sign, never by color alone.
 */
export function KpiCard({ label, value, icon: Icon, negative, note, delta, emphasis, empty }: {
  label: string; value: string; icon: LucideIcon; negative?: boolean; note: string; delta?: Delta | null; emphasis?: boolean; empty?: boolean;
}) {
  const good = delta ? (delta.pct === 0 ? null : (delta.pct > 0) === delta.upIsGood) : null;
  const DeltaIcon = !delta || delta.pct === 0 ? Minus : delta.pct > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <section className={cn("min-w-0 rounded-card border bg-surface p-5 shadow-card", emphasis ? "border-brand/30 bg-brand/[0.04]" : "border-line")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-muted">{label}</h2>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", emphasis ? "bg-brand text-brand-ink" : "bg-sunken text-muted")}><Icon className="h-4 w-4" aria-hidden /></span>
      </div>
      <p className={cn("num mt-3 truncate text-2xl font-semibold leading-9 tracking-tight xl:text-[26px]", empty && "text-muted", negative && "text-loss")} aria-label={empty ? "Belum ada data" : undefined}>{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {delta && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium ring-1 ring-inset", good === null ? "bg-sunken ring-line" : good ? "bg-gain/10 text-gain ring-gain/20" : "bg-loss/10 text-loss ring-loss/20")}>
            <DeltaIcon className="h-3 w-3" aria-hidden />{delta.pct > 0 ? "+" : delta.pct < 0 ? "−" : ""}{Math.abs(Math.round(delta.pct))}%
          </span>
        )}
        <span>{delta ? delta.vs : note}</span>
      </div>
    </section>
  );
}
