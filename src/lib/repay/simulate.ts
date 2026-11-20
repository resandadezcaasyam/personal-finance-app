import { LedgerError } from "../ledger/errors";
import { isValidIsoDate } from "../ledger/validate";
import { allocatePayment } from "../debts/schedule";
import { daysBetween, shiftDate } from "../format";
import { runForecast, type ForecastInput, type ForecastResult, type InstallmentInput, type ScenarioParams } from "../forecast/engine";

/**
 * Early-repayment simulator (PURE). Scenario A is the standard forecast, untouched. Scenario B is the same forecast with
 * one debt settled (fully or partly) on a chosen date. Nothing here reads or writes the database.
 *
 * Contract rules are unknown to the app, so only what the user supplies counts as a saving:
 *   - a rebate percentage of the scheduled interest that is skipped, or
 *   - a settlement quotation (the exact payoff amount from the provider).
 * Without either, paying early costs exactly what the schedule says (no interest saved), plus any fee/penalty entered.
 */

export interface DebtRow {
  debt_id: number;
  sequence_no: number;
  installment_count: number;
  due_date: string;
  /** Still owed on this installment. */
  remaining: number;
  /** Components of `remaining`. Payments are applied to fees, then interest, then principal. */
  fee_rem: number;
  interest_rem: number;
  principal_rem: number;
}
export interface DebtSim { debt_id: number; provider: string; label: string; rate_bps: number | null; rows: DebtRow[] }

export function remainingParts(r: { principal_due: number; interest_due: number; fee_due: number; amount_paid: number }) {
  const feePaid = Math.min(r.amount_paid, r.fee_due);
  const interestPaid = Math.min(r.amount_paid - feePaid, r.interest_due);
  const principalPaid = Math.min(r.amount_paid - feePaid - interestPaid, r.principal_due);
  return { fee_rem: r.fee_due - feePaid, interest_rem: r.interest_due - interestPaid, principal_rem: r.principal_due - principalPaid };
}

export interface RepayParams {
  debt_id: number;
  date: string;
  mode: "full" | "partial";
  /** Partial only: amount applied to the installments, oldest first. */
  amount: number | null;
  /** Full only: payoff amount quoted by the provider (overrides the schedule). */
  quote: number | null;
  /** Full only: percent of the scheduled interest on the prepaid installments that the provider waives. */
  rebate_pct: number;
  /** Extra cash out on top of the payoff; neither reduces the obligation. */
  fee: number;
  penalty: number;
}

export interface CoveredRow { sequence_no: number; due_date: string; before: number; paid: number; after: number }

export interface Settlement {
  mode: "full" | "partial";
  date: string;
  covered: CoveredRow[];
  /** What the schedule says those installments cost (sum of `before` over covered rows, or the part paid for partial). */
  scheduledCost: number;
  /** Amount paid towards the installments at the repayment date (excludes fee and penalty). */
  payoff: number;
  rebateKind: "none" | "percent" | "quote";
  /** Saving versus the schedule that comes from user input (>= 0 for rebate, any sign for a quote). Null when nothing was entered. */
  knownSaving: number | null;
  /** Upper bound on interest that could be saved: scheduled interest on the prepaid installments. NOT a promise. */
  interestUpperBound: number;
  fee: number;
  penalty: number;
  cashOut: number;
  /** Installments of this debt due on or before the date (they are paid on schedule, as in the forecast). */
  keptRows: DebtRow[];
  /** Installments after the date that remain (partial only), with the reduced remaining amounts. */
  remainingLater: DebtRow[];
  totalRemainingA: number;
  totalRemainingB: number;
  interestFeeA: number;
  interestFeeB: number;
}

const sumRem = (rows: DebtRow[]) => rows.reduce((s, r) => s + r.remaining, 0);
const sumIF = (rows: DebtRow[]) => rows.reduce((s, r) => s + r.interest_rem + r.fee_rem, 0);
const int = (n: unknown, field: string, lo: number, hi: number, msg: string): number => {
  if (typeof n !== "number" || !Number.isInteger(n) || n < lo || n > hi) throw new LedgerError(msg, field);
  return n;
};

