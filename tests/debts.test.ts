import { describe, it, expect } from "vitest";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { createDebt, recordDebtPayment, voidDebtPayment, cancelDebt, getDebt, listSchedule, listDebtPayments, listDebts, updateDebtDetails } from "@/lib/debts/debts";
import { getBalance } from "@/lib/ledger/accounts";
import { updateTransaction, voidTransaction, listLedger } from "@/lib/ledger/transactions";
import { monthTotals } from "@/lib/ledger/summary";
import { getCommitmentsOverview, listObligations } from "@/lib/obligations";
import { LedgerError } from "@/lib/ledger/errors";

const T = { today: TODAY };

function setup(opts: Partial<Parameters<typeof createDebt>[1]> = {}) {
  const db = memDb();
  const { bca } = twoAccounts(db, 5_000_000, 0);
  const id = createDebt(db, { provider: "SeaBank", model: "none", principal: 900_000, count: 3, start_date: "2026-10-01", first_due_date: "2026-11-25", payment_account_id: bca, ...opts });
  return { db, bca, id };
}
const pay = (db: ReturnType<typeof memDb>, id: number, account_id: number, amount: number, extra: Record<string, unknown> = {}) =>
  recordDebtPayment(db, { debt_id: id, account_id, amount, paid_on: TODAY, ...extra }, T);

describe("debt creation", () => {
  it("stores a schedule that matches the configured terms", () => {
    const { db, id } = setup({ model: "flat", principal: 1_200_000, rate_bps: 200, count: 6, admin_fee: 30_000 });
    const d = getDebt(db, id, TODAY)!;
    const rows = listSchedule(db, id);
    expect(rows).toHaveLength(6);
    expect(d.total_obligation).toBe(1_200_000 + 144_000 + 30_000);
    expect(d.outstanding).toBe(d.total_obligation);
    expect(d.remaining_principal).toBe(1_200_000);
    expect(d.installment_count).toBe(6);
    expect(d.remaining_installments).toBe(6);
    expect(d.maturity_date).toBe(rows[5].due_date);
    expect(d.next_due_date).toBe("2026-11-25");
  });

  it("can start with installments already paid, without touching any balance", () => {
    const { db, bca, id } = setup({ already_paid_count: 1 });
    const d = getDebt(db, id, TODAY)!;
    expect(d.remaining_installments).toBe(2);
    expect(d.outstanding).toBe(600_000);
    expect(d.paid_rows).toBe(1);
    expect(getBalance(db, bca)).toBe(5_000_000);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 0 });
    expect(() => createDebt(db, { provider: "X", model: "none", principal: 100, count: 2, start_date: "2026-10-01", first_due_date: "2026-11-25", already_paid_count: 2 })).toThrow(LedgerError);
  });

  it("supports irregular manual schedules", () => {
    const { db, id } = setup({ model: "manual", count: undefined, principal: 1_000_000, admin_fee: 0, manual: [{ due_date: "2026-12-01", amount: 700_000 }, { due_date: "2027-03-15", amount: 400_000 }] });
    const d = getDebt(db, id, TODAY)!;
    expect(d.total_obligation).toBe(1_100_000);
    expect(d.interest_model).toBe("manual");
    expect(listSchedule(db, id).map((r) => r.due_date)).toEqual(["2026-12-01", "2027-03-15"]);
  });
});

