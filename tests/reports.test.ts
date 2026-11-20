import { describe, it, expect } from "vitest";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { buildReport, resolvePeriod, exportRows, monthsBetween, cashAtDates, outstandingDebtAt, outstandingDebtNow } from "@/lib/reports/reports";
import { toCsv, csvCell } from "@/lib/reports/csv";
import { buildReportPdf } from "@/lib/reports/pdf";
import { createTransaction } from "@/lib/ledger/transactions";
import { createTransfer } from "@/lib/ledger/transfers";
import { reconcileAccount } from "@/lib/ledger/reconcile";
import { findCategoryId } from "@/lib/ledger/categories";
import { monthTotals, spendingByCategory } from "@/lib/ledger/summary";
import { listAccounts } from "@/lib/ledger/accounts";
import { createDebt, recordDebtPayment, voidDebtPayment } from "@/lib/debts/debts";
import { setBudget } from "@/lib/budgets/budgets";
import { LedgerError } from "@/lib/ledger/errors";

const T = { today: TODAY };
function world() {
  const db = memDb();
  const { bca, gopay } = twoAccounts(db, 5_000_000, 500_000);
  const add = (type: "income" | "expense", account: number, amount: number, date: string, cat: string | null, desc = "x", extra: Record<string, unknown> = {}) =>
    createTransaction(db, { type, account_id: account, category_id: cat ? findCategoryId(db, cat, type) : null, amount, occurred_on: date, description: desc, ...extra }, T);
  add("income", bca, 9_000_000, "2026-09-25", "Gaji"); add("income", bca, 9_000_000, "2026-10-25", "Gaji"); add("income", bca, 9_500_000, "2026-11-10", "Gaji"); add("income", gopay, 400_000, "2026-11-12", "Freelance");
  add("expense", bca, 1_000_000, "2026-09-05", "Makan"); add("expense", bca, 25_000, "2026-09-06", "Kopi"); add("expense", bca, 350_000, "2026-10-05", "Internet");
  add("expense", bca, 600_000, "2026-10-10", "Belanja Harian"); add("expense", bca, 80_000, "2026-11-02", "Kopi", "Kopi", { merchant: "Fore", tags: "harian" });
  add("expense", gopay, 120_000, "2026-11-08", null, "tanpa kategori");
  createTransfer(db, { from_account_id: bca, to_account_id: gopay, amount: 700_000, fee: 2_500, occurred_on: "2026-11-09" }, T);
  return { db, bca, gopay, add };
}
const R = (db: ReturnType<typeof memDb>, p: Parameters<typeof resolvePeriod>[0] = { preset: "3m" }) => buildReport(db, resolvePeriod(p, TODAY), TODAY);

