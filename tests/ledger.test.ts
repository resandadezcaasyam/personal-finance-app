import { describe, it, expect } from "vitest";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { getBalance, listAccounts, createAccount, updateAccount, archiveAccount, restoreAccount } from "@/lib/ledger/accounts";
import { createTransaction, updateTransaction, voidTransaction, listLedger } from "@/lib/ledger/transactions";
import { createTransfer, voidTransfer } from "@/lib/ledger/transfers";
import { reconcileAccount } from "@/lib/ledger/reconcile";
import { monthTotals, spendingByCategory, getDashboardSummary } from "@/lib/ledger/summary";
import { findCategoryId, createCategory } from "@/lib/ledger/categories";
import { LedgerError } from "@/lib/ledger/errors";

const T = { today: TODAY };
const exp = (db: ReturnType<typeof memDb>, account_id: number, amount: number, extra: Record<string, unknown> = {}) =>
  createTransaction(db, { type: "expense", account_id, category_id: null, amount, occurred_on: "2026-11-10", description: "x", ...extra }, T);
const inc = (db: ReturnType<typeof memDb>, account_id: number, amount: number) =>
  createTransaction(db, { type: "income", account_id, category_id: null, amount, occurred_on: "2026-11-01", description: "gaji" }, T);

describe("balances", () => {
  it("income increases and expense decreases the correct account only", () => {
    const db = memDb();
    const { bca, gopay } = twoAccounts(db, 1_000_000, 100_000);
    inc(db, bca, 9_500_000);
    exp(db, bca, 250_000);
    expect(getBalance(db, bca)).toBe(1_000_000 + 9_500_000 - 250_000);
    expect(getBalance(db, gopay)).toBe(100_000);
  });

  it("voided transactions stop affecting the balance but stay on record", () => {
    const db = memDb();
    const { bca } = twoAccounts(db);
    const id = exp(db, bca, 300_000);
    expect(getBalance(db, bca)).toBe(700_000);
    voidTransaction(db, id);
    expect(getBalance(db, bca)).toBe(1_000_000);
    expect(db.prepare("SELECT status FROM transactions WHERE id=?").get(id)).toEqual({ status: "voided" });
    voidTransaction(db, id); // idempotent
    expect(getBalance(db, bca)).toBe(1_000_000);
  });

  it("editing recalculates: amount, account and date moves", () => {
    const db = memDb();
    const { bca, gopay } = twoAccounts(db, 1_000_000, 500_000);
    const id = exp(db, bca, 100_000);
    updateTransaction(db, id, { account_id: bca, category_id: null, amount: 250_000, occurred_on: "2026-11-10", description: "x" }, T);
    expect(getBalance(db, bca)).toBe(750_000);
    updateTransaction(db, id, { account_id: gopay, category_id: null, amount: 250_000, occurred_on: "2026-11-11", description: "x" }, T);
    expect(getBalance(db, bca)).toBe(1_000_000);
    expect(getBalance(db, gopay)).toBe(250_000);
  });

  it("changing the initial balance shifts the derived balance and is audited", () => {
    const db = memDb();
    const { bca } = twoAccounts(db, 1_000_000);
    exp(db, bca, 100_000);
    updateAccount(db, bca, { name: "BCA", type: "bank", initial_balance: 2_000_000 });
    expect(getBalance(db, bca)).toBe(1_900_000);
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE entity='account' AND action='update'").get()).toEqual({ c: 1 });
  });
});

