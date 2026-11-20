import type Database from "better-sqlite3";
import { writeAudit } from "../ledger/audit";
import { LedgerError } from "../ledger/errors";
import { requireActiveAccount } from "../ledger/accounts";
import { findCategoryId } from "../ledger/categories";
import { assertAmount, assertPastOrToday, isValidIsoDate } from "../ledger/validate";
import { daysBetween, todayWIB } from "../format";
import { allocatePayment, derivePaymentKind, generateSchedule, MAX_INSTALLMENTS, type InterestModel, type PaymentKind, type ScheduleInput } from "./schedule";

export interface DebtInput {
  provider: string;
  label?: string;
  model: InterestModel;
  principal: number;
  rate_bps?: number | null;
  admin_fee?: number;
  count?: number;
  start_date: string;
  first_due_date: string;
  manual?: { due_date: string; amount: number }[];
  payment_account_id?: number | null;
  notes?: string;
  /** Installments already paid before tracking began. They never touch an account balance. */
  already_paid_count?: number;
}

export interface DebtRow {
  id: number; provider: string; label: string; original_principal: number; interest_model: InterestModel; interest_rate_bps: number | null;
  admin_fee: number; total_obligation: number; installment_amount: number | null; installment_count: number | null; start_date: string;
  maturity_date: string | null; payment_account_id: number | null; status: "active" | "settled" | "cancelled"; notes: string | null; opening_paid_count: number;
}

export interface DebtSummary extends DebtRow {
  total_rows: number;
  paid_rows: number;
  /** Everything still owed on the schedule (principal + interest + fees). */
  outstanding: number;
  /** Principal still owed. Payments are applied to fees, then interest, then principal within each installment. */
  remaining_principal: number;
  remaining_installments: number;
  next_due_date: string | null;
  overdue_amount: number;
  overdue_count: number;
  payment_account_name: string | null;
}

export interface ScheduleRowDb {
  id: number; debt_id: number; sequence_no: number; due_date: string; principal_due: number; interest_due: number; fee_due: number;
  amount_due: number; amount_paid: number; status: "scheduled" | "partial" | "paid" | "skipped";
}

/** Rows owed on active debts: skipped rows are excluded everywhere. */
const SUMMARY_SQL = (today: string) => `
SELECT d.*, a.name AS payment_account_name,
  COUNT(s.id) AS total_rows,
  COALESCE(SUM(s.amount_paid >= s.amount_due), 0) AS paid_rows,
  COALESCE(SUM(s.amount_due - s.amount_paid), 0) AS outstanding,
  COALESCE(SUM(s.principal_due - MIN(s.principal_due, MAX(0, s.amount_paid - s.fee_due - s.interest_due))), 0) AS remaining_principal,
  COALESCE(SUM(s.amount_paid < s.amount_due), 0) AS remaining_installments,
  MIN(CASE WHEN s.amount_paid < s.amount_due THEN s.due_date END) AS next_due_date,
  COALESCE(SUM(CASE WHEN s.amount_paid < s.amount_due AND s.due_date < '${today}' THEN s.amount_due - s.amount_paid END), 0) AS overdue_amount,
  COALESCE(SUM(s.amount_paid < s.amount_due AND s.due_date < '${today}'), 0) AS overdue_count
FROM debts d
LEFT JOIN installment_schedules s ON s.debt_id = d.id AND s.status <> 'skipped'
LEFT JOIN accounts a ON a.id = d.payment_account_id`;

export function listDebts(db: Database.Database, opts: { today?: string; status?: DebtRow["status"][] } = {}): DebtSummary[] {
  const today = opts.today ?? todayWIB();
  const where = opts.status?.length ? `WHERE d.status IN (${opts.status.map((s) => `'${s}'`).join(",")})` : "";
  return db.prepare(`${SUMMARY_SQL(today)} ${where} GROUP BY d.id ORDER BY (d.status = 'active') DESC, next_due_date IS NULL, next_due_date, d.provider COLLATE NOCASE`).all() as DebtSummary[];
}

