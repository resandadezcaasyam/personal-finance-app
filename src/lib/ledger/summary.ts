import type Database from "better-sqlite3";
import { listAccounts } from "./accounts";
import { listLedger } from "./transactions";
import type { AccountWithBalance, LedgerEntry } from "./types";

export interface CategorySpend { name: string; total: number }

export interface DashboardSummary {
  month: string;
  totalCash: number;
  income: number;
  expense: number;
  net: number;
  accounts: AccountWithBalance[];
  spendingByCategory: CategorySpend[];
  recent: LedgerEntry[];
  transactionCount: number;
}

/** Income and expense only: transfers and reconciliation adjustments never appear in these totals. */
export function monthTotals(db: Database.Database, month: string) {
  const r = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type='income' THEN amount END),0) AS income,
         COALESCE(SUM(CASE WHEN type='expense' THEN amount END),0) AS expense
       FROM transactions WHERE status='posted' AND substr(occurred_on,1,7)=?`,
    )
    .get(month) as { income: number; expense: number };
  return { income: r.income, expense: r.expense, net: r.income - r.expense };
}

export function spendingByCategory(db: Database.Database, month: string): CategorySpend[] {
  return db
    .prepare(
      `SELECT COALESCE(p.name, c.name, 'Tanpa kategori') AS name, SUM(t.amount) AS total
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN categories p ON p.id = c.parent_id
       WHERE t.status='posted' AND t.type='expense' AND substr(t.occurred_on,1,7)=?
       GROUP BY 1 ORDER BY total DESC`,
    )
    .all(month) as CategorySpend[];
}

export function getDashboardSummary(db: Database.Database, month: string): DashboardSummary {
  const accounts = listAccounts(db, { archived: false });
  const t = monthTotals(db, month);
  const recent = listLedger(db, { pageSize: 8 });
  return {
    month,
    totalCash: accounts.reduce((s, a) => s + a.balance, 0),
    ...t,
    accounts,
    spendingByCategory: spendingByCategory(db, month),
    recent: recent.rows,
    transactionCount: (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status='posted'").get() as { n: number }).n,
  };
}
