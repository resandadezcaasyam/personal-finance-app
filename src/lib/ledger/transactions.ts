import type Database from "better-sqlite3";
import { writeAudit } from "./audit";
import { LedgerError } from "./errors";
import { requireActiveAccount } from "./accounts";
import { categoryAndChildren } from "./categories";
import { assertAmount, assertPastOrToday, normalizeTags } from "./validate";
import type { CategoryRow, LedgerEntry, LedgerKind } from "./types";

export interface TxInput {
  type: "income" | "expense";
  account_id: number;
  category_id: number | null;
  amount: number;
  occurred_on: string;
  description: string;
  merchant?: string | null;
  tags?: string | null;
  /** Origin of the row. Imports (Phase 4) use source + source_ref for idempotency. */
  source?: string;
  source_ref?: string | null;
}

interface TxRow {
  id: number; account_id: number; category_id: number | null; type: "income" | "expense" | "adjustment";
  amount: number; occurred_on: string; description: string; merchant: string | null; tags: string | null;
  status: "posted" | "voided"; source: string; source_ref: string | null; adj_direction: "in" | "out" | null;
}

function checkCategory(db: Database.Database, categoryId: number | null, type: "income" | "expense") {
  if (categoryId === null) return;
  const c = db.prepare("SELECT * FROM categories WHERE id = ?").get(categoryId) as CategoryRow | undefined;
  if (!c) throw new LedgerError("Kategori tidak ditemukan.", "category_id");
  if (c.kind !== type) throw new LedgerError(`Kategori "${c.name}" bukan kategori ${type === "income" ? "pemasukan" : "pengeluaran"}.`, "category_id");
  if (c.is_archived) throw new LedgerError(`Kategori "${c.name}" sudah diarsipkan.`, "category_id");
}

function validate(db: Database.Database, i: TxInput, today?: string) {
  assertAmount(i.amount);
  assertPastOrToday(i.occurred_on, today);
  requireActiveAccount(db, i.account_id);
  checkCategory(db, i.category_id, i.type);
  if (i.description.length > 200) throw new LedgerError("Deskripsi maksimal 200 karakter.", "description");
  if ((i.merchant ?? "").length > 100) throw new LedgerError("Nama merchant maksimal 100 karakter.", "merchant");
}

