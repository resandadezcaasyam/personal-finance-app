import {
  DatabaseBackup,
  LayoutDashboard, ArrowLeftRight, Landmark, TrendingUp, Receipt, CreditCard, CalendarClock, Zap, Inbox,
  FileUp, LineChart, Calculator, PiggyBank, ListChecks, BarChart3, Workflow, Settings, type LucideIcon,
} from "lucide-react";

export type NavGroupId = "ringkasan" | "keuangan" | "alat" | "rencana" | "sistem";

export interface NavItem {
  href: string;
  /** Full name: page titles, breadcrumbs, tooltips. */
  label: string;
  /** Shorter text for the compact sidebar (falls back to `label`). */
  short?: string;
  icon: LucideIcon;
  group: NavGroupId;
  /** Phase in which the feature ships. Routes are only active once implemented. */
  phase: number;
}

export const CURRENT_PHASE = 8;
export const APP_VERSION = "1.0.0";

export const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: "ringkasan", label: "Ringkasan" },
  { id: "keuangan", label: "Keuangan" },
  { id: "alat", label: "Alat Cerdas" },
  { id: "rencana", label: "Perencanaan & Wawasan" },
  { id: "sistem", label: "Sistem" },
];

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dasbor", icon: LayoutDashboard, group: "ringkasan", phase: 1 },
  { href: "/transactions", label: "Transaksi", icon: ArrowLeftRight, group: "ringkasan", phase: 2 },
  { href: "/accounts", label: "Akun & Saldo", icon: Landmark, group: "ringkasan", phase: 2 },
  { href: "/income", label: "Pemasukan", icon: TrendingUp, group: "keuangan", phase: 2 },
  { href: "/expenses", label: "Pengeluaran & Anggaran", icon: Receipt, group: "keuangan", phase: 2 },
  { href: "/debts", label: "Utang & Cicilan", icon: CreditCard, group: "keuangan", phase: 3 },
  { href: "/bills", label: "Tagihan & Langganan", icon: CalendarClock, group: "keuangan", phase: 3 },
  { href: "/quick-capture", label: "Catat Cepat", icon: Zap, group: "alat", phase: 4 },
  { href: "/inbox", label: "Kotak Masuk Pintar", icon: Inbox, group: "alat", phase: 4 },
  { href: "/import", label: "Pusat Impor", icon: FileUp, group: "alat", phase: 4 },
  { href: "/forecast", label: "Proyeksi Arus Kas", icon: LineChart, group: "alat", phase: 5 },
  { href: "/early-repayment", label: "Simulasi Pelunasan Dini", short: "Simulasi Pelunasan", icon: Calculator, group: "alat", phase: 6 },
  { href: "/goals", label: "Target Tabungan", icon: PiggyBank, group: "rencana", phase: 7 },
  { href: "/next-actions", label: "Langkah Keuangan Berikutnya", short: "Langkah Berikutnya", icon: ListChecks, group: "rencana", phase: 7 },
  { href: "/reports", label: "Laporan & Analitik", icon: BarChart3, group: "rencana", phase: 7 },
  { href: "/automation", label: "Aturan Otomasi", icon: Workflow, group: "rencana", phase: 7 },
  { href: "/backup", label: "Cadangan & Kesehatan Data", short: "Cadangan & Data", icon: DatabaseBackup, group: "sistem", phase: 8 },
  { href: "/settings", label: "Pengaturan", icon: Settings, group: "sistem", phase: 1 },
];

/** The nav item (and its group) a pathname belongs to; `/debts/5` belongs to `/debts`. */
export function navFor(pathname: string): NavItem | undefined {
  return NAV_ITEMS.filter((i) => (i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(`${i.href}/`))).sort((a, b) => b.href.length - a.href.length)[0];
}

export const isActive = (item: NavItem) => item.phase <= CURRENT_PHASE;
