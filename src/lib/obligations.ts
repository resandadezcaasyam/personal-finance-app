import type Database from "better-sqlite3";
import { daysBetween, monthRange, shiftDate, todayWIB } from "./format";
import { listDebts, type DebtSummary } from "./debts/debts";
import { nextOccurrence, type BillRow } from "./bills/bills";

export interface ObligationItem {
  kind: "installment" | "bill";
  date: string;
  title: string;
  subtitle: string;
  /** Installments: amount still owed on that row. Bills: expected amount (0 when variable and unknown). */
  amount: number;
  overdue: boolean;
  /** True for bill occurrences extrapolated beyond the next real due date. */
  projected: boolean;
  href: string;
  bill_variable?: boolean;
}

const MAX_OCCURRENCES = 400;

/**
 * Everything owed between `from` and `to` (inclusive), plus anything already overdue when `from` is omitted.
 * Installments come from real schedules. Bills: the next due date is real; later occurrences are projections.
 * Nothing here is an actual transaction, and nothing here changes a balance.
 */
export function listObligations(db: Database.Database, opts: { to: string; from?: string; today?: string }): ObligationItem[] {
  const today = opts.today ?? todayWIB();
  const from = opts.from ?? "0000-01-01";
  const items: ObligationItem[] = [];

  const rows = db.prepare(
    `SELECT s.id, s.sequence_no, s.due_date, s.amount_due - s.amount_paid AS remaining, d.id AS debt_id, d.provider, d.label, d.installment_count
     FROM installment_schedules s JOIN debts d ON d.id = s.debt_id
     WHERE d.status = 'active' AND s.status <> 'skipped' AND s.amount_paid < s.amount_due AND s.due_date BETWEEN ? AND ?
     ORDER BY s.due_date, d.id, s.sequence_no`,
  ).all(from, opts.to) as { id: number; sequence_no: number; due_date: string; remaining: number; debt_id: number; provider: string; label: string; installment_count: number }[];
  for (const r of rows) {
    items.push({
      kind: "installment", date: r.due_date, title: r.label ? `${r.provider} · ${r.label}` : r.provider,
      subtitle: `Cicilan ${r.sequence_no} dari ${r.installment_count}`, amount: r.remaining, overdue: r.due_date < today, projected: false, href: `/debts/${r.debt_id}`,
    });
  }

  const bills = db.prepare("SELECT * FROM bills WHERE is_active = 1 AND next_due_date IS NOT NULL").all() as BillRow[];
  for (const b of bills) {
    let d: string | null = b.next_due_date;
    let first = true;
    for (let i = 0; d && d <= opts.to && i < MAX_OCCURRENCES; i++) {
      if (d >= from) {
        items.push({
          kind: "bill", date: d, title: b.name, subtitle: first ? (b.kind === "subscription" ? "Langganan" : "Tagihan") : `${b.kind === "subscription" ? "Langganan" : "Tagihan"} · proyeksi`,
          amount: b.amount ?? 0, overdue: d < today, projected: !first, href: "/bills", bill_variable: b.amount === null,
        });
      }
      d = nextOccurrence(d, b.frequency, b.due_day);
      first = false;
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export interface CommitmentsOverview {
  debts: DebtSummary[];
  activeDebts: DebtSummary[];
  totalOutstanding: number;
  totalRemainingPrincipal: number;
  month: string;
  monthInstallmentTotal: number;
  monthInstallmentPaid: number;
  monthInstallmentRemaining: number;
  paidInstallments: number;
  totalInstallments: number;
  completionPct: number;
  overdue: ObligationItem[];
  overdueTotal: number;
  upcoming: ObligationItem[];
  upcomingTotal: number;
}

export function getCommitmentsOverview(db: Database.Database, today: string = todayWIB(), upcomingDays = 30): CommitmentsOverview {
  const month = today.slice(0, 7);
  const debts = listDebts(db, { today });
  const active = debts.filter((d) => d.status === "active");
  const { from, to } = monthRange(month);
  const m = db.prepare(
    `SELECT COALESCE(SUM(s.amount_due),0) AS total, COALESCE(SUM(s.amount_paid),0) AS paid
     FROM installment_schedules s JOIN debts d ON d.id = s.debt_id
     WHERE d.status='active' AND s.status <> 'skipped' AND s.due_date BETWEEN ? AND ?`,
  ).get(from, to) as { total: number; paid: number };
  const all = listObligations(db, { to: shiftDate(today, upcomingDays), today });
  const overdue = all.filter((i) => i.overdue);
  const upcoming = all.filter((i) => !i.overdue);
  const paidInstallments = active.reduce((s, d) => s + d.paid_rows, 0);
  const totalInstallments = active.reduce((s, d) => s + d.total_rows, 0);
  return {
    debts, activeDebts: active,
    totalOutstanding: active.reduce((s, d) => s + d.outstanding, 0),
    totalRemainingPrincipal: active.reduce((s, d) => s + d.remaining_principal, 0),
    month, monthInstallmentTotal: m.total, monthInstallmentPaid: m.paid, monthInstallmentRemaining: m.total - m.paid,
    paidInstallments, totalInstallments,
    completionPct: totalInstallments ? Math.round((paidInstallments / totalInstallments) * 100) : 0,
    overdue, overdueTotal: overdue.reduce((s, i) => s + i.amount, 0),
    upcoming, upcomingTotal: upcoming.reduce((s, i) => s + i.amount, 0),
  };
}

export { daysBetween };

export interface AgendaItem {
  kind: "installment" | "bill";
  date: string;
  title: string;
  subtitle: string;
  amount: number;
  /** paid = settled, partial = part paid, overdue = past due and unpaid, due = still to pay, projected = bill extrapolated. */
  status: "paid" | "partial" | "overdue" | "due" | "projected";
  href: string;
}

/**
 * Everything on the calendar for one 'YYYY-MM' month: installments in every state (so progress is visible),
 * bills that were settled for that month, and bill occurrences still to come (real or projected).
 */
export function getMonthAgenda(db: Database.Database, month: string, today: string = todayWIB()): AgendaItem[] {
  const { from, to } = monthRange(month);
  const out: AgendaItem[] = [];

  const rows = db.prepare(
    `SELECT s.sequence_no, s.due_date, s.amount_due, s.amount_paid, d.id AS debt_id, d.provider, d.label, d.installment_count
     FROM installment_schedules s JOIN debts d ON d.id = s.debt_id
     WHERE d.status IN ('active','settled') AND s.status <> 'skipped' AND s.due_date BETWEEN ? AND ?`,
  ).all(from, to) as { sequence_no: number; due_date: string; amount_due: number; amount_paid: number; debt_id: number; provider: string; label: string; installment_count: number }[];
  for (const r of rows) {
    const paid = r.amount_paid >= r.amount_due;
    out.push({
      kind: "installment", date: r.due_date, title: r.label ? `${r.provider} · ${r.label}` : r.provider, subtitle: `Cicilan ${r.sequence_no} dari ${r.installment_count}`,
      amount: r.amount_due, status: paid ? "paid" : r.amount_paid > 0 ? "partial" : r.due_date < today ? "overdue" : "due", href: `/debts/${r.debt_id}`,
    });
  }

  const settled = db.prepare(
    `SELECT p.due_date, p.amount, b.name, b.kind FROM bill_payments p JOIN bills b ON b.id = p.bill_id
     WHERE p.status = 'paid' AND p.due_date BETWEEN ? AND ?`,
  ).all(from, to) as { due_date: string; amount: number; name: string; kind: string }[];
  for (const p of settled) out.push({ kind: "bill", date: p.due_date, title: p.name, subtitle: p.kind === "subscription" ? "Langganan" : "Tagihan", amount: p.amount, status: "paid", href: "/bills" });

  for (const o of listObligations(db, { from, to, today }).filter((i) => i.kind === "bill")) {
    out.push({ kind: "bill", date: o.date, title: o.title, subtitle: o.subtitle, amount: o.amount, status: o.projected ? "projected" : o.overdue ? "overdue" : "due", href: o.href });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
