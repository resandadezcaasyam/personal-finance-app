import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LedgerEntry } from "@/lib/ledger/types";

/** Direction of an entry for display: sign, text color class, and the icon. Never color alone: a sign always accompanies it. */
export function entrySign(r: Pick<LedgerEntry, "kind" | "adj_direction">) {
  if (r.kind === "income" || (r.kind === "adjustment" && r.adj_direction === "in")) return { text: "text-gain", sign: "+" as const };
  if (r.kind === "transfer") return { text: "", sign: "" as const };
  return { text: "text-loss", sign: "−" as const };
}

/** Round icon that says what kind of entry this is (in, out, transfer, adjustment). */
export function EntryAvatar({ r, className }: { r: Pick<LedgerEntry, "kind" | "adj_direction">; className?: string }) {
  const { sign } = entrySign(r);
  const Icon = r.kind === "transfer" ? ArrowLeftRight : r.kind === "adjustment" ? Scale : sign === "+" ? ArrowDownLeft : ArrowUpRight;
  const tone = r.kind === "transfer" ? "text-brand-text" : r.kind === "adjustment" ? "text-muted" : sign === "+" ? "text-gain" : "text-loss";
  return <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint", className)}><Icon className={cn("h-4 w-4", tone)} aria-hidden /></span>;
}

/** Soft-blue category chip. */
export function CategoryPill({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-block max-w-[14rem] truncate rounded-full align-middle bg-tint px-2.5 py-0.5 text-[11px] font-medium text-brand-text ring-1 ring-inset ring-brand/15", className)}>{children}</span>;
}
