import { describe, it, expect } from "vitest";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { loadForecastContext, actualCashHistory, saveScenario, listScenarios, deleteScenario, clampParams, horizonDays } from "@/lib/forecast/data";
import { runForecast, PRESETS } from "@/lib/forecast/engine";
import { createRecurringIncome } from "@/lib/ledger/recurring";
import { createTransaction } from "@/lib/ledger/transactions";
import { createTransfer } from "@/lib/ledger/transfers";
import { reconcileAccount } from "@/lib/ledger/reconcile";
import { findCategoryId } from "@/lib/ledger/categories";
import { archiveAccount, getBalance } from "@/lib/ledger/accounts";
import { createDebt, recordDebtPayment } from "@/lib/debts/debts";
import { createBill, payBill } from "@/lib/bills/bills";
import { createInboxItems } from "@/lib/inbox/inbox";
import { LedgerError } from "@/lib/ledger/errors";

const T = { today: TODAY };
function setup() {
  const db = memDb();
  const { bca, gopay } = twoAccounts(db, 5_000_000, 500_000);
  return { db, bca, gopay };
}
const rule = (db: ReturnType<typeof memDb>, bca: number, o: Partial<Parameters<typeof createRecurringIncome>[1]> = {}) =>
  createRecurringIncome(db, { name: "Gaji", amount: 9_000_000, account_id: bca, category_id: findCategoryId(db, "Gaji", "income"), frequency: "monthly", day_of_month: 25, start_date: "2026-01-25", ...o });
const exp = (db: ReturnType<typeof memDb>, account: number, amount: number, date: string) =>
  createTransaction(db, { type: "expense", account_id: account, category_id: null, amount, occurred_on: date, description: "x" }, T);
const COUNTS = `SELECT (SELECT COUNT(*) FROM transactions)||'|'||(SELECT COUNT(*) FROM transfers)||'|'||(SELECT COUNT(*) FROM debt_payments)||'|'||(SELECT COUNT(*) FROM bill_payments)||'|'||(SELECT COUNT(*) FROM installment_schedules WHERE amount_paid>0)||'|'||(SELECT COUNT(*) FROM audit_logs) AS c`;

describe("loading real data", () => {
  it("opening cash is the sum of ACTIVE account balances", () => {
    const { db, bca, gopay } = setup();
    expect(loadForecastContext(db, { today: TODAY }).input.openingCash).toBe(5_500_000);
    reconcileAccount(db, { account_id: gopay, actual_balance: 0, occurred_on: TODAY }, T);
    archiveAccount(db, gopay);
    expect(loadForecastContext(db, { today: TODAY }).input.openingCash).toBe(5_000_000);
    void bca;
  });

  it("an installment that has been paid is not projected again; the unpaid remainder is", () => {
    const { db, bca } = setup();
    const debt = createDebt(db, { provider: "SeaBank", model: "none", principal: 672_000, count: 3, start_date: "2026-10-01", first_due_date: "2026-11-25", payment_account_id: bca });
    const before = runForecast(loadForecastContext(db, { today: TODAY }).input, PRESETS.baseline, 90);
    expect(before.summary.totalInstallments).toBe(672_000);
    recordDebtPayment(db, { debt_id: debt, account_id: bca, amount: 224_000, paid_on: TODAY }, T);
    const after = runForecast(loadForecastContext(db, { today: TODAY }).input, PRESETS.baseline, 90);
    expect(after.summary.openingCash).toBe(5_500_000 - 224_000);
    expect(after.summary.totalInstallments).toBe(448_000); // 672k - paid 224k, exactly once
    expect(after.events.filter((e) => e.kind === "installment").map((e) => e.label)).toEqual(["SeaBank #2/3", "SeaBank #3/3"]);
    // a partial payment on the next row leaves only the remainder
    recordDebtPayment(db, { debt_id: debt, account_id: bca, amount: 100_000, paid_on: TODAY }, T);
    expect(runForecast(loadForecastContext(db, { today: TODAY }).input, PRESETS.baseline, 90).summary.totalInstallments).toBe(348_000);
  });

  it("settled and cancelled debts contribute nothing", () => {
    const { db, bca } = setup();
    const debt = createDebt(db, { provider: "X", model: "none", principal: 100_000, count: 1, start_date: "2026-10-01", first_due_date: "2026-11-25", payment_account_id: bca });
    recordDebtPayment(db, { debt_id: debt, account_id: bca, amount: 100_000, paid_on: TODAY }, T);
    expect(runForecast(loadForecastContext(db, { today: TODAY }).input, PRESETS.baseline, 90).summary.totalInstallments).toBe(0);
  });

  it("a paid bill moves to its next occurrence; paying early does not leave a stale projection", () => {
    const { db, bca } = setup();
    const id = createBill(db, { name: "Internet", kind: "bill", category_id: null, account_id: bca, amount: 350_000, frequency: "monthly", next_due_date: "2026-11-22", remind_days: 3 });
    const f = () => runForecast(loadForecastContext(db, { today: TODAY }).input, PRESETS.baseline, 75).events.filter((e) => e.kind === "bill").map((e) => e.date);
    expect(f()).toEqual(["2026-11-22", "2026-12-22", "2027-01-22"]);
    payBill(db, { bill_id: id, account_id: bca, amount: 350_000, paid_on: TODAY }, T); // early
    expect(f()).toEqual(["2026-12-22", "2027-01-22"]);
  });

  it("variable bills are estimated from the last paid amounts; never-paid ones are flagged", () => {
    const { db, bca } = setup();
    const id = createBill(db, { name: "Listrik", kind: "bill", category_id: null, account_id: bca, amount: null, frequency: "monthly", next_due_date: "2026-09-23", remind_days: 3 });
    expect(runForecast(loadForecastContext(db, { today: TODAY }).input, PRESETS.baseline, 30).assumptions.unknownBills).toEqual(["Listrik"]);
    payBill(db, { bill_id: id, account_id: bca, amount: 400_000, paid_on: "2026-09-23" }, T);
    payBill(db, { bill_id: id, account_id: bca, amount: 500_000, paid_on: "2026-10-23" }, T);
    const ctx = loadForecastContext(db, { today: TODAY });
    expect(ctx.input.bills[0].estimate).toBe(450_000);
    const r = runForecast(ctx.input, PRESETS.baseline, 30);
    expect(r.events.find((e) => e.kind === "bill")).toMatchObject({ date: "2026-11-23", amount: 450_000, uncertain: true });
  });

  it("income rules come from recurring_rules; inactive ones are ignored", () => {
    const { db, bca } = setup();
    const id = rule(db, bca);
    expect(runForecast(loadForecastContext(db, { today: TODAY }).input, PRESETS.baseline, 30).summary.totalIncome).toBe(9_000_000);
    db.prepare("UPDATE recurring_rules SET is_active = 0 WHERE id = ?").run(id);
    expect(runForecast(loadForecastContext(db, { today: TODAY }).input, PRESETS.baseline, 30).summary.totalIncome).toBe(0);
  });
});

