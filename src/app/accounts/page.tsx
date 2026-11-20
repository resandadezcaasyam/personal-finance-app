import { PageHeader } from "@/components/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { AccountsManager } from "@/components/ledger/accounts-manager";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { formatIDR, todayWIB } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function AccountsPage() {
  const db = getDb();
  const active = listAccounts(db, { archived: false });
  const archived = listAccounts(db, { archived: true });
  const total = active.reduce((s, a) => s + a.balance, 0);
  return (
    <>
      <PageHeader title="Akun & Saldo" description="Semua tempat uang Anda berada. Saldo dihitung otomatis dari saldo awal dan seluruh transaksi, jadi selalu konsisten dengan riwayat." />
      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm text-muted">Total kas semua akun aktif</span>
          <span className={`num text-2xl font-semibold ${total < 0 ? "text-loss" : ""}`}>{formatIDR(total)}</span>
        </CardBody>
      </Card>
      <AccountsManager accounts={active} archived={archived} today={todayWIB()} />
    </>
  );
}
