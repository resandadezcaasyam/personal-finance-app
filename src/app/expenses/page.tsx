import { PieChart } from "lucide-react";
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
  return (
    <>
      <PageHeader title="Pengeluaran" description="Catat pengeluaran harian dengan kategori, subkategori, akun pembayaran, dan tag, lalu atur anggaran bulanan per kategori." />
      <Card className="mb-6">
        <CardHeader><CardTitle>Pengeluaran {formatMonthID(month)}</CardTitle><span className="num font-semibold">{formatIDR(expense)}</span></CardHeader>
        <CardBody>{data.length ? <SpendingChart data={data} /> : <EmptyState icon={PieChart} title="Belum ada pengeluaran bulan ini" description="Rincian per kategori muncul setelah Anda mencatat pengeluaran." />}</CardBody>
      </Card>
      <section aria-labelledby="h-bud" className="mb-8"><h2 id="h-bud" className="mb-2 font-display text-xl font-semibold">Anggaran bulanan</h2><BudgetTable month={bm} prevMonth={previousMonthOf(bm)} nextMonth={nextBm <= addMonthsClamped(`${month}-01`, 6).slice(0, 7) ? nextBm : null} lines={bv.lines} totals={{ budget: bv.totalBudget, actualBudgeted: bv.totalActualBudgeted, actual: bv.totalActual }} uncategorized={bv.uncategorized} basePath="/expenses" /></section>
      <LedgerView basePath="/expenses" sp={searchParams} fixedType="expense" allowedTypes={["expense"]}
        emptyTitle="Belum ada pengeluaran" emptyText="Catat pengeluaran pertama Anda. Saldo akun yang dipilih akan berkurang." />
    </>
  );
}
