import { describe, it, expect } from "vitest";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { computeSettlement, simulateEarlyRepayment, liquidityRisk, remainingParts, type DebtSim, type DebtRow, type RepayParams } from "@/lib/repay/simulate";
import { runStrategy, compareStrategies, impliedCostRatio } from "@/lib/repay/strategies";
import { loadRepayContext, saveRepayScenario, listRepayScenarios, duplicateRepayScenario, deleteRepayScenario, sanitizeStored, recordFullSettlement } from "@/lib/repay/data";
import { parseRepayQuery } from "@/lib/repay/query";
import { runForecast, PRESETS, type ForecastInput } from "@/lib/forecast/engine";
import { createDebt, getDebt, recordDebtPayment } from "@/lib/debts/debts";
import { createRecurringIncome } from "@/lib/ledger/recurring";
import { createTransaction } from "@/lib/ledger/transactions";
import { getBalance } from "@/lib/ledger/accounts";
import { findCategoryId } from "@/lib/ledger/categories";
import { LedgerError } from "@/lib/ledger/errors";

const T = { today: TODAY };
const BASE = PRESETS.baseline;
const row = (debt_id: number, seq: number, due: string, principal: number, interest: number, fee = 0): DebtRow => ({
  debt_id, sequence_no: seq, installment_count: 6, due_date: due, remaining: principal + interest + fee, fee_rem: fee, interest_rem: interest, principal_rem: principal,
});
// SeaBank: 6 x 224.000 (200rb pokok + 24rb bunga), due 5th of each month from 2026-12
const sea = (): DebtSim => ({ debt_id: 1, provider: "SeaBank", label: "", rate_bps: 200, rows: ["2026-12-05", "2027-01-05", "2027-02-05", "2027-03-05", "2027-04-05", "2027-05-05"].map((d, i) => row(1, i + 1, d, 200_000, 24_000)) });
const P = (o: Partial<RepayParams> = {}): RepayParams => ({ debt_id: 1, date: "2026-12-20", mode: "full", amount: null, quote: null, rebate_pct: 0, fee: 0, penalty: 0, ...o });
const input = (o: Partial<ForecastInput> = {}): ForecastInput => ({
  today: TODAY, openingCash: 10_000_000, incomeRules: [{ id: 1, name: "Gaji", amount: 5_000_000, frequency: "monthly", day_of_month: 25, start_date: "2026-01-25", end_date: null, category_name: "Gaji" }],
  recentIncome: [], installments: sea().rows.map((r) => ({ debt_id: 1, label: "SeaBank", sequence_no: r.sequence_no, installment_count: 6, due_date: r.due_date, remaining: r.remaining })),
  bills: [], baselineDailySpend: 50_000, paydayRuleId: null, paydayOverride: null, ...o,
});
const DAYS = 365;

describe("engine one-off outflows", () => {
  it("empty or absent oneOffs change nothing", () => {
    const a = runForecast(input(), BASE, 90);
    expect(JSON.stringify(runForecast({ ...input(), oneOffs: [] }, BASE, 90))).toBe(JSON.stringify(a));
  });
  it("subtracts on the date, shows as an event, and is never scaled by the scenario", () => {
    const r = runForecast({ ...input({ baselineDailySpend: 0, incomeRules: [] }), oneOffs: [{ date: "2026-12-01", label: "X", amount: 1_000_000 }] }, PRESETS.conservative, 30);
    expect(r.days.find((d) => d.date === "2026-12-01")).toMatchObject({ oneOffs: 1_000_000, closing: 10_000_000 - 1_000_000 - 224_000 * 0 });
    expect(r.events.find((e) => e.kind === "oneoff")).toMatchObject({ amount: 1_000_000, label: "X" });
    expect(r.summary.totalOneOffs).toBe(1_000_000);
  });
  it("a one-off dated today lands on day 0; months still reconcile", () => {
    const r = runForecast({ ...input(), oneOffs: [{ date: TODAY, label: "Hari ini", amount: 700_000 }] }, BASE, 120);
    expect(r.days[0]).toMatchObject({ oneOffs: 700_000, closing: 10_000_000 - 700_000 });
    r.months.forEach((m) => expect(m.opening + m.income - m.spending - m.installments - m.bills - m.oneOffs).toBe(m.closing));
  });
});

