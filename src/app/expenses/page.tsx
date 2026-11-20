import { PieChart, ArrowUpRight, Target, Tags } from "lucide-react";
import { KpiCard, type Delta } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LedgerView } from "@/components/ledger/ledger-view";
import { SpendingChart } from "@/components/ledger/spending-chart";
import { getDb } from "@/lib/db/client";
import { monthTotals, spendingByCategory } from "@/lib/ledger/summary";
import { BudgetTable } from "@/components/budgets/budget-table";
import { getBudgetView, isMonth, previousMonthOf } from "@/lib/budgets/budgets";
import { addMonthsClamped, currentMonthWIB, formatIDR, formatMonthID } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function ExpensesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const db = getDb();
  const month = currentMonthWIB();
  const bmRaw = Array.isArray(searchParams.bm) ? searchParams.bm[0] : searchParams.bm;
  const bm = isMonth(bmRaw ?? "") && (bmRaw as string) <= addMonthsClamped(`${month}-01`, 6).slice(0, 7) ? (bmRaw as string) : month;
  const bv = getBudgetView(db, bm);
  const nextBm = addMonthsClamped(`${bm}-01`, 1).slice(0, 7);
  const data = spendingByCategory(db, month);
  const { expense } = monthTotals(db, month);
  const prevMonth = previousMonthOf(month);
  const prevExpense = monthTotals(db, prevMonth).expense;
  const delta: Delta | null = prevExpense > 0 ? { pct: ((expense - prevExpense) / prevExpense) * 100, upIsGood: false } : null;
  const budgetMonth = getBudgetView(db, month);
  const pctUsed = budgetMonth.totalBudget > 0 ? Math.round((budgetMonth.totalActualBudgeted / budgetMonth.totalBudget) * 100) : null;
  const top = data[0];
  return (
    <>
      <PageHeader title="Pengeluaran" description="Catat pengeluaran harian dengan kategori, subkategori, akun pembayaran, dan tag, lalu atur anggaran bulanan per kategori." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard emphasis label="Pengeluaran bulan ini" icon={ArrowUpRight} value={formatIDR(expense)} caption={prevExpense > 0 ? `${expense >= prevExpense ? "Naik" : "Turun"} ${formatIDR(Math.abs(expense - prevExpense))} dibanding ${formatMonthID(prevMonth)} (penuh)` : formatMonthID(month)} delta={delta} />
        <KpiCard label="Anggaran terpakai" icon={Target} value={pctUsed === null ? "—" : `${pctUsed}%`} empty={pctUsed === null} negative={pctUsed !== null && pctUsed > 100}
          caption={pctUsed === null ? "Belum ada anggaran bulan ini" : `${formatIDR(budgetMonth.totalActualBudgeted)} dari ${formatIDR(budgetMonth.totalBudget)}`} />
        <KpiCard label="Kategori terbesar" icon={Tags} value={top ? top.name : "—"} empty={!top} caption={top ? `${formatIDR(top.total)} · ${Math.round((top.total / Math.max(1, expense)) * 100)}% dari pengeluaran` : "Belum ada pengeluaran"} />
      </div>
      <Card className="mb-6">
        <CardHeader><CardTitle>Rincian per kategori · {formatMonthID(month)}</CardTitle><span className="num text-sm font-semibold">{formatIDR(expense)}</span></CardHeader>
        <CardBody>{data.length ? <SpendingChart data={data} /> : <EmptyState icon={PieChart} title="Belum ada pengeluaran bulan ini" description="Rincian per kategori muncul setelah Anda mencatat pengeluaran." />}</CardBody>
      </Card>
      <section aria-labelledby="h-bud" className="mb-8"><h2 id="h-bud" className="mb-3 text-lg font-semibold tracking-tight">Anggaran bulanan</h2><BudgetTable month={bm} prevMonth={previousMonthOf(bm)} nextMonth={nextBm <= addMonthsClamped(`${month}-01`, 6).slice(0, 7) ? nextBm : null} lines={bv.lines} totals={{ budget: bv.totalBudget, actualBudgeted: bv.totalActualBudgeted, actual: bv.totalActual }} uncategorized={bv.uncategorized} basePath="/expenses" /></section>
      <LedgerView basePath="/expenses" sp={searchParams} fixedType="expense" allowedTypes={["expense"]}
        emptyTitle="Belum ada pengeluaran" emptyText="Catat pengeluaran pertama Anda. Saldo akun yang dipilih akan berkurang." />
    </>
  );
}
