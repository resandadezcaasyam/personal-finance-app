import type Database from "better-sqlite3";
import { writeAudit } from "./audit";
import { LedgerError } from "./errors";
import { assertAmount } from "./validate";
import type { AccountRow, AccountType, AccountWithBalance } from "./types";

/**
 * Balance is always derived from the ledger, never stored:
 * initial + income - expense +/- reconciliation adjustments + transfers in - transfers out.
 * Voided rows are ignored. Transfer fees are separate expense rows, so they are not subtracted here.
 */
const BALANCE_SQL = `
SELECT a.*,
  a.initial_balance
  + COALESCE((SELECT SUM(CASE
        WHEN t.type = 'income' OR (t.type = 'adjustment' AND t.adj_direction = 'in') THEN t.amount
        WHEN t.type = 'expense' OR (t.type = 'adjustment' AND t.adj_direction = 'out') THEN -t.amount
        ELSE 0 END)
      FROM transactions t WHERE t.account_id = a.id AND t.status = 'posted'), 0)
  + COALESCE((SELECT SUM(amount) FROM transfers WHERE to_account_id = a.id AND status = 'posted'), 0)
  - COALESCE((SELECT SUM(amount) FROM transfers WHERE from_account_id = a.id AND status = 'posted'), 0) AS balance
FROM accounts a`;

export function listAccounts(db: Database.Database, opts: { archived?: boolean } = {}): AccountWithBalance[] {
  const where = opts.archived === undefined ? "" : `WHERE a.is_archived = ${opts.archived ? 1 : 0}`;
  return db.prepare(`${BALANCE_SQL} ${where} ORDER BY a.is_archived, a.sort_order, a.name COLLATE NOCASE`).all() as AccountWithBalance[];
}

export function getAccount(db: Database.Database, id: number): AccountWithBalance | undefined {
  return db.prepare(`${BALANCE_SQL} WHERE a.id = ?`).get(id) as AccountWithBalance | undefined;
}

export function getBalance(db: Database.Database, id: number): number {
  const a = getAccount(db, id);
  if (!a) throw new LedgerError("Akun tidak ditemukan.", "account_id");
  return a.balance;
}

export function requireActiveAccount(db: Database.Database, id: number, field = "account_id"): AccountRow {
  const a = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
  if (!a) throw new LedgerError("Akun tidak ditemukan.", field);
  if (a.is_archived) throw new LedgerError(`Akun "${a.name}" sudah diarsipkan.`, field);
  return a;
}

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new LedgerError("Nama akun wajib diisi.", "name");
  if (n.length > 60) throw new LedgerError("Nama akun maksimal 60 karakter.", "name");
  return n;
}

function mapUnique(e: unknown): never {
  if (e instanceof Error && "code" in e && (e as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
    throw new LedgerError("Sudah ada akun aktif dengan nama tersebut.", "name");
  }
  throw e;
}

export function createAccount(db: Database.Database, input: { name: string; type: AccountType; initial_balance: number }): number {
  const name = cleanName(input.name);
  assertAmount(input.initial_balance, "initial_balance", true);
  try {
    return db.transaction(() => {
      const next = (db.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts").get() as { n: number }).n;
      const id = Number(
        db.prepare("INSERT INTO accounts (name, type, initial_balance, sort_order) VALUES (?,?,?,?)").run(name, input.type, input.initial_balance, next).lastInsertRowid,
      );
      writeAudit(db, "account", id, "create", null, { name, type: input.type, initial_balance: input.initial_balance });
      return id;
    })();
  } catch (e) {
    return mapUnique(e);
  }
}

/** Editing the initial balance changes the derived balance by the same amount; the change is audited. */
export function updateAccount(db: Database.Database, id: number, input: { name: string; type: AccountType; initial_balance: number }) {
  const before = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
  if (!before) throw new LedgerError("Akun tidak ditemukan.");
  const name = cleanName(input.name);
  assertAmount(input.initial_balance, "initial_balance", true);
  try {
    db.transaction(() => {
      db.prepare("UPDATE accounts SET name=?, type=?, initial_balance=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(
        name, input.type, input.initial_balance, id,
      );
      writeAudit(db, "account", id, "update", { name: before.name, type: before.type, initial_balance: before.initial_balance }, { name, type: input.type, initial_balance: input.initial_balance });
    })();
  } catch (e) {
    mapUnique(e);
  }
}

/** An account can only be archived at a zero balance, so no money ever disappears from the totals. */
export function archiveAccount(db: Database.Database, id: number) {
  const a = getAccount(db, id);
  if (!a) throw new LedgerError("Akun tidak ditemukan.");
  if (a.is_archived) return;
  if (a.balance !== 0) throw new LedgerError("Saldo akun harus Rp 0 sebelum diarsipkan. Pindahkan dananya lewat transfer atau lakukan rekonsiliasi.");
  db.transaction(() => {
    db.prepare("UPDATE accounts SET is_archived=1, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(id);
    writeAudit(db, "account", id, "archive", { is_archived: 0 }, { is_archived: 1 });
  })();
}

export function restoreAccount(db: Database.Database, id: number) {
  const a = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
  if (!a) throw new LedgerError("Akun tidak ditemukan.");
  try {
    db.transaction(() => {
      db.prepare("UPDATE accounts SET is_archived=0, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(id);
      writeAudit(db, "account", id, "restore", { is_archived: 1 }, { is_archived: 0 });
    })();
  } catch (e) {
    mapUnique(e);
  }
}
