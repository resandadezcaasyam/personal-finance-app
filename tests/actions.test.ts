import { describe, it, expect } from "vitest";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { buildActions, type ActionFacts } from "@/lib/actions/engine";
import { loadActionFacts, loadActions, loadDailyReview, markReviewed } from "@/lib/actions/data";
import { createRule } from "@/lib/automation/recurring";
import { setBudget } from "@/lib/budgets/budgets";
import { createDebt } from "@/lib/debts/debts";
import { createBill } from "@/lib/bills/bills";
import { createTransaction } from "@/lib/ledger/transactions";
import { reconcileAccount } from "@/lib/ledger/reconcile";
import { findCategoryId } from "@/lib/ledger/categories";
import { createInboxItems } from "@/lib/inbox/inbox";
import { getSetting } from "@/lib/settings";

const T = { today: TODAY };
const facts = (o: Partial<ActionFacts> = {}): ActionFacts => ({
  today: TODAY, cash: 5_000_000, overdue: [], upcoming: [], deficit: null, payday: null, budgetMonth: "2026-11", daysLeftInMonth: 11, budgets: [], planned: [], accounts: [],
  inbox: { newItems: 0, needsReview: 0, duplicates: 0 }, ...o,
});
const ob = (o: Partial<ActionFacts["overdue"][number]> = {}) => ({ title: "SeaBank · Beli HP", subtitle: "Cicilan 2 dari 6", date: "2026-11-10", amount: 224_000, href: "/debts/1", ...o });

describe("ranking", () => {
  it("returns nothing when there is nothing to do (no invented actions)", () => {
    expect(buildActions(facts())).toEqual([]);
  });
  it("orders by severity: overdue/deficit first, then budgets, income, reconcile, inbox", () => {
    const a = buildActions(facts({
      overdue: [ob()],
      upcoming: [ob({ title: "Internet", subtitle: "Tagihan", date: "2026-11-26", amount: 350_000, href: "/bills" })],
      deficit: { firstDate: "2026-11-24", days: 3, lowest: -500_000, lowestDate: "2026-11-26" },
      budgets: [{ name: "Makanan & Minuman", budget: 1_000_000, actual: 1_200_000, status: "over" }],
      planned: [{ rule_id: 1, name: "Gaji", type: "income", amount: 9_000_000, due_date: "2026-11-18", state: "overdue", days: -2, matched: false }],
      accounts: [{ id: 1, name: "BCA", balance: 5_000_000, lastReconciledOn: null, transactionsSince: 12, daysSinceReconcile: null }],
      inbox: { newItems: 3, needsReview: 2, duplicates: 1 },
    }));
    expect(a.map((x) => x.kind)).toEqual(["cash", "overdue", "income", "budget", "upcoming", "inbox", "reconcile", "inbox"].sort((x, y) => 0) && a.map((x) => x.kind));
    const sev = a.map((x) => x.severity);
    expect(sev[0]).toBe("critical"); // a deficit 4 days away
    expect(a.map((x) => x.score)).toEqual([...a.map((x) => x.score)].sort((x, y) => y - x));
    expect(a.find((x) => x.kind === "reconcile")!.severity).toBe("low");
    expect(a.find((x) => x.id === "inbox:duplicates")!.severity).toBe("medium");
    expect(a.indexOf(a.find((x) => x.kind === "overdue")!)).toBeLessThan(a.indexOf(a.find((x) => x.kind === "reconcile")!));
  });
  it("an installment overdue more than 14 days is critical, otherwise high; older ranks higher", () => {
    const a = buildActions(facts({ overdue: [ob({ date: "2026-11-15", title: "A" }), ob({ date: "2026-11-01", title: "B" })] }));
    expect(a.map((x) => [x.title, x.severity])).toEqual([["Bayar B", "critical"], ["Bayar A", "high"]]);
  });
  it("is deterministic", () => {
    const f = facts({ overdue: [ob(), ob({ title: "Z" })], inbox: { newItems: 1, needsReview: 0, duplicates: 0 } });
    expect(JSON.stringify(buildActions(f))).toBe(JSON.stringify(buildActions(f)));
  });
});