export function getDebt(db: Database.Database, id: number, today: string = todayWIB()): DebtSummary | undefined {
  return db.prepare(`${SUMMARY_SQL(today)} WHERE d.id = ? GROUP BY d.id`).get(id) as DebtSummary | undefined;
}

export function listSchedule(db: Database.Database, debtId: number): ScheduleRowDb[] {
  return db.prepare("SELECT * FROM installment_schedules WHERE debt_id = ? ORDER BY sequence_no").all(debtId) as ScheduleRowDb[];
}

function cleanText(s: string | undefined, max: number, field: string, required = false): string {
  const t = (s ?? "").trim().replace(/\s+/g, " ");
  if (required && !t) throw new LedgerError("Wajib diisi.", field);
  if (t.length > max) throw new LedgerError(`Maksimal ${max} karakter.`, field);
  return t;
}

export function createDebt(db: Database.Database, input: DebtInput): number {
  const provider = cleanText(input.provider, 60, "provider", true);
  const label = cleanText(input.label, 80, "label");
  const notes = cleanText(input.notes, 300, "notes");
  if (!isValidIsoDate(input.start_date)) throw new LedgerError("Tanggal mulai tidak valid.", "start_date");
  if (input.payment_account_id) requireActiveAccount(db, input.payment_account_id, "payment_account_id");
  const sched: ScheduleInput = { model: input.model, principal: input.principal, rate_bps: input.rate_bps, admin_fee: input.admin_fee, count: input.count, first_due_date: input.first_due_date, manual: input.manual };
  const rows = generateSchedule(sched);
  const paidCount = input.already_paid_count ?? 0;
  if (!Number.isInteger(paidCount) || paidCount < 0 || paidCount >= rows.length) throw new LedgerError("Jumlah cicilan yang sudah dibayar harus lebih kecil dari total cicilan.", "already_paid_count");
  const total = rows.reduce((s, r) => s + r.amount_due, 0);
  const fee = rows.reduce((s, r) => s + r.fee_due, 0);

  return db.transaction(() => {
    const id = Number(
      db.prepare(
        `INSERT INTO debts (provider, label, original_principal, interest_model, interest_rate_bps, admin_fee, total_obligation, installment_amount,
                            installment_count, start_date, maturity_date, payment_account_id, notes, opening_paid_count)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(provider, label, input.principal, input.model, input.model === "none" || input.model === "manual" ? null : input.rate_bps ?? null, fee, total,
        rows[0].amount_due, rows.length, input.start_date, rows[rows.length - 1].due_date, input.payment_account_id ?? null, notes || null, paidCount).lastInsertRowid,
    );
    const ins = db.prepare(
      `INSERT INTO installment_schedules (debt_id, sequence_no, due_date, principal_due, interest_due, fee_due, amount_due, amount_paid, status) VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    rows.forEach((r, i) => {
      const opening = i < paidCount;
      ins.run(id, r.sequence_no, r.due_date, r.principal_due, r.interest_due, r.fee_due, r.amount_due, opening ? r.amount_due : 0, opening ? "paid" : "scheduled");
    });
    writeAudit(db, "debt", id, "create", null, { provider, label, model: input.model, principal: input.principal, installments: rows.length, total_obligation: total, opening_paid_count: paidCount });
    return id;
  })();
}

export function updateDebtDetails(db: Database.Database, id: number, input: { provider: string; label?: string; notes?: string; payment_account_id?: number | null }) {
  const before = db.prepare("SELECT * FROM debts WHERE id = ?").get(id) as DebtRow | undefined;
  if (!before) throw new LedgerError("Utang tidak ditemukan.");
  const provider = cleanText(input.provider, 60, "provider", true);
  const label = cleanText(input.label, 80, "label");
  const notes = cleanText(input.notes, 300, "notes");
  if (input.payment_account_id) requireActiveAccount(db, input.payment_account_id, "payment_account_id");
  db.transaction(() => {
    db.prepare("UPDATE debts SET provider=?, label=?, notes=?, payment_account_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(provider, label, notes || null, input.payment_account_id ?? null, id);
    writeAudit(db, "debt", id, "update", { provider: before.provider, label: before.label, notes: before.notes, payment_account_id: before.payment_account_id }, { provider, label, notes, payment_account_id: input.payment_account_id ?? null });
  })();
}

/** A debt with no payments can be cancelled (e.g. entered by mistake). Its schedule stops counting everywhere. */
export function cancelDebt(db: Database.Database, id: number) {
  const d = db.prepare("SELECT * FROM debts WHERE id = ?").get(id) as DebtRow | undefined;
  if (!d) throw new LedgerError("Utang tidak ditemukan.");
  if (d.status === "cancelled") return;
  const n = (db.prepare("SELECT COUNT(*) AS n FROM debt_payments WHERE debt_id = ? AND status = 'posted'").get(id) as { n: number }).n;
  if (n > 0) throw new LedgerError("Utang yang sudah memiliki pembayaran tidak dapat dibatalkan. Batalkan pembayarannya terlebih dahulu.");
  db.transaction(() => {
    db.prepare("UPDATE debts SET status='cancelled', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(id);
    writeAudit(db, "debt", id, "cancel", { status: d.status }, { status: "cancelled" });
  })();
}

export interface PaymentInput {
  debt_id: number;
  account_id: number;
  /** Amount applied to the installments (oldest first). */
  amount: number;
  penalty?: number;
  fee?: number;
  paid_on: string;
  note?: string;
}

export interface PaymentResult { paymentId: number; transactionId: number; kind: PaymentKind; allocations: { sequence_no: number; amount: number; fully: boolean }[]; debtSettled: boolean }

/**
 * Record a payment. Money leaves the account exactly once: ONE expense transaction (installment + penalty + fee),
 * linked to the payment. Partial, early, lump-sum and late payments all go through here.
 */
export function recordDebtPayment(db: Database.Database, input: PaymentInput, opts: { today?: string } = {}): PaymentResult {
  const today = opts.today ?? todayWIB();
  const penalty = input.penalty ?? 0;
  const fee = input.fee ?? 0;
  assertAmount(input.amount, "amount");
  assertAmount(penalty, "penalty", true);
  assertAmount(fee, "fee", true);
  assertPastOrToday(input.paid_on, today, "paid_on");
  const note = cleanText(input.note, 150, "note");
  const debt = getDebt(db, input.debt_id, today);
  if (!debt) throw new LedgerError("Utang tidak ditemukan.");
  if (debt.status !== "active") throw new LedgerError(debt.status === "settled" ? "Utang ini sudah lunas." : "Utang ini sudah dibatalkan.");
  const account = requireActiveAccount(db, input.account_id);

  return db.transaction(() => {
    const open = (db.prepare("SELECT id, sequence_no, due_date, amount_due - amount_paid AS remaining FROM installment_schedules WHERE debt_id = ? AND status <> 'skipped' AND amount_paid < amount_due ORDER BY sequence_no").all(debt.id) as { id: number; sequence_no: number; due_date: string; remaining: number }[]);
    const outstanding = open.reduce((s, r) => s + r.remaining, 0);
    if (input.amount > outstanding) throw new LedgerError(`Nominal melebihi sisa kewajiban (${outstanding.toLocaleString("id-ID")}). Kurangi nominal atau lunasi sebesar sisa.`, "amount");
    const { allocations } = allocatePayment(open, input.amount);
    const kind = derivePaymentKind(allocations, outstanding, input.amount, input.paid_on, daysBetween);

    const paymentId = Number(
      db.prepare("INSERT INTO debt_payments (debt_id, schedule_id, account_id, amount, penalty, fee, paid_on, kind, note) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(debt.id, allocations[0].schedule_id, account.id, input.amount, penalty, fee, input.paid_on, kind, note || null).lastInsertRowid,
    );
    const insAlloc = db.prepare("INSERT INTO debt_payment_allocations (payment_id, schedule_id, amount) VALUES (?,?,?)");
    const upd = db.prepare("UPDATE installment_schedules SET amount_paid = amount_paid + ?, status = CASE WHEN amount_paid + ? >= amount_due THEN 'paid' ELSE 'partial' END WHERE id = ?");
    for (const a of allocations) { insAlloc.run(paymentId, a.schedule_id, a.amount); upd.run(a.amount, a.amount, a.schedule_id); }

    const seqs = allocations.map((a) => a.sequence_no);
    const range = seqs.length > 1 ? `#${seqs[0]}–#${seqs[seqs.length - 1]}` : `#${seqs[0]}`;
    const label = debt.label ? `${debt.provider} ${debt.label}` : debt.provider;
    const description = `Cicilan ${label} ${range}${kind === "partial" ? " (sebagian)" : kind === "early" ? " (dipercepat)" : kind === "settlement" ? " (pelunasan)" : ""}`;
    const transactionId = Number(
      db.prepare(
        `INSERT INTO transactions (account_id, category_id, type, amount, occurred_on, description, merchant, source, source_ref, debt_payment_id)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(account.id, findCategoryId(db, "Cicilan & Utang", "expense"), "expense", input.amount + penalty + fee, input.paid_on, description, debt.provider, "debt_payment", `debt_payment:${paymentId}`, paymentId).lastInsertRowid,
    );
    const remainingAfter = outstanding - input.amount;
    const settled = remainingAfter === 0;
    if (settled) db.prepare("UPDATE debts SET status='settled', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(debt.id);
    writeAudit(db, "debt_payment", paymentId, "create", null, { debt_id: debt.id, amount: input.amount, penalty, fee, paid_on: input.paid_on, kind, transaction_id: transactionId, settled });
    return { paymentId, transactionId, kind, allocations: allocations.map((a) => ({ sequence_no: a.sequence_no, amount: a.amount, fully: a.fully })), debtSettled: settled };
  })();
}

export interface DebtPaymentRow {
  id: number; debt_id: number; account_id: number; account_name: string; amount: number; penalty: number; fee: number; paid_on: string;
  kind: PaymentKind; status: "posted" | "voided"; note: string | null; created_at: string; installments: string;
}

export function listDebtPayments(db: Database.Database, debtId: number): DebtPaymentRow[] {
  return db.prepare(
    `SELECT p.*, a.name AS account_name,
       (SELECT group_concat('#' || s.sequence_no, ', ') FROM (SELECT s2.sequence_no FROM debt_payment_allocations al JOIN installment_schedules s2 ON s2.id = al.schedule_id WHERE al.payment_id = p.id ORDER BY s2.sequence_no) s) AS installments
     FROM debt_payments p JOIN accounts a ON a.id = p.account_id WHERE p.debt_id = ? ORDER BY p.paid_on DESC, p.id DESC`,
  ).all(debtId) as DebtPaymentRow[];
}

/** Reverses a payment exactly: schedule rows, the debt's status and the linked transaction. */
export function voidDebtPayment(db: Database.Database, paymentId: number) {
  const p = db.prepare("SELECT * FROM debt_payments WHERE id = ?").get(paymentId) as { id: number; debt_id: number; status: string } | undefined;
  if (!p) throw new LedgerError("Pembayaran tidak ditemukan.");
  if (p.status === "voided") return;
  const debt = db.prepare("SELECT status FROM debts WHERE id = ?").get(p.debt_id) as { status: string };
  if (debt.status === "cancelled") throw new LedgerError("Utang sudah dibatalkan.");
  db.transaction(() => {
    const allocs = db.prepare("SELECT schedule_id, amount FROM debt_payment_allocations WHERE payment_id = ?").all(paymentId) as { schedule_id: number; amount: number }[];
    const upd = db.prepare("UPDATE installment_schedules SET amount_paid = amount_paid - ?, status = CASE WHEN amount_paid - ? <= 0 THEN 'scheduled' ELSE 'partial' END WHERE id = ?");
    for (const a of allocs) upd.run(a.amount, a.amount, a.schedule_id);
    db.prepare("UPDATE debt_payments SET status='voided' WHERE id=?").run(paymentId);
    db.prepare("UPDATE transactions SET status='voided', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE debt_payment_id=? AND status='posted'").run(paymentId);
    if (debt.status === "settled") db.prepare("UPDATE debts SET status='active', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(p.debt_id);
    writeAudit(db, "debt_payment", paymentId, "void", { status: "posted" }, { status: "voided" });
  })();
}

export const DEBT_LIMITS = { MAX_INSTALLMENTS };