describe("remaining components", () => {
  it("payments are applied to fees, then interest, then principal", () => {
    expect(remainingParts({ principal_due: 200_000, interest_due: 24_000, fee_due: 5_000, amount_paid: 0 })).toEqual({ fee_rem: 5_000, interest_rem: 24_000, principal_rem: 200_000 });
    expect(remainingParts({ principal_due: 200_000, interest_due: 24_000, fee_due: 5_000, amount_paid: 20_000 })).toEqual({ fee_rem: 0, interest_rem: 9_000, principal_rem: 200_000 });
    expect(remainingParts({ principal_due: 200_000, interest_due: 24_000, fee_due: 5_000, amount_paid: 100_000 })).toEqual({ fee_rem: 0, interest_rem: 0, principal_rem: 129_000 });
  });
});

describe("settlement (pure)", () => {
  it("full: covers the installments due AFTER the date; those on or before it stay on schedule", () => {
    const s = computeSettlement(sea(), P(), TODAY);
    expect(s.keptRows.map((r) => r.sequence_no)).toEqual([1]); // Dec 5 is before Dec 20
    expect(s.covered.map((c) => c.sequence_no)).toEqual([2, 3, 4, 5, 6]);
    expect(s.scheduledCost).toBe(5 * 224_000);
    expect(s.payoff).toBe(5 * 224_000);
    expect(s.cashOut).toBe(1_120_000);
    const onDue = computeSettlement(sea(), P({ date: "2027-01-05" }), TODAY);
    expect(onDue.keptRows.map((r) => r.sequence_no)).toEqual([1, 2]); // a row due on the date is paid as scheduled
  });
  it("with no rebate or quotation NO saving is assumed, but the upper bound is shown and labelled as such", () => {
    const s = computeSettlement(sea(), P(), TODAY);
    expect(s.rebateKind).toBe("none");
    expect(s.knownSaving).toBeNull();
    expect(s.interestUpperBound).toBe(5 * 24_000);
    expect(s.totalRemainingB).toBe(s.totalRemainingA);
    expect(s.interestFeeB).toBe(s.interestFeeA);
  });
  it("fee and penalty are extra cash out and do not reduce the obligation", () => {
    const s = computeSettlement(sea(), P({ fee: 25_000, penalty: 10_000 }), TODAY);
    expect(s.payoff).toBe(1_120_000);
    expect(s.cashOut).toBe(1_155_000);
    expect(s.totalRemainingB).toBe(s.totalRemainingA + 35_000);
  });
  it("a rebate percentage waives that share of the scheduled interest only", () => {
    const s = computeSettlement(sea(), P({ rebate_pct: 50 }), TODAY);
    expect(s.rebateKind).toBe("percent");
    expect(s.knownSaving).toBe(60_000); // 50% of 5 x 24.000
    expect(s.payoff).toBe(1_120_000 - 60_000);
    expect(s.interestFeeB).toBe(s.interestFeeA - 60_000);
    expect(s.totalRemainingB).toBe(s.totalRemainingA - 60_000);
  });
  it("a provider quotation overrides the schedule, and can be higher than it", () => {
    const lower = computeSettlement(sea(), P({ quote: 1_000_000 }), TODAY);
    expect(lower).toMatchObject({ rebateKind: "quote", payoff: 1_000_000, knownSaving: 120_000 });
    const higher = computeSettlement(sea(), P({ quote: 1_150_000 }), TODAY);
    expect(higher.knownSaving).toBe(-30_000);
    expect(higher.cashOut).toBe(1_150_000);
  });
  it("partial: pays the next installments after the date, oldest first, fees -> interest -> principal", () => {
    const debt: DebtSim = { ...sea(), rows: sea().rows.map((r, i) => (i === 1 ? row(1, 2, r.due_date, 200_000, 24_000, 5_000) : r)) };
    const s = computeSettlement(debt, P({ mode: "partial", amount: 250_000 }), TODAY);
    expect(s.covered.map((c) => [c.sequence_no, c.paid])).toEqual([[2, 229_000], [3, 21_000]]);
    expect(s.remainingLater.map((r) => [r.sequence_no, r.remaining])).toEqual([[3, 203_000], [4, 224_000], [5, 224_000], [6, 224_000]]);
    expect(s.remainingLater[0]).toMatchObject({ interest_rem: 3_000, principal_rem: 200_000 }); // 21k paid fee 0 -> interest first
    expect(s.cashOut).toBe(250_000);
    expect(s.knownSaving).toBeNull();
    expect(s.interestUpperBound).toBe(0);
    expect(s.totalRemainingB).toBe(s.totalRemainingA); // moving cash earlier does not change the total
  });
  it("rejects bad input with specific messages", () => {
    const msg = (p: Partial<RepayParams>, today = TODAY) => { try { computeSettlement(sea(), P(p), today); return ""; } catch (e) { return e instanceof LedgerError ? e.message : "other"; } };
    expect(msg({ date: "2026-11-19" })).toMatch(/sebelum hari ini/);
    expect(msg({ date: "2026-02-30" })).toMatch(/tidak valid/);
    expect(msg({ date: "2027-12-31" })).toMatch(/12 bulan/);
    expect(msg({ date: "2027-05-05" })).toMatch(/Tidak ada cicilan/);
    expect(msg({ rebate_pct: 101 })).toMatch(/0% dan 100%/);
    expect(msg({ fee: -1 })).toMatch(/Biaya/);
    expect(msg({ quote: 0 })).toMatch(/Kuotasi/);
    expect(msg({ mode: "partial", amount: null })).toMatch(/nominal/i);
    expect(msg({ mode: "partial", amount: 9_999_999 })).toMatch(/melebihi/);
  });
});

