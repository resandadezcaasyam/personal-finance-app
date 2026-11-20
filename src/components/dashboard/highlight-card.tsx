import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

/**
 * Priority highlight: the single most important item from Next Financial Actions (real data, ranked by the app's own
 * rules). It is not AI and says so by being factual. Text uses the per-theme ink (white in light, deep navy in dark), >= 4.8:1 on every gradient stop.
 */
export function HighlightCard({ eyebrow, title, body, href, cta }: { eyebrow: string; title: string; body: string; href: string; cta: string }) {
  return (
    <section className="relative isolate overflow-hidden rounded-card bg-grad-fill p-5 text-brand-ink shadow-glow ring-1 ring-inset ring-white/15 transition-transform duration-200 hover:-translate-y-0.5">
      {/* decorative rings, hidden from assistive tech */}
      <span className="pointer-events-none absolute -right-10 -top-12 -z-10 h-44 w-44 rounded-full border border-white/15" aria-hidden />
      <span className="pointer-events-none absolute -bottom-16 -right-4 -z-10 h-40 w-40 rounded-full bg-white/[0.08]" aria-hidden />
      <span className="pointer-events-none absolute -left-10 top-1/2 -z-10 h-36 w-36 rounded-full bg-cyan-300/20 blur-2xl" aria-hidden />
      <p className="flex items-center gap-2 text-[13px] font-medium text-brand-ink/90">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-ink/15"><Sparkles className="h-4 w-4" aria-hidden /></span>{eyebrow}
      </p>
      <h2 className="mt-4 text-lg font-semibold leading-6 tracking-tight">{title}</h2>
      <p className="mt-2 line-clamp-4 text-[13px] leading-5 text-brand-ink/90">{body}</p>
      <Link href={href} className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-ink px-3.5 text-sm font-medium text-brand-text shadow-card transition-all hover:opacity-90 active:scale-[0.98]">{cta}<ArrowRight className="h-4 w-4" aria-hidden /></Link>
    </section>
  );
}
