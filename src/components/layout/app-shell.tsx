"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Wallet } from "lucide-react";
import { NAV_ITEMS, isActive, CURRENT_PHASE } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigasi utama" className="space-y-0.5">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        if (!isActive(item)) {
          return (
            <div key={item.href} aria-disabled="true" title={`Tersedia di Fase ${item.phase}`} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted/70">
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1 leading-tight">{item.label}</span>
              <span className="text-xs">F{item.phase}</span>
            </div>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={current ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium", current ? "bg-brand/15 text-brand" : "hover:bg-sunken")}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="leading-tight">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
      <Wallet className="h-5 w-5 text-brand" aria-hidden /> Personal Finance OS
    </Link>
  );
}

export function AppShell({ profile, children }: { profile: "personal" | "demo"; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  React.useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[19.5rem_1fr]">
      <aside className="hidden border-r border-line bg-surface lg:block">
        <div className="sticky top-0 flex h-screen flex-col gap-5 overflow-y-auto p-4">
          <Brand />
          <NavList />
          <p className="mt-auto px-3 text-xs text-muted">Fase {CURRENT_PHASE} dari 8 · data tersimpan lokal</p>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/55" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-5 overflow-y-auto bg-surface p-4">
            <div className="flex items-center justify-between">
              <Brand />
              <Button variant="ghost" size="icon" aria-label="Tutup menu" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
            </div>
            <NavList onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/90 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Buka menu" onClick={() => setOpen(true)}><Menu className="h-4 w-4" /></Button>
          <div className="flex-1" />
          {profile === "demo" && <Badge tone="warn">Mode demo · data fiktif</Badge>}
          <ThemeToggle />
        </header>
        {profile === "demo" && (
          <div className="border-b border-line bg-warn/10 px-4 py-2 text-sm text-warn lg:px-8" role="status">
            Anda sedang melihat data demo. Data pribadi tidak tersentuh dan tersimpan terpisah.
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
