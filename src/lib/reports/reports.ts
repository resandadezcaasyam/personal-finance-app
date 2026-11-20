import type Database from "better-sqlite3";
import { LedgerError } from "../ledger/errors";
import { addMonthsClamped, daysBetween, isoOrNull, monthRange, shiftDate, todayWIB } from "../format";
import { listAccounts } from "../ledger/accounts";
import { getBudgetView } from "../budgets/budgets";

/**
 * Reports are read-only views of the ledger. Every figure is computed from posted transactions, transfers and debt
 * payments, and the parts always add up to the whole (monthly rows sum to the totals, categories sum to total expense),
 * which the tests assert against the ledger itself.
 */
export type Preset = "this_month" | "last_month" | "3m" | "6m" | "12m" | "ytd" | "custom";
export const PRESET_LABEL: Record<Preset, string> = { this_month: "Bulan ini", last_month: "Bulan lalu", "3m": "3 bulan terakhir", "6m": "6 bulan terakhir", "12m": "12 bulan terakhir", ytd: "Tahun ini", custom: "Kustom" };
export const MAX_REPORT_MONTHS = 24;

export interface Period { preset: Preset; from: string; to: string; months: string[] }

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7) && out.length <= MAX_REPORT_MONTHS; m = addMonthsClamped(`${m}-01`, 1).slice(0, 7)) out.push(m);
  return out;
}

/** Untrusted URL parameters -> a valid period (never later than today, at most 24 months). */
export function resolvePeriod(sp: { preset?: string; from?: string; to?: string }, today: string = todayWIB()): Period {
  const thisM = today.slice(0, 7);
  const back = (n: number) => addMonthsClamped(`${thisM}-01`, -n);
  let preset = (["this_month", "last_month", "3m", "6m", "12m", "ytd", "custom"] as const).find((p) => p === sp.preset) ?? "6m";
  let from = "";
  let to = "";
  if (preset === "custom") {
    const f = isoOrNull(sp.from), t = isoOrNull(sp.to);
    if (f && t) { from = f; to = t; } else preset = "6m";
  }
  if (preset === "this_month") { from = `${thisM}-01`; to = today; }
  else if (preset === "last_month") { const m = back(1); from = m; to = monthRange(m.slice(0, 7)).to; }
  else if (preset === "3m") { from = back(2); to = today; }
  else if (preset === "ytd") { from = `${today.slice(0, 4)}-01-01`; to = today; }
  else if (preset === "12m") { from = back(11); to = today; }
  else if (preset === "6m") { from = back(5); to = today; }
  if (to > today) to = today;
  if (from > to) throw new LedgerError("Tanggal awal tidak boleh setelah tanggal akhir.", "from");
  if (daysBetween(from, to) > 740) from = shiftDate(to, -739);
  return { preset, from, to, months: monthsBetween(from, to) };
}

export interface MonthlyRow { month: string; income: number; expense: number; net: number; savingsRate: number | null }
export interface CategoryRowR { name: string; total: number; pct: number; children: { name: string; total: number }[] }
export interface DebtMonth { month: string; paid: number; extra: number; outstandingEnd: number }
export interface BudgetMonth { month: string; budget: number; actual: number; over: number }
export interface PerfMonth { month: string; cash: number; debt: number; net: number }

export interface Report {
  period: Period;
  generatedOn: string;
  totals: { income: number; expense: number; net: number; savingsRate: number | null; transactions: number };
  monthly: MonthlyRow[];
  expenseByCategory: CategoryRowR[];
  incomeByCategory: { name: string; total: number }[];
  debt: { months: DebtMonth[]; paidInPeriod: number; extraInPeriod: number; outstandingNow: number };
  budgets: BudgetMonth[];
  performance: PerfMonth[];
}

const rate = (income: number, net: number) => (income > 0 ? net / income : null);

export function outstandingDebtNow(db: Database.Database): number {
  return (db.prepare(
    `SELECT COALESCE(SUM(s.amount_due - s.amount_paid), 0) AS n FROM installment_schedules s JOIN debts d ON d.id = s.debt_id WHERE d.status IN ('active','settled') AND s.status <> 'skipped'`,
  ).get() as { n: number }).n;
}

