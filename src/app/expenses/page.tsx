import { PieChart } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LedgerView } from "@/components/ledger/ledger-view";
import { SpendingChart } from "@/components/ledger/spending-chart";
import { getDb } from "@/lib/db/client";
import { monthTotals, spendingByCategory } from "@/lib/ledger/summary";
import { currentMonthWIB, formatIDR, formatMonthID } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function ExpensesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const db = getDb();
  const month = currentMonthWIB();
  const data = spendingByCategory(db, month);
  const { expense } = monthTotals(db, month);
  return (
    <>
      <PageHeader title="Pengeluaran" description="Catat pengeluaran harian dengan kategori, subkategori, akun pembayaran, dan tag. Anggaran per kategori tersedia di Fase 7." />
      <Card className="mb-6">
        <CardHeader><CardTitle>Pengeluaran {formatMonthID(month)}</CardTitle><span className="num font-semibold">{formatIDR(expense)}</span></CardHeader>
        <CardBody>{data.length ? <SpendingChart data={data} /> : <EmptyState icon={PieChart} title="Belum ada pengeluaran bulan ini" description="Rincian per kategori muncul setelah Anda mencatat pengeluaran." />}</CardBody>
      </Card>
      <LedgerView basePath="/expenses" sp={searchParams} fixedType="expense" allowedTypes={["expense"]}
        emptyTitle="Belum ada pengeluaran" emptyText="Catat pengeluaran pertama Anda. Saldo akun yang dipilih akan berkurang." />
    </>
  );
}
