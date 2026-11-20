import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-grad-fill text-brand-ink shadow-glow ring-1 ring-inset ring-white/10 hover:brightness-110 hover:shadow-[0_10px_24px_-8px_rgb(37_99_235/0.65)]",
  secondary: "border border-line bg-surface/80 text-ink shadow-card backdrop-blur hover:border-brand/30 hover:bg-tint/70",
  ghost: "text-ink hover:bg-sunken",
  danger: "bg-loss text-white shadow-card hover:opacity-90",
};
// One scale for the whole app: 32 / 36 / 36px.
const sizes: Record<Size, string> = { sm: "h-8 px-3 text-[13px]", md: "h-9 px-3.5 text-sm", icon: "h-9 w-9" };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/** Link-styled-as-button helper: same look as <Button> for <a>/<Link>. */
export const buttonClass = (variant: Variant = "primary", size: Size = "md", extra?: string) =>
  cn("inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,opacity,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50", variants[variant], sizes[size], extra);

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...props} />;
});