describe("payments", () => {
  it("full payment reduces the debt and the account exactly once", () => {
    const { db, bca, id } = setup();
    const r = pay(db, id, bca, 300_000);
    expect(r.kind).toBe("regular");
    expect(getBalance(db, bca)).toBe(4_700_000);
    const d = getDebt(db, id, TODAY)!;
    expect(d.outstanding).toBe(600_000);
    expect(d.remaining_installments).toBe(2);
    expect(listLedger(db, {}).rows.filter((x) => x.source === "debt_payment")).toHaveLength(1);
    expect(monthTotals(db, "2026-11").expense).toBe(300_000);
  });

  it("partial payments accumulate on the same installment until it is complete", () => {
    const { db, bca, id } = setup();
    expect(pay(db, id, bca, 100_000).kind).toBe("partial");
    let rows = listSchedule(db, id);
    expect(rows[0]).toMatchObject({ amount_paid: 100_000, status: "partial" });
    pay(db, id, bca, 200_000);
    rows = listSchedule(db, id);
    expect(rows[0]).toMatchObject({ amount_paid: 300_000, status: "paid" });
    expect(rows[1].status).toBe("scheduled");
    expect(getBalance(db, bca)).toBe(5_000_000 - 300_000);
  });

  it("a late payment records the penalty and fee as extra cash out, not as principal", () => {
    const { db, bca, id } = setup({ first_due_date: "2026-10-25" }); // 26 days overdue
    expect(getCommitmentsOverview(db, TODAY).overdue.length).toBeGreaterThan(0);
    pay(db, id, bca, 300_000, { penalty: 15_000, fee: 2_500 });
    expect(getBalance(db, bca)).toBe(5_000_000 - 317_500);
    expect(getDebt(db, id, TODAY)!.outstanding).toBe(600_000); // penalty/fee do not reduce the obligation
    expect(monthTotals(db, "2026-11").expense).toBe(317_500);
    const p = listDebtPayments(db, id)[0];
    expect(p).toMatchObject({ amount: 300_000, penalty: 15_000, fee: 2_500 });
  });

  it("an early lump-sum payment spans installments; paying everything settles the debt", () => {
    const { db, bca, id } = setup();
    const r = pay(db, id, bca, 600_000);
    expect(r.allocations.map((a) => a.sequence_no)).toEqual([1, 2]);
    expect(r.kind).toBe("early");
    expect(listSchedule(db, id).map((x) => x.status)).toEqual(["paid", "paid", "scheduled"]);
    const s = pay(db, id, bca, 300_000);
    expect(s.debtSettled).toBe(true);
    expect(getDebt(db, id, TODAY)).toMatchObject({ status: "settled", outstanding: 0, remaining_installments: 0, remaining_principal: 0 });
    expect(() => pay(db, id, bca, 1)).toThrow(/sudah lunas/);
  });

  it("settling everything at once is flagged as a settlement", () => {
    const { db, bca, id } = setup();
    expect(pay(db, id, bca, 900_000).kind).toBe("settlement");
  });

  it("rejects overpayment, bad amounts, future dates and archived accounts", () => {
    const { db, bca, id } = setup();
    expect(() => pay(db, id, bca, 900_001)).toThrow(/melebihi sisa/);
    expect(() => pay(db, id, bca, 0)).toThrow(LedgerError);
    expect(() => pay(db, id, bca, 100, { paid_on: "2026-11-21" })).toThrow(/masa depan/);
    expect(() => pay(db, id, 999, 100)).toThrow(/tidak ditemukan/);
    expect(db.prepare("SELECT COUNT(*) c FROM debt_payments").get()).toEqual({ c: 0 }); // failed attempts leave nothing behind
    expect(getBalance(db, bca)).toBe(5_000_000);
  });

  it("principal is reduced only after fees and interest in each installment", () => {
    const { db, bca, id } = setup({ model: "flat", principal: 1_000_000, rate_bps: 500, count: 2 }); // interest 50k per row, principal 500k
    expect(getDebt(db, id, TODAY)!.remaining_principal).toBe(1_000_000);
    pay(db, id, bca, 50_000); // exactly row 1 interest
    expect(getDebt(db, id, TODAY)!.remaining_principal).toBe(1_000_000);
    pay(db, id, bca, 100_000); // row 1 has now received 150k: 50k interest, then 100k principal
    expect(getDebt(db, id, TODAY)!.remaining_principal).toBe(900_000);
  });
});