/** Outstanding debt at the end of `date`: today's balance plus everything paid after that date (only real, posted payments). */
export function outstandingDebtAt(db: Database.Database, date: string, today: string): number {
  const now = outstandingDebtNow(db);
  if (date >= today) return now;
  const later = (db.prepare("SELECT COALESCE(SUM(p.amount),0) AS n FROM debt_payments p JOIN debts d ON d.id = p.debt_id WHERE p.status = 'posted' AND d.status IN ('active','settled') AND p.paid_on > ?").get(date) as { n: number }).n;
  return now + later;
}

/** Total cash across accounts that are active now, at the end of each date, reconstructed from the ledger. */
export function cashAtDates(db: Database.Database, dates: string[], today: string): Map<string, number> {
  const active = new Set(listAccounts(db, { archived: false }).map((a) => a.id));
  const current = listAccounts(db, { archived: false }).reduce((s, a) => s + a.balance, 0);
  const out = new Map<string, number>();
  if (dates.length === 0) return out;
  const earliest = dates.reduce((a, b) => (a < b ? a : b));
  const deltas: { d: string; v: number }[] = [];
  for (const r of db.prepare("SELECT occurred_on AS d, account_id, type, amount, adj_direction FROM transactions WHERE status='posted' AND occurred_on > ?").all(earliest) as { d: string; account_id: number; type: string; amount: number; adj_direction: string | null }[]) {
    if (active.has(r.account_id)) deltas.push({ d: r.d, v: r.type === "income" || (r.type === "adjustment" && r.adj_direction === "in") ? r.amount : -r.amount });
  }
  for (const r of db.prepare("SELECT occurred_on AS d, from_account_id AS f, to_account_id AS t, amount FROM transfers WHERE status='posted' AND occurred_on > ?").all(earliest) as { d: string; f: number; t: number; amount: number }[]) {
    deltas.push({ d: r.d, v: (active.has(r.t) ? r.amount : 0) - (active.has(r.f) ? r.amount : 0) });
  }
  for (const date of dates) {
    const d = date > today ? today : date;
    out.set(date, current - deltas.filter((x) => x.d > d).reduce((s, x) => s + x.v, 0));
  }
  return out;
}