describe("scenario A vs B", () => {
  const run = (p: Partial<RepayParams> = {}, i: Partial<ForecastInput> = {}) => simulateEarlyRepayment(input(i), [sea()], P(p), BASE, DAYS);

  it("Scenario A is exactly the standard forecast (baseline matches)", () => {
    const r = run();
    expect(JSON.stringify(r.a)).toBe(JSON.stringify(runForecast(input(), BASE, DAYS)));
  });
  it("full settlement: later installments disappear, one cash-out lands on the date", () => {
    const r = run({ fee: 20_000 });
    const inst = (res: typeof r.a) => res.events.filter((e) => e.kind === "installment").map((e) => e.date);
    expect(inst(r.a)).toHaveLength(6);
    expect(inst(r.b)).toEqual(["2026-12-05"]);
    const o = r.b.events.find((e) => e.kind === "oneoff")!;
    expect(o).toMatchObject({ date: "2026-12-20", amount: 1_120_000 + 20_000 });
    expect(o.label).toContain("Pelunasan dini SeaBank");
  });
  it("when the horizon covers every installment, B - A closing cash = saving - fee - penalty exactly", () => {
    expect(run().b.summary.closingCash - run().a.summary.closingCash).toBe(0);
    expect(run({ fee: 20_000, penalty: 5_000 }).b.summary.closingCash - run().a.summary.closingCash).toBe(-25_000);
    expect(run({ rebate_pct: 100, fee: 10_000 }).b.summary.closingCash - run().a.summary.closingCash).toBe(120_000 - 10_000);
    expect(run({ quote: 1_000_000 }).b.summary.closingCash - run().a.summary.closingCash).toBe(120_000);
  });
  it("partial: the same installments remain but are reduced; total paid on the debt is unchanged apart from fees", () => {
    const r = run({ mode: "partial", amount: 500_000, fee: 5_000 });
    expect(r.b.events.filter((e) => e.kind === "installment" && e.date > "2026-12-20").reduce((s, e) => s + e.amount, 0)).toBe(5 * 224_000 - 500_000);
    expect(r.b.summary.closingCash - r.a.summary.closingCash).toBe(-5_000);
    expect(r.mb.debtPaidInHorizon).toBe(r.ma.debtPaidInHorizon + 5_000);
  });
  it("settling today: the cash-out is on day 0 and an overdue installment is still paid today", () => {
    const overdueInput = input({ installments: [{ debt_id: 1, label: "SeaBank", sequence_no: 0, installment_count: 6, due_date: "2026-11-10", remaining: 224_000 }, ...input().installments] });
    const debt: DebtSim = { ...sea(), rows: [row(1, 0, "2026-11-10", 200_000, 24_000), ...sea().rows] };
    const r = simulateEarlyRepayment(overdueInput, [debt], P({ date: TODAY }), BASE, DAYS);
    expect(r.b.days[0].oneOffs).toBe(6 * 224_000);
    expect(r.b.days[0].installments).toBe(224_000); // the overdue one stays scheduled
    expect(r.settlement.keptRows.map((x) => x.sequence_no)).toEqual([0]);
  });
  it("liquidity: settling with too little cash creates a deficit and a high risk, while A stays safe", () => {
    // Only 300rb of income arrives each month (on the 25th): enough for the 224rb installments, not for a 1,12jt payoff on the 20th.
    const small = [{ id: 1, name: "Gaji kecil", amount: 300_000, frequency: "monthly" as const, day_of_month: 25, start_date: "2026-01-25", end_date: null, category_name: "Gaji" }];
    const r = run({}, { openingCash: 1_000_000, incomeRules: small, baselineDailySpend: 0 });
    expect(r.ma.risk).not.toBe("tinggi");
    expect(r.ma.deficitDays).toBe(0);
    expect(r.mb.deficitDays).toBeGreaterThan(0);
    expect(r.mb.risk).toBe("tinggi");
    expect(r.mb.lowest.balance).toBeLessThan(0);
    expect(r.mb.firstDeficitDate).toBe("2026-12-20");
  });
  it("liquidity thresholds: below zero is high, below the buffer or one month of spending is medium", () => {
    expect(liquidityRisk(-1, 0, 100)).toBe("tinggi");
    expect(liquidityRisk(50, 0, 1_500_000)).toBe("sedang");
    expect(liquidityRisk(1_000_000, 2_000_000, 0)).toBe("sedang");
    expect(liquidityRisk(5_000_000, 2_000_000, 1_500_000)).toBe("rendah");
  });
  it("debt-free date: full settlement ends the debt on the repayment date; partial ends at the last remaining installment", () => {
    const f = run();
    expect(f.debtFreeA).toBe("2027-05-05");
    expect(f.debtFreeB).toBe("2026-12-20");
    const p = run({ mode: "partial", amount: 224_000 * 5 - 1 });
    expect(p.debtFreeB).toBe("2027-05-05"); // one rupiah of installment 6 is still owed
    const q = run({ mode: "partial", amount: 224_000 * 5 });
    expect(q.debtFreeB).toBe("2026-12-05"); // only the installment due before the date remains
  });
  it("other debts keep their own schedule and determine the overall debt-free date", () => {
    const other: DebtSim = { debt_id: 2, provider: "Akulaku", label: "", rate_bps: null, rows: [row(2, 1, "2027-09-10", 100_000, 0)] };
    const i = input({ installments: [...input().installments, { debt_id: 2, label: "Akulaku", sequence_no: 1, installment_count: 1, due_date: "2027-09-10", remaining: 100_000 }] });
    const r = simulateEarlyRepayment(i, [sea(), other], P(), BASE, DAYS);
    expect(r.debtFreeB).toBe("2027-09-10");
    expect(r.b.events.some((e) => e.label === "Akulaku #1/1")).toBe(true);
  });
  it("monthly figures: routine surplus excludes the one-off payment", () => {
    const r = run();
    expect(r.mb.avgMonthlySurplus).toBeGreaterThanOrEqual(r.ma.avgMonthlySurplus - 1);
    expect(r.ma.avgMonthlyInstallments).toBeGreaterThan(0);
  });
  it("unknown debt is reported", () => {
    expect(() => simulateEarlyRepayment(input(), [sea()], P({ debt_id: 99 }), BASE, DAYS)).toThrow(/tidak ditemukan/);
  });
  it("is deterministic", () => {
    expect(JSON.stringify(run({ rebate_pct: 30, fee: 1_000 }))).toBe(JSON.stringify(run({ rebate_pct: 30, fee: 1_000 })));
  });
});

