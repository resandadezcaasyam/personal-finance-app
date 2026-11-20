import { Repeat, CalendarClock, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
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
  const planned = listPlanned(db, today);
  const rules = listRules(db);
  return (
    <>
      <PageHeader title="Aturan Otomasi" description="Transaksi yang berulang (gaji, sewa, arisan) disiapkan sebagai jadwal dan Anda tinggal mengonfirmasi. Tidak ada yang tercatat otomatis, jadi saldo selalu mencerminkan hal yang benar-benar terjadi." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard emphasis label="Menunggu keputusan" icon={CalendarClock} value={String(planned.filter((p) => p.state !== "upcoming").length)} negative={planned.some((p) => p.state === "overdue")} caption={`${planned.length} jadwal dalam 7 hari ke depan`} />
        <KpiCard label="Aturan aktif" icon={Repeat} value={String(rules.filter((r) => r.is_active).length)} caption={`${rules.length} aturan tersimpan`} />
        <KpiCard label="Pola terdeteksi" icon={Wand2} value={String(patterns.length)} caption={patterns.length ? "Saran dari riwayat Anda, perlu persetujuan" : "Belum ada pola berulang"} />
      </div>
      <AutomationManager planned={planned} rules={rules} patterns={patterns} accounts={accounts} categories={categories} today={today} />
    </>
  );
}