export function buildReport(db: Database.Database, period: Period, today: string = todayWIB()): Report {
  const { from, to, months } = period;
  const range = [from, to];
  const monthRows = db.prepare(
    `SELECT substr(occurred_on,1,7) AS m, type, SUM(amount) AS total, COUNT(*) AS n FROM transactions
     WHERE status='posted' AND type IN ('income','expense') AND occurred_on BETWEEN ? AND ? GROUP BY m, type`,
  ).all(...range) as { m: string; type: string; total: number; n: number }[];
  const monthly: MonthlyRow[] = months.map((m) => {
    const income = monthRows.find((r) => r.m === m && r.type === "income")?.total ?? 0;
    const expense = monthRows.find((r) => r.m === m && r.type === "expense")?.total ?? 0;
    return { month: m, income, expense, net: income - expense, savingsRate: rate(income, income - expense) };
  });
  const income = monthly.reduce((s, r) => s + r.income, 0), expense = monthly.reduce((s, r) => s + r.expense, 0);

  const catRows = db.prepare(
    `SELECT COALESCE(p.name, c.name, 'Tanpa kategori') AS top, CASE WHEN p.id IS NOT NULL THEN c.name ELSE NULL END AS sub, SUM(t.amount) AS total
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
     WHERE t.status='posted' AND t.type='expense' AND t.occurred_on BETWEEN ? AND ? GROUP BY top, sub`,
  ).all(...range) as { top: string; sub: string | null; total: number }[];
  const byTop = new Map<string, CategoryRowR>();
  for (const r of catRows) {
    const row = byTop.get(r.top) ?? { name: r.top, total: 0, pct: 0, children: [] };
    row.total += r.total;
    row.children.push({ name: r.sub ?? "(langsung di kategori utama)", total: r.total });
    byTop.set(r.top, row);
  }
  const expenseByCategory = [...byTop.values()].map((r) => ({ ...r, pct: expense ? r.total / expense : 0, children: r.children.sort((a, b) => b.total - a.total) })).sort((a, b) => b.total - a.total);
  const incomeByCategory = (db.prepare(
    `SELECT COALESCE(c.name, 'Tanpa kategori') AS name, SUM(t.amount) AS total FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.status='posted' AND t.type='income' AND t.occurred_on BETWEEN ? AND ? GROUP BY name ORDER BY total DESC`,
  ).all(...range) as { name: string; total: number }[]);

  const pay = db.prepare(
    `SELECT substr(p.paid_on,1,7) AS m, SUM(p.amount) AS paid, SUM(p.penalty + p.fee) AS extra FROM debt_payments p JOIN debts d ON d.id = p.debt_id
     WHERE p.status='posted' AND d.status IN ('active','settled') AND p.paid_on BETWEEN ? AND ? GROUP BY m`,
  ).all(...range) as { m: string; paid: number; extra: number }[];
  const debtMonths: DebtMonth[] = months.map((m) => {
    const end = monthRange(m).to;
    const p = pay.find((x) => x.m === m);
    return { month: m, paid: p?.paid ?? 0, extra: p?.extra ?? 0, outstandingEnd: outstandingDebtAt(db, end > to ? to : end, today) };
  });

  const budgets: BudgetMonth[] = [];
  for (const m of months) {
    const v = getBudgetView(db, m);
    if (v.totalBudget > 0) budgets.push({ month: m, budget: v.totalBudget, actual: v.totalActualBudgeted, over: v.lines.filter((l) => l.status === "over").length });
  }

  const ends = months.map((m) => { const e = monthRange(m).to; return e > to ? to : e; });
  const cash = cashAtDates(db, ends, today);
  const performance: PerfMonth[] = months.map((m, i) => {
    const c = cash.get(ends[i]) ?? 0;
    const d = outstandingDebtAt(db, ends[i], today);
    return { month: m, cash: c, debt: d, net: c - d };
  });
  const txCount = monthRows.reduce((s, r) => s + r.n, 0);
  return {
    period, generatedOn: today, totals: { income, expense, net: income - expense, savingsRate: rate(income, income - expense), transactions: txCount }, monthly, expenseByCategory, incomeByCategory,
    debt: { months: debtMonths, paidInPeriod: debtMonths.reduce((s, m) => s + m.paid, 0), extraInPeriod: debtMonths.reduce((s, m) => s + m.extra, 0), outstandingNow: outstandingDebtNow(db) },
    budgets, performance,
  };
}

/* ---------------- row export ---------------- */

export interface ExportRow { date: string; kind: string; account: string; category: string; description: string; merchant: string; tags: string; amount: number; source: string }

/** Posted transactions and transfers in the period, oldest first. Amounts are signed: income and transfers-in positive, expense and transfers-out negative. */
export function exportRows(db: Database.Database, period: Period): ExportRow[] {
  const tx = db.prepare(
    `SELECT t.occurred_on AS date, t.type AS kind, a.name AS account, COALESCE(p.name || ' > ' || c.name, c.name, '') AS category, t.description, COALESCE(t.merchant,'') AS merchant,
            COALESCE(t.tags,'') AS tags, CASE WHEN t.type='income' OR (t.type='adjustment' AND t.adj_direction='in') THEN t.amount ELSE -t.amount END AS amount, t.source, t.id AS id
     FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
     WHERE t.status='posted' AND t.occurred_on BETWEEN ? AND ?`,
  ).all(period.from, period.to) as (ExportRow & { id: number })[];
  const tr = db.prepare(
    `SELECT r.occurred_on AS date, 'transfer' AS kind, a.name || ' -> ' || b.name AS account, '' AS category, r.description, '' AS merchant, '' AS tags, -r.amount AS amount, 'transfer' AS source, r.id AS id
     FROM transfers r JOIN accounts a ON a.id = r.from_account_id JOIN accounts b ON b.id = r.to_account_id WHERE r.status='posted' AND r.occurred_on BETWEEN ? AND ?`,
  ).all(period.from, period.to) as (ExportRow & { id: number })[];
  return [...tx, ...tr].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.id - b.id).map(({ id, ...r }) => (void id, r));
}