describe("payoff strategies", () => {
  const X: DebtSim = { debt_id: 10, provider: "X (kecil, murah)", label: "", rate_bps: 100, rows: ["2026-12-05", "2027-01-05", "2027-02-05"].map((d, i) => row(10, i + 1, d, 90_000, 10_000)) }; // 300k, cost ratio 0,11
  const Y: DebtSim = { debt_id: 20, provider: "Y (besar, mahal)", label: "", rate_bps: 500, rows: ["2026-12-05", "2027-01-05", "2027-02-05", "2027-03-05"].map((d, i) => row(20, i + 1, d, 150_000, 50_000)) }; // 800k, cost ratio 0,33
  const debts = [X, Y];
  const sp = (o: Partial<{ extra: number; rebate_pct: number; order: number[] }> = {}) => ({ extra: 200_000, rebate_pct: 0, order: [], ...o });

  it("minimum pays exactly the schedule and finishes at the last due month", () => {
    const m = runStrategy("minimum", debts, TODAY, sp());
    expect(m.totalPaid).toBe(300_000 + 800_000);
    expect(m.debtFreeMonth).toBe("2027-03");
    expect(m.months.every((x) => x.extra === 0)).toBe(true);
    expect(m.months[m.months.length - 1].outstanding).toBe(0);
    expect(runStrategy("snowball", debts, TODAY, sp({ extra: 0 })).totalPaid).toBe(1_100_000);
  });
  it("snowball targets the smaller balance first, avalanche the costlier debt first, custom follows the order", () => {
    expect(runStrategy("snowball", debts, TODAY, sp()).targetOrder[0]).toBe(10);
    expect(runStrategy("avalanche", debts, TODAY, sp()).targetOrder[0]).toBe(20);
    expect(runStrategy("custom", debts, TODAY, sp({ order: [20, 10] })).targetOrder[0]).toBe(20);
    expect(runStrategy("custom", debts, TODAY, sp({ order: [10, 20] })).targetOrder[0]).toBe(10);
    expect(impliedCostRatio(Y)).toBeGreaterThan(impliedCostRatio(X));
  });
  it("with no rebate every strategy pays the same total but finishes sooner than the minimum", () => {
    const all = compareStrategies(debts, TODAY, sp());
    const [min, snow, ava, cus] = all;
    for (const r of [snow, ava, cus]) { expect(r.totalPaid).toBe(min.totalPaid); expect(r.interestFeePaid).toBe(min.interestFeePaid); expect(r.monthsToDebtFree).toBeLessThanOrEqual(min.monthsToDebtFree); }
    expect(snow.monthsToDebtFree).toBeLessThan(min.monthsToDebtFree);
  });
  it("savings only appear when a rebate is given, and avalanche saves more when the costly debt is prepaid first", () => {
    const [min, snow, ava] = compareStrategies(debts, TODAY, sp({ rebate_pct: 100 }));
    expect(snow.interestFeePaid).toBeLessThan(min.interestFeePaid);
    expect(ava.interestFeePaid).toBeLessThan(snow.interestFeePaid);
    expect(ava.totalPaid).toBeLessThan(snow.totalPaid);
  });
  it("only whole installments are prepaid and the unspent budget rolls over", () => {
    const r = runStrategy("snowball", [X], TODAY, sp({ extra: 150_000 }));
    // Nov: 150k budget prepays one 100k row, 50k left. Dec: +150k = 200k -> two rows.
    expect(r.months[0]).toMatchObject({ month: "2026-11", scheduled: 0, extra: 100_000 });
    expect(r.months[1]).toMatchObject({ month: "2026-12" });
    expect(r.months.reduce((s, m) => s + m.scheduled + m.extra, 0)).toBe(300_000);
  });
  it("outstanding never increases, ends at zero, and each debt's clearing month is recorded", () => {
    const r = runStrategy("avalanche", debts, TODAY, sp());
    r.months.forEach((m, i) => { if (i) expect(m.outstanding).toBeLessThanOrEqual(r.months[i - 1].outstanding); });
    expect(r.months[r.months.length - 1].outstanding).toBe(0);
    expect(Object.keys(r.clearedMonth).map(Number).sort()).toEqual([10, 20]);
  });
  it("overdue installments are paid in the first month; settled debts do not appear", () => {
    const late: DebtSim = { debt_id: 30, provider: "Late", label: "", rate_bps: null, rows: [row(30, 1, "2026-10-01", 100_000, 0)] };
    const r = runStrategy("minimum", [late], TODAY, sp());
    expect(r.months[0]).toMatchObject({ month: "2026-11", scheduled: 100_000, outstanding: 0 });
    expect(runStrategy("snowball", [], TODAY, sp())).toMatchObject({ monthsToDebtFree: 0, totalPaid: 0, debtFreeMonth: null });
  });
  it("validates the budget and rebate", () => {
    expect(() => runStrategy("snowball", debts, TODAY, sp({ extra: -1 }))).toThrow(LedgerError);
    expect(() => runStrategy("snowball", debts, TODAY, sp({ rebate_pct: 150 }))).toThrow(LedgerError);
  });
});