describe("transfers", () => {
  it("move money between accounts without creating income or expense", () => {
    const db = memDb();
    const { bca, gopay } = twoAccounts(db, 1_000_000, 0);
    createTransfer(db, { from_account_id: bca, to_account_id: gopay, amount: 400_000, occurred_on: "2026-11-05" }, T);
    expect(getBalance(db, bca)).toBe(600_000);
    expect(getBalance(db, gopay)).toBe(400_000);
    expect(monthTotals(db, "2026-11")).toEqual({ income: 0, expense: 0, net: 0 });
    expect(listAccounts(db).reduce((s, a) => s + a.balance, 0)).toBe(1_000_000);
  });

  it("charge the fee once, as an expense paid by the source account", () => {
    const db = memDb();
    const { bca, gopay } = twoAccounts(db, 1_000_000, 0);
    const id = createTransfer(db, { from_account_id: bca, to_account_id: gopay, amount: 400_000, fee: 2_500, occurred_on: "2026-11-05" }, T);
    expect(getBalance(db, bca)).toBe(1_000_000 - 400_000 - 2_500);
    expect(getBalance(db, gopay)).toBe(400_000);
    expect(monthTotals(db, "2026-11").expense).toBe(2_500);
    voidTransfer(db, id);
    expect(getBalance(db, bca)).toBe(1_000_000);
    expect(getBalance(db, gopay)).toBe(0);
    expect(monthTotals(db, "2026-11").expense).toBe(0);
  });

  it("reject same-account and archived-account transfers", () => {
    const db = memDb();
    const { bca, gopay } = twoAccounts(db, 0, 0);
    expect(() => createTransfer(db, { from_account_id: bca, to_account_id: bca, amount: 1, occurred_on: "2026-11-05" }, T)).toThrow(LedgerError);
    archiveAccount(db, gopay);
    expect(() => createTransfer(db, { from_account_id: bca, to_account_id: gopay, amount: 1, occurred_on: "2026-11-05" }, T)).toThrow(/diarsipkan/);
  });

  it("appear once in the history of both accounts", () => {
    const db = memDb();
    const { bca, gopay } = twoAccounts(db, 1_000_000, 0);
    createTransfer(db, { from_account_id: bca, to_account_id: gopay, amount: 100_000, occurred_on: "2026-11-05" }, T);
    expect(listLedger(db, { accountId: bca, type: "transfer" }).total).toBe(1);
    expect(listLedger(db, { accountId: gopay, type: "transfer" }).total).toBe(1);
  });
});

describe("reconciliation", () => {
  it("posts a traceable adjustment that is neither income nor expense", () => {
    const db = memDb();
    const { bca } = twoAccounts(db, 1_000_000);
    const r = reconcileAccount(db, { account_id: bca, actual_balance: 950_000, occurred_on: TODAY, note: "cek mobile banking" }, T);
    expect(r).toMatchObject({ adjusted: true, difference: -50_000 });
    expect(getBalance(db, bca)).toBe(950_000);
    expect(monthTotals(db, "2026-11")).toEqual({ income: 0, expense: 0, net: 0 });
    const audit = db.prepare("SELECT * FROM audit_logs WHERE action='reconcile'").all();
    expect(audit).toHaveLength(1);
    const up = reconcileAccount(db, { account_id: bca, actual_balance: 1_000_000, occurred_on: TODAY }, T);
    expect(up.difference).toBe(50_000);
    expect(getBalance(db, bca)).toBe(1_000_000);
  });

  it("does nothing when balances already match", () => {
    const db = memDb();
    const { bca } = twoAccounts(db, 1_000_000);
    expect(reconcileAccount(db, { account_id: bca, actual_balance: 1_000_000, occurred_on: TODAY }, T)).toEqual({ adjusted: false, difference: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 0 });
  });

  it("adjustments cannot be edited but can be voided", () => {
    const db = memDb();
    const { bca } = twoAccounts(db, 1_000_000);
    const r = reconcileAccount(db, { account_id: bca, actual_balance: 900_000, occurred_on: TODAY }, T);
    expect(() => updateTransaction(db, r.transactionId!, { account_id: bca, category_id: null, amount: 5, occurred_on: TODAY, description: "" }, T)).toThrow(LedgerError);
    voidTransaction(db, r.transactionId!);
    expect(getBalance(db, bca)).toBe(1_000_000);
  });

  it("the database refuses an adjustment without a direction", () => {
    const db = memDb();
    const { bca } = twoAccounts(db);
    expect(() => db.prepare("INSERT INTO transactions (account_id,type,amount,occurred_on) VALUES (?,?,?,?)").run(bca, "adjustment", 5, "2026-11-01")).toThrow(/adj_direction/);
  });
});

