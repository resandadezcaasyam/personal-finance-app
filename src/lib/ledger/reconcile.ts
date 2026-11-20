import type Database from "better-sqlite3";
import { writeAudit } from "./audit";
import { LedgerError } from "./errors";
import { getBalance, requireActiveAccount } from "./accounts";
import { MAX_AMOUNT, assertPastOrToday } from "./validate";
import { formatIDR } from "../format";

export interface ReconcileResult {
  adjusted: boolean;
  difference: number;
  transactionId?: number;
}

/**
 * Align the recorded balance with the real balance (bank app, wallet, cash count).
 * The gap is posted as an `adjustment` transaction, never as income or expense, and is audited.
 */
export function reconcileAccount(
  db: Database.Database,
  input: { account_id: number; actual_balance: number; occurred_on: string; note?: string },
  opts: { today?: string } = {},
): ReconcileResult {
  if (!Number.isSafeInteger(input.actual_balance) || Math.abs(input.actual_balance) > MAX_AMOUNT) {
    throw new LedgerError("Saldo aktual tidak valid.", "actual_balance");
  }
  assertPastOrToday(input.occurred_on, opts.today);
  const account = requireActiveAccount(db, input.account_id);
  const note = (input.note ?? "").trim().slice(0, 150);

  return db.transaction(() => {
    const recorded = getBalance(db, input.account_id);
    const diff = input.actual_balance - recorded;
    if (diff === 0) return { adjusted: false, difference: 0 };
    const description = `Rekonsiliasi: tercatat ${formatIDR(recorded)}, aktual ${formatIDR(input.actual_balance)}${note ? ` (${note})` : ""}`;
    const id = Number(
      db.prepare(
        `INSERT INTO transactions (account_id, type, amount, occurred_on, description, source, adj_direction) VALUES (?,?,?,?,?,?,?)`,
      ).run(input.account_id, "adjustment", Math.abs(diff), input.occurred_on, description, "reconciliation", diff > 0 ? "in" : "out").lastInsertRowid,
    );
    writeAudit(db, "account", account.id, "reconcile", { balance: recorded }, { balance: input.actual_balance, adjustment_transaction_id: id });
    return { adjusted: true, difference: diff, transactionId: id };
  })();
}