export function createTransaction(db: Database.Database, input: TxInput, opts: { today?: string } = {}): number {
  validate(db, input, opts.today);
  const tags = normalizeTags(input.tags);
  const description = input.description.trim();
  const merchant = input.merchant?.trim() || null;
  try {
    return db.transaction(() => {
      const id = Number(
        db
          .prepare(
            `INSERT INTO transactions (account_id, category_id, type, amount, occurred_on, description, merchant, tags, source, source_ref)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(input.account_id, input.category_id, input.type, input.amount, input.occurred_on, description, merchant, tags, input.source ?? "manual", input.source_ref ?? null).lastInsertRowid,
      );
      writeAudit(db, "transaction", id, "create", null, { ...input, description, merchant, tags });
      return id;
    })();
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new LedgerError("Transaksi dengan referensi sumber yang sama sudah tercatat.");
    }
    throw e;
  }
}

/** Only ordinary income/expense rows are editable. Reconciliation and transfer-fee rows are system-made. */
export function updateTransaction(db: Database.Database, id: number, patch: Omit<TxInput, "type" | "source" | "source_ref">, opts: { today?: string } = {}) {
  const before = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as TxRow | undefined;
  if (!before) throw new LedgerError("Transaksi tidak ditemukan.");
  if (before.status === "voided") throw new LedgerError("Transaksi yang sudah dibatalkan tidak dapat diubah.");
  if (before.type === "adjustment") throw new LedgerError("Penyesuaian rekonsiliasi tidak dapat diedit. Batalkan lalu lakukan rekonsiliasi ulang.");
  if (before.source === "transfer_fee") throw new LedgerError("Biaya transfer diubah lewat transfer terkait.");
  const next: TxInput = { ...patch, type: before.type };
  validate(db, next, opts.today);
  const tags = normalizeTags(patch.tags);
  const description = patch.description.trim();
  const merchant = patch.merchant?.trim() || null;
  db.transaction(() => {
    db.prepare(
      `UPDATE transactions SET account_id=?, category_id=?, amount=?, occurred_on=?, description=?, merchant=?, tags=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
    ).run(patch.account_id, patch.category_id, patch.amount, patch.occurred_on, description, merchant, tags, id);
    writeAudit(db, "transaction", id, "update",
      { account_id: before.account_id, category_id: before.category_id, amount: before.amount, occurred_on: before.occurred_on, description: before.description, merchant: before.merchant, tags: before.tags },
      { account_id: patch.account_id, category_id: patch.category_id, amount: patch.amount, occurred_on: patch.occurred_on, description, merchant, tags });
  })();
}

/** Voiding keeps the row for traceability; it stops affecting balances and reports. */
export function voidTransaction(db: Database.Database, id: number) {
  const before = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as TxRow | undefined;
  if (!before) throw new LedgerError("Transaksi tidak ditemukan.");
  if (before.status === "voided") return;
  if (before.source === "transfer_fee") throw new LedgerError("Biaya transfer dibatalkan bersama transfer terkait.");
  db.transaction(() => {
    db.prepare("UPDATE transactions SET status='voided', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(id);
    writeAudit(db, "transaction", id, "void", { status: "posted" }, { status: "voided" });
  })();
}

export interface LedgerFilters {
  q?: string;
  type?: LedgerKind;
  accountId?: number;
  categoryId?: number;
  from?: string;
  to?: string;
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
  includeVoided?: boolean;
  page?: number;
  pageSize?: number;
}

export interface LedgerPage {
  rows: LedgerEntry[];
  total: number;
  page: number;
  pageSize: number;
  /** Totals of posted income/expense in the filtered set (transfers and adjustments excluded). */
  incomeTotal: number;
  expenseTotal: number;
}

const LEDGER_CTE = `
WITH ledger AS (
  SELECT 'tx' AS src, t.id, t.occurred_on, t.type AS kind, t.amount, t.account_id, NULL AS to_account_id, t.category_id,
         t.description, t.merchant, t.tags, t.status, t.adj_direction, t.source
  FROM transactions t
  UNION ALL
  SELECT 'tr', r.id, r.occurred_on, 'transfer', r.amount, r.from_account_id, r.to_account_id, NULL,
         r.description, NULL, NULL, r.status, NULL, 'transfer'
  FROM transfers r
)`;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function listLedger(db: Database.Database, f: LedgerFilters = {}): LedgerPage {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!f.includeVoided) where.push("l.status = 'posted'");
  if (f.type) { where.push("l.kind = ?"); params.push(f.type); }
  if (f.accountId) { where.push("(l.account_id = ? OR l.to_account_id = ?)"); params.push(f.accountId, f.accountId); }
  if (f.categoryId) {
    const ids = categoryAndChildren(db, f.categoryId);
    where.push(`l.category_id IN (${ids.map(() => "?").join(",") || "NULL"})`);
    params.push(...ids);
  }
  if (f.from) { where.push("l.occurred_on >= ?"); params.push(f.from); }
  if (f.to) { where.push("l.occurred_on <= ?"); params.push(f.to); }
  const q = f.q?.trim();
  if (q) {
    const like = `%${escapeLike(q.toLowerCase())}%`;
    where.push("(LOWER(l.description) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(l.merchant,'')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(l.tags,'')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.name,'')) LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `FROM ledger l
    JOIN accounts a ON a.id = l.account_id
    LEFT JOIN accounts ta ON ta.id = l.to_account_id
    LEFT JOIN categories c ON c.id = l.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id`;

  const order = {
    date_desc: "l.occurred_on DESC, l.id DESC",
    date_asc: "l.occurred_on ASC, l.id ASC",
    amount_desc: "l.amount DESC, l.id DESC",
    amount_asc: "l.amount ASC, l.id DESC",
  }[f.sort ?? "date_desc"];

  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 200);
  const page = Math.max(f.page ?? 1, 1);

  const total = (db.prepare(`${LEDGER_CTE} SELECT COUNT(*) AS n ${from} ${whereSql}`).get(...params) as { n: number }).n;
  const sums = db
    .prepare(
      `${LEDGER_CTE} SELECT
         COALESCE(SUM(CASE WHEN l.kind='income' AND l.status='posted' THEN l.amount END),0) AS inc,
         COALESCE(SUM(CASE WHEN l.kind='expense' AND l.status='posted' THEN l.amount END),0) AS exp
       ${from} ${whereSql}`,
    )
    .get(...params) as { inc: number; exp: number };
  const rows = db
    .prepare(
      `${LEDGER_CTE} SELECT l.*, a.name AS account_name, ta.name AS to_account_name, c.name AS category_name, pc.name AS parent_category_name
       ${from} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as LedgerEntry[];

  return { rows, total, page, pageSize, incomeTotal: sums.inc, expenseTotal: sums.exp };
}
