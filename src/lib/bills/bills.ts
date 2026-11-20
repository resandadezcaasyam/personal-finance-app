import type Database from "better-sqlite3";
import { writeAudit } from "../ledger/audit";
import { LedgerError } from "../ledger/errors";
import { requireActiveAccount } from "../ledger/accounts";
import { findCategoryId } from "../ledger/categories";
import { assertAmount, assertPastOrToday, isValidIsoDate } from "../ledger/validate";
import { addMonthsClamped, daysBetween, shiftDate, todayWIB } from "../format";

export type BillFrequency = "weekly" | "monthly" | "quarterly" | "yearly" | "once";
export type BillKind = "bill" | "subscription";
export type BillStatus = "overdue" | "due_soon" | "upcoming" | "inactive";

export interface BillInput {
  name: string;
  kind: BillKind;
  category_id: number | null;
  account_id: number | null;
  /** Expected amount. Null for variable bills (e.g. electricity): the amount is entered when paying. */
  amount: number | null;
  frequency: BillFrequency;
  next_due_date: string;
  remind_days: number;
  notes?: string;
}

export interface BillRow {
  id: number; name: string; kind: BillKind; category_id: number | null; account_id: number | null; amount: number | null; is_variable: number;
  frequency: BillFrequency; due_day: number | null; next_due_date: string | null; remind_days: number; is_active: number; notes: string | null;
}
export interface BillView extends BillRow {
  status: BillStatus;
  days_until: number | null;
  account_name: string | null;
  category_name: string | null;
  last_paid_on: string | null;
}

const MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** The due date after `due`, or null for one-off bills. Month-based series keep their anchor day. */
export function nextOccurrence(due: string, frequency: BillFrequency, anchorDay: number | null): string | null {
  if (frequency === "once") return null;
  if (frequency === "weekly") return shiftDate(due, 7);
  return addMonthsClamped(due, MONTHS[frequency], anchorDay ?? undefined);
}

export function billStatus(b: Pick<BillRow, "is_active" | "next_due_date" | "remind_days">, today: string): BillStatus {
  if (!b.is_active || !b.next_due_date) return "inactive";
  const d = daysBetween(today, b.next_due_date);
  if (d < 0) return "overdue";
  return d <= b.remind_days ? "due_soon" : "upcoming";
}

function validate(db: Database.Database, i: BillInput) {
  const name = i.name.trim().replace(/\s+/g, " ");
  if (!name) throw new LedgerError("Nama wajib diisi.", "name");
  if (name.length > 80) throw new LedgerError("Maksimal 80 karakter.", "name");
  if (i.amount !== null) assertAmount(i.amount, "amount");
  if (!isValidIsoDate(i.next_due_date)) throw new LedgerError("Tanggal jatuh tempo tidak valid.", "next_due_date");
  if (!Number.isInteger(i.remind_days) || i.remind_days < 0 || i.remind_days > 60) throw new LedgerError("Pengingat harus 0 sampai 60 hari.", "remind_days");
  if (i.account_id) requireActiveAccount(db, i.account_id, "account_id");
  if (i.category_id) {
    const c = db.prepare("SELECT kind FROM categories WHERE id = ?").get(i.category_id) as { kind: string } | undefined;
    if (!c || c.kind !== "expense") throw new LedgerError("Pilih kategori pengeluaran.", "category_id");
  }
  return name;
}

