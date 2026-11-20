import { ArrowDownLeft, History, Repeat } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard, type Delta } from "@/components/dashboard/kpi-card";
import { LedgerView } from "@/components/ledger/ledger-view";
import { RecurringIncomeManager } from "@/components/ledger/recurring-income-manager";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { listCategories } from "@/lib/ledger/categories";
import { listRecurringIncome } from "@/lib/ledger/recurring";
import { monthTotals } from "@/lib/ledger/summary";
import { previousMonthOf } from "@/lib/budgets/budgets";
import { currentMonthWIB, formatIDR, formatMonthID, todayWIB } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function IncomePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const db = getDb();
  const month = currentMonthWIB();
  const prevMonth = previousMonthOf(month);
  const cur = monthTotals(db, month).income;
  const prev = monthTotals(db, prevMonth).income;
  const rules = listRecurringIncome(db);
  const delta: Delta | null = prev > 0 ? { pct: ((cur - prev) / prev) * 100, upIsGood: true } : null;
  return (
    <>
      <PageHeader title="Pemasukan" description="Gaji, bonus, THR, freelance, refund, dan reimbursement. Pilih kategori yang sesuai agar laporan akurat." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard emphasis label="Pemasukan bulan ini" icon={ArrowDownLeft} value={formatIDR(cur)} caption={prev > 0 ? `${cur >= prev ? "Naik" : "Turun"} ${formatIDR(Math.abs(cur - prev))} dibanding ${formatMonthID(prevMonth)} (penuh)` : formatMonthID(month)} delta={delta} />
        <KpiCard label="Bulan lalu" icon={History} value={formatIDR(prev)} empty={prev === 0} caption={formatMonthID(prevMonth)} />
        <KpiCard label="Pemasukan berulang" icon={Repeat} value={`${rules.filter((r) => r.is_active).length} aktif`} caption={rules.length ? `${rules.length} aturan tersimpan` : "Belum ada aturan"} />
      </div>
      <LedgerView basePath="/income" sp={searchParams} fixedType="income" allowedTypes={["income"]}
        emptyTitle="Belum ada pemasukan" emptyText="Catat gaji atau pemasukan lain. Saldo akun yang dipilih akan bertambah." />
      <h2 className="mb-1 mt-10 text-lg font-semibold tracking-tight">Pemasukan berulang</h2>
      <RecurringIncomeManager rules={rules} accounts={listAccounts(db)} categories={listCategories(db)} today={todayWIB()} />
    </>
  );
}