describe("with the real database", () => {
  function setup() {
    const db = memDb();
    const { bca } = twoAccounts(db, 5_000_000, 0);
    createRecurringIncome(db, { name: "Gaji", amount: 6_000_000, account_id: bca, category_id: findCategoryId(db, "Gaji", "income"), frequency: "monthly", day_of_month: 25, start_date: "2026-01-25" });
    createTransaction(db, { type: "expense", account_id: bca, category_id: null, amount: 300_000, occurred_on: "2026-11-05", description: "makan" }, T);
    const debt = createDebt(db, { provider: "SeaBank", model: "flat", principal: 1_200_000, rate_bps: 200, count: 6, start_date: "2026-11-01", first_due_date: "2026-12-05", payment_account_id: bca });
    return { db, bca, debt };
  }
  const COUNTS = `SELECT (SELECT COUNT(*) FROM transactions)||'|'||(SELECT COUNT(*) FROM transfers)||'|'||(SELECT COUNT(*) FROM debt_payments)||'|'||(SELECT COUNT(*) FROM bill_payments)||'|'||(SELECT SUM(amount_paid) FROM installment_schedules)||'|'||(SELECT status FROM debts WHERE id=1)||'|'||(SELECT COUNT(*) FROM audit_logs) AS c`;

  it("the loader gives the same installments to the simulator and to the forecast", () => {
    const { db, debt } = setup();
    const ctx = loadRepayContext(db, { today: TODAY });
    expect(ctx.debts).toHaveLength(1);
    expect(ctx.debts[0].rows.map((r) => [r.sequence_no, r.due_date, r.remaining, r.interest_rem, r.principal_rem])).toEqual(
      ctx.forecast.input.installments.map((i) => [i.sequence_no, i.due_date, i.remaining, 24_000, 200_000]));
    expect(ctx.debts[0].debt_id).toBe(debt);
  });
  it("a paid installment is not part of the simulation; a partly paid one carries its reduced components", () => {
    const { db, bca, debt } = setup();
    recordDebtPayment(db, { debt_id: debt, account_id: bca, amount: 224_000, paid_on: TODAY }, T);
    recordDebtPayment(db, { debt_id: debt, account_id: bca, amount: 30_000, paid_on: TODAY }, T);
    const rows = loadRepayContext(db, { today: TODAY }).debts[0].rows;
    expect(rows.map((r) => r.sequence_no)).toEqual([2, 3, 4, 5, 6]);
    expect(rows[0]).toMatchObject({ remaining: 194_000, interest_rem: 0, principal_rem: 194_000 }); // 30k paid: interest 24k first, then 6k principal
  });
  it("simulating never changes real records", () => {
    const { db, debt } = setup();
    const before = (db.prepare(COUNTS).get() as { c: string }).c;
    const ctx = loadRepayContext(db, { today: TODAY });
    for (const mode of ["full", "partial"] as const) {
      simulateEarlyRepayment(ctx.forecast.input, ctx.debts, P({ debt_id: debt, mode, amount: mode === "partial" ? 300_000 : null, rebate_pct: 40, fee: 1_000 }), BASE, DAYS);
    }
    compareStrategies(ctx.debts, TODAY, { extra: 100_000, rebate_pct: 20, order: [] });
    expect((db.prepare(COUNTS).get() as { c: string }).c).toBe(before);
  });
  it("saving a scenario writes only to simulation_scenarios (and the audit log)", () => {
    const { db, debt } = setup();
    const tables = `SELECT (SELECT COUNT(*) FROM transactions)||'|'||(SELECT COUNT(*) FROM debt_payments)||'|'||(SELECT SUM(amount_paid) FROM installment_schedules) AS c`;
    const before = (db.prepare(tables).get() as { c: string }).c;
    saveRepayScenario(db, "Lunas Des", sanitizeStored({ debt_id: debt, date: "2026-12-20", mode: "full", rebate_pct: 10, fee: 5_000, penalty: 0, preset: "baseline", buffer: 0 }), { closing: 1, lowest: 2, cashOut: 3 });
    expect((db.prepare(tables).get() as { c: string }).c).toBe(before);
    expect(db.prepare("SELECT COUNT(*) c FROM simulation_scenarios WHERE kind='early_repayment'").get()).toEqual({ c: 1 });
  });
  it("scenarios: save, list, reject duplicate names, duplicate, delete; stored params are sanitized", () => {
    const { db, debt } = setup();
    const params = sanitizeStored({ debt_id: debt, date: "2026-12-20", mode: "partial", amount: 300_000, rebate_pct: 999, fee: -5, penalty: 0, preset: "evil", buffer: 100 });
    expect(params).toMatchObject({ rebate_pct: 100, fee: 0, preset: "baseline", mode: "partial", amount: 300_000 });
    const id = saveRepayScenario(db, "Sebagian", params, null);
    expect(() => saveRepayScenario(db, "sebagian", params, null)).toThrow(/Sudah ada/);
    expect(() => saveRepayScenario(db, "  ", params, null)).toThrow(LedgerError);
    const copy = duplicateRepayScenario(db, id);
    expect(listRepayScenarios(db).map((s) => s.name).sort()).toEqual(["Sebagian", "Sebagian (salinan)"]);
    duplicateRepayScenario(db, id);
    expect(listRepayScenarios(db).map((s) => s.name)).toContain("Sebagian (salinan 2)");
    deleteRepayScenario(db, copy);
    expect(listRepayScenarios(db).map((s) => s.id)).not.toContain(copy);
    // a forecast-kind scenario with the same name is not touched by deleting repayment scenarios
    db.prepare("INSERT INTO simulation_scenarios (name, kind, parameters) VALUES ('Sebagian', 'forecast', '{}')").run();
    deleteRepayScenario(db, id);
    expect(db.prepare("SELECT COUNT(*) c FROM simulation_scenarios WHERE kind='forecast'").get()).toEqual({ c: 1 });
  });
  it("recording the REAL settlement is separate: it posts one expense for the whole outstanding obligation and closes the debt", () => {
    const { db, bca, debt } = setup();
    const r = recordFullSettlement(db, { debt_id: debt, account_id: bca, paid_on: TODAY, fee: 10_000, penalty: 0 }, T);
    expect(r.debtSettled).toBe(true);
    expect(getDebt(db, debt, TODAY)).toMatchObject({ status: "settled", outstanding: 0 });
    expect(getBalance(db, bca)).toBe(5_000_000 - 300_000 - 1_344_000 - 10_000);
    expect(() => recordFullSettlement(db, { debt_id: debt, account_id: bca, paid_on: TODAY, fee: 0, penalty: 0 }, T)).toThrow(/sudah lunas|tidak ditemukan/);
  });
  it("recording refuses a future date (the ledger holds only what happened)", () => {
    const { db, bca, debt } = setup();
    expect(() => recordFullSettlement(db, { debt_id: debt, account_id: bca, paid_on: "2026-12-20", fee: 0, penalty: 0 }, T)).toThrow(/masa depan/);
    expect(getDebt(db, debt, TODAY)?.outstanding).toBe(1_344_000);
  });
  it("end to end on real data: B - A = -fee when the horizon covers the schedule", () => {
    const { db, debt } = setup();
    const ctx = loadRepayContext(db, { today: TODAY });
    const r = simulateEarlyRepayment(ctx.forecast.input, ctx.debts, P({ debt_id: debt, fee: 12_000 }), BASE, DAYS);
    expect(r.b.summary.closingCash - r.a.summary.closingCash).toBe(-12_000);
    expect(JSON.stringify(r.a)).toBe(JSON.stringify(runForecast(ctx.forecast.input, BASE, DAYS)));
  });
});

