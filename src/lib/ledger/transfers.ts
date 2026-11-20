import type Database from "better-sqlite3";
import { writeAudit } from "./audit";
import { LedgerError } from "./errors";
import { requireActiveAccount } from "./accounts";
import { findCategoryId } from "./categories";
import { assertAmount, assertPastOrToday } from "./validate";

export interface TransferInput {
  from_account_id: number;
  to_account_id: number;
  amount: number;
  /** Optional admin fee. It is paid from the source account and recorded as a separate expense. */
  fee?: number;
  occurred_on: string;
  description?: string;
}

/**
 * A transfer moves money between two of the user's accounts. It lives in `transfers`, never in
 * income/expense, so it cannot inflate either. Only the fee is a real expense.
 */
export function createTransfer(db: Database.Database, input: TransferInput, opts: { today?: string } = {}): number {
  const fee = input.fee ?? 0;
  assertAmount(input.amount);
  assertAmount(fee, "fee", true);
  assertPastOrToday(input.occurred_on, opts.today);
  if (input.from_account_id === input.to_account_id) throw new LedgerError("Akun asal dan tujuan harus berbeda.", "to_account_id");
  requireActiveAccount(db, input.from_account_id, "from_account_id");
  requireActiveAccount(db, input.to_account_id, "to_account_id");
  const description = (input.description ?? "").trim();
  if (description.length > 200) throw new LedgerError("Catatan maksimal 200 karakter.", "description");

  return db.transaction(() => {
    const id = Number(
      db.prepare("INSERT INTO transfers (from_account_id, to_account_id, amount, fee, occurred_on, description) VALUES (?,?,?,?,?,?)")
        .run(input.from_account_id, input.to_account_id, input.amount, fee, input.occurred_on, description).lastInsertRowid,
    );
    if (fee > 0) {
      db.prepare(
        `INSERT INTO transactions (account_id, category_id, type, amount, occurred_on, description, source, source_ref)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(input.from_account_id, findCategoryId(db, "Biaya Admin & Bunga", "expense"), "expense", fee, input.occurred_on, "Biaya transfer", "transfer_fee", `transfer:${id}`);
    }
    writeAudit(db, "transfer", id, "create", null, { ...input, fee, description });
    return id;
  })();
}

export function voidTransfer(db: Database.Database, id: number) {
  const before = db.prepare("SELECT * FROM transfers WHERE id = ?").get(id) as { status: string } | undefined;
  if (!before) throw new LedgerError("Transfer tidak ditemukan.");
  if (before.status === "voided") return;
  db.transaction(() => {
    db.prepare("UPDATE transfers SET status='voided' WHERE id=?").run(id);
    db.prepare("UPDATE transactions SET status='voided', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE source='transfer_fee' AND source_ref=?").run(`transfer:${id}`);
    writeAudit(db, "transfer", id, "void", { status: "posted" }, { status: "voided" });
  })();
}
