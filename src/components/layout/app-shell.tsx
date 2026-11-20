"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Wallet, Lock, PanelLeftClose, PanelLeftOpen, Plus, Search, ChevronRight } from "lucide-react";
import { lockNowAction } from "@/app/auth-actions";
import { NAV_GROUPS, NAV_ITEMS, isActive, navFor, APP_VERSION } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigasi utama" className="space-y-4">
      {NAV_GROUPS.map((g) => {
        const items = NAV_ITEMS.filter((i) => i.group === g.id);
        return (
          <div key={g.id} role="group" aria-label={g.label}>
            <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted collapsed:hidden">{g.label}</p>
            <div className="hidden border-t border-line/70 pb-1.5 collapsed:block" aria-hidden />
            <ul className="space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                const text = item.short ?? item.label;
                const current = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                if (!isActive(item)) {
                  return (
                    <li key={item.href}>
                      <div aria-disabled="true" title={`Tersedia di Fase ${item.phase}`} className="flex h-8 items-center gap-3 rounded-lg px-2.5 text-[13px] text-muted/70">
                        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden /><span className="flex-1 truncate collapsed:hidden">{text}</span>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={current ? "page" : undefined}
                      title={item.label}
                      className={cn(
                        "group relative flex h-8 items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors collapsed:justify-center collapsed:px-0",
                        current ? "bg-tint text-brand-text" : "text-ink/80 hover:bg-sunken hover:text-ink",
                      )}
                    >
                      {current && <span className="absolute -left-3 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand collapsed:-left-2" aria-hidden />}
                      <Icon className={cn("h-[18px] w-[18px] shrink-0", current ? "text-brand-text" : "text-muted group-hover:text-ink")} aria-hidden />
                      <span className="truncate collapsed:sr-only">{text}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand({ compactable = false }: { compactable?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-lg">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-ink"><Wallet className="h-[18px] w-[18px]" aria-hidden /></span>
      <span className={cn("leading-tight", compactable && "collapsed:sr-only")}>
        <span className="block text-sm font-semibold tracking-tight">Personal Finance OS</span>
        <span className="block text-[11px] text-muted">Keuangan pribadi · lokal</span>
      </span>
    </Link>
  );
}

function Breadcrumbs() {
  const pathname = usePathname();
  const item = navFor(pathname);
  if (!item) return <span className="text-sm font-medium">Personal Finance OS</span>;
  const group = NAV_GROUPS.find((g) => g.id === item.group);
  const detail = pathname !== item.href && pathname.startsWith(`${item.href}/`);
  return (
    <nav aria-label="Lokasi halaman" className="hidden min-w-0 items-center gap-1.5 text-[13px] sm:flex">
      <span className="text-muted">{group?.label}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted/70" aria-hidden />
      {detail ? <Link href={item.href} className="truncate text-muted hover:text-ink">{item.label}</Link> : <span className="truncate font-medium" aria-current="page">{item.label}</span>}
      {detail && <><ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted/70" aria-hidden /><span className="font-medium" aria-current="page">Detail</span></>}
    </nav>
  );
}

export function AppShell({ profile, authEnabled = false, children }: { profile: "personal" | "demo"; authEnabled?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const pathname = usePathname();
  const drawerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => setOpen(false), [pathname]);
  React.useEffect(() => setCollapsed(document.documentElement.getAttribute("data-sidebar") === "collapsed"), []);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    drawerRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (next) document.documentElement.setAttribute("data-sidebar", "collapsed"); else document.documentElement.removeAttribute("data-sidebar");
    try { localStorage.setItem("sidebar", next ? "collapsed" : "expanded"); } catch { /* storage unavailable */ }
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[var(--sidebar-w)_minmax(0,1fr)] lg:transition-[grid-template-columns] lg:duration-200">
      <aside className="hidden border-r border-line bg-sidebar lg:block" aria-label="Sidebar">
        <div className="sticky top-0 flex h-screen flex-col">
          <div className="flex h-14 shrink-0 items-center border-b border-line px-4 collapsed:justify-center collapsed:px-0"><Brand compactable /></div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3"><NavList /></div>
          <p className="shrink-0 border-t border-line px-4 py-3 text-[11px] text-muted collapsed:hidden">Versi {APP_VERSION} · data tersimpan lokal</p>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div ref={drawerRef} className="absolute inset-y-0 left-0 flex w-[17.5rem] max-w-[86vw] flex-col bg-sidebar shadow-pop">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
              <Brand />
              <Button variant="ghost" size="icon" aria-label="Tutup menu" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4"><NavList onNavigate={() => setOpen(false)} /></div>
            <p className="border-t border-line px-4 py-3 text-[11px] text-muted">Versi {APP_VERSION} · data tersimpan lokal</p>
          </div>
        </div>
      )}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/85 px-4 backdrop-blur lg:px-8">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Buka menu" onClick={() => setOpen(true)}><Menu className="h-[18px] w-[18px]" /></Button>
          <Button variant="ghost" size="icon" className="hidden lg:inline-flex" aria-label={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"} aria-pressed={collapsed} onClick={toggleCollapsed}>
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          </Button>
          <Breadcrumbs />
          <div className="flex-1" />
          <form action="/transactions" method="get" role="search" className="relative hidden md:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input name="q" type="search" aria-label="Cari transaksi" placeholder="Cari transaksi…" maxLength={100}
              className="h-9 w-56 rounded-lg border border-line bg-surface pl-8 pr-3 text-[13px] shadow-card placeholder:text-muted/80 hover:border-muted/40 focus-visible:border-brand lg:w-64" />
          </form>
          {profile === "demo" && <Badge tone="warn" className="hidden sm:inline-flex">Mode demo · data fiktif</Badge>}
          <Link href="/transactions?tambah=1" className={buttonClass("primary", "md", "px-3")} aria-label="Tambah transaksi">
            <Plus className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Tambah transaksi</span>
          </Link>
          {authEnabled && <form action={lockNowAction}><Button type="submit" variant="ghost" size="icon" aria-label="Kunci aplikasi" title="Kunci aplikasi"><Lock className="h-[18px] w-[18px]" aria-hidden /></Button></form>}
          <ThemeToggle />
        </header>
        {profile === "demo" && (
          <div className="border-b border-warn-fill/30 bg-warn-fill/10 px-4 py-2 text-[13px] text-warn lg:px-8" role="status">
            <strong className="font-semibold">Mode demo.</strong> Anda sedang melihat data demo; data pribadi tidak tersentuh dan tersimpan terpisah.
          </div>
        )}
        <main className="mx-auto w-full max-w-[1320px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