describe("validation rules", () => {
  it("rejects future dates, zero/negative/float amounts and unknown accounts", () => {
    const db = memDb();
    const { bca } = twoAccounts(db);
    expect(() => exp(db, bca, 100, { occurred_on: "2026-11-21" })).toThrow(/masa depan/);
    expect(() => exp(db, bca, 0)).toThrow(LedgerError);
    expect(() => exp(db, bca, -5)).toThrow(LedgerError);
    expect(() => exp(db, bca, 10.5)).toThrow(LedgerError);
    expect(() => exp(db, 999, 100)).toThrow(/tidak ditemukan/);
    expect(() => exp(db, bca, 100, { occurred_on: "2026-02-30" })).toThrow(/tidak valid/);
  });

  it("requires the category kind to match the transaction type", () => {
    const db = memDb();
    const { bca } = twoAccounts(db);
    const salary = findCategoryId(db, "Gaji", "income")!;
    expect(() => exp(db, bca, 100, { category_id: salary })).toThrow(/bukan kategori pengeluaran/);
  });

  it("an account can be archived only at zero balance, then restored", () => {
    const db = memDb();
    const { bca } = twoAccounts(db, 100);
    expect(() => archiveAccount(db, bca)).toThrow(/Rp 0/);
    reconcileAccount(db, { account_id: bca, actual_balance: 0, occurred_on: TODAY }, T);
    archiveAccount(db, bca);
    expect(listAccounts(db, { archived: false }).map((a) => a.name)).toEqual(["GoPay"]);
    restoreAccount(db, bca);
    expect(listAccounts(db, { archived: false })).toHaveLength(2);
  });

  it("rejects duplicate active account names but allows reuse after archiving", () => {
    const db = memDb();
    const { gopay } = twoAccounts(db, 0, 0);
    expect(() => createAccount(db, { name: "gopay", type: "ewallet", initial_balance: 0 })).toThrow(/nama tersebut/);
    archiveAccount(db, gopay);
    expect(() => createAccount(db, { name: "GoPay", type: "ewallet", initial_balance: 0 })).not.toThrow();
  });

  it("blocks a second posting with the same source reference (idempotent imports)", () => {
    const db = memDb();
    const { bca } = twoAccounts(db);
    exp(db, bca, 100, { source: "csv", source_ref: "REF-1" });
    expect(() => exp(db, bca, 100, { source: "csv", source_ref: "REF-1" })).toThrow(/sama sudah tercatat/);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 1 });
  });
});

