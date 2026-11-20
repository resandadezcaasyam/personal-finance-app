import { describe, it, expect, beforeAll } from "vitest";
import { memDb, TODAY } from "./helpers";
import { createAccount } from "@/lib/ledger/accounts";
import { listLedger } from "@/lib/ledger/transactions";
import { getDashboardSummary, monthTotals, spendingByCategory } from "@/lib/ledger/summary";
import { buildReport, resolvePeriod } from "@/lib/reports/reports";
import { loadForecastContext, horizonDays } from "@/lib/forecast/data";
import { runForecast, PRESETS } from "@/lib/forecast/engine";
import { getBudgetView } from "@/lib/budgets/budgets";
import { detectPatterns, listPlanned } from "@/lib/automation/recurring";
import { loadActions, loadDailyReview } from "@/lib/actions/data";
import { runIntegrityChecks } from "@/lib/db/integrity";
import { exportRows, buildReport as _b } from "@/lib/reports/reports";
import { exportAllData } from "@/lib/backup/backup";
import { listCategories } from "@/lib/ledger/categories";

/**
 * Large-ledger behavior: ~25,000 transactions over 3 years. The thresholds are deliberately generous (CI machines vary);
 * they exist to catch an accidental full-table scan or an N+1 query, not to benchmark.
 */
const N = 25_000;
let db: ReturnType<typeof memDb>;
const time = <T,>(label: string, fn: () => T, maxMs: number): T => {
  const t0 = performance.now(); const r = fn(); const ms = performance.now() - t0;
  console.log(`[perf] ${label}: ${ms.toFixed(1)} ms`);
  expect(ms, `${label} took ${ms.toFixed(0)} ms`).toBeLessThan(maxMs);
  return r;
};
const plan = (sql: string, ...params: unknown[]) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]).map((r) => r.detail).join(" | ");

beforeAll(() => {
  db = memDb();
  const accs = ["BCA", "GoPay", "Dompet", "Jago"].map((n, i) => createAccount(db, { name: n, type: i === 2 ? "cash" : "bank", initial_balance: 10_000_000 }));
  const cats = listCategories(db).filter((c) => c.kind === "expense").map((c) => c.id);
  const inc = listCategories(db).filter((c) => c.kind === "income").map((c) => c.id);
  const ins = db.prepare("INSERT INTO transactions (account_id, type, amount, category_id, occurred_on, description, merchant, source, source_ref, status) VALUES (?,?,?,?,?,?,?,?,?, 'posted')");
  const start = Date.parse("2023-11-21T00:00:00Z");
  db.transaction(() => {
    for (let i = 0; i < N; i++) {
      const day = new Date(start + Math.floor((i / N) * 1095) * 86_400_000).toISOString().slice(0, 10);
      const isInc = i % 25 === 0;
      ins.run(accs[i % accs.length], isInc ? "income" : "expense", 10_000 + (i * 7919) % 900_000, isInc ? inc[i % inc.length] : cats[i % cats.length], day, `transaksi ${i}`, i % 3 ? `merchant ${i % 200}` : null, "manual", null);
    }
  })();
  db.exec("ANALYZE");
});

describe(`a ledger with ${N.toLocaleString("id-ID")} transactions`, () => {
  it("lists a filtered, paged ledger quickly", () => {
    const p = time("listLedger page 1", () => listLedger(db, { pageSize: 50 } as never), 400);
    expect(p.rows.length).toBeGreaterThan(0);
    time("listLedger account+date filter", () => listLedger(db, { accountId: 1, from: "2025-01-01", to: "2025-06-30", pageSize: 50 } as never), 400);
    time("listLedger search", () => listLedger(db, { search: "merchant 17", pageSize: 50 } as never), 800);
  });
  it("computes the dashboard and monthly summaries quickly", () => {
    time("dashboard summary", () => getDashboardSummary(db, TODAY.slice(0, 7)), 500);
    time("month totals", () => monthTotals(db, TODAY.slice(0, 7)), 200);
    time("spending by category", () => spendingByCategory(db, TODAY.slice(0, 7)), 300);
  });
  it("builds a 12-month report and exports quickly", () => {
    const r = time("report 12m", () => buildReport(db, resolvePeriod({ preset: "12m" }, TODAY), TODAY), 1500);
    expect(r.totals.transactions).toBeGreaterThan(5000);
    time("report 24m", () => buildReport(db, resolvePeriod({ preset: "custom", from: "2024-11-21", to: TODAY }, TODAY), TODAY), 2500);
    time("export rows 12m", () => exportRows(db, resolvePeriod({ preset: "12m" }, TODAY)), 1500);
  });
  it("loads the forecast, budgets, automation and actions quickly", () => {
    time("forecast context + run", () => runForecast(loadForecastContext(db, { today: TODAY }).input, PRESETS.baseline, horizonDays(TODAY, 12)), 1500);
    time("budget view", () => getBudgetView(db, TODAY.slice(0, 7)), 300);
    time("planned occurrences", () => listPlanned(db, TODAY), 300);
    time("pattern detection", () => detectPatterns(db, TODAY), 1500);
    time("next actions", () => loadActions(db, TODAY), 2000);
    time("daily review", () => loadDailyReview(db, TODAY), 800);
  });
  it("runs the integrity checks and a full export in reasonable time", () => {
    const r = time("integrity checks", () => runIntegrityChecks(db), 3000);
    expect(r.ok).toBe(true);
    time("export all", () => exportAllData(db, { appVersion: "t", exportedOn: TODAY }), 5000);
  });
  it("uses indexes (no full scans) on the main access paths", () => {
    const p1 = plan("SELECT * FROM transactions WHERE account_id = 1 AND occurred_on BETWEEN '2025-01-01' AND '2025-02-01' AND status = 'posted'");
    expect(p1).toMatch(/USING (COVERING )?INDEX/);
    expect(p1).not.toMatch(/SCAN transactions/);
    const p2 = plan("SELECT SUM(amount) FROM transactions WHERE status='posted' AND type='expense' AND occurred_on BETWEEN '2026-11-01' AND '2026-11-30'");
    expect(p2).toMatch(/USING (COVERING )?INDEX/);
    const p3 = plan("SELECT * FROM transactions WHERE debt_payment_id = 5");
    expect(p3, "debt_payment_id lookups").not.toMatch(/SCAN transactions/);
    const p4 = plan("SELECT * FROM transactions WHERE bill_id = 5");
    expect(p4, "bill_id lookups").not.toMatch(/SCAN transactions/);
    const p5 = plan("SELECT COUNT(*) FROM transactions WHERE status='posted' AND created_at > '2999-01-01'"); // selective cutoff: every synthetic row is created "now"
    expect(p5, "created_at lookups").not.toMatch(/SCAN transactions/);
    const p6 = plan("SELECT * FROM installment_schedules WHERE debt_id = 3 ORDER BY sequence_no");
    expect(p6, "installments by debt").not.toMatch(/SCAN installment_schedules/);
    expect(plan("SELECT * FROM debt_payments WHERE debt_id = 3 ORDER BY paid_on"), "payments by debt").not.toMatch(/SCAN debt_payments/);
    expect(plan("SELECT SUM(amount) FROM transactions WHERE status='posted' AND type='expense' AND category_id = 4 AND occurred_on >= '2026-01-01'"), "category over time").toMatch(/USING (COVERING )?INDEX idx_tx_category_date/);
  });
});
void _b;
