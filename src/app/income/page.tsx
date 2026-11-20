import { PageHeader } from "@/components/page-header";
import { LedgerView } from "@/components/ledger/ledger-view";
import { RecurringIncomeManager } from "@/components/ledger/recurring-income-manager";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { listCategories } from "@/lib/ledger/categories";
import { listRecurringIncome } from "@/lib/ledger/recurring";
import { todayWIB } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function IncomePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const db = getDb();
  return (
    <>
      <PageHeader title="Pemasukan" description="Gaji, bonus, THR, freelance, refund, dan reimbursement. Pilih kategori yang sesuai agar laporan akurat." />
      <LedgerView basePath="/income" sp={searchParams} fixedType="income" allowedTypes={["income"]}
        emptyTitle="Belum ada pemasukan" emptyText="Catat gaji atau pemasukan lain. Saldo akun yang dipilih akan bertambah." />
      <h2 className="mb-1 mt-10 font-display text-xl font-semibold">Pemasukan berulang</h2>
      <RecurringIncomeManager rules={listRecurringIncome(db)} accounts={listAccounts(db)} categories={listCategories(db)} today={todayWIB()} />
    </>
  );
}
