import { describe, it, expect } from "vitest";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { createBill, payBill, skipBill, voidBillPayment, listBills, listBillPayments, nextOccurrence, billStatus, setBillActive } from "@/lib/bills/bills";
import { getBalance } from "@/lib/ledger/accounts";
import { voidTransaction, listLedger } from "@/lib/ledger/transactions";
import { monthTotals } from "@/lib/ledger/summary";
import { listObligations } from "@/lib/obligations";
import { findCategoryId } from "@/lib/ledger/categories";
import { LedgerError } from "@/lib/ledger/errors";

const T = { today: TODAY };
function setup(over: Partial<Parameters<typeof createBill>[1]> = {}) {
  const db = memDb();
  const { bca } = twoAccounts(db, 2_000_000, 0);
  const id = createBill(db, { name: "Internet", kind: "bill", category_id: findCategoryId(db, "Internet", "expense"), account_id: bca, amount: 350_000, frequency: "monthly", next_due_date: "2026-11-25", remind_days: 3, ...over });
  return { db, bca, id };
}

describe("recurrence", () => {
  it("computes the next due date, keeping the anchor day", () => {
    expect(nextOccurrence("2026-11-25", "monthly", 25)).toBe("2026-12-25");
    expect(nextOccurrence("2026-02-28", "monthly", 31)).toBe("2026-03-31");
    expect(nextOccurrence("2026-11-25", "weekly", null)).toBe("2026-12-02");
    expect(nextOccurrence("2026-11-25", "quarterly", 25)).toBe("2027-02-25");
    expect(nextOccurrence("2026-11-25", "yearly", 25)).toBe("2027-11-25");
    expect(nextOccurrence("2026-11-25", "once", null)).toBeNull();
  });
  it("derives statuses from the due date and reminder window", () => {
    const b = { is_active: 1, remind_days: 3 };
    expect(billStatus({ ...b, next_due_date: "2026-11-19" }, TODAY)).toBe("overdue");
    expect(billStatus({ ...b, next_due_date: "2026-11-20" }, TODAY)).toBe("due_soon");
    expect(billStatus({ ...b, next_due_date: "2026-11-23" }, TODAY)).toBe("due_soon");
    expect(billStatus({ ...b, next_due_date: "2026-11-24" }, TODAY)).toBe("upcoming");
    expect(billStatus({ is_active: 0, remind_days: 3, next_due_date: "2026-11-24" }, TODAY)).toBe("inactive");
  });
});

