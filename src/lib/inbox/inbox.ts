import type Database from "better-sqlite3";
import { writeAudit } from "../ledger/audit";
import { LedgerError } from "../ledger/errors";
import { requireActiveAccount } from "../ledger/accounts";
import { createTransaction } from "../ledger/transactions";
import { createTransfer } from "../ledger/transfers";
import { assertAmount, assertPastOrToday, isValidIsoDate } from "../ledger/validate";
import { recordDebtPayment } from "../debts/debts";
import { payBill } from "../bills/bills";
import { daysBetween, todayWIB } from "../format";
import type { RuleHit } from "../capture/nl-parser";
import { findObligationMatch, sameMatch, type Match } from "./matching";

export type InboxStatus = "new" | "needs_review" | "potential_duplicate" | "approved" | "rejected";
export const PENDING: InboxStatus[] = ["new", "needs_review", "potential_duplicate"];
export const CONFIDENCE_OK = 0.75;

export interface InboxRow {
  id: number; batch_id: number | null; status: InboxStatus; type: "income" | "expense" | "transfer" | null; amount: number | null;
  occurred_on: string | null; description: string | null; merchant: string | null; account_id: number | null; category_id: number | null;
  source_ref: string | null; fingerprint: string | null; confidence: number | null; raw_payload: string | null; posted_transaction_id: number | null;
  created_at: string; source_kind: string; note: string | null; match_json: string | null; match_dismissed: number; category_source: string | null;
  posted_ref: string | null; duplicate_of: string | null;
}
export interface InboxView extends InboxRow {
  account_name: string | null; category_name: string | null; parent_category_name: string | null; match: Match | null; duplicates: string[]; file_name: string | null;
}

export interface NewInboxItem {
  type: "income" | "expense";
  amount: number | null;
  occurred_on: string | null;
  description: string;
  merchant?: string | null;
  account_id: number | null;
  category_id: number | null;
  category_source?: "rule" | "user" | "parser" | null;
  fingerprint?: string | null;
  source_ref?: string | null;
  confidence?: number | null;
  raw_payload?: unknown;
  note?: string | null;
  source_kind: string;
  /** Always send to review (e.g. OCR output). */
  forceReview?: boolean;
}

type Matcher = (text: string, kind: "income" | "expense") => RuleHit | null;

/** Posted ledger rows that look like the same event (same account/type/amount, within a day). Flags, never deletes. */
export function findLedgerDuplicates(db: Database.Database, i: { account_id: number | null; type: "income" | "expense"; amount: number | null; occurred_on: string | null }): string[] {
  if (!i.account_id || !i.amount || !i.occurred_on || !isValidIsoDate(i.occurred_on)) return [];
  const lo = new Date(`${i.occurred_on}T00:00:00Z`); lo.setUTCDate(lo.getUTCDate() - 1);
  const hi = new Date(`${i.occurred_on}T00:00:00Z`); hi.setUTCDate(hi.getUTCDate() + 1);
  const from = lo.toISOString().slice(0, 10), to = hi.toISOString().slice(0, 10);
  const tx = db.prepare("SELECT id FROM transactions WHERE status='posted' AND account_id=? AND type=? AND amount=? AND occurred_on BETWEEN ? AND ?").all(i.account_id, i.type, i.amount, from, to) as { id: number }[];
  const col = i.type === "expense" ? "from_account_id" : "to_account_id";
  const tr = db.prepare(`SELECT id FROM transfers WHERE status='posted' AND ${col}=? AND amount=? AND occurred_on BETWEEN ? AND ?`).all(i.account_id, i.amount, from, to) as { id: number }[];
  return [...tx.map((r) => `tx:${r.id}`), ...tr.map((r) => `transfer:${r.id}`)];
}

function complete(i: { amount: number | null; occurred_on: string | null; account_id: number | null }) {
  return !!i.amount && !!i.occurred_on && !!i.account_id;
}

function statusFor(i: { amount: number | null; occurred_on: string | null; account_id: number | null; category_id: number | null; confidence: number | null; forceReview?: boolean }, dups: string[]): InboxStatus {
  if (dups.length) return "potential_duplicate";
  if (i.forceReview || !complete(i) || !i.category_id || (i.confidence !== null && i.confidence < CONFIDENCE_OK)) return "needs_review";
  return "new";
}