export function createBill(db: Database.Database, i: BillInput): number {
  const name = validate(db, i);
  return db.transaction(() => {
    const day = Number(i.next_due_date.slice(8, 10));
    const id = Number(
      db.prepare(
        `INSERT INTO bills (name, kind, category_id, account_id, amount, is_variable, frequency, due_day, next_due_date, remind_days, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(name, i.kind, i.category_id, i.account_id, i.amount, i.amount === null ? 1 : 0, i.frequency, i.frequency === "weekly" || i.frequency === "once" ? null : day, i.next_due_date, i.remind_days, i.notes?.trim() || null).lastInsertRowid,
    );
    writeAudit(db, "bill", id, "create", null, { ...i, name });
    return id;
  })();
}

export function updateBill(db: Database.Database, id: number, i: Omit<BillInput, "next_due_date" | "frequency">) {
  const before = db.prepare("SELECT * FROM bills WHERE id = ?").get(id) as BillRow | undefined;
  if (!before) throw new LedgerError("Tagihan tidak ditemukan.");
  const name = validate(db, { ...i, frequency: before.frequency, next_due_date: before.next_due_date ?? "2000-01-01" });
  db.transaction(() => {
    db.prepare("UPDATE bills SET name=?, kind=?, category_id=?, account_id=?, amount=?, is_variable=?, remind_days=?, notes=? WHERE id=?")
      .run(name, i.kind, i.category_id, i.account_id, i.amount, i.amount === null ? 1 : 0, i.remind_days, i.notes?.trim() || null, id);
    writeAudit(db, "bill", id, "update", { name: before.name, amount: before.amount, kind: before.kind }, { name, amount: i.amount, kind: i.kind });
  })();
}

export function setBillActive(db: Database.Database, id: number, active: boolean) {
  db.transaction(() => {
    db.prepare("UPDATE bills SET is_active=? WHERE id=?").run(active ? 1 : 0, id);
    writeAudit(db, "bill", id, active ? "activate" : "deactivate", null, { is_active: active });
  })();
}

export function listBills(db: Database.Database, today: string = todayWIB()): BillView[] {
  const rows = db.prepare(
    `SELECT b.*, a.name AS account_name, c.name AS category_name,
       (SELECT MAX(paid_on) FROM bill_payments p WHERE p.bill_id = b.id AND p.status = 'paid') AS last_paid_on
     FROM bills b LEFT JOIN accounts a ON a.id = b.account_id LEFT JOIN categories c ON c.id = b.category_id
     ORDER BY b.is_active DESC, b.next_due_date IS NULL, b.next_due_date, b.name COLLATE NOCASE`,
  ).all() as (BillRow & { account_name: string | null; category_name: string | null; last_paid_on: string | null })[];
  return rows.map((r) => ({ ...r, status: billStatus(r, today), days_until: r.next_due_date ? daysBetween(today, r.next_due_date) : null }));
}

export interface BillPaymentInput { bill_id: number; account_id: number; amount: number; paid_on: string }

/**
 * Pay the current occurrence. One expense transaction, linked to the bill. The (bill, due date) pair can
 * be settled only once, so double-clicks or repeated submissions cannot post twice.
 */
export function payBill(db: Database.Database, input: BillPaymentInput, opts: { today?: string } = {}): { paymentId: number; transactionId: number } {
  const today = opts.today ?? todayWIB();
  assertAmount(input.amount, "amount");
  assertPastOrToday(input.paid_on, today, "paid_on");
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(input.bill_id) as BillRow | undefined;
  if (!bill) throw new LedgerError("Tagihan tidak ditemukan.");
  if (!bill.is_active || !bill.next_due_date) throw new LedgerError("Tagihan ini tidak aktif atau sudah selesai.");
  requireActiveAccount(db, input.account_id);
  const due = bill.next_due_date;

  return db.transaction(() => {
    const dup = db.prepare("SELECT 1 FROM bill_payments WHERE bill_id = ? AND due_date = ? AND status IN ('paid','skipped')").get(bill.id, due);
    if (dup) throw new LedgerError("Jatuh tempo ini sudah diselesaikan.");
    const categoryId = bill.category_id ?? findCategoryId(db, "Tagihan & Utilitas", "expense");
    const txId = Number(
      db.prepare(
        `INSERT INTO transactions (account_id, category_id, type, amount, occurred_on, description, merchant, source, source_ref, bill_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(input.account_id, categoryId, "expense", input.amount, input.paid_on, `${bill.name} (jatuh tempo ${due})`, bill.name, "bill_payment", `bill:${bill.id}:${due}`, bill.id).lastInsertRowid,
    );
    const paymentId = Number(
      db.prepare("INSERT INTO bill_payments (bill_id, due_date, amount, paid_on, account_id, transaction_id, status) VALUES (?,?,?,?,?,?, 'paid')")
        .run(bill.id, due, input.amount, input.paid_on, input.account_id, txId).lastInsertRowid,
    );
    advance(db, bill, due);
    writeAudit(db, "bill_payment", paymentId, "create", null, { bill_id: bill.id, due_date: due, amount: input.amount, paid_on: input.paid_on, transaction_id: txId });
    return { paymentId, transactionId: txId };
  })();
}

/** Skip an occurrence (e.g. waived or paid outside the app) without any ledger entry. */
export function skipBill(db: Database.Database, billId: number) {
  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(billId) as BillRow | undefined;
  if (!bill) throw new LedgerError("Tagihan tidak ditemukan.");
  if (!bill.is_active || !bill.next_due_date) throw new LedgerError("Tagihan ini tidak aktif atau sudah selesai.");
  const due = bill.next_due_date;
  db.transaction(() => {
    const id = Number(db.prepare("INSERT INTO bill_payments (bill_id, due_date, amount, paid_on, status) VALUES (?,?,0,?, 'skipped')").run(bill.id, due, todayWIB()).lastInsertRowid);
    advance(db, bill, due);
    writeAudit(db, "bill_payment", id, "skip", null, { bill_id: bill.id, due_date: due });
  })();
}

function advance(db: Database.Database, bill: BillRow, due: string) {
  const next = nextOccurrence(due, bill.frequency, bill.due_day);
  db.prepare("UPDATE bills SET next_due_date = ?, is_active = ? WHERE id = ?").run(next, next ? bill.is_active : 0, bill.id);
}

export interface BillPaymentRow {
  id: number; bill_id: number; bill_name: string; due_date: string; amount: number; paid_on: string; status: "paid" | "skipped" | "voided"; account_name: string | null; is_latest: number;
}

export function listBillPayments(db: Database.Database, limit = 40): BillPaymentRow[] {
  return db.prepare(
    `SELECT p.*, b.name AS bill_name, a.name AS account_name,
       (p.id = (SELECT p2.id FROM bill_payments p2 WHERE p2.bill_id = p.bill_id AND p2.status IN ('paid','skipped') ORDER BY p2.due_date DESC LIMIT 1)) AS is_latest
     FROM bill_payments p JOIN bills b ON b.id = p.bill_id LEFT JOIN accounts a ON a.id = p.account_id
     ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
  ).all(limit) as BillPaymentRow[];
}

/** Only the most recent settlement of a bill can be undone, so due dates never get out of order. */
export function voidBillPayment(db: Database.Database, paymentId: number) {
  const p = db.prepare("SELECT * FROM bill_payments WHERE id = ?").get(paymentId) as { id: number; bill_id: number; due_date: string; status: string; transaction_id: number | null } | undefined;
  if (!p) throw new LedgerError("Pembayaran tidak ditemukan.");
  if (p.status === "voided") return;
  const latest = db.prepare("SELECT id FROM bill_payments WHERE bill_id = ? AND status IN ('paid','skipped') ORDER BY due_date DESC LIMIT 1").get(p.bill_id) as { id: number } | undefined;
  if (latest?.id !== p.id) throw new LedgerError("Hanya pembayaran terbaru dari tagihan ini yang dapat dibatalkan.");
  db.transaction(() => {
    db.prepare("UPDATE bill_payments SET status='voided' WHERE id=?").run(paymentId);
    if (p.transaction_id) db.prepare("UPDATE transactions SET status='voided', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='posted'").run(p.transaction_id);
    db.prepare("UPDATE bills SET next_due_date = ?, is_active = 1 WHERE id = ?").run(p.due_date, p.bill_id);
    writeAudit(db, "bill_payment", paymentId, "void", { status: p.status }, { status: "voided", restored_due_date: p.due_date });
  })();
}