describe("habitual spending baseline", () => {
  it("excludes debt payments, bill payments, transfers and adjustments; includes everyday expenses", () => {
    const { db, bca, gopay } = setup();
    exp(db, bca, 300_000, "2026-11-01");
    exp(db, bca, 100_000, "2026-11-20");
    const debt = createDebt(db, { provider: "SeaBank", model: "none", principal: 500_000, count: 1, start_date: "2026-10-01", first_due_date: "2026-11-10", payment_account_id: bca });
    recordDebtPayment(db, { debt_id: debt, account_id: bca, amount: 500_000, paid_on: "2026-11-10" }, T);
    const bill = createBill(db, { name: "Internet", kind: "bill", category_id: null, account_id: bca, amount: 350_000, frequency: "monthly", next_due_date: "2026-11-05", remind_days: 3 });
    payBill(db, { bill_id: bill, account_id: bca, amount: 350_000, paid_on: "2026-11-05" }, T);
    createTransfer(db, { from_account_id: bca, to_account_id: gopay, amount: 1_000_000, occurred_on: "2026-11-12" }, T);
    reconcileAccount(db, { account_id: bca, actual_balance: 100_000, occurred_on: "2026-11-15" }, T); // big downward adjustment
    const ctx = loadForecastContext(db, { today: TODAY });
    // history starts at the first expense (Nov 1): 20 days; only 300k + 100k are habitual
    expect(ctx.baseline).toMatchObject({ days: 20, total: 400_000, perDay: 20_000, from: "2026-11-01" });
  });
  it("uses at most the last 90 days", () => {
    const { db, bca } = setup();
    exp(db, bca, 5_000_000, "2026-01-05"); // far outside the window
    exp(db, bca, 90_000, "2026-11-19");
    const ctx = loadForecastContext(db, { today: TODAY });
    expect(ctx.baseline.days).toBe(90);
    expect(ctx.baseline.total).toBe(90_000);
    expect(ctx.baseline.perDay).toBe(1_000);
  });
  it("warns about missing or short history and missing income rules", () => {
    const { db, bca } = setup();
    expect(loadForecastContext(db, { today: TODAY }).warnings.join(" ")).toMatch(/Belum ada riwayat pengeluaran/);
    exp(db, bca, 10_000, "2026-11-18");
    const w = loadForecastContext(db, { today: TODAY }).warnings.join(" ");
    expect(w).toMatch(/baru 3 hari/);
    expect(w).toMatch(/pemasukan berulang/);
  });
});

describe("pending inbox items are not actuals", () => {
  it("do not change opening cash, history or projections, but are flagged", () => {
    const { db, bca } = setup();
    const a = runForecast(loadForecastContext(db, { today: TODAY }).input, PRESETS.baseline, 30);
    createInboxItems(db, [{ type: "expense", amount: 2_000_000, occurred_on: "2026-11-19", description: "BELUM DISETUJUI", account_id: bca, category_id: null, source_kind: "csv" }], { today: TODAY });
    const ctx = loadForecastContext(db, { today: TODAY });
    expect(ctx.pendingInbox).toBe(1);
    expect(ctx.warnings.join(" ")).toMatch(/1 item di Kotak Masuk belum disetujui/);
    expect(JSON.stringify(runForecast(ctx.input, PRESETS.baseline, 30))).toBe(JSON.stringify(a));
  });
});