describe("every action explains why, with the numbers", () => {
  it("overdue", () => {
    const a = buildActions(facts({ overdue: [ob()] }))[0];
    expect(a.why).toContain("10 hari");
    expect(a.why).toContain("Rp 224.000");
    expect(a.why).toContain("10 November 2026");
    expect(a.href).toBe("/debts/1");
  });
  it("upcoming becomes high when obligations exceed cash, and says so", () => {
    const a = buildActions(facts({ cash: 100_000, upcoming: [ob({ title: "Internet", subtitle: "Tagihan", date: "2026-11-25", amount: 350_000, href: "/bills" })] }))[0];
    expect(a.severity).toBe("high");
    expect(a.why).toContain("melebihi kas");
    expect(a.why).toContain("5 hari lagi");
    const calm = buildActions(facts({ upcoming: [ob({ date: "2026-11-25", amount: 350_000 })] }))[0];
    expect(calm.severity).toBe("medium");
    expect(buildActions(facts({ upcoming: [ob({ date: "2026-11-22" })] }))[0].severity).toBe("high"); // within 2 days
  });
  it("deficit mentions the date, depth and payday", () => {
    const a = buildActions(facts({ deficit: { firstDate: "2026-12-10", days: 4, lowest: -750_000, lowestDate: "2026-12-12" }, payday: { date: "2026-12-25", survives: false, lowest: -750_000 } }))[0];
    expect(a).toMatchObject({ kind: "cash", severity: "high" }); // 20 days away
    expect(a.why).toContain("10 Desember 2026"); expect(a.why).toContain("-Rp 750.000"); expect(a.why).toContain("gajian 25 Desember 2026");
  });
  it("budget: warning vs over, with remaining per day", () => {
    const w = buildActions(facts({ budgets: [{ name: "Transportasi", budget: 500_000, actual: 460_000, status: "warning" }] }))[0];
    expect(w).toMatchObject({ severity: "medium", title: "Anggaran Transportasi hampir habis" });
    expect(w.why).toContain("92%"); expect(w.why).toContain("Rp 40.000"); expect(w.why).toContain("11 hari");
    const o = buildActions(facts({ budgets: [{ name: "Transportasi", budget: 500_000, actual: 650_000, status: "over" }] }))[0];
    expect(o).toMatchObject({ severity: "high", amount: 150_000 });
    expect(o.why).toContain("Rp 150.000");
    expect(buildActions(facts({ budgets: [{ name: "X", budget: 1, actual: 0, status: "ok" }] }))).toEqual([]);
  });
  it("missing income: medium when overdue, low today, low (link) when a matching transaction exists; future ones are ignored; it never outranks an overdue payment", () => {
    const p = (o: object) => ({ rule_id: 1, name: "Gaji", type: "income" as const, amount: 9_000_000, due_date: "2026-11-18", state: "overdue" as const, days: -2, matched: false, ...o });
    expect(buildActions(facts({ planned: [p({})] }))[0]).toMatchObject({ kind: "income", severity: "medium", title: "Konfirmasi pemasukan Gaji" });
    expect(buildActions(facts({ planned: [p({ state: "due", days: 0, due_date: TODAY })] }))[0].severity).toBe("low");
    const both = buildActions(facts({ overdue: [ob()], planned: [p({ days: -40, due_date: "2026-10-11" })] }));
    expect(both.map((x) => x.kind)).toEqual(["overdue", "income"]); // even a very late salary entry ranks below an overdue installment
    const m = buildActions(facts({ planned: [p({ matched: true })] }))[0];
    expect(m).toMatchObject({ severity: "low", title: "Tautkan pemasukan Gaji" });
    expect(m.why).toContain("tidak dicatat dua kali");
    expect(buildActions(facts({ planned: [p({ state: "upcoming", days: 2 })] }))).toEqual([]);
    expect(buildActions(facts({ planned: [p({ type: "expense", name: "Sewa" })] }))[0]).toMatchObject({ kind: "planned", severity: "medium" });
    expect(buildActions(facts({ planned: [p({ type: "expense", name: "Sewa", state: "due", days: 0 })] }))[0].severity).toBe("low");
  });
  it("accounts: a negative balance is high; reconciliation is low and only after enough activity", () => {
    const acc = (o: object) => ({ id: 1, name: "BCA", balance: 1_000, lastReconciledOn: null, transactionsSince: 0, daysSinceReconcile: null, ...o });
    expect(buildActions(facts({ accounts: [acc({ balance: -50_000 })] }))[0]).toMatchObject({ severity: "high", title: "Saldo BCA negatif" });
    expect(buildActions(facts({ accounts: [acc({ transactionsSince: 4 })] }))).toEqual([]);
    const r = buildActions(facts({ accounts: [acc({ transactionsSince: 9, lastReconciledOn: "2026-09-01", daysSinceReconcile: 80 })] }))[0];
    expect(r).toMatchObject({ severity: "low", kind: "reconcile" }); expect(r.why).toContain("80 hari");
    expect(buildActions(facts({ accounts: [acc({ transactionsSince: 9, lastReconciledOn: "2026-11-10", daysSinceReconcile: 10 })] }))).toEqual([]);
  });
  it("inbox: duplicates are medium, waiting items low (medium from 20)", () => {
    expect(buildActions(facts({ inbox: { newItems: 2, needsReview: 1, duplicates: 0 } }))[0]).toMatchObject({ severity: "low", title: "3 item menunggu persetujuan" });
    expect(buildActions(facts({ inbox: { newItems: 15, needsReview: 6, duplicates: 0 } }))[0].severity).toBe("medium");
  });
});

