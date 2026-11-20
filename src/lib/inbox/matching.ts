import type Database from "better-sqlite3";
import { daysBetween } from "../format";
import { normalizeText } from "../capture/text";

export type Match =
  | { kind: "debt"; debt_id: number; schedule_id: number; sequence_no: number; label: string; remaining: number; reason: string }
  | { kind: "bill"; bill_id: number; label: string; due_date: string; reason: string }
  | { kind: "transfer"; pair_id: number; pair_label: string; from_account_id: number; to_account_id: number };

export interface MatchInput { type: "income" | "expense"; amount: number | null; occurred_on: string | null; account_id: number | null; description: string | null; merchant: string | null }

export const MATCH_WINDOW_DAYS = 10;

const STOP = new Set(["bayar", "tagihan", "pembayaran", "token", "transfer", "angsuran", "cicilan", "biaya"]);
const sigTokens = (s: string) => normalizeText(s).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));

/**
 * Suggest that an imported expense is really an installment or a bill payment, so approving it records the
 * obligation as paid (one expense) instead of creating a second, duplicate expense.
 * Returns null when nothing fits or when two candidates fit equally (never guesses between them).
 */
export function findObligationMatch(db: Database.Database, item: MatchInput): Match | null {
  if (item.type !== "expense" || !item.amount || !item.occurred_on) return null;
  const date = item.occurred_on;
  const text = normalizeText(`${item.merchant ?? ""} ${item.description ?? ""}`);
  const cands: { score: number; dist: number; m: Match }[] = [];

  const debts = db.prepare(
    `SELECT d.id, d.provider, d.label,
       (SELECT s.id FROM installment_schedules s WHERE s.debt_id = d.id AND s.status <> 'skipped' AND s.amount_paid < s.amount_due ORDER BY s.sequence_no LIMIT 1) AS sid
     FROM debts d WHERE d.status = 'active'`,
  ).all() as { id: number; provider: string; label: string; sid: number | null }[];
  for (const d of debts) {
    if (!d.sid) continue;
    const row = db.prepare("SELECT sequence_no, due_date, amount_due - amount_paid AS remaining FROM installment_schedules WHERE id = ?").get(d.sid) as { sequence_no: number; due_date: string; remaining: number };
    const outstanding = (db.prepare("SELECT COALESCE(SUM(amount_due - amount_paid),0) AS o FROM installment_schedules WHERE debt_id = ? AND status <> 'skipped'").get(d.id) as { o: number }).o;
    const named = normalizeText(d.provider).length >= 3 && ` ${text} `.includes(` ${normalizeText(d.provider)} `);
    const dist = Math.abs(daysBetween(row.due_date, date));
    const label = d.label ? `${d.provider} · ${d.label}` : d.provider;
    if (row.remaining === item.amount && dist <= MATCH_WINDOW_DAYS) {
      cands.push({ score: named ? 3 : 2, dist, m: { kind: "debt", debt_id: d.id, schedule_id: d.sid, sequence_no: row.sequence_no, label, remaining: row.remaining, reason: `Nominal sama dengan cicilan #${row.sequence_no} (jatuh tempo ${row.due_date})` } });
    } else if (named && item.amount <= outstanding) {
      cands.push({ score: 1, dist, m: { kind: "debt", debt_id: d.id, schedule_id: d.sid, sequence_no: row.sequence_no, label, remaining: row.remaining, reason: `Keterangan menyebut ${d.provider}` } });
    }
  }

  const bills = db.prepare("SELECT id, name, amount, next_due_date FROM bills WHERE is_active = 1 AND next_due_date IS NOT NULL").all() as { id: number; name: string; amount: number | null; next_due_date: string }[];
  for (const b of bills) {
    const dist = Math.abs(daysBetween(b.next_due_date, date));
    if (dist > MATCH_WINDOW_DAYS) continue;
    const named = sigTokens(b.name).some((t) => ` ${text} `.includes(` ${t} `));
    const sameAmount = b.amount !== null && b.amount === item.amount;
    if (!sameAmount && !named) continue;
    const score = sameAmount ? (named ? 3 : 2) : 1;
    cands.push({ score, dist, m: { kind: "bill", bill_id: b.id, label: b.name, due_date: b.next_due_date, reason: sameAmount ? `Nominal sama dengan tagihan (jatuh tempo ${b.next_due_date})` : `Keterangan menyebut ${b.name}` } });
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score || a.dist - b.dist);
  const [best, second] = cands;
  if (second && second.score === best.score && second.dist === best.dist) return null; // ambiguous: let the user decide
  return best.m;
}

/** Stored match is still valid if the same obligation is still the best fit. */
export function sameMatch(a: Match | null, b: Match | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "debt" && b.kind === "debt") return a.debt_id === b.debt_id && a.schedule_id === b.schedule_id;
  if (a.kind === "bill" && b.kind === "bill") return a.bill_id === b.bill_id && a.due_date === b.due_date;
  return true;
}