export function computeSettlement(debt: DebtSim, p: RepayParams, today: string): Settlement {
  if (!isValidIsoDate(p.date)) throw new LedgerError("Tanggal pelunasan tidak valid.", "date");
  if (p.date < today) throw new LedgerError("Tanggal pelunasan tidak boleh sebelum hari ini. Pelunasan yang sudah terjadi dicatat lewat halaman utang.", "date");
  if (daysBetween(today, p.date) > 365) throw new LedgerError("Tanggal pelunasan maksimal 12 bulan dari sekarang.", "date");
  int(p.fee, "fee", 0, 1e12, "Biaya pelunasan tidak valid.");
  int(p.penalty, "penalty", 0, 1e12, "Denda tidak valid.");
  if (typeof p.rebate_pct !== "number" || !Number.isFinite(p.rebate_pct) || p.rebate_pct < 0 || p.rebate_pct > 100) throw new LedgerError("Rebat bunga harus antara 0% dan 100%.", "rebate");

  const open = debt.rows.filter((r) => r.remaining > 0);
  const kept = open.filter((r) => r.due_date <= p.date);
  const later = open.filter((r) => r.due_date > p.date);
  if (later.length === 0) throw new LedgerError("Tidak ada cicilan yang jatuh tempo setelah tanggal ini: utang akan lunas lewat jadwal biasa. Pilih tanggal yang lebih awal.", "date");
  const laterTotal = sumRem(later);

  let covered: CoveredRow[];
  let remainingLater: DebtRow[];
  let scheduledCost: number;
  let payoff: number;
  let rebateKind: Settlement["rebateKind"] = "none";
  let knownSaving: number | null = null;
  let interestUpperBound: number;

  if (p.mode === "full") {
    covered = later.map((r) => ({ sequence_no: r.sequence_no, due_date: r.due_date, before: r.remaining, paid: r.remaining, after: 0 }));
    remainingLater = [];
    scheduledCost = laterTotal;
    interestUpperBound = later.reduce((s, r) => s + r.interest_rem, 0);
    if (p.quote !== null) {
      if (typeof p.quote !== "number" || !Number.isInteger(p.quote) || p.quote <= 0) throw new LedgerError("Kuotasi pelunasan harus lebih dari 0.", "quote");
      payoff = p.quote; rebateKind = "quote"; knownSaving = scheduledCost - p.quote;
    } else if (p.rebate_pct > 0) {
      const rebate = Math.round((p.rebate_pct / 100) * interestUpperBound);
      payoff = scheduledCost - rebate; rebateKind = "percent"; knownSaving = rebate;
    } else payoff = scheduledCost;
  } else {
    const amount = p.amount;
    if (amount === null || !Number.isInteger(amount) || amount <= 0) throw new LedgerError("Isi nominal pembayaran sebagian (lebih dari 0).", "amount");
    if (amount > laterTotal) throw new LedgerError(`Nominal melebihi sisa cicilan setelah tanggal itu (${laterTotal.toLocaleString("id-ID")}). Pilih pelunasan penuh atau kurangi nominal.`, "amount");
    const { allocations } = allocatePayment(later.map((r) => ({ id: r.sequence_no, sequence_no: r.sequence_no, due_date: r.due_date, remaining: r.remaining })), amount);
    const paidBy = new Map(allocations.map((a) => [a.sequence_no, a.amount]));
    covered = later.filter((r) => paidBy.has(r.sequence_no)).map((r) => ({ sequence_no: r.sequence_no, due_date: r.due_date, before: r.remaining, paid: paidBy.get(r.sequence_no) ?? 0, after: r.remaining - (paidBy.get(r.sequence_no) ?? 0) }));
    // Payments hit fees, then interest, then principal inside each installment.
    remainingLater = later.map((r) => {
      const paid = paidBy.get(r.sequence_no) ?? 0;
      const f = Math.min(paid, r.fee_rem), i = Math.min(paid - f, r.interest_rem), pr = Math.min(paid - f - i, r.principal_rem);
      return { ...r, remaining: r.remaining - paid, fee_rem: r.fee_rem - f, interest_rem: r.interest_rem - i, principal_rem: r.principal_rem - pr };
    }).filter((r) => r.remaining > 0);
    scheduledCost = amount; payoff = amount;
    interestUpperBound = 0; // a partial payment moves cash earlier; without a contract rule no interest is assumed saved
  }

  const cashOut = payoff + p.fee + p.penalty;
  const all = open;
  const totalRemainingA = sumRem(all);
  const totalRemainingB = sumRem(kept) + sumRem(remainingLater) + cashOut;
  const interestFeeA = sumIF(all);
  const coveredIF = p.mode === "full" ? later.reduce((s, r) => s + r.interest_rem + r.fee_rem, 0) : 0;
  const interestFeeB = p.mode === "full"
    ? sumIF(kept) + coveredIF - (knownSaving ?? 0)
    : sumIF(kept) + sumIF(remainingLater) + (later.reduce((s, r) => s + r.interest_rem + r.fee_rem, 0) - sumIF(remainingLater));
  return {
    mode: p.mode, date: p.date, covered, scheduledCost, payoff, rebateKind, knownSaving, interestUpperBound, fee: p.fee, penalty: p.penalty, cashOut,
    keptRows: kept, remainingLater, totalRemainingA, totalRemainingB, interestFeeA, interestFeeB,
  };
}

/* ---------------- comparison ---------------- */

export type Risk = "rendah" | "sedang" | "tinggi";

/**
 * Liquidity risk from the lowest projected balance: tinggi if it goes below zero, sedang if it stays above zero but
 * under the cash buffer or under one month of habitual spending, otherwise rendah.
 */