describe("voiding payments", () => {
  it("restores the schedule, debt status and account balance exactly", () => {
    const { db, bca, id } = setup();
    const p = pay(db, id, bca, 900_000);
    expect(getDebt(db, id, TODAY)!.status).toBe("settled");
    voidDebtPayment(db, p.paymentId);
    const d = getDebt(db, id, TODAY)!;
    expect(d).toMatchObject({ status: "active", outstanding: 900_000, remaining_installments: 3 });
    expect(listSchedule(db, id).map((x) => [x.amount_paid, x.status])).toEqual([[0, "scheduled"], [0, "scheduled"], [0, "scheduled"]]);
    expect(getBalance(db, bca)).toBe(5_000_000);
    expect(monthTotals(db, "2026-11").expense).toBe(0);
    voidDebtPayment(db, p.paymentId); // idempotent
    expect(getBalance(db, bca)).toBe(5_000_000);
  });

  it("only reverses the voided payment when several exist", () => {
    const { db, bca, id } = setup();
    const a = pay(db, id, bca, 100_000);
    pay(db, id, bca, 200_000);
    voidDebtPayment(db, a.paymentId);
    expect(listSchedule(db, id)[0]).toMatchObject({ amount_paid: 200_000, status: "partial" });
    expect(getBalance(db, bca)).toBe(5_000_000 - 200_000);
  });

  it("leaves installments paid at entry untouched", () => {
    const { db, bca, id } = setup({ already_paid_count: 1 });
    const p = pay(db, id, bca, 300_000);
    voidDebtPayment(db, p.paymentId);
    expect(listSchedule(db, id).map((x) => x.status)).toEqual(["paid", "scheduled", "scheduled"]);
  });
});

describe("ledger protection and cancellation", () => {
  it("the generic transaction editor cannot touch debt-payment rows", () => {
    const { db, bca, id } = setup();
    const p = pay(db, id, bca, 300_000);
    const tx = db.prepare("SELECT id FROM transactions WHERE debt_payment_id = ?").get(p.paymentId) as { id: number };
    expect(() => voidTransaction(db, tx.id)).toThrow(/halaman utang/);
    expect(() => updateTransaction(db, tx.id, { account_id: bca, category_id: null, amount: 1, occurred_on: TODAY, description: "x" }, T)).toThrow(/pembayaran cicilan/);
    expect(getBalance(db, bca)).toBe(4_700_000);
  });

  it("cancel works only without payments", () => {
    const { db, bca, id } = setup();
    pay(db, id, bca, 100_000);
    expect(() => cancelDebt(db, id)).toThrow(/sudah memiliki pembayaran/);
    const other = createDebt(db, { provider: "Salah input", model: "none", principal: 100_000, count: 1, start_date: "2026-11-01", first_due_date: "2026-12-01" });
    cancelDebt(db, other);
    expect(getDebt(db, other, TODAY)!.status).toBe("cancelled");
    expect(getCommitmentsOverview(db, TODAY).activeDebts.map((d) => d.id)).toEqual([id]);
  });

  it("metadata can be updated and is audited", () => {
    const { db, id } = setup();
    updateDebtDetails(db, id, { provider: "SeaBank Pinjam", label: "HP baru", notes: "n" });
    expect(getDebt(db, id, TODAY)).toMatchObject({ provider: "SeaBank Pinjam", label: "HP baru" });
    expect(db.prepare("SELECT COUNT(*) c FROM audit_logs WHERE entity='debt' AND action='update'").get()).toEqual({ c: 1 });
  });
});

