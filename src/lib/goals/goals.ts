import type Database from "better-sqlite3";
import { LedgerError } from "../ledger/errors";
import { writeAudit } from "../ledger/audit";
import { requireActiveAccount } from "../ledger/accounts";
import { assertAmount, assertPastOrToday, isValidIsoDate, MAX_AMOUNT } from "../ledger/validate";
import { daysBetween, shiftDate, todayWIB } from "../format";

/**
 * Savings goals are EARMARKS: a contribution records money set aside for a goal, it does not move money between accounts
 * (balances and the ledger are unchanged). Progress, pace and projections are derived from the contributions.
 */
export type GoalKind = "emergency" | "travel" | "purchase" | "custom";
export const GOAL_KIND_LABEL: Record<GoalKind, string> = { emergency: "Dana darurat", travel: "Liburan", purchase: "Pembelian", custom: "Lainnya" };

export interface GoalInput { name: string; kind: GoalKind; target_amount: number; target_date: string | null }
export interface GoalRow { id: number; name: string; kind: GoalKind; target_amount: number; saved_amount: number; target_date: string | null; status: "active" | "achieved" | "archived"; created_at: string }

export interface GoalView extends GoalRow {
  pct: number;
  remaining: number;
  /** Net amount set aside in the last 90 days, per month. */
  avgPerMonth: number;
  /** Needed per month to reach the target by its date (null without a date, or when already reached). */
  requiredPerMonth: number | null;
  /** When the goal is reached if the recent pace continues (null if the pace is zero or the goal is reached). */
  projectedDate: string | null;
  onTrack: boolean | null;
  contributions: number;
}

function validate(i: GoalInput, today: string) {
  const name = i.name.trim().replace(/\s+/g, " ");
  if (!name) throw new LedgerError("Nama target wajib diisi.", "name");
  if (name.length > 60) throw new LedgerError("Nama target maksimal 60 karakter.", "name");
  if (!(["emergency", "travel", "purchase", "custom"] as const).includes(i.kind)) throw new LedgerError("Jenis target tidak valid.", "kind");
  assertAmount(i.target_amount, "target_amount");
  if (i.target_date !== null && (!isValidIsoDate(i.target_date) || i.target_date <= today)) throw new LedgerError("Tanggal target harus setelah hari ini.", "target_date");
  return name;
}

export function createGoal(db: Database.Database, i: GoalInput, opts: { today?: string } = {}): number {
  const name = validate(i, opts.today ?? todayWIB());
  return db.transaction(() => {
    const id = Number(db.prepare("INSERT INTO goals (name, kind, target_amount, target_date) VALUES (?,?,?,?)").run(name, i.kind, i.target_amount, i.target_date).lastInsertRowid);
    writeAudit(db, "goal", id, "create", null, { ...i, name });
    return id;
  })();
}

export function updateGoal(db: Database.Database, id: number, i: GoalInput, opts: { today?: string } = {}) {
  const g = db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as GoalRow | undefined;
  if (!g) throw new LedgerError("Target tidak ditemukan.");
  const name = validate(i, opts.today ?? todayWIB());
  db.transaction(() => {
    db.prepare("UPDATE goals SET name=?, kind=?, target_amount=?, target_date=? WHERE id=?").run(name, i.kind, i.target_amount, i.target_date, id);
    syncStatus(db, id);
    writeAudit(db, "goal", id, "update", { name: g.name, target_amount: g.target_amount }, { name, target_amount: i.target_amount });
  })();
}

