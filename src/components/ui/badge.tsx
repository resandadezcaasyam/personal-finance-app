import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-sunken text-muted",
  brand: "bg-brand/15 text-brand",
  warn: "bg-warn/15 text-warn",
  loss: "bg-loss/15 text-loss",
};
export function Badge({ tone = "neutral", className, children }: { tone?: keyof typeof tones; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}
