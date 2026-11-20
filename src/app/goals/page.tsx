import { PageHeader } from "@/components/page-header";
import { GoalsManager } from "@/components/goals/goals-manager";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { emergencyFundHint, listContributions, listGoals } from "@/lib/goals/goals";
import { loadForecastContext } from "@/lib/forecast/data";
import { todayWIB } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function GoalsPage() {
  const db = getDb();
  const today = todayWIB();
  const goals = listGoals(db, today);
  const histories = Object.fromEntries(goals.map((g) => [g.id, listContributions(db, g.id)]));
  const hint = emergencyFundHint(loadForecastContext(db, { today }).baseline.perDay);
  return (
    <>
      <PageHeader title="Target Tabungan" description="Dana darurat, liburan, pembelian besar, atau target lain. Dana yang Anda catat adalah uang yang disisihkan; saldo akun Anda tidak berubah." />
      <GoalsManager goals={goals} histories={histories} accounts={listAccounts(db)} today={today} hint={hint} />
    </>
  );
}
