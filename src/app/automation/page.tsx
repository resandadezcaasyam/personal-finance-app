import { PageHeader } from "@/components/page-header";
import { AutomationManager } from "@/components/automation/automation-manager";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { listCategories } from "@/lib/ledger/categories";
import { detectPatterns, listPlanned, listRules } from "@/lib/automation/recurring";
import { todayWIB } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function AutomationPage() {
  const db = getDb();
  const today = todayWIB();
  const accounts = listAccounts(db);
  const categories = listCategories(db, { includeArchived: true });
  const name = (id: number) => accounts.find((a) => a.id === id)?.name ?? "—";
  const cat = (id: number | null) => (id ? categories.find((c) => c.id === id)?.name ?? null : null);
  const patterns = detectPatterns(db, today).map((p) => ({ ...p, account_name: name(p.account_id), category_name: cat(p.category_id) }));
  return (
    <>
      <PageHeader title="Aturan Otomasi" description="Transaksi yang berulang (gaji, sewa, arisan) disiapkan sebagai jadwal dan Anda tinggal mengonfirmasi. Tidak ada yang tercatat otomatis, jadi saldo selalu mencerminkan hal yang benar-benar terjadi." />
      <AutomationManager planned={listPlanned(db, today)} rules={listRules(db)} patterns={patterns} accounts={accounts} categories={categories} today={today} />
    </>
  );
}
