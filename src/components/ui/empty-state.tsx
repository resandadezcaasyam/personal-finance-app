import type { LucideIcon } from "lucide-react";

/** Compact by design: a small icon, one line of title, a short hint and at most one action. Never fills the card. */
export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-2 py-6 text-center">
      <span className="mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-sunken text-muted"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-[34ch] text-[13px] leading-5 text-muted">{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
