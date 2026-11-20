import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonthsClamped, formatMonthID } from "@/lib/format";

export function MonthNav({ month, view }: { month: string; view: string }) {
  const shift = (n: number) => addMonthsClamped(`${month}-01`, n).slice(0, 7);
  const href = (mo: string) => `/debts?view=${view}&month=${mo}`;
  const cls = "inline-flex h-9 w-9 items-center justify-center rounded-md border border-line hover:bg-sunken";
  return (
    <div className="mb-4 flex items-center gap-2">
      <Link href={href(shift(-1))} className={cls} aria-label="Bulan sebelumnya"><ChevronLeft className="h-4 w-4" aria-hidden /></Link>
      <h2 className="min-w-40 text-center font-display text-lg font-semibold">{formatMonthID(month)}</h2>
      <Link href={href(shift(1))} className={cls} aria-label="Bulan berikutnya"><ChevronRight className="h-4 w-4" aria-hidden /></Link>
    </div>
  );
}
