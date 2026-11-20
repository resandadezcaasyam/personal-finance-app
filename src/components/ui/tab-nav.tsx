import Link from "next/link";
import { cn } from "@/lib/utils";

/** Link-based segmented tabs (state lives in the URL). */
export function TabNav({ items, label }: { items: { href: string; label: string; active: boolean }[]; label: string }) {
  return (
    <nav aria-label={label} className="mb-5 inline-flex max-w-full flex-wrap gap-0.5 rounded-xl bg-sunken p-1">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? "page" : undefined}
          className={cn("rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors", i.active ? "bg-surface text-brand-text shadow-card" : "text-muted hover:text-ink")}>{i.label}</Link>
      ))}
    </nav>
  );
}