describe("URL parameters", () => {
  const debts = [sea()];
  it("no debt chosen: just the form, with sensible defaults", () => {
    const q = parseRepayQuery({}, debts, TODAY);
    expect(q.params).toBeNull();
    expect(q.errors).toEqual([]);
    expect(q.raw.date).toBe("2026-12-04");
    expect(q.preset).toBe("baseline");
  });
  it("parses Indonesian money text and keeps the raw text for the form", () => {
    const q = parseRepayQuery({ debt: "1", mode: "partial", amt: "500rb", fee: "25.000", pen: "1jt", date: "2026-12-20", rb: "12,5", preset: "conservative", buf: "2jt" }, debts, TODAY);
    expect(q.params).toMatchObject({ debt_id: 1, mode: "partial", amount: 500_000, quote: null, fee: 25_000, penalty: 1_000_000, rebate_pct: 12.5, date: "2026-12-20" });
    expect(q.scenario).toMatchObject({ income_pct: 90, buffer: 2_000_000 });
    expect(q.raw.amount).toBe("500rb");
  });
  it("full mode ignores the partial amount, partial mode ignores the quotation", () => {
    expect(parseRepayQuery({ debt: "1", mode: "full", amt: "500rb", quote: "1jt" }, debts, TODAY).params).toMatchObject({ amount: null, quote: 1_000_000 });
    expect(parseRepayQuery({ debt: "1", mode: "partial", amt: "500rb", quote: "1jt" }, debts, TODAY).params).toMatchObject({ amount: 500_000, quote: null });
  });
  it("reports garbage instead of failing, and clamps hostile values", () => {
    const q = parseRepayQuery({ debt: "999", date: "bukan", amt: "abc", rb: "9999", fee: "x", extra: "zzz", srb: "-4", order: "1,abc,,3", cmp: "1,2,3,4,5,6", preset: "evil" }, debts, TODAY);
    expect(q.params).toBeNull();
    expect(q.errors.length).toBeGreaterThanOrEqual(4);
    expect(q.preset).toBe("baseline");
    expect(q.strategy).toMatchObject({ extra: 0, rebate_pct: 0, order: [1, 3] });
    expect(q.compare).toEqual([1, 2, 3, 4]);
    const ok = parseRepayQuery({ debt: "1", rb: "9999" }, debts, TODAY);
    expect(ok.params!.rebate_pct).toBe(100);
    expect(ok.errors.join()).toMatch(/Rebat/);
  });
});
