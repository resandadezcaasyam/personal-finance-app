import { cn } from "@/lib/utils";

// Restrained: a soft tint, a hairline ring, small type. Meaning always comes with text, never color alone.
const tones = {
  neutral: "bg-sunken text-muted ring-line",
  brand: "bg-brand/10 text-brand-text ring-brand/20",
  gain: "bg-gain/10 text-gain ring-gain/20",
  warn: "bg-warn-fill/15 text-warn ring-warn-fill/30",
  loss: "bg-loss/10 text-loss ring-loss/20",
};
export function Badge({ tone = "neutral", className, children }: { tone?: keyof typeof tones; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset", tones[tone], className)}>{children}</span>;
}