describe("commitments overview", () => {
  it("reports outstanding, monthly totals, overdue, upcoming and completion from real schedules", () => {
    const db = memDb();
    const { bca } = twoAccounts(db, 5_000_000, 0);
    const a = createDebt(db, { provider: "A", model: "none", principal: 600_000, count: 2, start_date: "2026-09-01", first_due_date: "2026-10-25", payment_account_id: bca }); // Oct overdue, Nov upcoming
    createDebt(db, { provider: "B", model: "none", principal: 400_000, count: 2, start_date: "2026-11-01", first_due_date: "2026-11-28" }); // Nov 28, Dec 28
    const o = getCommitmentsOverview(db, TODAY);
    expect(o.totalOutstanding).toBe(1_000_000);
    expect(o.overdue.map((i) => [i.title, i.amount])).toEqual([["A", 300_000]]);
    expect(o.overdueTotal).toBe(300_000);
    expect(o.monthInstallmentTotal).toBe(300_000 + 200_000); // A#2 (Nov 25) + B#1 (Nov 28)
    expect(o.monthInstallmentPaid).toBe(0);
    expect(o.upcoming.map((i) => i.title)).toEqual(["A", "B"]); // Nov 25 and Nov 28; Dec 28 is beyond the 30-day window
    expect(o.completionPct).toBe(0);
    recordDebtPayment(db, { debt_id: a, account_id: bca, amount: 300_000, paid_on: TODAY }, T);
    const o2 = getCommitmentsOverview(db, TODAY);
    expect(o2.overdue).toHaveLength(0);
    expect(o2.monthInstallmentPaid).toBe(0); // the payment settled the October row, not a November one
    expect(o2.totalOutstanding).toBe(700_000);
    expect(o2.completionPct).toBe(25);
  });

  it("settled and cancelled debts never appear as obligations", () => {
    const { db, bca, id } = setup();
    pay(db, id, bca, 900_000);
    expect(listObligations(db, { to: "2030-01-01", today: TODAY })).toHaveLength(0);
    expect(listDebts(db, { today: TODAY, status: ["active"] })).toHaveLength(0);
  });
});

describe("month agenda (calendar and monthly view)", () => {
  it("shows installments in every state plus bills paid, due, overdue and projected", async () => {
    const { getMonthAgenda } = await import("@/lib/obligations");
    const { createBill, payBill } = await import("@/lib/bills/bills");
    const db = memDb();
    const { bca } = twoAccounts(db, 5_000_000, 0);
    const d = createDebt(db, { provider: "Kredivo", model: "none", principal: 900_000, count: 3, start_date: "2026-09-01", first_due_date: "2026-10-25", payment_account_id: bca }); // Oct, Nov, Dec
    recordDebtPayment(db, { debt_id: d, account_id: bca, amount: 300_000, paid_on: TODAY }, T); // settles October
    recordDebtPayment(db, { debt_id: d, account_id: bca, amount: 100_000, paid_on: TODAY }, T); // part of November
    const paid = createBill(db, { name: "Internet", kind: "bill", category_id: null, account_id: bca, amount: 350_000, frequency: "monthly", next_due_date: "2026-11-05", remind_days: 3 });
    payBill(db, { bill_id: paid, account_id: bca, amount: 350_000, paid_on: "2026-11-05" }, T);
    createBill(db, { name: "Sampah", kind: "bill", category_id: null, account_id: bca, amount: 25_000, frequency: "monthly", next_due_date: "2026-11-10", remind_days: 3 });

    const oct = getMonthAgenda(db, "2026-10", TODAY);
    expect(oct.map((i) => [i.title, i.status])).toEqual([["Kredivo", "paid"]]);
    const nov = getMonthAgenda(db, "2026-11", TODAY);
    expect(nov.map((i) => [i.date, i.title, i.status])).toEqual([
      ["2026-11-05", "Internet", "paid"], ["2026-11-10", "Sampah", "overdue"], ["2026-11-25", "Kredivo", "partial"],
    ]);
    const dec = getMonthAgenda(db, "2026-12", TODAY);
    expect(dec.map((i) => [i.title, i.status]).sort()).toEqual([["Internet", "due"], ["Kredivo", "due"], ["Sampah", "projected"]]); // Internet Dec 5 is its real next due date
  });
});