function reviewNote(i: { amount: number | null; occurred_on: string | null; account_id: number | null; category_id: number | null }, existing: string | null): string | null {
  const why: string[] = [];
  if (!i.amount) why.push("nominal");
  if (!i.occurred_on) why.push("tanggal");
  if (!i.account_id) why.push("akun");
  if (!i.category_id) why.push("kategori");
  const extra = why.length ? `Lengkapi: ${why.join(", ")}.` : null;
  return [existing, extra].filter(Boolean).join(" ") || null;
}

export interface CreateResult { created: number; skippedDuplicates: number; ids: number[] }

export function createInboxItems(db: Database.Database, items: NewInboxItem[], opts: { batchId?: number | null; matcher?: Matcher; today?: string } = {}): CreateResult {
  const today = opts.today ?? todayWIB();
  const ids: number[] = [];
  let skipped = 0;
  const ins = db.prepare(
    `INSERT INTO inbox_items (batch_id, status, type, amount, occurred_on, description, merchant, account_id, category_id, source_ref, fingerprint, confidence,
                              raw_payload, source_kind, note, match_json, category_source, duplicate_of)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  db.transaction(() => {
    for (const it of items) {
      if (it.fingerprint && db.prepare("SELECT 1 FROM inbox_items WHERE fingerprint = ?").get(it.fingerprint)) { skipped++; continue; }
      let category_id = it.category_id;
      let merchant = it.merchant ?? null;
      let category_source = it.category_source ?? (category_id ? "parser" : null);
      if (!category_id && opts.matcher) {
        const hit = opts.matcher(`${it.merchant ?? ""} ${it.description}`, it.type);
        if (hit?.category_id) { category_id = hit.category_id; category_source = "rule"; }
        if (hit?.merchant && !merchant) merchant = hit.merchant;
      }
      const dups = findLedgerDuplicates(db, { account_id: it.account_id, type: it.type, amount: it.amount, occurred_on: it.occurred_on });
      const match = findObligationMatch(db, { type: it.type, amount: it.amount, occurred_on: it.occurred_on, account_id: it.account_id, description: it.description, merchant });
      const confidence = it.confidence ?? null;
      const status = statusFor({ ...it, category_id, confidence }, dups);
      const id = Number(ins.run(
        opts.batchId ?? null, status, it.type, it.amount, it.occurred_on, it.description.slice(0, 200), merchant, it.account_id, category_id, it.source_ref ?? null, it.fingerprint ?? null,
        confidence, it.raw_payload === undefined ? null : JSON.stringify(it.raw_payload), it.source_kind, reviewNote({ ...it, category_id }, it.note ?? null),
        match ? JSON.stringify(match) : null, category_source, dups.length ? JSON.stringify(dups) : null,
      ).lastInsertRowid);
      ids.push(id);
    }
    pairTransfers(db, ids);
    if (ids.length) writeAudit(db, "inbox", null, "create", null, { count: ids.length, batch_id: opts.batchId ?? null });
  })();
  void today;
  return { created: ids.length, skippedDuplicates: skipped, ids };
}

/** Two pending items in different accounts with opposite direction, the same amount and dates within a day are probably one transfer. */
export function pairTransfers(db: Database.Database, ids: number[]) {
  const pend = PENDING.map((s) => `'${s}'`).join(",");
  for (const id of ids) {
    const it = db.prepare(`SELECT * FROM inbox_items WHERE id = ? AND status IN (${pend}) AND match_json IS NULL`).get(id) as InboxRow | undefined;
    if (!it || !it.amount || !it.account_id || !it.occurred_on || (it.type !== "expense" && it.type !== "income")) continue;
    const other = it.type === "expense" ? "income" : "expense";
    const cands = (db.prepare(
      `SELECT * FROM inbox_items WHERE id <> ? AND status IN (${pend}) AND match_json IS NULL AND type = ? AND amount = ? AND account_id IS NOT NULL AND account_id <> ? AND occurred_on IS NOT NULL`,
    ).all(id, other, it.amount, it.account_id) as InboxRow[]).filter((c) => Math.abs(daysBetween(c.occurred_on!, it.occurred_on!)) <= 1);
    if (!cands.length) continue;
    cands.sort((a, b) => Math.abs(daysBetween(a.occurred_on!, it.occurred_on!)) - Math.abs(daysBetween(b.occurred_on!, it.occurred_on!)) || a.id - b.id);
    const pair = cands[0];
    const from = it.type === "expense" ? it : pair;
    const to = it.type === "expense" ? pair : it;
    const label = (x: InboxRow) => x.description || "item";
    const set = db.prepare("UPDATE inbox_items SET match_json = ? WHERE id = ?");
    set.run(JSON.stringify({ kind: "transfer", pair_id: pair.id, pair_label: label(pair), from_account_id: from.account_id as number, to_account_id: to.account_id as number } satisfies Match), it.id);
    set.run(JSON.stringify({ kind: "transfer", pair_id: it.id, pair_label: label(it), from_account_id: from.account_id as number, to_account_id: to.account_id as number } satisfies Match), pair.id);
    // A transfer needs no category, so "category missing" alone no longer holds these two back from 'new'.
    db.prepare(
      `UPDATE inbox_items SET status = 'new', note = NULL
       WHERE id IN (?, ?) AND status = 'needs_review' AND amount IS NOT NULL AND occurred_on IS NOT NULL AND account_id IS NOT NULL
         AND (confidence IS NULL OR confidence >= ${CONFIDENCE_OK}) AND note = 'Lengkapi: kategori.'`,
    ).run(it.id, pair.id);
  }
}

/* ---------------- listing ---------------- */

export interface InboxFilter { status?: InboxStatus | "pending"; batchId?: number; q?: string; page?: number; pageSize?: number }

export function listInbox(db: Database.Database, f: InboxFilter = {}) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.status === "pending") where.push(`i.status IN (${PENDING.map((s) => `'${s}'`).join(",")})`);
  else if (f.status) { where.push("i.status = ?"); params.push(f.status); }
  if (f.batchId) { where.push("i.batch_id = ?"); params.push(f.batchId); }
  if (f.q?.trim()) {
    const like = `%${f.q.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(LOWER(COALESCE(i.description,'')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(i.merchant,'')) LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200);
  const page = Math.max(f.page ?? 1, 1);
  const from = `FROM inbox_items i LEFT JOIN accounts a ON a.id = i.account_id LEFT JOIN categories c ON c.id = i.category_id LEFT JOIN categories pc ON pc.id = c.parent_id LEFT JOIN import_batches b ON b.id = i.batch_id`;
  const total = (db.prepare(`SELECT COUNT(*) AS n ${from} ${w}`).get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT i.*, a.name AS account_name, c.name AS category_name, pc.name AS parent_category_name, b.file_name AS file_name ${from} ${w}
     ORDER BY COALESCE(i.occurred_on,'9999') DESC, i.id DESC LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, (page - 1) * pageSize) as (InboxRow & { account_name: string | null; category_name: string | null; parent_category_name: string | null; file_name: string | null })[];
  const views: InboxView[] = rows.map((r) => ({ ...r, match: r.match_json && !r.match_dismissed ? (JSON.parse(r.match_json) as Match) : null, duplicates: r.duplicate_of ? (JSON.parse(r.duplicate_of) as string[]) : [] }));
  return { rows: views, total, page, pageSize };
}

export function inboxCounts(db: Database.Database): Record<InboxStatus | "pending", number> {
  const out = { new: 0, needs_review: 0, potential_duplicate: 0, approved: 0, rejected: 0, pending: 0 } as Record<InboxStatus | "pending", number>;
  for (const r of db.prepare("SELECT status, COUNT(*) AS n FROM inbox_items GROUP BY status").all() as { status: InboxStatus; n: number }[]) out[r.status] = r.n;
  out.pending = out.new + out.needs_review + out.potential_duplicate;
  return out;
}

/* ---------------- editing ---------------- */

export interface InboxPatch {
  type: "income" | "expense";
  amount: number | null;
  occurred_on: string | null;
  description: string;
  merchant: string | null;
  account_id: number | null;
  category_id: number | null;
  dismiss_match?: boolean;
}

function getPending(db: Database.Database, id: number): InboxRow {
  const r = db.prepare("SELECT * FROM inbox_items WHERE id = ?").get(id) as InboxRow | undefined;
  if (!r) throw new LedgerError("Item tidak ditemukan.");
  if (!PENDING.includes(r.status)) throw new LedgerError(r.status === "approved" ? "Item yang sudah disetujui tidak dapat diubah. Ubah lewat daftar transaksi." : "Item yang ditolak harus dipulihkan dulu.");
  return r;
}

/** An explicit user edit. A category chosen here is marked 'user', so rules never overwrite it later. */
export function updateInboxItem(db: Database.Database, id: number, p: InboxPatch) {
  const before = getPending(db, id);
  if (p.amount !== null) assertAmount(p.amount, "amount");
  if (p.occurred_on !== null && !isValidIsoDate(p.occurred_on)) throw new LedgerError("Tanggal tidak valid.", "occurred_on");
  if (p.category_id) {
    const c = db.prepare("SELECT kind FROM categories WHERE id = ?").get(p.category_id) as { kind: string } | undefined;
    if (!c || c.kind !== p.type) throw new LedgerError("Kategori tidak sesuai dengan jenis transaksi.", "category_id");
  }
  const categoryChanged = p.category_id !== before.category_id;
  db.transaction(() => {
    const dups = findLedgerDuplicates(db, { account_id: p.account_id, type: p.type, amount: p.amount, occurred_on: p.occurred_on });
    const match = p.dismiss_match ? null : findObligationMatch(db, { type: p.type, amount: p.amount, occurred_on: p.occurred_on, account_id: p.account_id, description: p.description, merchant: p.merchant });
    const keepTransfer = before.match_json && (JSON.parse(before.match_json) as Match).kind === "transfer" && p.type === before.type && p.amount === before.amount && p.account_id === before.account_id && !p.dismiss_match;
    const status = statusFor({ ...p, confidence: before.confidence !== null && before.confidence < CONFIDENCE_OK && !categoryChanged && complete(p) ? before.confidence : 1 }, dups);
    db.prepare(
      `UPDATE inbox_items SET type=?, amount=?, occurred_on=?, description=?, merchant=?, account_id=?, category_id=?, category_source=?, status=?, duplicate_of=?,
         match_json=?, match_dismissed=?, note=? WHERE id=?`,
    ).run(p.type, p.amount, p.occurred_on, p.description.slice(0, 200), p.merchant, p.account_id, p.category_id, categoryChanged && p.category_id ? "user" : before.category_source,
      status, dups.length ? JSON.stringify(dups) : null, keepTransfer ? before.match_json : match ? JSON.stringify(match) : null, p.dismiss_match ? 1 : 0, reviewNote(p, null), id);
    writeAudit(db, "inbox", id, "update", { amount: before.amount, category_id: before.category_id, account_id: before.account_id }, { amount: p.amount, category_id: p.category_id, account_id: p.account_id });
  })();
}

export function rejectInboxItems(db: Database.Database, ids: number[]): number {
  let n = 0;
  db.transaction(() => {
    const upd = db.prepare(`UPDATE inbox_items SET status='rejected' WHERE id = ? AND status IN (${PENDING.map((s) => `'${s}'`).join(",")})`);
    for (const id of ids) n += upd.run(id).changes;
    if (n) writeAudit(db, "inbox", null, "reject", null, { ids });
  })();
  return n;
}

export function restoreInboxItem(db: Database.Database, id: number) {
  const r = db.prepare("SELECT * FROM inbox_items WHERE id = ?").get(id) as InboxRow | undefined;
  if (!r) throw new LedgerError("Item tidak ditemukan.");
  if (r.status !== "rejected") throw new LedgerError("Hanya item yang ditolak yang dapat dipulihkan.");
  db.transaction(() => {
    db.prepare("UPDATE inbox_items SET status='needs_review' WHERE id=?").run(id);
    writeAudit(db, "inbox", id, "restore", { status: "rejected" }, { status: "needs_review" });
  })();
}

/** Bulk category change. Items whose type does not fit the category are skipped and counted. */
export function setCategoryForItems(db: Database.Database, ids: number[], categoryId: number): { updated: number; skipped: number } {
  const c = db.prepare("SELECT kind FROM categories WHERE id = ?").get(categoryId) as { kind: string } | undefined;
  if (!c) throw new LedgerError("Kategori tidak ditemukan.");
  let updated = 0, skipped = 0;
  db.transaction(() => {
    for (const id of ids) {
      const r = db.prepare("SELECT * FROM inbox_items WHERE id = ?").get(id) as InboxRow | undefined;
      if (!r || !PENDING.includes(r.status) || r.type !== c.kind) { skipped++; continue; }
      const status = r.status === "potential_duplicate" ? r.status : statusFor({ ...r, category_id: categoryId, confidence: r.confidence !== null && r.confidence < CONFIDENCE_OK ? r.confidence : 1 }, []);
      db.prepare("UPDATE inbox_items SET category_id=?, category_source='user', status=? WHERE id=?").run(categoryId, status, id);
      updated++;
    }
    writeAudit(db, "inbox", null, "categorize", null, { ids, category_id: categoryId });
  })();
  return { updated, skipped };
}

export function setMatchDismissed(db: Database.Database, id: number, dismissed: boolean) {
  const r = getPending(db, id);
  db.prepare("UPDATE inbox_items SET match_dismissed = ? WHERE id = ?").run(dismissed ? 1 : 0, id);
  void r;
}

/* ---------------- approval (the only path from inbox to ledger) ---------------- */

export interface ApproveOptions { today?: string; includeDuplicates?: boolean }
export interface ApproveResult { id: number; ok: boolean; posted_ref?: string; error?: string; code?: "duplicate" | "invalid" | "match_changed" | "done" }

/**
 * Post inbox items to the real ledger. Always goes through the same domain functions as manual entry:
 * a suggested installment/bill match records that obligation as paid (one expense), a suggested transfer pair becomes
 * one transfer, everything else becomes one income/expense. Each item is atomic; failures are reported per item.
 */
export function approveInboxItems(db: Database.Database, ids: number[], opts: ApproveOptions = {}): ApproveResult[] {
  const today = opts.today ?? todayWIB();
  const results: ApproveResult[] = [];
  for (const id of ids) {
    try {
      results.push(db.transaction(() => approveOne(db, id, today, !!opts.includeDuplicates))());
    } catch (e) {
      if (e instanceof LedgerError) results.push({ id, ok: false, error: e.message, code: "invalid" });
      else throw e;
    }
  }
  return results;
}

function approveOne(db: Database.Database, id: number, today: string, includeDuplicates: boolean): ApproveResult {
  const it = db.prepare("SELECT * FROM inbox_items WHERE id = ?").get(id) as InboxRow | undefined;
  if (!it) return { id, ok: false, error: "Item tidak ditemukan.", code: "invalid" };
  if (it.status === "approved") return { id, ok: false, error: "Sudah disetujui.", code: "done" };
  if (it.status === "rejected") return { id, ok: false, error: "Item ditolak. Pulihkan dulu untuk menyetujuinya.", code: "invalid" };
  if (it.status === "potential_duplicate" && !includeDuplicates) return { id, ok: false, error: "Mirip dengan transaksi yang sudah ada. Setujui satu per satu untuk mengonfirmasi.", code: "duplicate" };
  if (it.type !== "income" && it.type !== "expense") throw new LedgerError("Jenis transaksi belum valid.");
  if (!it.amount) throw new LedgerError("Nominal belum diisi.");
  if (!it.occurred_on) throw new LedgerError("Tanggal belum diisi.");
  if (!it.account_id) throw new LedgerError("Akun belum dipilih.");
  assertPastOrToday(it.occurred_on, today);
  assertAmount(it.amount);
  requireActiveAccount(db, it.account_id);

  const stored = it.match_json && !it.match_dismissed ? (JSON.parse(it.match_json) as Match) : null;
  const text = { type: it.type, amount: it.amount, occurred_on: it.occurred_on, account_id: it.account_id, description: it.description, merchant: it.merchant };
  let posted_ref: string;
  let tx: number | null = null;

  if (stored?.kind === "transfer") {
    const pair = db.prepare("SELECT * FROM inbox_items WHERE id = ?").get(stored.pair_id) as InboxRow | undefined;
    if (!pair || !PENDING.includes(pair.status) || pair.amount !== it.amount || !pair.account_id || pair.account_id === it.account_id) {
      db.prepare("UPDATE inbox_items SET match_json = NULL, status = 'needs_review' WHERE id = ?").run(id);
      return { id, ok: false, error: "Pasangan transfer sudah berubah. Tinjau ulang item ini.", code: "match_changed" };
    }
    const fromId = it.type === "expense" ? it.account_id : pair.account_id;
    const toId = it.type === "expense" ? pair.account_id : it.account_id;
    const trId = createTransfer(db, { from_account_id: fromId, to_account_id: toId, amount: it.amount, occurred_on: it.occurred_on, description: it.description ?? "" }, { today });
    posted_ref = `transfer:${trId}`;
    db.prepare("UPDATE inbox_items SET status='approved', posted_ref=? WHERE id IN (?, ?)").run(posted_ref, id, pair.id);
    writeAudit(db, "inbox", id, "approve", null, { posted_ref, paired_with: pair.id });
    return { id, ok: true, posted_ref };
  }

  if (stored && (stored.kind === "debt" || stored.kind === "bill")) {
    const fresh = findObligationMatch(db, text);
    if (!sameMatch(stored, fresh)) {
      db.prepare("UPDATE inbox_items SET match_json = ?, status = 'needs_review' WHERE id = ?").run(fresh ? JSON.stringify(fresh) : null, id);
      return { id, ok: false, error: "Kecocokan dengan cicilan/tagihan sudah berubah. Tinjau ulang item ini.", code: "match_changed" };
    }
    if (stored.kind === "debt") {
      const r = recordDebtPayment(db, { debt_id: stored.debt_id, account_id: it.account_id, amount: it.amount, paid_on: it.occurred_on, note: "Dari kotak masuk" }, { today });
      posted_ref = `debt_payment:${r.paymentId}`; tx = r.transactionId;
    } else {
      const r = payBill(db, { bill_id: stored.bill_id, account_id: it.account_id, amount: it.amount, paid_on: it.occurred_on }, { today });
      posted_ref = `bill_payment:${r.paymentId}`; tx = r.transactionId;
    }
  } else {
    tx = createTransaction(db, {
      type: it.type, account_id: it.account_id, category_id: it.category_id, amount: it.amount, occurred_on: it.occurred_on,
      description: it.description ?? "", merchant: it.merchant, source: it.fingerprint ? "import" : it.source_kind === "quick_capture" ? "quick_capture" : "manual", source_ref: it.fingerprint,
    }, { today });
    posted_ref = `tx:${tx}`;
  }
  db.prepare("UPDATE inbox_items SET status='approved', posted_transaction_id=?, posted_ref=? WHERE id=?").run(tx, posted_ref, id);
  writeAudit(db, "inbox", id, "approve", null, { posted_ref });
  return { id, ok: true, posted_ref };
}

/* ---------------- batches ---------------- */

export interface BatchRow {
  id: number; source_type: string; file_name: string | null; file_hash: string | null; row_count: number; status: string; error_report: string | null;
  created_at: string; account_id: number | null; imported_count: number; duplicate_count: number; error_count: number; account_name: string | null;
}

export function listBatches(db: Database.Database, limit = 30): BatchRow[] {
  return db.prepare(
    `SELECT b.*, a.name AS account_name FROM import_batches b LEFT JOIN accounts a ON a.id = b.account_id ORDER BY b.id DESC LIMIT ?`,
  ).all(limit) as BatchRow[];
}

export function createBatch(db: Database.Database, b: { source_type: string; file_name: string | null; file_hash: string | null; account_id: number | null; row_count: number }): number {
  if (b.file_hash) {
    const prev = db.prepare("SELECT id, created_at, file_name FROM import_batches WHERE file_hash = ?").get(b.file_hash) as { id: number; created_at: string; file_name: string | null } | undefined;
    if (prev) throw new LedgerError(`File ini sudah pernah diimpor pada ${prev.created_at.slice(0, 10)}${prev.file_name ? ` (${prev.file_name})` : ""}. Impor ulang dilewati agar tidak ada transaksi ganda.`, "file");
  }
  return Number(db.prepare("INSERT INTO import_batches (source_type, file_name, file_hash, account_id, row_count, status) VALUES (?,?,?,?,?, 'pending')").run(b.source_type, b.file_name, b.file_hash, b.account_id, b.row_count).lastInsertRowid);
}

export function finalizeBatch(db: Database.Database, id: number, r: { imported: number; duplicates: number; errors: { row_no: number; reason: string }[] }) {
  db.prepare("UPDATE import_batches SET status='completed', imported_count=?, duplicate_count=?, error_count=?, error_report=? WHERE id=?")
    .run(r.imported, r.duplicates, r.errors.length, r.errors.length ? JSON.stringify(r.errors) : null, id);
}
