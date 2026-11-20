import type Database from "better-sqlite3";
import { LedgerError } from "../ledger/errors";
import { writeAudit } from "../ledger/audit";
import { getDebt, recordDebtPayment } from "../debts/debts";
import { todayWIB } from "../format";
import { loadForecastContext, type ForecastContext } from "../forecast/data";
import { PRESETS, type PresetKey } from "../forecast/engine";
import { remainingParts, type DebtSim, type RepayParams } from "./simulate";

export interface RepayContext { forecast: ForecastContext; debts: DebtSim[] }

/** Read-only. Open installments of active debts with their fee/interest/principal split. */
export function loadRepayContext(db: Database.Database, opts: { today?: string } = {}): RepayContext {
  const today = opts.today ?? todayWIB();
  const forecast = loadForecastContext(db, { today });
  const debts = (db.prepare("SELECT id, provider, label, interest_rate_bps FROM debts WHERE status = 'active' ORDER BY provider COLLATE NOCASE, id").all() as { id: number; provider: string; label: string; interest_rate_bps: number | null }[])
    .map((d) => {
      const rows = (db.prepare(
        `SELECT sequence_no, due_date, principal_due, interest_due, fee_due, amount_due, amount_paid FROM installment_schedules
         WHERE debt_id = ? AND status <> 'skipped' AND amount_paid < amount_due ORDER BY sequence_no`,
      ).all(d.id) as { sequence_no: number; due_date: string; principal_due: number; interest_due: number; fee_due: number; amount_due: number; amount_paid: number }[]).map((r) => ({
        debt_id: d.id, sequence_no: r.sequence_no, installment_count: 0, due_date: r.due_date, remaining: r.amount_due - r.amount_paid, ...remainingParts(r),
      }));
      const count = (db.prepare("SELECT installment_count AS n FROM debts WHERE id = ?").get(d.id) as { n: number | null }).n ?? rows.length;
      rows.forEach((r) => (r.installment_count = count));
      return { debt_id: d.id, provider: d.provider, label: d.label, rate_bps: d.interest_rate_bps, rows };
    })
    .filter((d) => d.rows.length > 0);
  return { forecast, debts };
}

/* ---------------- saved scenarios (kind = 'early_repayment') ---------------- */

export interface StoredRepay extends RepayParams { preset: PresetKey; buffer: number }
export interface SavedRepay { id: number; name: string; params: StoredRepay; snapshot: { closing?: number; lowest?: number; cashOut?: number } | null; created_at: string }

const KIND = "early_repayment";

export function sanitizeStored(raw: unknown): StoredRepay {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : d);
  const preset = (["baseline", "conservative", "optimistic"] as const).includes(o.preset as PresetKey) ? (o.preset as PresetKey) : "baseline";
  return {
    debt_id: num(o.debt_id, 0), date: typeof o.date === "string" ? o.date : "", mode: o.mode === "partial" ? "partial" : "full",
    amount: o.amount === null || o.amount === undefined ? null : num(o.amount, 0), quote: o.quote === null || o.quote === undefined ? null : num(o.quote, 0),
    rebate_pct: Math.min(100, Math.max(0, num(o.rebate_pct, 0))), fee: Math.max(0, num(o.fee, 0)), penalty: Math.max(0, num(o.penalty, 0)), preset, buffer: Math.max(0, num(o.buffer, PRESETS[preset].buffer)),
  };
}

export function listRepayScenarios(db: Database.Database): SavedRepay[] {
  return (db.prepare("SELECT id, name, parameters, result, created_at FROM simulation_scenarios WHERE kind = ? ORDER BY name COLLATE NOCASE").all(KIND) as { id: number; name: string; parameters: string; result: string | null; created_at: string }[])
    .map((r) => ({ id: r.id, name: r.name, params: sanitizeStored(JSON.parse(r.parameters)), snapshot: r.result ? JSON.parse(r.result) : null, created_at: r.created_at }));
}

/** Stores assumptions and a small snapshot. Never touches the ledger or any debt. */
export function saveRepayScenario(db: Database.Database, name: string, params: StoredRepay, snapshot: { closing: number; lowest: number; cashOut: number } | null): number {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new LedgerError("Nama skenario wajib diisi.", "name");
  if (n.length > 50) throw new LedgerError("Nama skenario maksimal 50 karakter.", "name");
  try {
    return db.transaction(() => {
      const id = Number(db.prepare("INSERT INTO simulation_scenarios (name, kind, parameters, result) VALUES (?,?,?,?)").run(n, KIND, JSON.stringify(params), snapshot ? JSON.stringify(snapshot) : null).lastInsertRowid);
      writeAudit(db, "scenario", id, "create", null, { kind: KIND, name: n });
      return id;
    })();
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new LedgerError("Sudah ada skenario dengan nama tersebut.", "name");
    throw e;
  }
}

export function duplicateRepayScenario(db: Database.Database, id: number): number {
  const s = listRepayScenarios(db).find((x) => x.id === id);
  if (!s) throw new LedgerError("Skenario tidak ditemukan.");
  const names = new Set(listRepayScenarios(db).map((x) => x.name.toLowerCase()));
  let name = `${s.name} (salinan)`;
  for (let i = 2; names.has(name.toLowerCase()); i++) name = `${s.name} (salinan ${i})`;
  return saveRepayScenario(db, name.slice(0, 50), s.params, s.snapshot ? { closing: s.snapshot.closing ?? 0, lowest: s.snapshot.lowest ?? 0, cashOut: s.snapshot.cashOut ?? 0 } : null);
}

export function deleteRepayScenario(db: Database.Database, id: number) {
  db.transaction(() => {
    db.prepare("DELETE FROM simulation_scenarios WHERE id = ? AND kind = ?").run(id, KIND);
    writeAudit(db, "scenario", id, "delete", null, { kind: KIND });
  })();
}

/* ---------------- recording the REAL repayment (explicit, separate from simulating) ---------------- */

/**
 * Records an actual full settlement through the normal debt-payment path: one expense, the whole outstanding obligation
 * applied to the schedule. Only for settlements without a rebate or quotation, because the ledger has no way to
 * represent a waived amount. The amount is computed here from the database, never taken from the client.
 */
export function recordFullSettlement(db: Database.Database, input: { debt_id: number; account_id: number; paid_on: string; fee: number; penalty: number }, opts: { today?: string } = {}) {
  const today = opts.today ?? todayWIB();
  const debt = getDebt(db, input.debt_id, today);
  if (!debt || debt.status !== "active") throw new LedgerError("Utang tidak ditemukan atau sudah lunas.");
  if (debt.outstanding <= 0) throw new LedgerError("Tidak ada sisa kewajiban.");
  return recordDebtPayment(db, { debt_id: input.debt_id, account_id: input.account_id, amount: debt.outstanding, penalty: input.penalty, fee: input.fee, paid_on: input.paid_on, note: "Pelunasan dini (dari simulator)" }, { today });
}
