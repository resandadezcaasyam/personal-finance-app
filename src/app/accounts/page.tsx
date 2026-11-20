import { Wallet, Landmark, Smartphone, Banknote } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AccountsManager } from "@/components/ledger/accounts-manager";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { ACCOUNT_TYPE_LABEL, type AccountType } from "@/lib/ledger/types";
import { formatIDR, todayWIB } from "@/lib/format";

export const dynamic = "force-dynamic";

const TYPE_ICON = { bank: Landmark, ewallet: Smartphone, cash: Banknote, other: Wallet } as const;

export default function AccountsPage() {
  const db = getDb();
  const active = listAccounts(db, { archived: false });
  const archived = listAccounts(db, { archived: true });
  const total = active.reduce((s, a) => s + a.balance, 0);
  // Per account type, from the real balances (only types the user actually has).
  const byType = (Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[])
    .map((t) => ({ t, n: active.filter((a) => a.type === t).length, sum: active.filter((a) => a.type === t).reduce((s, a) => s + a.balance, 0) }))
    .filter((x) => x.n > 0).sort((a, b) => b.sum - a.sum).slice(0, 3);
  return (
    <>
      <PageHeader title="Akun & Saldo" description="Semua tempat uang Anda berada. Saldo dihitung otomatis dari saldo awal dan seluruh transaksi, jadi selalu konsisten dengan riwayat." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard emphasis label="Total kas" icon={Wallet} value={active.length ? formatIDR(total) : "—"} empty={!active.length} negative={total < 0} caption={active.length ? `Semua akun aktif · ${active.length} akun` : "Belum ada akun"} />
        {byType.map(({ t, n, sum }) => <KpiCard key={t} label={ACCOUNT_TYPE_LABEL[t]} icon={TYPE_ICON[t]} value={formatIDR(sum)} negative={sum < 0} caption={`${n} akun`} />)}
      </div>
      <AccountsManager accounts={active} archived={archived} today={todayWIB()} />
    </>
  );
}
