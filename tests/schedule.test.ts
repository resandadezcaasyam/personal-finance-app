import { describe, it, expect } from "vitest";
import { generateSchedule, splitEvenly, allocatePayment, derivePaymentKind, parseManualSchedule } from "@/lib/debts/schedule";
import { addMonthsClamped, daysBetween, parseIDR } from "@/lib/format";
import { LedgerError } from "@/lib/ledger/errors";

const sum = (rows: { amount_due: number }[]) => rows.reduce((s, r) => s + r.amount_due, 0);

describe("splitEvenly", () => {
  it("sums exactly with the remainder on the last part", () => {
    expect(splitEvenly(1000, 3)).toEqual([333, 333, 334]);
    expect(splitEvenly(900, 3)).toEqual([300, 300, 300]);
    expect(splitEvenly(0, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("dates", () => {
  it("clamps to month end and keeps the anchor day", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-01-31", 2)).toBe("2026-03-31"); // computed from the start, not chained
    expect(addMonthsClamped("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonthsClamped("2026-12-05", 1)).toBe("2027-01-05");
  });
  it("counts days", () => {
    expect(daysBetween("2026-11-20", "2026-11-27")).toBe(7);
    expect(daysBetween("2026-11-27", "2026-11-20")).toBe(-7);
  });
});

describe("zero-interest schedule", () => {
  it("splits the principal evenly with an exact total", () => {
    const rows = generateSchedule({ model: "none", principal: 1_000_000, count: 3, first_due_date: "2026-12-05" });
    expect(rows.map((r) => r.amount_due)).toEqual([333_333, 333_333, 333_334]);
    expect(sum(rows)).toBe(1_000_000);
    expect(rows.every((r) => r.interest_due === 0 && r.fee_due === 0)).toBe(true);
    expect(rows.map((r) => r.due_date)).toEqual(["2026-12-05", "2027-01-05", "2027-02-05"]);
  });
  it("adds the admin fee spread across installments", () => {
    const rows = generateSchedule({ model: "none", principal: 600_000, admin_fee: 30_000, count: 3, first_due_date: "2026-12-01" });
    expect(rows.map((r) => r.fee_due)).toEqual([10_000, 10_000, 10_000]);
    expect(sum(rows)).toBe(630_000);
  });
});

describe("flat schedule", () => {
  it("charges monthly rate x principal x count, split evenly", () => {
    const rows = generateSchedule({ model: "flat", principal: 1_200_000, rate_bps: 200, count: 6, first_due_date: "2026-12-10" });
    // 2% x 6 months = 12% of 1.2jt = 144.000
    expect(rows.reduce((s, r) => s + r.interest_due, 0)).toBe(144_000);
    expect(rows.reduce((s, r) => s + r.principal_due, 0)).toBe(1_200_000);
    expect(rows[0].amount_due).toBe(224_000);
    expect(sum(rows)).toBe(1_344_000);
  });
});

describe("reducing-balance schedule", () => {
  it("amortizes to exactly zero principal with decreasing interest", () => {
    const rows = generateSchedule({ model: "reducing", principal: 10_000_000, rate_bps: 150, count: 12, first_due_date: "2026-12-01" });
    expect(rows.reduce((s, r) => s + r.principal_due, 0)).toBe(10_000_000);
    expect(rows[0].interest_due).toBe(150_000); // 1,5% of 10jt
    for (let i = 1; i < rows.length; i++) expect(rows[i].interest_due).toBeLessThan(rows[i - 1].interest_due);
    // fixed payment except the final rounding row
    const pmt = rows[0].amount_due;
    expect(rows.slice(0, -1).every((r) => r.amount_due === pmt)).toBe(true);
    expect(Math.abs(rows[11].amount_due - pmt)).toBeLessThan(20);
    expect(pmt).toBe(916_800); // standard annuity for 10jt, 1,5%/mo, 12 months
  });
  it("with 0% interest equals an even split", () => {
    const a = generateSchedule({ model: "reducing", principal: 900_000, rate_bps: 0, count: 3, first_due_date: "2026-12-01" });
    expect(a.map((r) => r.amount_due)).toEqual([300_000, 300_000, 300_000]);
  });
});

describe("manual / irregular schedule", () => {
  it("keeps the user's dates and amounts and splits cost proportionally", () => {
    const rows = generateSchedule({
      model: "manual", principal: 1_000_000, admin_fee: 20_000, first_due_date: "2026-12-01",
      manual: [{ due_date: "2027-01-15", amount: 600_000 }, { due_date: "2026-12-01", amount: 500_000 }, { due_date: "2027-03-01", amount: 120_000 }],
    });
    expect(rows.map((r) => r.due_date)).toEqual(["2026-12-01", "2027-01-15", "2027-03-01"]); // sorted
    expect(sum(rows)).toBe(1_220_000);
    expect(rows.reduce((s, r) => s + r.principal_due, 0)).toBe(1_000_000);
    expect(rows.reduce((s, r) => s + r.fee_due, 0)).toBe(20_000);
    expect(rows.reduce((s, r) => s + r.interest_due, 0)).toBe(200_000);
    for (const r of rows) expect(r.principal_due + r.interest_due + r.fee_due).toBe(r.amount_due);
  });
  it("rejects schedules smaller than the principal", () => {
    expect(() => generateSchedule({ model: "manual", principal: 1_000_000, first_due_date: "2026-12-01", manual: [{ due_date: "2026-12-01", amount: 900_000 }] })).toThrow(LedgerError);
  });
  it("parses text lines", () => {
    expect(parseManualSchedule("2026-12-05 350rb\n\n2027-01-05; 1.250.000", parseIDR)).toEqual([{ due_date: "2026-12-05", amount: 350_000 }, { due_date: "2027-01-05", amount: 1_250_000 }]);
    expect(() => parseManualSchedule("besok 100", parseIDR)).toThrow(/Baris 1/);
  });
});

describe("validation", () => {
  it("rejects bad inputs", () => {
    const base = { model: "none" as const, principal: 100, count: 2, first_due_date: "2026-12-01" };
    expect(() => generateSchedule({ ...base, principal: 0 })).toThrow(LedgerError);
    expect(() => generateSchedule({ ...base, count: 0 })).toThrow(LedgerError);
    expect(() => generateSchedule({ ...base, count: 500 })).toThrow(LedgerError);
    expect(() => generateSchedule({ ...base, first_due_date: "2026-02-31" })).toThrow(LedgerError);
    expect(() => generateSchedule({ ...base, model: "flat", rate_bps: 99999 })).toThrow(LedgerError);
  });
});

describe("allocatePayment", () => {
  const open = [
    { id: 1, sequence_no: 1, due_date: "2026-12-01", remaining: 100 },
    { id: 2, sequence_no: 2, due_date: "2027-01-01", remaining: 100 },
    { id: 3, sequence_no: 3, due_date: "2027-02-01", remaining: 100 },
  ];
  it("pays oldest first, spanning rows, and reports leftover", () => {
    const r = allocatePayment(open, 250);
    expect(r.allocations.map((a) => [a.schedule_id, a.amount, a.fully])).toEqual([[1, 100, true], [2, 100, true], [3, 50, false]]);
    expect(r.leftover).toBe(0);
    expect(allocatePayment(open, 400).leftover).toBe(100);
  });
  it("derives the payment kind", () => {
    const d = daysBetween;
    const a1 = allocatePayment(open, 100).allocations;
    expect(derivePaymentKind(a1, 300, 100, "2026-12-01", d)).toBe("regular");
    expect(derivePaymentKind(a1, 300, 100, "2026-11-25", d)).toBe("regular"); // within the 7-day tolerance
    expect(derivePaymentKind(a1, 300, 100, "2026-11-01", d)).toBe("early");
    expect(derivePaymentKind(allocatePayment(open, 60).allocations, 300, 60, "2026-12-01", d)).toBe("partial");
    expect(derivePaymentKind(allocatePayment(open, 300).allocations, 300, 300, "2026-12-01", d)).toBe("settlement");
  });
});
