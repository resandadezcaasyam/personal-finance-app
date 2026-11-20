import { PiggyBank, Target, Percent, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { GoalsManager } from "@/components/goals/goals-manager";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { emergencyFundHint, listContributions, listGoals } from "@/lib/goals/goals";
import { loadForecastContext } from "@/lib/forecast/data";
import { formatIDR, todayWIB } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function GoalsPage() {
  const db = getDb();
  const today = todayWIB();
  const goals = listGoals(db, today);
  const histories = Object.fromEntries(goals.map((g) => [g.id, listContributions(db, g.id)]));
  const hint = emergencyFundHint(loadForecastContext(db, { today }).baseline.perDay);
  const live = goals.filter((g) => g.status !== "archived");
  const saved = live.reduce((t, g) => t + g.saved_amount, 0);
  const target = live.reduce((t, g) => t + g.target_amount, 0);
  const pct = target > 0 ? Math.round((saved / target) * 100) : 0;
  const done = live.filter((g) => g.status === "achieved").length;
  return (
    <>
      <PageHeader title="Target Tabungan" description="Dana darurat, liburan, pembelian besar, atau target lain. Dana yang Anda catat adalah uang yang disisihkan; saldo akun Anda tidak berubah." />
      {live.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard emphasis label="Total terkumpul" icon={PiggyBank} value={formatIDR(saved)} caption="Dana yang disisihkan (tidak mengubah saldo akun)" />
          <KpiCard label="Total target" icon={Target} value={formatIDR(target)} caption={`${live.length} target`} />
          <KpiCard label="Progres keseluruhan" icon={Percent} value={`${pct}%`} caption={`Sisa ${formatIDR(Math.max(0, target - saved))}`} />
          <KpiCard label="Target tercapai" icon={CheckCircle2} value={`${done} dari ${live.length}`} caption={done === live.length ? "Semua target tercapai" : "Terus catat dana yang disisihkan"} />
        </div>
      )}
      <GoalsManager goals={goals} histories={histories} accounts={listAccounts(db)} today={today} hint={hint} />
    </>
  );
}
