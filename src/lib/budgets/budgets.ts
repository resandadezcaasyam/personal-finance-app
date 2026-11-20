import type Database from "better-sqlite3";
import { LedgerError } from "../ledger/errors";
import { writeAudit } from "../ledger/audit";
import { assertAmount } from "../ledger/validate";
import { addMonthsClamped } from "../format";

/**
 * Monthly category budgets. A budget belongs to a TOP-LEVEL expense category and covers its subcategories, so spending is
 * never counted twice. Actuals are posted expenses of the month (transfers and reconciliation adjustments are not expenses;
 * debt and bill payments are, under their own categories).
 */
export const WARN_AT = 0.9;
export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export const previousMonthOf = (m: string) => addMonthsClamped(`${m}-01`, -1).slice(0, 7);

export type BudgetStatus = "none" | "ok" | "warning" | "over";
export interface BudgetLine { category_id: number; name: string; budget: number | null; actual: number; remaining: number | null; pct: number | null; status: BudgetStatus }
export interface BudgetView {
  month: string;
  lines: BudgetLine[];
  /** Expenses without a category: reported, but they cannot be budgeted. */
  uncategorized: number;
  totalBudget: number;
  /** Actual spending in categories that have a budget. */
  totalActualBudgeted: number;
  totalActual: number;
}

export function statusOf(budget: number | null, actual: number): BudgetStatus {
  if (budget === null) return "none";
  if (actual > budget) return "over";
  if (budget > 0 && actual >= budget * WARN_AT) return "warning";
  return "ok";
}

export function getBudgetView(db: Database.Database, month: string): BudgetView {
  if (!isMonth(month)) throw new LedgerError("Bulan tidak valid.", "month");
  const actuals = db.prepare(
    `SELECT COALESCE(p.id, c.id) AS top_id, SUM(t.amount) AS total
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
     WHERE t.status = 'posted' AND t.type = 'expense' AND substr(t.occurred_on, 1, 7) = ? GROUP BY top_id`,
  ).all(month) as { top_id: number | null; total: number }[];
  const actual = new Map(actuals.map((a) => [a.top_id, a.total]));
  const budgets = new Map((db.prepare("SELECT category_id, amount FROM budgets WHERE month = ?").all(month) as { category_id: number; amount: number }[]).map((b) => [b.category_id, b.amount]));
  const cats = db.prepare("SELECT id, name, is_archived FROM categories WHERE kind = 'expense' AND parent_id IS NULL ORDER BY name COLLATE NOCASE").all() as { id: number; name: string; is_archived: number }[];
  const lines: BudgetLine[] = [];
  for (const c of cats) {
    const a = actual.get(c.id) ?? 0;
    const b = budgets.get(c.id) ?? null;
    if (c.is_archived && b === null && a === 0) continue;
    lines.push({ category_id: c.id, name: c.name, budget: b, actual: a, remaining: b === null ? null : b - a, pct: b === null ? null : b > 0 ? a / b : a > 0 ? Infinity : 0, status: statusOf(b, a) });
  }
  lines.sort((x, y) => Number(y.budget !== null) - Number(x.budget !== null) || y.actual - x.actual || x.name.localeCompare(y.name));
  const totalActual = actuals.reduce((s, a) => s + a.total, 0);
  return {
    month, lines, uncategorized: actual.get(null) ?? 0,
    totalBudget: lines.reduce((s, l) => s + (l.budget ?? 0), 0), totalActualBudgeted: lines.reduce((s, l) => s + (l.budget !== null ? l.actual : 0), 0), totalActual,
  };
}

/** Set or clear (amount = null) the budget of a top-level expense category for a month. */
export function setBudget(db: Database.Database, categoryId: number, month: string, amount: number | null) {
  if (!isMonth(month)) throw new LedgerError("Bulan tidak valid.", "month");
  const c = db.prepare("SELECT kind, parent_id, name FROM categories WHERE id = ?").get(categoryId) as { kind: string; parent_id: number | null; name: string } | undefined;
  if (!c) throw new LedgerError("Kategori tidak ditemukan.", "category_id");
  if (c.kind !== "expense") throw new LedgerError("Anggaran hanya untuk kategori pengeluaran.", "category_id");
  if (c.parent_id !== null) throw new LedgerError("Anggaran dipasang pada kategori utama; subkategori ikut terhitung di dalamnya.", "category_id");
  db.transaction(() => {
    if (amount === null) db.prepare("DELETE FROM budgets WHERE category_id = ? AND month = ?").run(categoryId, month);
    else {
      assertAmount(amount, "amount", true);
      db.prepare("INSERT INTO budgets (category_id, month, amount) VALUES (?,?,?) ON CONFLICT(category_id, month) DO UPDATE SET amount = excluded.amount").run(categoryId, month, amount);
    }
    writeAudit(db, "budget", categoryId, amount === null ? "clear" : "set", null, { month, amount, category: c.name });
  })();
}

/** Copy one month's budgets to another. Existing budgets in the target month are kept unless `overwrite` is set. */
export function copyBudgets(db: Database.Database, from: string, to: string, opts: { overwrite?: boolean } = {}): { copied: number; skipped: number } {
  if (!isMonth(from) || !isMonth(to)) throw new LedgerError("Bulan tidak valid.", "month");
  if (from === to) throw new LedgerError("Bulan asal dan tujuan harus berbeda.", "month");
  const src = db.prepare("SELECT category_id, amount FROM budgets WHERE month = ?").all(from) as { category_id: number; amount: number }[];
  if (src.length === 0) throw new LedgerError("Bulan asal belum punya anggaran.", "month");
  let copied = 0, skipped = 0;
  db.transaction(() => {
    for (const b of src) {
      const has = db.prepare("SELECT 1 FROM budgets WHERE category_id = ? AND month = ?").get(b.category_id, to);
      if (has && !opts.overwrite) { skipped++; continue; }
      db.prepare("INSERT INTO budgets (category_id, month, amount) VALUES (?,?,?) ON CONFLICT(category_id, month) DO UPDATE SET amount = excluded.amount").run(b.category_id, to, b.amount);
      copied++;
    }
    writeAudit(db, "budget", null, "copy", null, { from, to, copied, skipped });
  })();
  return { copied, skipped };
}
