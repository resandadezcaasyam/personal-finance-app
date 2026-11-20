import type Database from "better-sqlite3";
import { writeAudit } from "./audit";
import { LedgerError } from "./errors";
import { requireActiveAccount } from "./accounts";
import { assertAmount, isValidIsoDate } from "./validate";

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";

export interface RecurringIncomeInput {
  name: string;
  amount: number;
  account_id: number;
  category_id: number | null;
  frequency: Frequency;
  day_of_month: number | null;
  start_date: string;
  end_date?: string | null;
}

export interface RecurringRuleRow {
  id: number; name: string; type: "income" | "expense"; amount: number; account_id: number | null; category_id: number | null;
  frequency: Frequency; day_of_month: number | null; start_date: string; end_date: string | null; is_active: number;
  account_name: string | null;
}

/**
 * Phase 2 only stores the configuration (e.g. monthly salary). Nothing is posted automatically;
 * generation of planned entries arrives with Phase 7 so projections never masquerade as actuals.
 */
export function createRecurringIncome(db: Database.Database, i: RecurringIncomeInput): number {
  const name = i.name.trim();
  if (!name) throw new LedgerError("Nama wajib diisi.", "name");
  assertAmount(i.amount);
  requireActiveAccount(db, i.account_id);
  if (!isValidIsoDate(i.start_date)) throw new LedgerError("Tanggal mulai tidak valid.", "start_date");
  if (i.end_date && (!isValidIsoDate(i.end_date) || i.end_date < i.start_date)) throw new LedgerError("Tanggal berakhir harus setelah tanggal mulai.", "end_date");
  if (i.frequency !== "weekly") {
    if (!i.day_of_month || i.day_of_month < 1 || i.day_of_month > 31) throw new LedgerError("Tanggal gajian harus antara 1 dan 31.", "day_of_month");
  }
  return db.transaction(() => {
    const id = Number(
      db.prepare(
        `INSERT INTO recurring_rules (name, type, amount, account_id, category_id, frequency, day_of_month, start_date, end_date)
         VALUES (?, 'income', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(name, i.amount, i.account_id, i.category_id, i.frequency, i.frequency === "weekly" ? null : i.day_of_month, i.start_date, i.end_date || null).lastInsertRowid,
    );
    writeAudit(db, "recurring_rule", id, "create", null, i);
    return id;
  })();
}

export function listRecurringIncome(db: Database.Database): RecurringRuleRow[] {
  return db
    .prepare(
      `SELECT r.*, a.name AS account_name FROM recurring_rules r LEFT JOIN accounts a ON a.id = r.account_id
       WHERE r.type='income' ORDER BY r.is_active DESC, r.name COLLATE NOCASE`,
    )
    .all() as RecurringRuleRow[];
}

export function setRecurringActive(db: Database.Database, id: number, active: boolean) {
  db.transaction(() => {
    db.prepare("UPDATE recurring_rules SET is_active=? WHERE id=?").run(active ? 1 : 0, id);
    writeAudit(db, "recurring_rule", id, active ? "activate" : "deactivate", null, { is_active: active });
  })();
}