describe("listing and reporting", () => {
  function seeded() {
    const db = memDb();
    const { bca, gopay } = twoAccounts(db, 1_000_000, 0);
    const kopi = findCategoryId(db, "Kopi", "expense")!;
    const listrik = findCategoryId(db, "Listrik", "expense")!;
    exp(db, bca, 25_000, { category_id: kopi, description: "Kopi pagi", merchant: "Fore Coffee", tags: "Harian, #Kantor", occurred_on: "2026-11-03" });
    exp(db, bca, 450_000, { category_id: listrik, description: "Token", merchant: "PLN", occurred_on: "2026-11-08" });
    exp(db, gopay, 30_000, { description: "100% promo_test", occurred_on: "2026-10-30" });
    inc(db, bca, 9_500_000);
    createTransfer(db, { from_account_id: bca, to_account_id: gopay, amount: 200_000, occurred_on: "2026-11-09" }, T);
    return { db, bca, gopay, kopi };
  }

  it("filters by search text, merchant, tag, type, account, category and date range", () => {
    const { db, bca, gopay } = seeded();
    expect(listLedger(db, { q: "fore" }).total).toBe(1);
    expect(listLedger(db, { q: "kantor" }).total).toBe(1);
    expect(listLedger(db, { q: "kopi" }).total).toBe(1);
    expect(listLedger(db, { q: "100%" }).total).toBe(1); // LIKE wildcards are escaped
    expect(listLedger(db, { q: "promo_test" }).total).toBe(1);
    expect(listLedger(db, { q: "%" }).total).toBe(1);
    expect(listLedger(db, { type: "income" }).total).toBe(1);
    expect(listLedger(db, { type: "transfer" }).total).toBe(1);
    expect(listLedger(db, { accountId: gopay }).total).toBe(2); // one expense + one incoming transfer
    expect(listLedger(db, { accountId: bca, from: "2026-11-05", to: "2026-11-30" }).total).toBe(2); // Nov 8 expense + Nov 9 transfer
  });

  it("filtering by a parent category includes its subcategories", () => {
    const { db } = seeded();
    const food = findCategoryId(db, "Makanan & Minuman", "expense")!;
    expect(listLedger(db, { categoryId: food }).total).toBe(1);
  });

  it("sorts and paginates deterministically", () => {
    const { db } = seeded();
    const byAmount = listLedger(db, { sort: "amount_desc", pageSize: 2 });
    expect(byAmount.rows.map((r) => r.amount)).toEqual([9_500_000, 450_000]);
    expect(byAmount.total).toBe(5);
    expect(listLedger(db, { sort: "amount_desc", pageSize: 2, page: 3 }).rows).toHaveLength(1);
    const dates = listLedger(db, { sort: "date_asc" }).rows.map((r) => r.occurred_on);
    expect([...dates].sort()).toEqual(dates);
  });

  it("hides voided rows by default and shows them on request", () => {
    const { db, bca } = seeded();
    const id = exp(db, bca, 1_000);
    voidTransaction(db, id);
    expect(listLedger(db, {}).rows.some((r) => r.id === id && r.src === "tx")).toBe(false);
    expect(listLedger(db, { includeVoided: true }).rows.some((r) => r.id === id && r.status === "voided")).toBe(true);
  });

  it("month totals ignore transfers, adjustments and other months; spending groups by top-level category", () => {
    const { db, bca } = seeded();
    reconcileAccount(db, { account_id: bca, actual_balance: 1, occurred_on: TODAY }, T);
    expect(monthTotals(db, "2026-11")).toEqual({ income: 9_500_000, expense: 475_000, net: 9_025_000 });
    expect(spendingByCategory(db, "2026-11")).toEqual([
      { name: "Tagihan & Utilitas", total: 450_000 },
      { name: "Makanan & Minuman", total: 25_000 },
    ]);
  });

  it("dashboard total cash equals the sum of active account balances", () => {
    const { db } = seeded();
    const s = getDashboardSummary(db, "2026-11");
    expect(s.totalCash).toBe(1_000_000 + 9_500_000 - 505_000); // includes the Oct expense: cash is not month-scoped
    expect(s.recent.length).toBeGreaterThan(0);
  });
});

describe("categories", () => {
  it("ships Indonesian defaults and allows custom subcategories (one level)", () => {
    const db = memDb();
    const food = findCategoryId(db, "Makanan & Minuman", "expense")!;
    const id = createCategory(db, { name: "Jajan", kind: "expense", parent_id: food });
    expect(() => createCategory(db, { name: "Es", kind: "expense", parent_id: id })).toThrow(/satu tingkat/);
    expect(() => createCategory(db, { name: "Jajan", kind: "expense", parent_id: food })).toThrow(/sudah ada/);
    expect(() => createCategory(db, { name: "X", kind: "income", parent_id: food })).toThrow(/sama dengan/);
  });
});