/** Keep saved_amount and the active/achieved status consistent with the contributions. */
function syncStatus(db: Database.Database, id: number) {
  const g = db.prepare("SELECT target_amount, status FROM goals WHERE id = ?").get(id) as { target_amount: number; status: string };
  const saved = (db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM goal_contributions WHERE goal_id = ?").get(id) as { s: number }).s;
  const status = g.status === "archived" ? "archived" : saved >= g.target_amount ? "achieved" : "active";
  db.prepare("UPDATE goals SET saved_amount = ?, status = ? WHERE id = ?").run(saved, status, id);
}

export function addContribution(db: Database.Database, goalId: number, c: { amount: number; contributed_on: string; note?: string; account_id?: number | null }, opts: { today?: string } = {}): number {
  const today = opts.today ?? todayWIB();
  const g = db.prepare("SELECT * FROM goals WHERE id = ?").get(goalId) as GoalRow | undefined;
  if (!g) throw new LedgerError("Target tidak ditemukan.");
  if (g.status === "archived") throw new LedgerError("Target ini diarsipkan. Pulihkan dulu untuk menambah dana.");
  if (!Number.isSafeInteger(c.amount) || c.amount === 0 || Math.abs(c.amount) > MAX_AMOUNT) throw new LedgerError("Nominal tidak valid.", "amount");
  assertPastOrToday(c.contributed_on, today, "contributed_on");
  if (c.account_id) requireActiveAccount(db, c.account_id, "account_id");
  const note = (c.note ?? "").trim().slice(0, 120);
  if (g.saved_amount + c.amount < 0) throw new LedgerError("Penarikan melebihi dana yang terkumpul pada target ini.", "amount");
  return db.transaction(() => {
    const id = Number(db.prepare("INSERT INTO goal_contributions (goal_id, amount, contributed_on, note, account_id) VALUES (?,?,?,?,?)").run(goalId, c.amount, c.contributed_on, note || null, c.account_id ?? null).lastInsertRowid);
    syncStatus(db, goalId);
    writeAudit(db, "goal_contribution", id, "create", null, { goal_id: goalId, amount: c.amount, contributed_on: c.contributed_on });
    return id;
  })();
}

export function removeContribution(db: Database.Database, contributionId: number) {
  const c = db.prepare("SELECT goal_id, amount FROM goal_contributions WHERE id = ?").get(contributionId) as { goal_id: number; amount: number } | undefined;
  if (!c) throw new LedgerError("Catatan tidak ditemukan.");
  const g = db.prepare("SELECT saved_amount FROM goals WHERE id = ?").get(c.goal_id) as { saved_amount: number };
  if (g.saved_amount - c.amount < 0) throw new LedgerError("Menghapus catatan ini membuat dana target menjadi negatif.");
  db.transaction(() => {
    db.prepare("DELETE FROM goal_contributions WHERE id = ?").run(contributionId);
    syncStatus(db, c.goal_id);
    writeAudit(db, "goal_contribution", contributionId, "delete", { amount: c.amount }, null);
  })();
}

export function setGoalArchived(db: Database.Database, id: number, archived: boolean) {
  db.transaction(() => {
    db.prepare("UPDATE goals SET status = ? WHERE id = ?").run(archived ? "archived" : "active", id);
    syncStatus(db, id);
    writeAudit(db, "goal", id, archived ? "archive" : "restore", null, null);
  })();
}

export function deleteGoal(db: Database.Database, id: number) {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM goal_contributions WHERE goal_id = ?").get(id) as { n: number }).n;
  if (n > 0) throw new LedgerError("Target yang sudah punya catatan dana tidak bisa dihapus. Arsipkan saja.");
  db.transaction(() => { db.prepare("DELETE FROM goals WHERE id = ?").run(id); writeAudit(db, "goal", id, "delete", null, null); })();
}

export function listGoals(db: Database.Database, today: string = todayWIB()): GoalView[] {
  const rows = db.prepare("SELECT * FROM goals ORDER BY (status = 'archived'), (status = 'achieved'), COALESCE(target_date, '9999'), name COLLATE NOCASE").all() as GoalRow[];
  const since = shiftDate(today, -90);
  return rows.map((g) => {
    const net = (db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM goal_contributions WHERE goal_id = ? AND contributed_on > ?").get(g.id, since) as { s: number }).s;
    const n = (db.prepare("SELECT COUNT(*) AS n FROM goal_contributions WHERE goal_id = ?").get(g.id) as { n: number }).n;
    const remaining = Math.max(0, g.target_amount - g.saved_amount);
    const avg = Math.round(net / 3);
    const reached = remaining === 0;
    const months = g.target_date ? Math.max(1, Math.ceil(daysBetween(today, g.target_date) / 30.4375)) : null;
    const projected = !reached && avg > 0 ? shiftDate(today, Math.ceil((remaining / avg) * 30.4375)) : null;
    return {
      ...g, pct: g.target_amount ? g.saved_amount / g.target_amount : 0, remaining, avgPerMonth: avg,
      requiredPerMonth: g.target_date && !reached && months ? Math.ceil(remaining / months) : null, projectedDate: projected,
      onTrack: g.target_date && !reached ? (projected !== null && projected <= g.target_date) : null, contributions: n,
    };
  });
}

export function listContributions(db: Database.Database, goalId: number) {
  return db.prepare(
    `SELECT c.id, c.amount, c.contributed_on, c.note, a.name AS account_name FROM goal_contributions c LEFT JOIN accounts a ON a.id = c.account_id
     WHERE c.goal_id = ? ORDER BY c.contributed_on DESC, c.id DESC`,
  ).all(goalId) as { id: number; amount: number; contributed_on: string; note: string | null; account_name: string | null }[];
}

/** A common rule of thumb, shown as a hint only: 3 to 6 months of habitual spending. */
export function emergencyFundHint(baselineDailySpend: number): { months3: number; months6: number } {
  const month = baselineDailySpend * 30;
  return { months3: Math.round(month * 3), months6: Math.round(month * 6) };
}
