import { describe, it, expect } from "vitest";
import { runForecast, incomeOccurrences, billOccurrences, PRESETS, type ForecastInput, type IncomeRule, type ScenarioParams } from "@/lib/forecast/engine";
import { daysBetween } from "@/lib/format";

const TODAY = "2026-11-20"; // Friday
const BASE: ScenarioParams = PRESETS.baseline;
const salary = (o: Partial<IncomeRule> = {}): IncomeRule => ({ id: 1, name: "Gaji", amount: 9_000_000, frequency: "monthly", day_of_month: 25, start_date: "2026-01-25", end_date: null, category_name: "Gaji", ...o });
const input = (o: Partial<ForecastInput> = {}): ForecastInput => ({
  today: TODAY, openingCash: 1_000_000, incomeRules: [], recentIncome: [], installments: [], bills: [], baselineDailySpend: 0, paydayRuleId: null, paydayOverride: null, ...o,
});

describe("income occurrences", () => {
  it("monthly salary starts tomorrow or later and honours start and end dates", () => {
    expect(incomeOccurrences(salary(), TODAY, "2027-02-28")).toEqual(["2026-11-25", "2026-12-25", "2027-01-25", "2027-02-25"]);
    expect(incomeOccurrences(salary({ end_date: "2026-12-31" }), TODAY, "2027-02-28")).toEqual(["2026-11-25", "2026-12-25"]);
    expect(incomeOccurrences(salary({ start_date: "2026-12-01" }), TODAY, "2027-01-31")).toEqual(["2026-12-25", "2027-01-25"]);
  });
  it("an occurrence dated today is not projected (today's actuals are already in the opening cash)", () => {
    expect(incomeOccurrences(salary({ day_of_month: 20 }), TODAY, "2026-12-31")).toEqual(["2026-12-20"]);
  });
  it("salary on day 31 clamps to month end but keeps the anchor day", () => {
    expect(incomeOccurrences(salary({ day_of_month: 31 }), TODAY, "2027-03-31")).toEqual(["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
  });
  it("weekly, quarterly and yearly rules", () => {
    expect(incomeOccurrences(salary({ frequency: "weekly", day_of_month: null, start_date: "2026-11-02" }), TODAY, "2026-12-10")).toEqual(["2026-11-23", "2026-11-30", "2026-12-07"]);
    expect(incomeOccurrences(salary({ frequency: "quarterly", day_of_month: 10, start_date: "2026-01-10" }), TODAY, "2027-06-30")).toEqual(["2027-01-10", "2027-04-10"]);
    expect(incomeOccurrences(salary({ frequency: "yearly", day_of_month: 5, start_date: "2025-12-05" }), TODAY, "2028-01-01")).toEqual(["2026-12-05", "2027-12-05"]);
  });
});

describe("bill occurrences", () => {
  it("repeats from the real next due date, clamping month ends", () => {
    const b = { id: 1, name: "Internet", kind: "bill" as const, amount: 350_000, estimate: null, frequency: "monthly" as const, due_day: 31, next_due_date: "2026-11-30" };
    expect(billOccurrences(b, "2027-02-28")).toEqual(["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"]);
    expect(billOccurrences({ ...b, frequency: "once" }, "2027-02-28")).toEqual(["2026-11-30"]);
  });
});

describe("daily roll-forward", () => {
  it("closing = opening + income - installments - bills - spending, and days chain", () => {
    const r = runForecast(input({
      openingCash: 5_000_000, incomeRules: [salary()],
      installments: [{ debt_id: 1, label: "SeaBank", sequence_no: 2, installment_count: 3, due_date: "2026-11-28", remaining: 224_000 }],
      bills: [{ id: 1, name: "Internet", kind: "bill", amount: 350_000, estimate: null, frequency: "monthly", due_day: 22, next_due_date: "2026-11-22" }],
      baselineDailySpend: 100_000,
    }), BASE, 30);
    for (let i = 0; i < r.days.length; i++) {
      const d = r.days[i];
      expect(d.closing).toBe(d.opening + d.income - d.installments - d.bills - d.spending);
      if (i > 0) expect(d.opening).toBe(r.days[i - 1].closing);
    }
    expect(r.days[0]).toMatchObject({ date: TODAY, opening: 5_000_000, spending: 0 });
    expect(r.days[2]).toMatchObject({ date: "2026-11-22", bills: 350_000, spending: 100_000 });
    expect(r.days[8]).toMatchObject({ date: "2026-11-28", installments: 224_000 });
    expect(r.days[5]).toMatchObject({ date: "2026-11-25", income: 9_000_000 });
    expect(r.summary.closingCash).toBe(r.days[30].closing);
  });

  it("habitual spending uses cumulative rounding: N days sum to round(daily x N)", () => {
    const r = runForecast(input({ baselineDailySpend: 33_333.4 }), BASE, 30);
    const total = r.days.reduce((s, d) => s + d.spending, 0);
    expect(total).toBe(Math.round(33_333.4 * 30));
    expect(r.summary.totalSpending).toBe(total);
  });

  it("is deterministic: identical input gives identical output", () => {
    const i = input({ incomeRules: [salary()], baselineDailySpend: 87_654.3, openingCash: 2_345_678 });
    expect(JSON.stringify(runForecast(i, BASE, 90))).toBe(JSON.stringify(runForecast(i, BASE, 90)));
  });

  it("includes events on the last horizon day and excludes later ones", () => {
    const last = "2026-12-20"; // 30 days
    const r = runForecast(input({ installments: [
      { debt_id: 1, label: "A", sequence_no: 1, installment_count: 2, due_date: last, remaining: 10 },
      { debt_id: 1, label: "A", sequence_no: 2, installment_count: 2, due_date: "2026-12-21", remaining: 20 },
    ] }), BASE, 30);
    expect(r.summary.totalInstallments).toBe(10);
    expect(r.days).toHaveLength(31);
    expect(r.events.map((e) => e.date)).toEqual([last]);
  });
});

describe("installments", () => {
  it("projects only the unpaid remainder (a partly paid row projects what is left)", () => {
    const r = runForecast(input({ installments: [{ debt_id: 1, label: "SeaBank", sequence_no: 2, installment_count: 3, due_date: "2026-11-28", remaining: 124_000 }] }), BASE, 30);
    expect(r.summary.totalInstallments).toBe(124_000);
  });
  it("rows with nothing remaining are never projected", () => {
    const r = runForecast(input({ installments: [{ debt_id: 1, label: "SeaBank", sequence_no: 1, installment_count: 3, due_date: "2026-11-28", remaining: 0 }] }), BASE, 30);
    expect(r.summary.totalInstallments).toBe(0);
    expect(r.events).toEqual([]);
  });
  it("an overdue installment lands on today, flagged, instead of vanishing", () => {
    const r = runForecast(input({ installments: [{ debt_id: 1, label: "SeaBank", sequence_no: 1, installment_count: 3, due_date: "2026-11-10", remaining: 224_000 }] }), BASE, 30);
    expect(r.days[0]).toMatchObject({ installments: 224_000, closing: 1_000_000 - 224_000 });
    expect(r.events[0]).toMatchObject({ overdue: true, date: TODAY });
    expect(r.assumptions.overdueCount).toBe(1);
  });
});

describe("bills", () => {
  it("variable bills use the estimate, scaled by the bills percentage; unknown ones are called out and count as 0", () => {
    const bill = { id: 1, name: "Listrik", kind: "bill" as const, amount: null, estimate: 400_000, frequency: "monthly" as const, due_day: 23, next_due_date: "2026-11-23" };
    expect(runForecast(input({ bills: [bill] }), BASE, 30).summary.totalBills).toBe(400_000);
    expect(runForecast(input({ bills: [bill] }), { ...BASE, bills_pct: 105 }, 30).summary.totalBills).toBe(420_000);
    const unknown = runForecast(input({ bills: [{ ...bill, estimate: null }] }), BASE, 30);
    expect(unknown.summary.totalBills).toBe(0);
    expect(unknown.assumptions.unknownBills).toEqual(["Listrik"]);
    expect(unknown.events[0].uncertain).toBe(true);
  });
  it("fixed bills ignore the scenario percentage", () => {
    const bill = { id: 1, name: "Internet", kind: "bill" as const, amount: 350_000, estimate: null, frequency: "monthly" as const, due_day: 22, next_due_date: "2026-11-22" };
    expect(runForecast(input({ bills: [bill] }), PRESETS.conservative, 30).summary.totalBills).toBe(350_000);
  });
  it("an overdue bill lands on today", () => {
    const bill = { id: 1, name: "Sampah", kind: "bill" as const, amount: 25_000, estimate: null, frequency: "monthly" as const, due_day: 10, next_due_date: "2026-11-10" };
    const r = runForecast(input({ bills: [bill] }), BASE, 40);
    expect(r.days[0].bills).toBe(25_000);
    expect(r.events.map((e) => [e.date, e.overdue])).toEqual([[TODAY, true], ["2026-12-10", false]]);
  });
});

describe("income handling", () => {
  it("skips an occurrence that was already received a few days early (no double counting)", () => {
    const r = runForecast(input({ incomeRules: [salary()], recentIncome: [{ date: TODAY, amount: 9_000_000 }] }), BASE, 60);
    expect(r.events.filter((e) => e.kind === "income").map((e) => e.date)).toEqual(["2026-12-25"]);
    expect(r.assumptions.skippedIncome[0]).toContain("dianggap sudah diterima");
  });
  it("only money received within 5 days before the due date counts", () => {
    const early = runForecast(input({ incomeRules: [salary()], recentIncome: [{ date: "2026-11-19", amount: 9_000_000 }] }), BASE, 30); // 6 days early
    expect(early.events.some((e) => e.date === "2026-11-25")).toBe(true);
  });
  it("received money cancels only one occurrence and only when the amount is close", () => {
    const far = runForecast(input({ incomeRules: [salary()], recentIncome: [{ date: "2026-11-19", amount: 3_000_000 }] }), BASE, 30);
    expect(far.events.some((e) => e.date === "2026-11-25")).toBe(true);
  });
  it("applies the income percentage and delay", () => {
    const r = runForecast(input({ incomeRules: [salary()] }), PRESETS.conservative, 40);
    const ev = r.events.find((e) => e.kind === "income")!;
    expect(ev).toMatchObject({ date: "2026-11-28", amount: 8_100_000 });
    expect(ev.note).toContain("+3 hari");
  });
});

describe("balances: lowest point and deficits", () => {
  const i = input({
    openingCash: 500_000, incomeRules: [salary({ amount: 3_000_000, day_of_month: 5 })],
    installments: [{ debt_id: 1, label: "SeaBank", sequence_no: 1, installment_count: 1, due_date: "2026-11-24", remaining: 700_000 }],
    baselineDailySpend: 50_000,
  });
  const r = runForecast(i, BASE, 30);
  it("finds the lowest balance and its date", () => {
    expect(r.summary.lowest.date).toBe("2026-12-04");
    expect(r.summary.lowest.balance).toBe(r.days.find((d) => d.date === "2026-12-04")!.closing);
    expect(r.summary.lowest.balance).toBeLessThan(0);
  });
  it("reports the first deficit day and contiguous deficit periods", () => {
    expect(r.summary.firstDeficitDate).toBe("2026-11-24");
    expect(r.summary.deficitPeriods).toHaveLength(1);
    expect(r.summary.deficitPeriods[0]).toMatchObject({ from: "2026-11-24", to: "2026-12-04", days: 11, lowestDate: "2026-12-04" });
    expect(r.summary.deficitDays).toBe(11);
  });
  it("closes the deficit when income arrives", () => {
    expect(r.days.find((d) => d.date === "2026-12-05")!.closing).toBeGreaterThan(0);
  });
  it("no deficits when cash is plentiful", () => {
    const ok = runForecast(input({ openingCash: 50_000_000, baselineDailySpend: 50_000 }), BASE, 30);
    expect(ok.summary.firstDeficitDate).toBeNull();
    expect(ok.summary.deficitPeriods).toEqual([]);
  });
});

describe("monthly projection", () => {
  const r = runForecast(input({
    openingCash: 5_000_000, incomeRules: [salary()], baselineDailySpend: 120_000,
    installments: [{ debt_id: 1, label: "SeaBank", sequence_no: 1, installment_count: 6, due_date: "2026-12-10", remaining: 300_000 }],
    bills: [{ id: 1, name: "Internet", kind: "bill", amount: 350_000, estimate: null, frequency: "monthly", due_day: 22, next_due_date: "2026-11-22" }],
  }), BASE, 120);
  it("opening and closing reconcile month by month and across months", () => {
    expect(r.months[0].opening).toBe(5_000_000);
    r.months.forEach((m, i) => {
      expect(m.opening + m.income - m.spending - m.installments - m.bills).toBe(m.closing);
      expect(m.net).toBe(m.closing - m.opening);
      if (i > 0) expect(m.opening).toBe(r.months[i - 1].closing);
    });
    expect(r.months[r.months.length - 1].closing).toBe(r.summary.closingCash);
  });
  it("the first month is partial and months are labelled surplus or deficit", () => {
    expect(r.months[0]).toMatchObject({ month: "2026-11", partial: true });
    expect(r.months[1].partial).toBe(false);
    expect(r.months.every((m) => m.status === (m.net >= 0 ? "surplus" : "deficit"))).toBe(true);
  });
  it("monthly totals add up to the overall totals", () => {
    expect(r.months.reduce((s, m) => s + m.income, 0)).toBe(r.summary.totalIncome);
    expect(r.months.reduce((s, m) => s + m.spending, 0)).toBe(r.summary.totalSpending);
    expect(r.months.reduce((s, m) => s + m.bills, 0)).toBe(r.summary.totalBills);
    expect(r.months.reduce((s, m) => s + m.installments, 0)).toBe(r.summary.totalInstallments);
  });
});

describe("scenarios", () => {
  const i = input({ openingCash: 3_000_000, incomeRules: [salary()], baselineDailySpend: 100_000,
    bills: [{ id: 1, name: "Listrik", kind: "bill", amount: null, estimate: 400_000, frequency: "monthly", due_day: 23, next_due_date: "2026-11-23" }] });
  const [b, c, o] = [runForecast(i, PRESETS.baseline, 60), runForecast(i, PRESETS.conservative, 60), runForecast(i, PRESETS.optimistic, 60)];
  it("conservative is worse than baseline, optimistic is better", () => {
    expect(c.summary.closingCash).toBeLessThan(b.summary.closingCash);
    expect(o.summary.closingCash).toBeGreaterThan(b.summary.closingCash);
    expect(c.summary.lowest.balance).toBeLessThanOrEqual(b.summary.lowest.balance);
  });
  it("scales spending exactly by the percentage", () => {
    expect(c.summary.totalSpending).toBe(Math.round(100_000 * 1.15 * 60));
    expect(o.summary.totalSpending).toBe(Math.round(100_000 * 0.9 * 60));
  });
  it("assumptions are reported back", () => {
    expect(c.params).toEqual({ income_pct: 90, spending_pct: 115, bills_pct: 105, income_delay_days: 3, buffer: 0 });
    expect(c.assumptions.scenarioDailySpend).toBe(115_000);
  });
});

describe("payday survival", () => {
  const base = { incomeRules: [salary({ amount: 9_000_000, day_of_month: 25 })], baselineDailySpend: 100_000 };
  it("survives when cash covers habitual spending and obligations until payday", () => {
    const r = runForecast(input({ ...base, openingCash: 2_000_000 }), BASE, 30);
    expect(r.survival).toMatchObject({ payday: "2026-11-25", daysUntil: 5, survives: true, shortfall: 0 });
    // days 0..4 closing: 2.0jt then -100k per day => lowest is the day before payday
    expect(r.survival!.lowest).toBe(2_000_000 - 4 * 100_000);
    expect(r.survival!.lowestDate).toBe("2026-11-24");
  });
  it("fails and reports the shortfall when cash runs out before payday", () => {
    const r = runForecast(input({ ...base, openingCash: 300_000 }), BASE, 30);
    expect(r.survival!.survives).toBe(false);
    expect(r.survival!.lowest).toBe(300_000 - 400_000);
    expect(r.survival!.shortfall).toBe(100_000);
  });
  it("safe-to-spend subtracts scheduled obligations and the buffer, then divides over the days left", () => {
    const r = runForecast(input({ ...base, openingCash: 2_000_000,
      installments: [{ debt_id: 1, label: "SeaBank", sequence_no: 1, installment_count: 1, due_date: "2026-11-23", remaining: 500_000 }],
    }), { ...BASE, buffer: 100_000 }, 30);
    // obligations-only low point = 2.0jt - 500k = 1.5jt; minus 100k buffer = 1.4jt over days 1..4 (4 days)
    expect(r.survival!.safeTotal).toBe(1_400_000);
    expect(r.survival!.safePerDay).toBe(350_000);
    expect(r.survival!.baselinePerDay).toBe(100_000);
  });
  it("buffer makes survival stricter", () => {
    const r = runForecast(input({ ...base, openingCash: 700_000 }), { ...BASE, buffer: 500_000 }, 30);
    expect(r.survival!.survives).toBe(false); // lowest = 300k < buffer 500k
  });
  it("can use an explicit payday date, or a chosen income rule", () => {
    const r = runForecast(input({ ...base, openingCash: 2_000_000, paydayOverride: "2026-11-30" }), BASE, 30);
    expect(r.survival).toMatchObject({ payday: "2026-11-30", daysUntil: 10 });
    const two = runForecast(input({ incomeRules: [salary(), salary({ id: 2, name: "Freelance", amount: 1_000_000, day_of_month: 22, category_name: "Freelance" })], paydayRuleId: 2, openingCash: 2_000_000 }), BASE, 30);
    expect(two.survival!.payday).toBe("2026-11-22");
  });
  it("auto-picks the salary-category rule, then the biggest", () => {
    const rules = [salary({ id: 2, name: "Sampingan", amount: 20_000_000, day_of_month: 22, category_name: "Freelance" }), salary()];
    expect(runForecast(input({ incomeRules: rules }), BASE, 30).survival!.sourceLabel).toBe("Gaji");
    expect(runForecast(input({ incomeRules: [rules[0], salary({ category_name: null, amount: 1_000 })] }), BASE, 30).survival!.sourceLabel).toBe("Sampingan");
  });
  it("is null without any income rule, and still works when the display horizon is shorter than the gap to payday", () => {
    expect(runForecast(input(), BASE, 30).survival).toBeNull();
    const short = runForecast(input({ ...base, openingCash: 2_000_000, paydayOverride: "2026-12-15" }), BASE, 7);
    expect(short.survival).toMatchObject({ daysUntil: 25 });
    expect(short.days).toHaveLength(8);
  });
  it("daysUntil matches the calendar", () => {
    const r = runForecast(input({ ...base }), BASE, 30);
    expect(r.survival!.daysUntil).toBe(daysBetween(TODAY, r.survival!.payday));
  });
});