export function liquidityRisk(lowest: number, buffer: number, monthlySpending: number): Risk {
  if (lowest < 0) return "tinggi";
  return lowest < Math.max(buffer, monthlySpending) ? "sedang" : "rendah";
}

export interface ScenarioMetrics {
  closingCash: number;
  lowest: { date: string; balance: number };
  deficitDays: number;
  firstDeficitDate: string | null;
  /** Cash paid on this debt inside the horizon (installments plus the early payment). */
  debtPaidInHorizon: number;
  installmentsInHorizon: number;
  avgMonthlyInstallments: number;
  /** Routine surplus per month: income - habitual spending - installments - bills (one-off payments excluded). */
  avgMonthlySurplus: number;
  risk: Risk;
}

export function metricsOf(res: ForecastResult, debtId: number, scenario: ScenarioParams, baselineDailySpend: number): ScenarioMetrics {
  const months = res.displayDays / 30.4375;
  const debtPaid = res.events.filter((e) => e.source.id === debtId && (e.kind === "installment" || e.kind === "oneoff")).reduce((s, e) => s + e.amount, 0);
  const routine = res.summary.totalIncome - res.summary.totalSpending - res.summary.totalInstallments - res.summary.totalBills;
  const monthlySpending = Math.round(((baselineDailySpend * scenario.spending_pct) / 100) * 30);
  return {
    closingCash: res.summary.closingCash, lowest: res.summary.lowest, deficitDays: res.summary.deficitDays, firstDeficitDate: res.summary.firstDeficitDate,
    debtPaidInHorizon: debtPaid, installmentsInHorizon: res.summary.totalInstallments,
    avgMonthlyInstallments: Math.round(res.summary.totalInstallments / months), avgMonthlySurplus: Math.round(routine / months),
    risk: liquidityRisk(res.summary.lowest.balance, scenario.buffer, monthlySpending),
  };
}

export interface SimulationResult {
  settlement: Settlement;
  a: ForecastResult;
  b: ForecastResult;
  ma: ScenarioMetrics;
  mb: ScenarioMetrics;
  /** Last due date over all remaining installments of all debts (null when nothing is owed). */
  debtFreeA: string | null;
  debtFreeB: string | null;
  debtLabel: string;
}

const lastDue = (rows: { due_date: string }[]) => rows.reduce<string | null>((m, r) => (m === null || r.due_date > m ? r.due_date : m), null);

export function simulateEarlyRepayment(input: ForecastInput, debts: DebtSim[], p: RepayParams, scenario: ScenarioParams, displayDays: number): SimulationResult {
  const debt = debts.find((d) => d.debt_id === p.debt_id);
  if (!debt) throw new LedgerError("Utang tidak ditemukan atau sudah lunas.", "debt");
  const s = computeSettlement(debt, p, input.today);

  const paidBy = new Map<number, number>(s.covered.map((c) => [c.sequence_no, c.paid]));
  const installments: InstallmentInput[] = [];
  for (const i of input.installments) {
    if (i.debt_id !== p.debt_id || i.due_date <= p.date) { installments.push(i); continue; }
    if (s.mode === "full") continue; // settled at the repayment date
    const left = i.remaining - (paidBy.get(i.sequence_no) ?? 0);
    if (left > 0) installments.push({ ...i, remaining: left });
  }
  const label = debt.label ? `${debt.provider} · ${debt.label}` : debt.provider;
  const oneOff = {
    date: p.date, id: p.debt_id, label: `${s.mode === "full" ? "Pelunasan dini" : "Pembayaran sebagian"} ${label}`, amount: s.cashOut,
    note: `cicilan ${s.covered.map((c) => `#${c.sequence_no}`).join(", ")}${s.fee ? ` + biaya ${s.fee}` : ""}${s.penalty ? ` + denda ${s.penalty}` : ""}`,
  };
  const a = runForecast(input, scenario, displayDays);
  const b = runForecast({ ...input, installments, oneOffs: [...(input.oneOffs ?? []), oneOff] }, scenario, displayDays);

  const otherRows = debts.filter((d) => d.debt_id !== p.debt_id).flatMap((d) => d.rows.filter((r) => r.remaining > 0));
  const debtFreeA = lastDue([...otherRows, ...debt.rows.filter((r) => r.remaining > 0)]);
  // Full settlement: this debt ends on the repayment date. Partial: it ends at its last remaining installment.
  const bRows = s.mode === "full" ? [...otherRows, { due_date: p.date }] : [...otherRows, ...s.keptRows, ...s.remainingLater];
  const debtFreeBFinal = lastDue(bRows);
  return {
    settlement: s, a, b, ma: metricsOf(a, p.debt_id, scenario, input.baselineDailySpend), mb: metricsOf(b, p.debt_id, scenario, input.baselineDailySpend),
    debtFreeA, debtFreeB: debtFreeBFinal, debtLabel: label,
  };
}

export { shiftDate };
