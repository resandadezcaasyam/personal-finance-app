import { LedgerError } from "../ledger/errors";
import { addMonthsClamped } from "../format";
import type { DebtRow, DebtSim } from "./simulate";

/**
 * Payoff-strategy comparison (PURE). Every debt keeps paying its scheduled installments. On top of that the user has an
 * extra monthly budget that prepays whole future installments of ONE target debt at a time, oldest first:
 *   snowball  -> smallest remaining balance first
 *   avalanche -> highest (scheduled interest + fees) per rupiah of remaining principal first
 *   custom    -> the user's own order
 *   minimum   -> no extra budget (the schedules as they are)
 * An unspent budget rolls over to the next month. Prepaying an installment costs its remaining amount minus the rebate,
 * where the rebate is the user-entered percentage of that installment's scheduled interest. With a 0% rebate every
 * strategy pays the same total and only finishes sooner; the app never assumes savings the contract has not granted.
 */

export type StrategyKey = "minimum" | "snowball" | "avalanche" | "custom";
export const STRATEGY_LABEL: Record<StrategyKey, string> = { minimum: "Cicilan minimum", snowball: "Snowball", avalanche: "Avalanche", custom: "Urutan kustom" };
export const STRATEGY_HELP: Record<StrategyKey, string> = {
  minimum: "Hanya membayar jadwal cicilan biasa, tanpa tambahan.",
  snowball: "Tambahan dipakai untuk utang dengan sisa saldo terkecil lebih dulu.",
  avalanche: "Tambahan dipakai untuk utang dengan bunga+biaya terjadwal terbesar per rupiah pokok lebih dulu.",
  custom: "Tambahan dipakai sesuai urutan yang Anda tentukan.",
};

export interface StrategyParams { extra: number; rebate_pct: number; order: number[] }

export interface MonthPoint { month: string; scheduled: number; extra: number; outstanding: number }
export interface StrategyResult {
  key: StrategyKey;
  months: MonthPoint[];
  /** Number of months until nothing is owed (0 when nothing is owed now). */
  monthsToDebtFree: number;
  debtFreeMonth: string | null;
  totalPaid: number;
  interestFeePaid: number;
  /** Month each debt reaches zero, by debt id. */
  clearedMonth: Record<number, string>;
  /** Order in which targets received the extra budget (first time each was targeted). */
  targetOrder: number[];
}

interface Row extends DebtRow { paid: boolean }
const MAX_MONTHS = 240;

const monthEnd = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };

export function runStrategy(key: StrategyKey, debts: DebtSim[], today: string, p: StrategyParams): StrategyResult {
  if (!Number.isInteger(p.extra) || p.extra < 0 || p.extra > 1e12) throw new LedgerError("Anggaran tambahan tidak valid.", "extra");
  if (!Number.isFinite(p.rebate_pct) || p.rebate_pct < 0 || p.rebate_pct > 100) throw new LedgerError("Rebat bunga harus antara 0% dan 100%.", "rebate");
  const state = new Map<number, Row[]>(debts.map((d) => [d.debt_id, d.rows.filter((r) => r.remaining > 0).map((r) => ({ ...r, paid: false }))]));
  const ids = debts.map((d) => d.debt_id);
  const open = (id: number) => (state.get(id) ?? []).filter((r) => !r.paid);
  const balance = (id: number) => open(id).reduce((s, r) => s + r.remaining, 0);
  const total = () => ids.reduce((s, id) => s + balance(id), 0);
  const startMonth = today.slice(0, 7);
  const months: MonthPoint[] = [];
  const cleared: Record<number, string> = {};
  const targetOrder: number[] = [];
  let totalPaid = 0, interestFee = 0, budget = 0;
  const budgetPerMonth = key === "minimum" ? 0 : p.extra;

  const pickTarget = (end: string): number | null => {
    const candidates = ids.filter((id) => open(id).some((r) => r.due_date > end));
    if (candidates.length === 0) return null;
    if (key === "snowball") return [...candidates].sort((a, b) => balance(a) - balance(b) || a - b)[0];
    if (key === "avalanche") {
      const ratio = (id: number) => { const rows = open(id); const pr = rows.reduce((s, r) => s + r.principal_rem, 0); const cost = rows.reduce((s, r) => s + r.interest_rem + r.fee_rem, 0); return pr > 0 ? cost / pr : cost > 0 ? Infinity : 0; };
      return [...candidates].sort((a, b) => ratio(b) - ratio(a) || balance(a) - balance(b) || a - b)[0];
    }
    const rank = (id: number) => { const i = p.order.indexOf(id); return i < 0 ? p.order.length + id : i; };
    return [...candidates].sort((a, b) => rank(a) - rank(b))[0];
  };

  for (let m = 0; m < MAX_MONTHS && total() > 0; m++) {
    const ym = addMonthsClamped(`${startMonth}-01`, m).slice(0, 7);
    const end = monthEnd(ym);
    let scheduled = 0, extra = 0;
    // 1) scheduled installments (anything due up to the end of this month, including overdue ones in month 0)
    for (const id of ids) for (const r of open(id)) if (r.due_date <= end) { scheduled += r.remaining; interestFee += r.interest_rem + r.fee_rem; r.paid = true; }
    // 2) extra budget prepays whole future installments of the target debt
    budget += budgetPerMonth;
    for (let guard = 0; guard < 10_000 && budget > 0; guard++) {
      const t = pickTarget(end);
      if (t === null) break;
      const row = open(t).filter((r) => r.due_date > end).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.sequence_no - b.sequence_no)[0];
      const rebate = Math.round((p.rebate_pct / 100) * row.interest_rem);
      const cost = row.remaining - rebate;
      if (cost > budget) break; // only whole installments are prepaid; the rest rolls over
      budget -= cost; extra += cost; interestFee += row.interest_rem + row.fee_rem - rebate; row.paid = true;
      if (!targetOrder.includes(t)) targetOrder.push(t);
    }
    totalPaid += scheduled + extra;
    for (const id of ids) if (!(id in cleared) && balance(id) === 0) cleared[id] = ym;
    months.push({ month: ym, scheduled, extra, outstanding: total() });
  }
  const last = months[months.length - 1];
  return {
    key, months, monthsToDebtFree: months.length, debtFreeMonth: last ? last.month : null, totalPaid, interestFeePaid: interestFee, clearedMonth: cleared, targetOrder,
  };
}

export function compareStrategies(debts: DebtSim[], today: string, p: StrategyParams): StrategyResult[] {
  return (["minimum", "snowball", "avalanche", "custom"] as StrategyKey[]).map((k) => runStrategy(k, debts, today, p));
}

/** Rough ranking proxy shown to the user: scheduled interest + fees per rupiah of remaining principal. */
export function impliedCostRatio(d: DebtSim): number {
  const rows = d.rows.filter((r) => r.remaining > 0);
  const pr = rows.reduce((s, r) => s + r.principal_rem, 0);
  const cost = rows.reduce((s, r) => s + r.interest_rem + r.fee_rem, 0);
  return pr > 0 ? cost / pr : 0;
}
