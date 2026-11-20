import {
  LayoutDashboard, ArrowLeftRight, Landmark, TrendingUp, Receipt, CreditCard, CalendarClock, Zap, Inbox,
  FileUp, LineChart, Calculator, PiggyBank, ListChecks, BarChart3, Workflow, Settings, type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Phase in which the feature ships. Routes are only active once implemented. */
  phase: number;
}

export const CURRENT_PHASE = 7;

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dasbor", icon: LayoutDashboard, phase: 1 },
  { href: "/transactions", label: "Transaksi", icon: ArrowLeftRight, phase: 2 },
  { href: "/accounts", label: "Akun & Saldo", icon: Landmark, phase: 2 },
  { href: "/income", label: "Pemasukan", icon: TrendingUp, phase: 2 },
  { href: "/expenses", label: "Pengeluaran & Anggaran", icon: Receipt, phase: 2 },
  { href: "/debts", label: "Utang & Cicilan", icon: CreditCard, phase: 3 },
  { href: "/bills", label: "Tagihan & Langganan", icon: CalendarClock, phase: 3 },
  { href: "/quick-capture", label: "Catat Cepat", icon: Zap, phase: 4 },
  { href: "/inbox", label: "Kotak Masuk Pintar", icon: Inbox, phase: 4 },
  { href: "/import", label: "Pusat Impor", icon: FileUp, phase: 4 },
  { href: "/forecast", label: "Proyeksi Arus Kas", icon: LineChart, phase: 5 },
  { href: "/early-repayment", label: "Simulasi Pelunasan Dini", icon: Calculator, phase: 6 },
  { href: "/goals", label: "Target Tabungan", icon: PiggyBank, phase: 7 },
  { href: "/next-actions", label: "Langkah Keuangan Berikutnya", icon: ListChecks, phase: 7 },
  { href: "/reports", label: "Laporan & Analitik", icon: BarChart3, phase: 7 },
  { href: "/automation", label: "Aturan Otomasi", icon: Workflow, phase: 7 },
  { href: "/settings", label: "Pengaturan", icon: Settings, phase: 1 },
];

export const isActive = (item: NavItem) => item.phase <= CURRENT_PHASE;
