import type { LucideIcon } from "lucide-react";

/** A titled settings block: icon, title, one-line description, optional status badge, then the controls. */
export function SettingsSection({ id, icon: Icon, title, description, badge, children }: { id: string; icon: LucideIcon; title: string; description: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 rounded-card border border-line bg-surface shadow-card">
      <header className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tint text-brand-text"><Icon className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1"><h2 id={`${id}-title`} className="text-[15px] font-semibold tracking-tight">{title}</h2><p className="mt-0.5 text-[13px] leading-5 text-muted">{description}</p></div>
        {badge}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