describe("paying bills", () => {
  it("posts one expense, advances the due date, and cannot be paid twice for the same due date", () => {
    const { db, bca, id } = setup();
    const r = payBill(db, { bill_id: id, account_id: bca, amount: 350_000, paid_on: TODAY }, T);
    expect(getBalance(db, bca)).toBe(1_650_000);
    expect(monthTotals(db, "2026-11").expense).toBe(350_000);
    expect(listBills(db, TODAY)[0].next_due_date).toBe("2026-12-25");
    expect(listBills(db, TODAY)[0].last_paid_on).toBe(TODAY);
    expect(db.prepare("SELECT source, bill_id FROM transactions WHERE id = ?").get(r.transactionId)).toEqual({ source: "bill_payment", bill_id: id });
    // a second pay now settles the NEXT occurrence (Dec 25), never Nov 25 again
    payBill(db, { bill_id: id, account_id: bca, amount: 350_000, paid_on: TODAY }, T);
    expect(listBills(db, TODAY)[0].next_due_date).toBe("2027-01-25");
    const dues = listBillPayments(db).map((p) => p.due_date).sort();
    expect(dues).toEqual(["2026-11-25", "2026-12-25"]);
  });

  it("the database refuses a duplicate posting for one occurrence", () => {
    const { db, bca, id } = setup();
    payBill(db, { bill_id: id, account_id: bca, amount: 100, paid_on: TODAY }, T);
    db.prepare("UPDATE bills SET next_due_date='2026-11-25' WHERE id=?").run(id); // simulate a stale double-submit
    expect(() => payBill(db, { bill_id: id, account_id: bca, amount: 100, paid_on: TODAY }, T)).toThrow(/sudah diselesaikan/);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 1 });
  });

  it("variable bills need the amount at payment time", () => {
    const { db, bca, id } = setup({ name: "Listrik", amount: null });
    expect(listBills(db, TODAY)[0].is_variable).toBe(1);
    expect(() => payBill(db, { bill_id: id, account_id: bca, amount: 0, paid_on: TODAY }, T)).toThrow(LedgerError);
    payBill(db, { bill_id: id, account_id: bca, amount: 487_250, paid_on: TODAY }, T);
    expect(getBalance(db, bca)).toBe(2_000_000 - 487_250);
  });

  it("one-off bills finish after payment", () => {
    const { db, bca, id } = setup({ frequency: "once", name: "Pajak" });
    payBill(db, { bill_id: id, account_id: bca, amount: 1_000, paid_on: TODAY }, T);
    const b = listBills(db, TODAY)[0];
    expect(b).toMatchObject({ is_active: 0, next_due_date: null, status: "inactive" });
    expect(() => payBill(db, { bill_id: id, account_id: bca, amount: 1_000, paid_on: TODAY }, T)).toThrow(/tidak aktif/);
  });

  it("overdue bills are flagged and a late payment advances one period at a time", () => {
    const { db, bca, id } = setup({ next_due_date: "2026-09-25" });
    expect(listBills(db, TODAY)[0].status).toBe("overdue");
    payBill(db, { bill_id: id, account_id: bca, amount: 350_000, paid_on: TODAY }, T);
    expect(listBills(db, TODAY)[0]).toMatchObject({ next_due_date: "2026-10-25", status: "overdue" });
  });

  it("skipping an occurrence moves on without a ledger entry", () => {
    const { db, bca, id } = setup();
    skipBill(db, id);
    expect(listBills(db, TODAY)[0].next_due_date).toBe("2026-12-25");
    expect(getBalance(db, bca)).toBe(2_000_000);
    expect(listLedger(db, {}).total).toBe(0);
  });
});

describe("undoing bill payments", () => {
  it("restores the due date and the balance; only the latest can be undone", () => {
    const { db, bca, id } = setup();
    const p1 = payBill(db, { bill_id: id, account_id: bca, amount: 350_000, paid_on: TODAY }, T);
    const p2 = payBill(db, { bill_id: id, account_id: bca, amount: 350_000, paid_on: TODAY }, T);
    expect(() => voidBillPayment(db, p1.paymentId)).toThrow(/terbaru/);
    voidBillPayment(db, p2.paymentId);
    expect(listBills(db, TODAY)[0].next_due_date).toBe("2026-12-25");
    expect(getBalance(db, bca)).toBe(2_000_000 - 350_000);
    voidBillPayment(db, p1.paymentId);
    expect(listBills(db, TODAY)[0].next_due_date).toBe("2026-11-25");
    expect(getBalance(db, bca)).toBe(2_000_000);
    // and it can be paid again afterwards
    expect(() => payBill(db, { bill_id: id, account_id: bca, amount: 350_000, paid_on: TODAY }, T)).not.toThrow();
  });

  it("a paid bill's transaction cannot be voided from the ledger", () => {
    const { db, bca, id } = setup();
    const p = payBill(db, { bill_id: id, account_id: bca, amount: 350_000, paid_on: TODAY }, T);
    expect(() => voidTransaction(db, p.transactionId)).toThrow(/halaman tagihan/);
  });
});

describe("obligations feed", () => {
  it("lists the real next due date and projects later occurrences; inactive bills disappear", () => {
    const { db, id } = setup();
    const items = listObligations(db, { from: "2026-11-01", to: "2027-01-31", today: TODAY });
    expect(items.map((i) => [i.date, i.projected])).toEqual([["2026-11-25", false], ["2026-12-25", true], ["2027-01-25", true]]);
    setBillActive(db, id, false);
    expect(listObligations(db, { to: "2027-12-31", today: TODAY })).toHaveLength(0);
  });
});