describe("the forecast never writes to actual tables", () => {
  it("leaves every ledger/debt/bill table and the audit log untouched", () => {
    const { db, bca } = setup();
    rule(db, bca);
    createDebt(db, { provider: "SeaBank", model: "none", principal: 300_000, count: 2, start_date: "2026-10-01", first_due_date: "2026-11-25", payment_account_id: bca });
    createBill(db, { name: "Internet", kind: "bill", category_id: null, account_id: bca, amount: 350_000, frequency: "monthly", next_due_date: "2026-11-22", remind_days: 3 });
    exp(db, bca, 50_000, "2026-11-10");
    const before = (db.prepare(COUNTS).get() as { c: string }).c;
    const balance = getBalance(db, bca);
    for (const m of [1, 3, 6, 12]) { const ctx = loadForecastContext(db, { today: TODAY }); for (const p of Object.values(PRESETS)) runForecast(ctx.input, p, horizonDays(TODAY, m)); }
    actualCashHistory(db, TODAY, 30);
    expect((db.prepare(COUNTS).get() as { c: string }).c).toBe(before);
    expect(getBalance(db, bca)).toBe(balance);
  });
});

describe("actual cash history (solid line on the chart)", () => {
  it("reconstructs end-of-day totals from the ledger and ends at the current total", () => {
    const { db, bca, gopay } = setup(); // 5.5jt
    exp(db, bca, 100_000, "2026-11-18");
    createTransaction(db, { type: "income", account_id: bca, category_id: null, amount: 1_000_000, occurred_on: "2026-11-19", description: "x" }, T);
    createTransfer(db, { from_account_id: bca, to_account_id: gopay, amount: 400_000, occurred_on: "2026-11-19" }, T); // nets to zero
    const h = actualCashHistory(db, TODAY, 5);
    expect(h).toHaveLength(6);
    const by = Object.fromEntries(h.map((x) => [x.date, x.balance]));
    expect(by[TODAY]).toBe(5_500_000 - 100_000 + 1_000_000);
    expect(by["2026-11-19"]).toBe(by[TODAY]);
    expect(by["2026-11-18"]).toBe(by[TODAY] - 1_000_000);
    expect(by["2026-11-17"]).toBe(5_500_000);
  });
  it("a voided transaction never appears, and a transfer to an archived account changes the active total", () => {
    const { db, bca, gopay } = setup();
    const id = exp(db, bca, 100_000, "2026-11-18");
    db.prepare("UPDATE transactions SET status='voided' WHERE id=?").run(id);
    createTransfer(db, { from_account_id: gopay, to_account_id: bca, amount: 500_000, occurred_on: "2026-11-19" }, T);
    archiveAccount(db, gopay); // gopay is now 0 and archived
    const h = actualCashHistory(db, TODAY, 3);
    const by = Object.fromEntries(h.map((x) => [x.date, x.balance]));
    expect(by[TODAY]).toBe(5_500_000);
    expect(by["2026-11-18"]).toBe(5_000_000); // the history is the total of accounts that are active NOW; the 500k that moved in from the archived account was not part of it
  });
});

describe("saved scenarios", () => {
  it("saves assumptions plus a snapshot, lists, rejects duplicate names, and deletes", () => {
    const { db } = setup();
    const r = runForecast(loadForecastContext(db, { today: TODAY }).input, PRESETS.baseline, 30);
    const params = clampParams({ income_pct: 80, spending_pct: 120, bills_pct: 100, income_delay_days: 5, buffer: 500_000 });
    const id = saveScenario(db, "Gaji telat", params, r);
    expect(listScenarios(db)).toMatchObject([{ id, name: "Gaji telat", params }]);
    expect(() => saveScenario(db, "gaji TELAT", params, r)).toThrow(/Sudah ada/);
    expect(() => saveScenario(db, " ", params, r)).toThrow(LedgerError);
    expect(JSON.parse((db.prepare("SELECT result FROM simulation_scenarios").get() as { result: string }).result)).toMatchObject({ closing: r.summary.closingCash, horizonDays: 30 });
    deleteScenario(db, id);
    expect(listScenarios(db)).toEqual([]);
  });
  it("clamps wild parameters to safe ranges and falls back for junk", () => {
    expect(clampParams({ income_pct: 9999, spending_pct: -5, bills_pct: NaN, income_delay_days: 99, buffer: -1 })).toEqual({ income_pct: 200, spending_pct: 0, bills_pct: 100, income_delay_days: 30, buffer: 0 });
  });
});

describe("horizons", () => {
  it("1/3/6/12 months in days, with month-end clamping", () => {
    expect(horizonDays("2026-11-20", 1)).toBe(30);
    expect(horizonDays("2026-11-20", 12)).toBe(365);
    expect(horizonDays("2026-01-31", 1)).toBe(28);
  });
});
