import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonthID } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Previous / next month for the dashboard. The next month is disabled once it would be in the future. */
export function MonthSwitcher({ month, prev, next, hrefFor }: { month: string; prev: string; next: string | null; hrefFor: (m: string) => string }) {
  const btn = "inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sunken hover:text-ink";
  return (
    <div className="inline-flex items-center rounded-lg border border-line bg-surface shadow-card" role="group" aria-label="Pilih bulan">
      <Link href={hrefFor(prev)} className={btn} aria-label="Bulan sebelumnya"><ChevronLeft className="h-4 w-4" aria-hidden /></Link>
      <span className="min-w-[8.5rem] px-1 text-center text-[13px] font-medium" aria-live="polite">{formatMonthID(month)}</span>
      {next ? <Link href={hrefFor(next)} className={btn} aria-label="Bulan berikutnya"><ChevronRight className="h-4 w-4" aria-hidden /></Link>
        : <span className={cn(btn, "cursor-not-allowed opacity-30 hover:bg-transparent")} aria-disabled="true"><ChevronRight className="h-4 w-4" aria-hidden /></span>}
    </div>
  );
}
