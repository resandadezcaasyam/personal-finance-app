import { describe, it, expect } from "vitest";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { getBudgetView, setBudget, copyBudgets, statusOf, previousMonthOf } from "@/lib/budgets/budgets";
import { createGoal, updateGoal, addContribution, removeContribution, setGoalArchived, deleteGoal, listGoals, listContributions, emergencyFundHint } from "@/lib/goals/goals";
import { createTransaction } from "@/lib/ledger/transactions";
import { createTransfer } from "@/lib/ledger/transfers";
import { reconcileAccount } from "@/lib/ledger/reconcile";
import { findCategoryId } from "@/lib/ledger/categories";
import { getBalance } from "@/lib/ledger/accounts";
import { monthTotals } from "@/lib/ledger/summary";
import { LedgerError } from "@/lib/ledger/errors";

const T = { today: TODAY };
function setup() { const db = memDb(); const { bca, gopay } = twoAccounts(db, 5_000_000, 500_000); return { db, bca, gopay }; }
const spend = (db: ReturnType<typeof memDb>, acc: number, amount: number, date: string, cat: string | null) =>
  createTransaction(db, { type: "expense", account_id: acc, category_id: cat ? findCategoryId(db, cat, "expense") : null, amount, occurred_on: date, description: "x" }, T);

describe("budgets", () => {
  it("compares budget with actual per top-level category, rolling subcategories up (never double counting)", () => {
    const { db, bca } = setup();
    const food = findCategoryId(db, "Makanan & Minuman", "expense")!;
    setBudget(db, food, "2026-11", 1_000_000);
    spend(db, bca, 300_000, "2026-11-03", "Kopi");            // subcategory
    spend(db, bca, 200_000, "2026-11-05", "Makanan & Minuman"); // the parent itself
    spend(db, bca, 99_000, "2026-10-30", "Kopi");               // other month
    const v = getBudgetView(db, "2026-11");
    const line = v.lines.find((l) => l.category_id === food)!;
    expect(line).toMatchObject({ budget: 1_000_000, actual: 500_000, remaining: 500_000, pct: 0.5, status: "ok" });
    expect(v.totalBudget).toBe(1_000_000);
    expect(v.totalActualBudgeted).toBe(500_000);
    expect(v.totalActual).toBe(500_000);
  });
  it("flags warning at 90% and over beyond 100%, and reports unbudgeted and uncategorized spending", () => {
    const { db, bca } = setup();
    const trans = findCategoryId(db, "Transportasi", "expense")!;
    setBudget(db, trans, "2026-11", 200_000);
    spend(db, bca, 180_000, "2026-11-01", "Ojek Online");
    expect(getBudgetView(db, "2026-11").lines[0].status).toBe("warning");
    spend(db, bca, 30_000, "2026-11-02", "BBM");
    expect(getBudgetView(db, "2026-11").lines.find((l) => l.category_id === trans)).toMatchObject({ actual: 210_000, remaining: -10_000, status: "over" });
    spend(db, bca, 70_000, "2026-11-03", "Belanja");
    spend(db, bca, 5_000, "2026-11-04", null);
    const v = getBudgetView(db, "2026-11");
    expect(v.lines.find((l) => l.name === "Belanja")).toMatchObject({ budget: null, actual: 70_000, status: "none" });
    expect(v.uncategorized).toBe(5_000);
    expect(v.totalActual).toBe(285_000);
  });
  it("statusOf boundaries", () => {
    expect(statusOf(null, 5)).toBe("none");
    expect(statusOf(100, 89)).toBe("ok");
    expect(statusOf(100, 90)).toBe("warning");
    expect(statusOf(100, 100)).toBe("warning");
    expect(statusOf(100, 101)).toBe("over");
    expect(statusOf(0, 0)).toBe("ok");
    expect(statusOf(0, 1)).toBe("over");
  });
  it("transfers, adjustments and voided expenses never count as spending; totals match the ledger", () => {
    const { db, bca, gopay } = setup();
    spend(db, bca, 100_000, "2026-11-02", "Kopi");
    const v = spend(db, bca, 50_000, "2026-11-03", "Kopi");
    db.prepare("UPDATE transactions SET status='voided' WHERE id=?").run(v);
    createTransfer(db, { from_account_id: bca, to_account_id: gopay, amount: 1_000_000, fee: 2_500, occurred_on: "2026-11-04" }, T);
    reconcileAccount(db, { account_id: bca, actual_balance: 100, occurred_on: "2026-11-05" }, T);
    const view = getBudgetView(db, "2026-11");
    expect(view.totalActual).toBe(monthTotals(db, "2026-11").expense); // 100k + the 2.5k transfer fee
    expect(view.totalActual).toBe(102_500);
  });
  it("only top-level expense categories can be budgeted; blank clears; zero is allowed; values validated", () => {
    const { db } = setup();
    const food = findCategoryId(db, "Makanan & Minuman", "expense")!;
    expect(() => setBudget(db, findCategoryId(db, "Kopi", "expense")!, "2026-11", 1)).toThrow(/kategori utama/);
    expect(() => setBudget(db, findCategoryId(db, "Gaji", "income")!, "2026-11", 1)).toThrow(/pengeluaran/);
    expect(() => setBudget(db, food, "2026-13", 1)).toThrow(/Bulan/);
    expect(() => setBudget(db, food, "2026-11", -5)).toThrow(LedgerError);
    expect(() => setBudget(db, 999, "2026-11", 5)).toThrow(/tidak ditemukan/);
    setBudget(db, food, "2026-11", 0);
    expect(getBudgetView(db, "2026-11").lines[0]).toMatchObject({ budget: 0, status: "ok" });
    setBudget(db, food, "2026-11", 500_000); setBudget(db, food, "2026-11", 600_000);
    expect(db.prepare("SELECT COUNT(*) c, MAX(amount) a FROM budgets").get()).toEqual({ c: 1, a: 600_000 });
    setBudget(db, food, "2026-11", null);
    expect(db.prepare("SELECT COUNT(*) c FROM budgets").get()).toEqual({ c: 0 });
  });
  it("copies a month, keeping existing target budgets unless told to overwrite", () => {
    const { db } = setup();
    const a = findCategoryId(db, "Makanan & Minuman", "expense")!, b = findCategoryId(db, "Transportasi", "expense")!;
    setBudget(db, a, "2026-10", 1_000_000); setBudget(db, b, "2026-10", 400_000); setBudget(db, a, "2026-11", 900_000);
    expect(copyBudgets(db, "2026-10", "2026-11")).toEqual({ copied: 1, skipped: 1 });
    expect(getBudgetView(db, "2026-11").lines.map((l) => [l.name, l.budget]).sort()).toContainEqual(["Makanan & Minuman", 900_000]);
    expect(copyBudgets(db, "2026-10", "2026-11", { overwrite: true })).toEqual({ copied: 2, skipped: 0 });
    expect(() => copyBudgets(db, "2026-09", "2026-11")).toThrow(/belum punya/);
    expect(() => copyBudgets(db, "2026-10", "2026-10")).toThrow(/berbeda/);
    expect(previousMonthOf("2026-01")).toBe("2025-12");
  });
});

