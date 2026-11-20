import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 py-2">
      <Icon className="h-5 w-5 text-muted" aria-hidden />
      <p className="font-medium">{title}</p>
      <p className="max-w-prose text-sm text-muted">{description}</p>
      {action}
    </div>
  );
}