describe("periods", () => {
  it("resolves presets relative to today", () => {
    expect(resolvePeriod({ preset: "this_month" }, TODAY)).toMatchObject({ from: "2026-11-01", to: "2026-11-20", months: ["2026-11"] });
    expect(resolvePeriod({ preset: "last_month" }, TODAY)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolvePeriod({ preset: "3m" }, TODAY).months).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(resolvePeriod({ preset: "ytd" }, TODAY).from).toBe("2026-01-01");
    expect(resolvePeriod({ preset: "12m" }, TODAY).months).toHaveLength(12);
  });
  it("custom ranges are validated and clamped; garbage falls back to 6 months", () => {
    expect(resolvePeriod({ preset: "custom", from: "2026-10-15", to: "2026-11-05" }, TODAY)).toMatchObject({ from: "2026-10-15", to: "2026-11-05", months: ["2026-10", "2026-11"] });
    expect(resolvePeriod({ preset: "custom", from: "2026-10-15", to: "2030-01-01" }, TODAY).to).toBe(TODAY);
    expect(() => resolvePeriod({ preset: "custom", from: "2026-11-15", to: "2026-10-01" }, TODAY)).toThrow(LedgerError);
    expect(resolvePeriod({ preset: "custom", from: "bad", to: "x" }, TODAY).preset).toBe("6m");
    expect(resolvePeriod({ preset: "evil" }, TODAY).preset).toBe("6m");
    expect(resolvePeriod({ preset: "custom", from: "2000-01-01", to: TODAY }, TODAY).months.length).toBeLessThanOrEqual(25);
    expect(monthsBetween("2026-11-30", "2027-02-01")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("report figures reconcile with the ledger", () => {
  it("monthly rows equal the ledger's own month totals; the total is their sum", () => {
    const { db } = world();
    const r = R(db);
    for (const m of r.monthly) { const t = monthTotals(db, m.month); expect([m.income, m.expense, m.net]).toEqual([t.income, t.expense, t.net]); }
    expect(r.monthly.map((m) => [m.month, m.income, m.expense])).toEqual([["2026-09", 9_000_000, 1_025_000], ["2026-10", 9_000_000, 950_000], ["2026-11", 9_900_000, 82_500 + 120_000]]);
    expect(r.totals.income).toBe(r.monthly.reduce((s, m) => s + m.income, 0));
    expect(r.totals.expense).toBe(r.monthly.reduce((s, m) => s + m.expense, 0));
    expect(r.totals.net).toBe(r.totals.income - r.totals.expense);
    expect(r.totals.savingsRate).toBeCloseTo(r.totals.net / r.totals.income, 10);
  });
  it("transfers and reconciliation adjustments are not income or expense (only the transfer fee is spending)", () => {
    const { db, bca } = world();
    reconcileAccount(db, { account_id: bca, actual_balance: 1_000, occurred_on: "2026-11-15" }, T);
    const r = R(db);
    expect(r.monthly[2].expense).toBe(80_000 + 120_000 + 2_500);
    expect(r.totals.income).toBe(9_000_000 + 9_000_000 + 9_500_000 + 400_000);
  });
  it("categories add up to total expense; subcategories roll up and uncategorized is separate", () => {
    const { db } = world();
    const r = R(db);
    expect(r.expenseByCategory.reduce((s, c) => s + c.total, 0)).toBe(r.totals.expense);
    expect(r.expenseByCategory.every((c) => c.children.reduce((s, x) => s + x.total, 0) === c.total)).toBe(true);
    expect(r.expenseByCategory.find((c) => c.name === "Makanan & Minuman")).toMatchObject({ total: 1_000_000 + 25_000 + 80_000 + 600_000 }); // Makan, Kopi x2 and Belanja Harian are all under it
    expect(r.expenseByCategory.find((c) => c.name === "Tanpa kategori")?.total).toBe(120_000);
    expect(r.expenseByCategory.map((c) => c.total)).toEqual([...r.expenseByCategory.map((c) => c.total)].sort((a, b) => b - a));
    expect(Math.round(r.expenseByCategory.reduce((s, c) => s + c.pct, 0) * 1000)).toBe(1000);
    const nov = buildReport(db, resolvePeriod({ preset: "this_month" }, TODAY), TODAY);
    expect(nov.expenseByCategory.reduce((s, c) => s + c.total, 0)).toBe(spendingByCategory(db, "2026-11").reduce((s, c) => s + c.total, 0));
    expect(r.incomeByCategory.reduce((s, c) => s + c.total, 0)).toBe(r.totals.income);
  });
  it("custom ranges cut months at the chosen dates", () => {
    const { db } = world();
    const r = buildReport(db, resolvePeriod({ preset: "custom", from: "2026-11-05", to: "2026-11-10" }, TODAY), TODAY);
    expect(r.totals).toMatchObject({ income: 9_500_000, transactions: 3 }); // Nov 8 expense, Nov 9 transfer fee, Nov 10 salary
    expect(r.totals.expense).toBe(120_000 + 2_500);
  });
  it("performance: cash at month end is rebuilt from the ledger and the last point is today's real total", () => {
    const { db } = world();
    const r = R(db);
    const now = listAccounts(db, { archived: false }).reduce((s, a) => s + a.balance, 0);
    expect(r.performance[r.performance.length - 1].cash).toBe(now);
    expect(r.performance[0].cash).toBe(5_500_000 + 9_000_000 - 1_025_000);          // end of September
    expect(r.performance[1].cash).toBe(r.performance[0].cash + 9_000_000 - 950_000); // end of October
    expect(r.performance.every((p) => p.net === p.cash - p.debt)).toBe(true);
    expect(cashAtDates(db, ["2026-10-31"], TODAY).get("2026-10-31")).toBe(r.performance[1].cash);
  });
  it("is deterministic and read-only", () => {
    const { db } = world();
    const c = () => (db.prepare("SELECT (SELECT COUNT(*) FROM transactions)||'|'||(SELECT COUNT(*) FROM audit_logs) AS c").get() as { c: string }).c;
    const before = c();
    expect(JSON.stringify(R(db))).toBe(JSON.stringify(R(db)));
    expect(c()).toBe(before);
  });
});

describe("debt reduction and budgets in the report", () => {
  it("shows payments per month and the outstanding debt at each month end", () => {
    const { db, bca } = world();
    const debt = createDebt(db, { provider: "SeaBank", model: "none", principal: 600_000, count: 3, start_date: "2026-09-01", first_due_date: "2026-10-05", payment_account_id: bca });
    recordDebtPayment(db, { debt_id: debt, account_id: bca, amount: 200_000, paid_on: "2026-10-05", penalty: 5_000 }, T);
    recordDebtPayment(db, { debt_id: debt, account_id: bca, amount: 200_000, paid_on: "2026-11-05", fee: 2_000 }, T);
    const r = R(db);
    expect(r.debt.months.map((m) => [m.month, m.paid, m.outstandingEnd])).toEqual([["2026-09", 0, 600_000], ["2026-10", 200_000, 400_000], ["2026-11", 200_000, 200_000]]);
    expect(r.debt).toMatchObject({ paidInPeriod: 400_000, extraInPeriod: 7_000, outstandingNow: 200_000 });
    expect(outstandingDebtNow(db)).toBe(200_000);
    expect(outstandingDebtAt(db, "2026-10-31", TODAY)).toBe(400_000);
    expect(r.performance[2].debt).toBe(200_000);
  });
  it("a voided payment disappears from the history and restores the outstanding amount", () => {
    const { db, bca } = world();
    const debt = createDebt(db, { provider: "X", model: "none", principal: 300_000, count: 1, start_date: "2026-10-01", first_due_date: "2026-10-05", payment_account_id: bca });
    const p = recordDebtPayment(db, { debt_id: debt, account_id: bca, amount: 300_000, paid_on: "2026-10-05" }, T);
    expect(R(db).debt.paidInPeriod).toBe(300_000);
    voidDebtPayment(db, p.paymentId);
    expect(R(db).debt).toMatchObject({ paidInPeriod: 0, outstandingNow: 300_000 });
  });
  it("budget vs actual per month for budgeted categories only", () => {
    const { db } = world();
    setBudget(db, findCategoryId(db, "Makanan & Minuman", "expense")!, "2026-09", 1_000_000);
    setBudget(db, findCategoryId(db, "Makanan & Minuman", "expense")!, "2026-11", 100_000);
    const b = R(db).budgets;
    expect(b).toEqual([{ month: "2026-09", budget: 1_000_000, actual: 1_025_000, over: 1 }, { month: "2026-11", budget: 100_000, actual: 80_000, over: 0 }]);
  });
});

describe("exports", () => {
  it("transaction rows include transfers, signed amounts, readable categories, and add up to the report", () => {
    const { db } = world();
    const p = resolvePeriod({ preset: "3m" }, TODAY);
    const rows = exportRows(db, p);
    const r = buildReport(db, p, TODAY);
    expect(rows.filter((x) => x.kind === "income").reduce((s, x) => s + x.amount, 0)).toBe(r.totals.income);
    expect(rows.filter((x) => x.kind === "expense").reduce((s, x) => s - x.amount, 0)).toBe(r.totals.expense);
    const tr = rows.find((x) => x.kind === "transfer")!;
    expect(tr).toMatchObject({ account: "BCA -> GoPay", amount: -700_000 });
    expect(rows.find((x) => x.description === "Kopi")).toMatchObject({ category: "Makanan & Minuman > Kopi", merchant: "Fore", tags: "harian", amount: -80_000 });
    expect([...rows].sort((a, b) => a.date.localeCompare(b.date))).toEqual(rows);
  });
  it("voided transactions are not exported", () => {
    const { db, add } = world();
    const id = add("expense", 1, 999_999, "2026-11-11", null, "salah");
    db.prepare("UPDATE transactions SET status='voided' WHERE id=?").run(id);
    expect(exportRows(db, resolvePeriod({ preset: "3m" }, TODAY)).some((x) => x.description === "salah")).toBe(false);
  });
  it("CSV: quotes, escapes, neutralizes spreadsheet formulas, keeps numbers plain, starts with a BOM", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+62812")).toBe("'+62812");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("baris\nbaru")).toBe("baris baru");
    expect(csvCell(-1250000)).toBe("-1250000");
    expect(csvCell(null)).toBe("");
    const csv = toCsv(["a", "b"], [["x", 1], ["=1+1", -2]]);
    expect(csv.startsWith("\uFEFFa,b\r\n")).toBe(true);
    expect(csv.split("\r\n")).toEqual(["\uFEFFa,b", "x,1", "'=1+1,-2", ""]);
  });
  it("PDF is produced offline, is a valid document, and contains the report's numbers", async () => {
    const { db } = world();
    const r = R(db);
    const bytes = await buildReportPdf(r);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
    expect(doc.numPages).toBeGreaterThanOrEqual(1);
    let text = "";
    for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" ");
    expect(text).toContain("Laporan Keuangan");
    expect(text).toContain("Rp 27.900.000");   // income
    expect(text).toContain("Makanan & Minuman");
    expect(text).toContain("Halaman 1");
  }, 30_000);
  it("PDF generation survives characters the standard fonts cannot draw", async () => {
    const { db } = world();
    createTransaction(db, { type: "expense", account_id: 1, category_id: null, amount: 1_000, occurred_on: "2026-11-03", description: "日本語 ★ emoji 😀" }, T);
    const bytes = await buildReportPdf(R(db));
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
