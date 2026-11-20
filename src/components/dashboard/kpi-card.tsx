import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Delta {
  /** Percent change versus the previous month (only passed when the previous month has real data). */
  pct: number;
  /** Is an increase good (income) or bad (expenses)? */
  upIsGood: boolean;
}

/** A status chip for values that have no percentage (e.g. net cash flow): text + arrow, never color alone. */
export interface Status { label: string; good: boolean | null }

/**
 * Financial KPI. Icon in a soft-blue container, the value as the visual focus, a direction chip beside it, and a caption
 * with the real difference. Direction is always spelled out with an arrow and a sign, never by color alone.
 */
export function KpiCard({ label, value, icon: Icon, negative, caption, delta, status, emphasis, empty }: {
  label: string; value: string; icon: LucideIcon; negative?: boolean; caption: string; delta?: Delta | null; status?: Status | null; emphasis?: boolean; empty?: boolean;
}) {
  const good = delta ? (delta.pct === 0 ? null : (delta.pct > 0) === delta.upIsGood) : status ? status.good : null;
  const up = delta ? delta.pct > 0 : status ? status.good === true : false;
  const Arrow = good === null ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const chipText = delta ? `${delta.pct > 0 ? "+" : delta.pct < 0 ? "−" : ""}${Math.abs(Math.round(delta.pct))}%` : status?.label;
  return (
    <section className={cn("group relative min-w-0 overflow-hidden rounded-card border bg-surface p-5 shadow-card hover:-translate-y-0.5", emphasis ? "border-brand/30 bg-[linear-gradient(160deg,hsl(var(--brand)/0.10),transparent_55%)]" : "border-line")}>
      {emphasis && <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-grad-accent" aria-hidden />}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", emphasis ? "bg-grad-fill text-brand-ink shadow-glow ring-1 ring-inset ring-white/15" : "bg-tint text-brand-text ring-1 ring-inset ring-brand/10 transition-colors group-hover:bg-brand/15")}><Icon className="h-5 w-5" aria-hidden /></span>
          <h2 className="truncate text-[13px] font-medium text-muted">{label}</h2>
        </div>
        {delta && (
          <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", good === null ? "bg-sunken text-muted ring-line" : good ? "bg-gain/10 text-gain ring-gain/20" : "bg-loss/10 text-loss ring-loss/20")}>
            <Arrow className="h-3 w-3" aria-hidden />{chipText}
          </span>
        )}
      </div>
      <p className={cn("num mt-4 truncate text-[28px] font-semibold leading-9 tracking-tight", empty && "text-muted", negative && "text-loss")} aria-label={empty ? "Belum ada data" : undefined}>{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {!delta && status && (
          <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", good === null ? "bg-sunken text-muted ring-line" : good ? "bg-gain/10 text-gain ring-gain/20" : "bg-loss/10 text-loss ring-loss/20")}>
            <Arrow className="h-3 w-3" aria-hidden />{chipText}
          </span>
        )}
        <p className="text-xs leading-5 text-muted">{caption}</p>
      </div>
    </section>
  );
}
