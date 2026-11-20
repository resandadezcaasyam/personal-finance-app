import { addMonthsClamped } from "../format";
import { LedgerError } from "../ledger/errors";
import { isValidIsoDate, MAX_AMOUNT } from "../ledger/validate";

export type InterestModel = "none" | "flat" | "reducing" | "manual";

export interface ScheduleRow {
  sequence_no: number;
  due_date: string;
  principal_due: number;
  interest_due: number;
  fee_due: number;
  amount_due: number;
}

export interface ScheduleInput {
  model: InterestModel;
  principal: number;
  /** Interest rate PER MONTH in basis points (2,5% = 250). Ignored for "none" and "manual". */
  rate_bps?: number | null;
  /** Total administrative fee, spread evenly across installments. */
  admin_fee?: number;
  count?: number;
  first_due_date: string;
  /** Manual model: explicit installments. */
  manual?: { due_date: string; amount: number }[];
}

/** Split `total` into n integer parts; the remainder lands on the last part so the sum is exact. */
export function splitEvenly(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const parts = Array<number>(n).fill(base);
  parts[n - 1] = total - base * (n - 1);
  return parts;
}

export const MAX_INSTALLMENTS = 120;

/**
 * Deterministic schedule generator. All stored values are integer rupiah.
 * - none:     principal split evenly, no interest.
 * - flat:     interest = principal x monthly rate x count, split evenly (the common paylater/loan "flat" quote).
 * - reducing: annuity (fixed payment, interest on the declining balance), rounded to whole rupiah per row.
 * - manual:   the user supplies dates and amounts (for contracts that follow other rules); the
 *             principal/interest split is proportional to the amounts.
 * Contract rules differ between providers. If a quote differs from these formulas, use "manual".
 */
export function generateSchedule(input: ScheduleInput): ScheduleRow[] {
  const P = input.principal;
  if (!Number.isSafeInteger(P) || P <= 0 || P > MAX_AMOUNT) throw new LedgerError("Pokok utang harus lebih dari 0.", "principal");
  if (!isValidIsoDate(input.first_due_date)) throw new LedgerError("Tanggal jatuh tempo pertama tidak valid.", "first_due_date");
  const fee = input.admin_fee ?? 0;
  if (!Number.isSafeInteger(fee) || fee < 0) throw new LedgerError("Biaya administrasi tidak valid.", "admin_fee");

  if (input.model === "manual") return manualSchedule(input, P, fee);

  const n = input.count ?? 0;
  if (!Number.isInteger(n) || n < 1 || n > MAX_INSTALLMENTS) throw new LedgerError(`Jumlah cicilan harus 1 sampai ${MAX_INSTALLMENTS}.`, "count");
  const bps = input.model === "none" ? 0 : input.rate_bps ?? 0;
  if (input.model !== "none" && (!Number.isInteger(bps) || bps < 0 || bps > 10_000)) throw new LedgerError("Bunga per bulan harus antara 0% dan 100%.", "rate");

  let principals: number[];
  let interests: number[];
  const r = bps / 10_000;

  if (input.model === "reducing" && bps > 0) {
    const pmt = Math.round((P * r) / (1 - Math.pow(1 + r, -n)));
    principals = [];
    interests = [];
    let bal = P;
    for (let i = 0; i < n; i++) {
      const interest = Math.round(bal * r);
      const principal = i === n - 1 ? bal : Math.min(bal, pmt - interest);
      if (principal < 0) throw new LedgerError("Kombinasi bunga dan jumlah cicilan tidak valid.", "rate");
      principals.push(principal);
      interests.push(interest);
      bal -= principal;
    }
  } else {
    principals = splitEvenly(P, n);
    interests = input.model === "flat" ? splitEvenly(Math.round((P * bps * n) / 10_000), n) : Array<number>(n).fill(0);
  }
  const fees = splitEvenly(fee, n);
  return principals.map((principal, i) => ({
    sequence_no: i + 1,
    due_date: addMonthsClamped(input.first_due_date, i),
    principal_due: principal,
    interest_due: interests[i],
    fee_due: fees[i],
    amount_due: principal + interests[i] + fees[i],
  }));
}

