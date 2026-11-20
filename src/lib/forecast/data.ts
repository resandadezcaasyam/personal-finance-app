import type Database from "better-sqlite3";
import { listAccounts } from "../ledger/accounts";
import { LedgerError } from "../ledger/errors";
import { writeAudit } from "../ledger/audit";
import { addMonthsClamped, daysBetween, shiftDate, todayWIB } from "../format";
import { PRESETS, runForecast, type BillInput, type ForecastInput, type ForecastResult, type IncomeRule, type InstallmentInput, type ScenarioParams } from "./engine";

export const HISTORY_DAYS = 90;
export const MIN_HISTORY_DAYS = 14;

export interface ForecastContext {
  input: ForecastInput;
  /** Data-quality notes the user should see next to the numbers. */
  warnings: string[];
  baseline: { days: number; total: number; perDay: number; perMonth: number; from: string | null };
  pendingInbox: number;
  incomeRules: IncomeRule[];
}

/**
 * Reads ACTUAL data only. Pending inbox items are deliberately not used: they are not in the ledger yet and would
 * double count or invent cash. Nothing here (or in the engine) writes to any table.
 */
export function loadForecastContext(db: Database.Database, opts: { today?: string; paydayRuleId?: number | null; paydayOverride?: string | null } = {}): ForecastContext {
  const today = opts.today ?? todayWIB();
  const warnings: string[] = [];
  const openingCash = listAccounts(db, { archived: false }).reduce((s, a) => s + a.balance, 0);

  const incomeRules = db.prepare(
    `SELECT r.id, r.name, r.amount, r.frequency, r.day_of_month, r.start_date, r.end_date, c.name AS category_name
     FROM recurring_rules r LEFT JOIN categories c ON c.id = r.category_id WHERE r.type = 'income' AND r.is_active = 1 ORDER BY r.id`,
  ).all() as IncomeRule[];
  if (incomeRules.length === 0) warnings.push("Belum ada pemasukan berulang (mis. gaji). Proyeksi hanya memuat pengeluaran dan kewajiban. Tambahkan di halaman Pemasukan.");

  const recentIncome = db.prepare("SELECT occurred_on AS date, amount FROM transactions WHERE status='posted' AND type='income' AND occurred_on >= ? AND occurred_on <= ?").all(shiftDate(today, -10), today) as { date: string; amount: number }[];

  const installments = (db.prepare(
    `SELECT d.id AS debt_id, CASE WHEN d.label <> '' THEN d.provider || ' · ' || d.label ELSE d.provider END AS label, s.sequence_no, d.installment_count,
            s.due_date, s.amount_due - s.amount_paid AS remaining
     FROM installment_schedules s JOIN debts d ON d.id = s.debt_id
     WHERE d.status = 'active' AND s.status <> 'skipped' AND s.amount_paid < s.amount_due ORDER BY s.due_date, d.id, s.sequence_no`,
  ).all() as InstallmentInput[]);

  const billRows = db.prepare("SELECT id, name, kind, amount, frequency, due_day, next_due_date FROM bills WHERE is_active = 1 AND next_due_date IS NOT NULL").all() as Omit<BillInput, "estimate">[];
  const bills: BillInput[] = billRows.map((b) => {
    let estimate: number | null = null;
    if (b.amount === null) {
      const last = db.prepare("SELECT amount FROM bill_payments WHERE bill_id = ? AND status = 'paid' AND amount > 0 ORDER BY due_date DESC LIMIT 3").all(b.id) as { amount: number }[];
      if (last.length) estimate = Math.round(last.reduce((s, r) => s + r.amount, 0) / last.length);
    }
    return { ...b, estimate };
  });

  // Habitual spending = average daily expense over recent history, excluding debt/bill payments (projected separately),
  // transfers and reconciliation adjustments (not expenses).
  const first = (db.prepare("SELECT MIN(occurred_on) AS d FROM transactions WHERE status='posted' AND type='expense'").get() as { d: string | null }).d;
  const windowStart = first ? (first > shiftDate(today, -(HISTORY_DAYS - 1)) ? first : shiftDate(today, -(HISTORY_DAYS - 1))) : today;
  const days = first ? daysBetween(windowStart, today) + 1 : 0;
  const total = first
    ? (db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE status='posted' AND type='expense' AND debt_payment_id IS NULL AND bill_id IS NULL AND occurred_on BETWEEN ? AND ?").get(windowStart, today) as { s: number }).s
    : 0;
  const perDay = days > 0 ? total / days : 0;
  if (days === 0) warnings.push("Belum ada riwayat pengeluaran, jadi belanja harian diproyeksikan Rp 0. Catat transaksi agar proyeksi lebih realistis.");
  else if (days < MIN_HISTORY_DAYS) warnings.push(`Riwayat pengeluaran baru ${days} hari. Rata-rata belanja harian mungkin belum mewakili kebiasaan Anda.`);

  const pendingInbox = (db.prepare("SELECT COUNT(*) AS n FROM inbox_items WHERE status IN ('new','needs_review','potential_duplicate')").get() as { n: number }).n;
  if (pendingInbox > 0) warnings.push(`${pendingInbox} item di Kotak Masuk belum disetujui dan tidak dihitung. Menyetujuinya dapat mengubah proyeksi.`);

  return {
    input: { today, openingCash, incomeRules, recentIncome, installments, bills, baselineDailySpend: perDay, paydayRuleId: opts.paydayRuleId ?? null, paydayOverride: opts.paydayOverride ?? null },
    warnings, baseline: { days, total, perDay: Math.round(perDay), perMonth: Math.round(perDay * 30), from: first ? windowStart : null }, pendingInbox, incomeRules,
  };
}

/* ---------------- actual balance history (for the chart's solid line) ---------------- */

/**
 * Total cash across active accounts at the end of each of the last `days` days, reconstructed from the ledger by
 * undoing later transactions. Transfers between active accounts net to zero; a transfer to/from an archived account
 * changes the active total.
 */
export function actualCashHistory(db: Database.Database, today: string, days: number): { date: string; balance: number }[] {
  const active = new Set(listAccounts(db, { archived: false }).map((a) => a.id));
  const current = [...active].length ? listAccounts(db, { archived: false }).reduce((s, a) => s + a.balance, 0) : 0;
  const from = shiftDate(today, -days);
  const delta = new Map<string, number>();
  const add = (d: string, v: number) => delta.set(d, (delta.get(d) ?? 0) + v);
  for (const r of db.prepare(
    `SELECT occurred_on AS d, account_id, type, amount, adj_direction FROM transactions WHERE status='posted' AND occurred_on > ?`,
  ).all(from) as { d: string; account_id: number; type: string; amount: number; adj_direction: string | null }[]) {
    if (!active.has(r.account_id)) continue;
    add(r.d, r.type === "income" || (r.type === "adjustment" && r.adj_direction === "in") ? r.amount : -r.amount);
  }
  for (const r of db.prepare("SELECT occurred_on AS d, from_account_id AS f, to_account_id AS t, amount FROM transfers WHERE status='posted' AND occurred_on > ?").all(from) as { d: string; f: number; t: number; amount: number }[]) {
    add(r.d, (active.has(r.t) ? r.amount : 0) - (active.has(r.f) ? r.amount : 0));
  }
  const out: { date: string; balance: number }[] = [];
  let bal = current;
  for (let i = 0; i <= days; i++) {
    const date = shiftDate(today, -i);
    out.push({ date, balance: bal });
    bal -= delta.get(date) ?? 0; // balance at end of the previous day
  }
  return out.reverse();
}

/* ---------------- scenarios ---------------- */

export function clampParams(p: Partial<ScenarioParams>, base: ScenarioParams = PRESETS.baseline): ScenarioParams {
  const n = (v: unknown, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
  return {
    income_pct: n(p.income_pct, 0, 200, base.income_pct), spending_pct: n(p.spending_pct, 0, 300, base.spending_pct), bills_pct: n(p.bills_pct, 0, 300, base.bills_pct),
    income_delay_days: n(p.income_delay_days, 0, 30, base.income_delay_days), buffer: n(p.buffer, 0, 1_000_000_000, base.buffer),
  };
}

export interface SavedScenario { id: number; name: string; params: ScenarioParams; created_at: string }

export function listScenarios(db: Database.Database): SavedScenario[] {
  return (db.prepare("SELECT id, name, parameters, created_at FROM simulation_scenarios WHERE kind = 'forecast' ORDER BY name COLLATE NOCASE").all() as { id: number; name: string; parameters: string; created_at: string }[])
    .map((r) => ({ id: r.id, name: r.name, params: clampParams(JSON.parse(r.parameters)), created_at: r.created_at }));
}

/** Stores assumptions and a small result snapshot. Never touches the ledger. */
export function saveScenario(db: Database.Database, name: string, params: ScenarioParams, result: ForecastResult | null): number {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new LedgerError("Nama skenario wajib diisi.", "name");
  if (n.length > 40) throw new LedgerError("Nama skenario maksimal 40 karakter.", "name");
  const snap = result ? JSON.stringify({ closing: result.summary.closingCash, lowest: result.summary.lowest, deficitDays: result.summary.deficitDays, horizonDays: result.displayDays, savedAt: result.today }) : null;
  try {
    return db.transaction(() => {
      const id = Number(db.prepare("INSERT INTO simulation_scenarios (name, kind, parameters, result) VALUES (?, 'forecast', ?, ?)").run(n, JSON.stringify(params), snap).lastInsertRowid);
      writeAudit(db, "scenario", id, "create", null, { name: n, ...params });
      return id;
    })();
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new LedgerError("Sudah ada skenario dengan nama tersebut.", "name");
    throw e;
  }
}

export function deleteScenario(db: Database.Database, id: number) {
  db.transaction(() => {
    db.prepare("DELETE FROM simulation_scenarios WHERE id = ? AND kind = 'forecast'").run(id);
    writeAudit(db, "scenario", id, "delete", null, null);
  })();
}

export function horizonDays(today: string, months: number): number {
  return daysBetween(today, addMonthsClamped(today, months));
}