describe("savings goals", () => {
  it("tracks contributions and progress without touching any balance", () => {
    const { db, bca } = setup();
    const before = getBalance(db, bca);
    const id = createGoal(db, { name: "Dana darurat", kind: "emergency", target_amount: 10_000_000, target_date: "2027-11-20" }, T);
    addContribution(db, id, { amount: 2_000_000, contributed_on: "2026-10-20", account_id: bca }, T);
    addContribution(db, id, { amount: 1_000_000, contributed_on: "2026-11-10", note: "bonus" }, T);
    const g = listGoals(db, TODAY)[0];
    expect(g).toMatchObject({ saved_amount: 3_000_000, pct: 0.3, remaining: 7_000_000, status: "active", contributions: 2 });
    expect(getBalance(db, bca)).toBe(before);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 0 });
    expect(listContributions(db, id).map((c) => [c.amount, c.note])).toEqual([[1_000_000, "bonus"], [2_000_000, null]]);
  });
  it("derives pace, required monthly amount, projection and on-track status", () => {
    const { db } = setup();
    const id = createGoal(db, { name: "Laptop", kind: "purchase", target_amount: 12_000_000, target_date: "2027-05-20" }, T); // 6 months
    addContribution(db, id, { amount: 900_000, contributed_on: "2026-09-25" }, T);
    addContribution(db, id, { amount: 900_000, contributed_on: "2026-10-25" }, T);
    addContribution(db, id, { amount: 900_000, contributed_on: "2026-11-15" }, T);
    const g = listGoals(db, TODAY)[0];
    expect(g.avgPerMonth).toBe(900_000);                       // 2.7jt in 90 days / 3
    expect(g.requiredPerMonth).toBe(Math.ceil(9_300_000 / 6)); // 1.55jt
    expect(g.onTrack).toBe(false);                             // 9.3jt at 900k/month takes ~10.3 months
    expect(g.projectedDate! > "2027-05-20").toBe(true);
    addContribution(db, id, { amount: 6_000_000, contributed_on: "2026-11-16" }, T);
    expect(listGoals(db, TODAY)[0].onTrack).toBe(true);
  });
  it("is achieved automatically at the target, and active again after a withdrawal", () => {
    const { db } = setup();
    const id = createGoal(db, { name: "Liburan", kind: "travel", target_amount: 3_000_000, target_date: null }, T);
    addContribution(db, id, { amount: 3_000_000, contributed_on: TODAY }, T);
    expect(listGoals(db, TODAY)[0]).toMatchObject({ status: "achieved", remaining: 0, projectedDate: null, requiredPerMonth: null });
    addContribution(db, id, { amount: -500_000, contributed_on: TODAY, note: "tarik" }, T);
    expect(listGoals(db, TODAY)[0]).toMatchObject({ status: "active", saved_amount: 2_500_000 });
  });
  it("validates: no overdraw, no future dates, no zero amounts, no contributions to archived goals, no bad targets", () => {
    const { db, gopay } = setup();
    const id = createGoal(db, { name: "X", kind: "custom", target_amount: 1_000_000, target_date: null }, T);
    expect(() => addContribution(db, id, { amount: -1, contributed_on: TODAY }, T)).toThrow(/melebihi/);
    expect(() => addContribution(db, id, { amount: 1_000, contributed_on: "2026-11-21" }, T)).toThrow(/masa depan/);
    expect(() => addContribution(db, id, { amount: 0, contributed_on: TODAY }, T)).toThrow(LedgerError);
    expect(() => addContribution(db, id, { amount: 1.5, contributed_on: TODAY }, T)).toThrow(LedgerError);
    expect(() => addContribution(db, 999, { amount: 1_000, contributed_on: TODAY }, T)).toThrow(/tidak ditemukan/);
    expect(() => createGoal(db, { name: " ", kind: "custom", target_amount: 1, target_date: null }, T)).toThrow(LedgerError);
    expect(() => createGoal(db, { name: "a", kind: "custom", target_amount: 0, target_date: null }, T)).toThrow(LedgerError);
    expect(() => createGoal(db, { name: "a", kind: "custom", target_amount: 1, target_date: TODAY }, T)).toThrow(/setelah hari ini/);
    setGoalArchived(db, id, true);
    expect(() => addContribution(db, id, { amount: 1_000, contributed_on: TODAY }, T)).toThrow(/diarsipkan/);
    void gopay;
  });
  it("removing a contribution recomputes; deleting needs an empty goal; archive and restore keep the amount", () => {
    const { db } = setup();
    const id = createGoal(db, { name: "X", kind: "custom", target_amount: 1_000_000, target_date: null }, T);
    const c1 = addContribution(db, id, { amount: 400_000, contributed_on: TODAY }, T);
    const c2 = addContribution(db, id, { amount: -100_000, contributed_on: TODAY }, T);
    expect(() => removeContribution(db, c1)).toThrow(/negatif/); // would leave -100k
    removeContribution(db, c2);
    expect(listGoals(db, TODAY)[0].saved_amount).toBe(400_000);
    expect(() => deleteGoal(db, id)).toThrow(/Arsipkan/);
    setGoalArchived(db, id, true);
    expect(listGoals(db, TODAY)[0]).toMatchObject({ status: "archived", saved_amount: 400_000 });
    setGoalArchived(db, id, false);
    expect(listGoals(db, TODAY)[0].status).toBe("active");
    removeContribution(db, c1);
    deleteGoal(db, id);
    expect(listGoals(db, TODAY)).toEqual([]);
  });
  it("editing the target re-evaluates the status", () => {
    const { db } = setup();
    const id = createGoal(db, { name: "X", kind: "custom", target_amount: 1_000_000, target_date: null }, T);
    addContribution(db, id, { amount: 1_000_000, contributed_on: TODAY }, T);
    expect(listGoals(db, TODAY)[0].status).toBe("achieved");
    updateGoal(db, id, { name: "X", kind: "custom", target_amount: 2_000_000, target_date: null }, T);
    expect(listGoals(db, TODAY)[0]).toMatchObject({ status: "active", pct: 0.5 });
  });
  it("emergency fund hint is 3 and 6 months of habitual spending", () => {
    expect(emergencyFundHint(100_000)).toEqual({ months3: 9_000_000, months6: 18_000_000 });
  });
});
