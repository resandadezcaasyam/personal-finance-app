import { PageHeader } from "@/components/page-header";
import { LedgerView } from "@/components/ledger/ledger-view";

export const dynamic = "force-dynamic";

export default function TransactionsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return (
    <>
      <PageHeader title="Transaksi" description="Seluruh riwayat pemasukan, pengeluaran, transfer, dan penyesuaian. Transfer antar akun tidak dihitung sebagai pemasukan atau pengeluaran." />
      <LedgerView basePath="/transactions" sp={searchParams} allowedTypes={["expense", "income", "transfer"]}
        emptyTitle="Belum ada transaksi" emptyText="Catat pengeluaran, pemasukan, atau transfer pertama Anda. Pastikan sudah ada akun di Akun & Saldo." />
    </>
  );
}
