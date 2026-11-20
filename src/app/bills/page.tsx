import { AlertTriangle, CalendarClock, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { BillsManager } from "@/components/bills/bills-manager";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { listCategories } from "@/lib/ledger/categories";
import { listBills, listBillPayments } from "@/lib/bills/bills";
import { formatIDR, todayWIB } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function BillsPage() {
  const db = getDb();
  const today = todayWIB();
  const bills = listBills(db, today);
  const active = bills.filter((b) => b.is_active);
  const overdue = active.filter((b) => b.status === "overdue");
  const soon = active.filter((b) => b.status === "due_soon");
  const known = (l: typeof bills) => l.reduce((s, b) => s + (b.amount ?? 0), 0);
  const note = (l: typeof bills, empty: string) => (l.length === 0 ? empty : known(l) > 0 ? `${formatIDR(known(l))} (di luar nominal yang berubah-ubah)` : "Nominal belum diketahui (berubah tiap periode)");
  const stats = [
    { label: "Aktif", icon: CheckCircle2, value: String(active.length), note: `${active.filter((b) => b.kind === "subscription").length} langganan` },
    { label: "Segera jatuh tempo", icon: CalendarClock, value: String(soon.length), note: note(soon, "Tidak ada dalam masa pengingat") },
    { label: "Terlambat", icon: AlertTriangle, value: String(overdue.length), note: note(overdue, "Semua tepat waktu"), tone: overdue.length ? "text-loss" : "" },
  ];
  return (
    <>
      <PageHeader title="Tagihan & Langganan" description="Listrik, internet, sewa, asuransi, dan langganan. Menandai lunas mencatat satu pengeluaran dan menggeser jatuh tempo ke periode berikutnya." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {stats.map(({ label, icon, value, note, tone }, i) => <KpiCard key={label} emphasis={i === 0} label={label} icon={icon} value={value} caption={note} negative={!!tone} />)}
      </div>
      <BillsManager bills={bills} payments={listBillPayments(db)} accounts={listAccounts(db)} categories={listCategories(db, { includeArchived: true })} today={today} />
    </>
  );
}