function manualSchedule(input: ScheduleInput, P: number, fee: number): ScheduleRow[] {
  const rows = [...(input.manual ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date));
  if (rows.length < 1 || rows.length > MAX_INSTALLMENTS) throw new LedgerError(`Jadwal manual harus berisi 1 sampai ${MAX_INSTALLMENTS} cicilan.`, "manual");
  for (const r of rows) {
    if (!isValidIsoDate(r.due_date)) throw new LedgerError(`Tanggal tidak valid pada jadwal manual: ${r.due_date}`, "manual");
    if (!Number.isSafeInteger(r.amount) || r.amount <= 0) throw new LedgerError("Nominal cicilan manual harus lebih dari 0.", "manual");
  }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  if (total < P) throw new LedgerError("Total jadwal manual tidak boleh lebih kecil dari pokok utang.", "manual");
  // Spread the cash obligation over principal / (interest) / fee. Fee is fixed; the rest splits proportionally.
  const feeTotal = Math.min(fee, total - P);
  const interestTotal = total - P - feeTotal;
  const fees = splitProportional(feeTotal, rows.map((r) => r.amount));
  const interests = splitProportional(interestTotal, rows.map((r) => r.amount));
  return rows.map((r, i) => ({
    sequence_no: i + 1,
    due_date: r.due_date,
    principal_due: r.amount - fees[i] - interests[i],
    interest_due: interests[i],
    fee_due: fees[i],
    amount_due: r.amount,
  }));
}

/** Largest-remainder-free proportional split; the last part absorbs rounding so the sum is exact. */
function splitProportional(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  const out: number[] = [];
  let used = 0;
  weights.forEach((w, i) => {
    const part = i === weights.length - 1 ? total - used : Math.floor((total * w) / sum);
    out.push(part);
    used += part;
  });
  return out;
}

/** Parse lines like "2026-12-05 350000", "2026-12-05;350rb" or "2026-12-05, 1.250.000". */
export function parseManualSchedule(text: string, parseAmount: (s: string) => number | null): { due_date: string; amount: number }[] {
  const out: { due_date: string; amount: number }[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d{4}-\d{2}-\d{2})[\s,;]+(.+)$/);
    const amount = m ? parseAmount(m[2].trim()) : null;
    if (!m || amount === null) throw new LedgerError(`Baris ${i + 1} tidak valid. Format: 2026-12-05 350000`, "manual");
    out.push({ due_date: m[1], amount });
  }
  return out;
}

/* ---------- Payment allocation (pure) ---------- */

export interface OpenRow { id: number; sequence_no: number; due_date: string; remaining: number }
export interface Allocation { schedule_id: number; sequence_no: number; due_date: string; amount: number; fully: boolean }

/** Pay the oldest unpaid installments first. Returns the allocations and any amount that did not fit. */
export function allocatePayment(open: OpenRow[], amount: number): { allocations: Allocation[]; leftover: number } {
  let left = amount;
  const allocations: Allocation[] = [];
  for (const r of [...open].sort((a, b) => a.sequence_no - b.sequence_no)) {
    if (left <= 0) break;
    if (r.remaining <= 0) continue;
    const a = Math.min(left, r.remaining);
    allocations.push({ schedule_id: r.id, sequence_no: r.sequence_no, due_date: r.due_date, amount: a, fully: a === r.remaining });
    left -= a;
  }
  return { allocations, leftover: left };
}

export type PaymentKind = "regular" | "partial" | "early" | "settlement";
/** Paying more than this many days before the due date counts as an early payment. */
export const EARLY_TOLERANCE_DAYS = 7;

export function derivePaymentKind(allocations: Allocation[], outstanding: number, amount: number, paidOn: string, daysBetween: (a: string, b: string) => number): PaymentKind {
  if (allocations.length === 0) return "regular";
  if (amount === outstanding && allocations.length > 1) return "settlement";
  if (!allocations[allocations.length - 1].fully) return "partial";
  if (allocations.some((a) => daysBetween(paidOn, a.due_date) > EARLY_TOLERANCE_DAYS)) return "early";
  return "regular";
}