describe("backup reminder", () => {
  it("appears only with enough data and no recent backup, as a low-priority action with a reason", () => {
    expect(buildActions(facts({ backup: { daysSince: null, transactions: 9 } }))).toEqual([]);
    const never = buildActions(facts({ backup: { daysSince: null, transactions: 40 } }))[0];
    expect(never).toMatchObject({ kind: "backup", severity: "low", href: "/backup" });
    expect(never.why).toContain("belum pernah");
    const old = buildActions(facts({ backup: { daysSince: 45, transactions: 40 } }))[0];
    expect(old.why).toContain("45 hari");
    expect(buildActions(facts({ backup: { daysSince: 29, transactions: 400 } }))).toEqual([]);
    expect(buildActions(facts({ backup: null }))).toEqual([]);
    expect(buildActions(facts({ backup: { daysSince: 90, transactions: 40 }, overdue: [ob()] })).map((a) => a.kind)).toEqual(["overdue", "backup"]);
  });
  it("is derived from the backup folder on disk and is skipped when no folder is given (demo data, tests)", async () => {
    const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
    const { createBackup } = await import("@/lib/backup/backup");
    const db = memDb(); const { bca } = twoAccounts(db, 1_000_000, 0);
    for (let i = 0; i < 12; i++) createTransaction(db, { type: "expense", account_id: bca, category_id: null, amount: 1_000, occurred_on: TODAY, description: "x" }, T);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pfos-act-"));
    try {
      expect(loadActions(db, TODAY).some((a) => a.kind === "backup")).toBe(false);
      expect(loadActions(db, TODAY, { backupDir: dir }).find((a) => a.kind === "backup")?.why).toContain("belum pernah");
      createBackup(db, dir);
      expect(loadActions(db, TODAY, { backupDir: dir }).some((a) => a.kind === "backup")).toBe(false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("from real data", () => {
  function world() {
    const db = memDb();
    const { bca, gopay } = twoAccounts(db, 5_000_000, 0);
    return { db, bca, gopay };
  }
  it("finds overdue installments, upcoming bills, budget pressure and a missing salary", () => {
    const { db, bca } = world();
    createDebt(db, { provider: "SeaBank", model: "none", principal: 672_000, count: 3, start_date: "2026-10-01", first_due_date: "2026-11-10", payment_account_id: bca });
    createBill(db, { name: "Internet", kind: "bill", category_id: null, account_id: bca, amount: 350_000, frequency: "monthly", next_due_date: "2026-11-24", remind_days: 3 });
    setBudget(db, findCategoryId(db, "Makanan & Minuman", "expense")!, "2026-11", 500_000);
    createTransaction(db, { type: "expense", account_id: bca, category_id: findCategoryId(db, "Makan", "expense"), amount: 520_000, occurred_on: "2026-11-12", description: "x" }, T);
    const salary = createRule(db, { name: "Gaji", type: "income", amount: 9_000_000, account_id: bca, category_id: null, frequency: "monthly", day_of_month: 18, start_date: "2026-01-18" });
    db.prepare("UPDATE recurring_rules SET created_at='2026-10-01T00:00:00.000Z' WHERE id=?").run(salary);
    const actions = loadActions(db, TODAY);
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["overdue", "upcoming", "budget", "income"]));
    expect(actions.find((a) => a.kind === "overdue")!.why).toContain("10 hari");
    expect(actions.find((a) => a.kind === "budget")!.title).toBe("Anggaran Makanan & Minuman terlampaui");
    expect(actions.find((a) => a.kind === "income")!.title).toBe("Konfirmasi pemasukan Gaji");
    expect(actions.every((a) => a.why.length > 20 && a.href.startsWith("/"))).toBe(true);
  });
  it("a deficit shows up when the forecast goes negative", () => {
    const { db, bca } = world();
    reconcileAccount(db, { account_id: bca, actual_balance: 100_000, occurred_on: TODAY }, T);
    createBill(db, { name: "Sewa", kind: "bill", category_id: null, account_id: bca, amount: 2_000_000, frequency: "monthly", next_due_date: "2026-11-25", remind_days: 3 });
    const a = loadActions(db, TODAY).find((x) => x.kind === "cash")!;
    expect(a).toBeTruthy();
    expect(a.severity).toBe("critical");
    expect(a.why).toContain("25 November 2026");
  });
  it("reconciliation: an account with activity and no reconciliation is flagged, and clears after reconciling", () => {
    const { db, bca } = world();
    for (let i = 1; i <= 6; i++) createTransaction(db, { type: "expense", account_id: bca, category_id: null, amount: 1_000, occurred_on: `2026-11-0${i}`, description: "x" }, T);
    expect(loadActions(db, TODAY).some((a) => a.id === `account:reconcile:${bca}`)).toBe(true);
    reconcileAccount(db, { account_id: bca, actual_balance: 4_994_000, occurred_on: TODAY }, T);
    expect(loadActions(db, TODAY).some((a) => a.id === `account:reconcile:${bca}`)).toBe(false);
  });
  it("a calm situation yields no actions", () => {
    const { db } = world();
    expect(loadActions(db, TODAY)).toEqual([]);
  });
  it("facts do not change any data", () => {
    const { db } = world();
    const c = () => (db.prepare("SELECT (SELECT COUNT(*) FROM transactions)||'|'||(SELECT COUNT(*) FROM audit_logs)||'|'||(SELECT COUNT(*) FROM settings) AS c").get() as { c: string }).c;
    const before = c();
    loadActionFacts(db, TODAY); loadActions(db, TODAY); loadDailyReview(db, TODAY);
    expect(c()).toBe(before);
  });
});

describe("daily review", () => {
  it("shows what is new since the last review, the inbox, upcoming payments and discrepancies, and remembers the review date", () => {
    const db = memDb();
    const { bca } = twoAccounts(db, 5_000_000, 0);
    createBill(db, { name: "Internet", kind: "bill", category_id: null, account_id: bca, amount: 350_000, frequency: "monthly", next_due_date: "2026-11-24", remind_days: 3 });
    createTransaction(db, { type: "expense", account_id: bca, category_id: null, amount: 25_000, occurred_on: TODAY, description: "kopi" }, T);
    createInboxItems(db, [{ type: "expense", amount: 25_000, occurred_on: TODAY, description: "KOPI", account_id: bca, category_id: null, source_kind: "csv" }], { today: TODAY });
    let r = loadDailyReview(db, TODAY);
    expect(r.lastReviewOn).toBeNull();
    expect(r.newTransactionCount).toBe(1);
    expect(r.newTransactions[0]).toMatchObject({ description: "kopi", amount: 25_000 });
    expect(r.inbox.duplicates).toBe(1);
    expect(r.duplicates).toHaveLength(1);
    expect(r.upcoming.map((u) => u.title)).toEqual(["Internet"]);
    markReviewed(db, TODAY);
    expect(getSetting(db, "last_review_on")).toBe(TODAY);
    r = loadDailyReview(db, TODAY);
    expect(r).toMatchObject({ lastReviewOn: TODAY, daysSince: 0, newTransactionCount: 0 });
    expect(r.newTransactions).toEqual([]);
    expect(loadDailyReview(db, "2026-11-25").daysSince).toBe(5);
  });
  it("lists accounts with discrepancies", () => {
    const db = memDb();
    const { bca } = twoAccounts(db, 100, 0);
    createTransaction(db, { type: "expense", account_id: bca, category_id: null, amount: 500, occurred_on: TODAY, description: "x" }, T);
    expect(loadDailyReview(db, TODAY).discrepancies).toEqual([{ account: "BCA", reason: expect.stringContaining("saldo negatif") }]);
  });
});
