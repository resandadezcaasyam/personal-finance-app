import type Database from "better-sqlite3";
import { LedgerError } from "../ledger/errors";
import { writeAudit } from "../ledger/audit";
import { requireActiveAccount } from "../ledger/accounts";
import { createTransaction } from "../ledger/transactions";
import { assertAmount, isValidIsoDate } from "../ledger/validate";
import { daysBetween, shiftDate, todayWIB } from "../format";
import { incomeOccurrences, type IncomeRule } from "../forecast/engine";
import { normalizeText } from "../capture/text";
import { getSetting, setSetting } from "../settings";

/**
 * Recurring entries. A rule produces PLANNED occurrences; they are derived on demand (nothing is stored until the user
 * decides), so planned money can never be mistaken for real money. Confirming posts through the normal ledger rules and
 * is idempotent: (rule, due date) is unique and the posted transaction carries source_ref `rule:<id>:<date>`.
 */

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";
export interface RuleRow {
  id: number; name: string; type: "income" | "expense"; amount: number; account_id: number | null; category_id: number | null; frequency: Frequency;
  day_of_month: number | null; start_date: string; end_date: string | null; is_active: number; created_at: string;
  account_name: string | null; category_name: string | null;
}
export interface RuleInput {
  name: string; type: "income" | "expense"; amount: number; account_id: number | null; category_id: number | null; frequency: Frequency;
  day_of_month: number | null; start_date: string; end_date?: string | null;
}

export const LOOKAHEAD_DAYS = 7;
export const LOOKBACK_DAYS = 62;
/** Money received/paid this close to a due date, within this share of the planned amount, counts as the same event. */
export const MATCH_DAYS = 5;
export const MATCH_TOLERANCE = 0.15;

/** The calendar date (WIB) of a stored UTC timestamp. */
export const wibDate = (iso: string): string => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10);

export function listRules(db: Database.Database): RuleRow[] {
  return db.prepare(
    `SELECT r.*, a.name AS account_name, c.name AS category_name FROM recurring_rules r
     LEFT JOIN accounts a ON a.id = r.account_id LEFT JOIN categories c ON c.id = r.category_id
     ORDER BY r.is_active DESC, r.type, r.name COLLATE NOCASE`,
  ).all() as RuleRow[];
}

function validate(db: Database.Database, i: RuleInput): string {
  const name = i.name.trim().replace(/\s+/g, " ");
  if (!name) throw new LedgerError("Nama wajib diisi.", "name");
  if (name.length > 80) throw new LedgerError("Nama maksimal 80 karakter.", "name");
  assertAmount(i.amount, "amount");
  if (!["weekly", "monthly", "quarterly", "yearly"].includes(i.frequency)) throw new LedgerError("Frekuensi tidak valid.", "frequency");
  if (i.frequency !== "weekly" && (!i.day_of_month || i.day_of_month < 1 || i.day_of_month > 31)) throw new LedgerError("Tanggal tiap periode harus antara 1 dan 31.", "day_of_month");
  if (!isValidIsoDate(i.start_date)) throw new LedgerError("Tanggal mulai tidak valid.", "start_date");
  if (i.end_date && (!isValidIsoDate(i.end_date) || i.end_date < i.start_date)) throw new LedgerError("Tanggal berakhir harus setelah tanggal mulai.", "end_date");
  if (i.account_id) requireActiveAccount(db, i.account_id, "account_id");
  if (i.category_id) {
    const c = db.prepare("SELECT kind, is_archived FROM categories WHERE id = ?").get(i.category_id) as { kind: string; is_archived: number } | undefined;
    if (!c || c.kind !== i.type) throw new LedgerError("Kategori tidak sesuai dengan jenis aturan.", "category_id");
  }
  return name;
}

export function createRule(db: Database.Database, i: RuleInput): number {
  const name = validate(db, i);
  return db.transaction(() => {
    const id = Number(db.prepare(
      `INSERT INTO recurring_rules (name, type, amount, account_id, category_id, frequency, day_of_month, start_date, end_date) VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(name, i.type, i.amount, i.account_id, i.category_id, i.frequency, i.frequency === "weekly" ? null : i.day_of_month, i.start_date, i.end_date || null).lastInsertRowid);
    writeAudit(db, "recurring_rule", id, "create", null, { ...i, name });
    return id;
  })();
}

/** Changes apply to occurrences that have not been decided yet; confirmed ones keep what was posted. */
export function updateRule(db: Database.Database, id: number, i: RuleInput) {
  const before = db.prepare("SELECT * FROM recurring_rules WHERE id = ?").get(id) as RuleRow | undefined;
  if (!before) throw new LedgerError("Aturan tidak ditemukan.");
  const name = validate(db, i);
  db.transaction(() => {
    db.prepare("UPDATE recurring_rules SET name=?, type=?, amount=?, account_id=?, category_id=?, frequency=?, day_of_month=?, start_date=?, end_date=? WHERE id=?")
      .run(name, i.type, i.amount, i.account_id, i.category_id, i.frequency, i.frequency === "weekly" ? null : i.day_of_month, i.start_date, i.end_date || null, id);
    writeAudit(db, "recurring_rule", id, "update", { name: before.name, amount: before.amount }, { name, amount: i.amount });
  })();
}

export function setRuleActive(db: Database.Database, id: number, active: boolean) {
  db.transaction(() => {
    db.prepare("UPDATE recurring_rules SET is_active = ? WHERE id = ?").run(active ? 1 : 0, id);
    writeAudit(db, "recurring_rule", id, active ? "activate" : "deactivate", null, null);
  })();
}

/** A rule with any recorded decision is kept for history: deactivate it instead. */
export function deleteRule(db: Database.Database, id: number) {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM recurring_occurrences WHERE rule_id = ?").get(id) as { n: number }).n;
  if (n > 0) throw new LedgerError("Aturan ini sudah punya riwayat konfirmasi. Nonaktifkan saja agar riwayatnya tetap tersimpan.");
  db.transaction(() => {
    db.prepare("DELETE FROM recurring_rules WHERE id = ?").run(id);
    writeAudit(db, "recurring_rule", id, "delete", null, null);
  })();
}

const asIncomeRule = (r: RuleRow): IncomeRule => ({ id: r.id, name: r.name, amount: r.amount, frequency: r.frequency, day_of_month: r.day_of_month, start_date: r.start_date, end_date: r.end_date, category_name: r.category_name });

/* ---------------- planned occurrences ---------------- */

export interface PlannedItem {
  rule_id: number; name: string; type: "income" | "expense"; amount: number; account_id: number | null; account_name: string | null; category_id: number | null;
  due_date: string;
  /** overdue: due date passed; due: due today; upcoming: within the look-ahead window (cannot be posted yet). */
  state: "overdue" | "due" | "upcoming";
  days: number;
  /** An existing transaction that looks like this occurrence already happened. Link it instead of posting a duplicate. */
  match: { transaction_id: number; date: string; amount: number; description: string } | null;
}

function findMatch(db: Database.Database, r: RuleRow, due: string, today: string, claimed: Set<number>): PlannedItem["match"] {
  const lo = shiftDate(due, -MATCH_DAYS);
  const hi = shiftDate(due, MATCH_DAYS) < today ? shiftDate(due, MATCH_DAYS) : today;
  if (lo > hi) return null;
  const rows = db.prepare(
    `SELECT t.id, t.occurred_on, t.amount, t.description FROM transactions t
     WHERE t.status = 'posted' AND t.type = ? AND t.occurred_on BETWEEN ? AND ? AND t.debt_payment_id IS NULL AND t.bill_id IS NULL AND t.source <> 'recurring'
       AND (? IS NULL OR t.account_id = ?)
       AND t.id NOT IN (SELECT transaction_id FROM recurring_occurrences WHERE transaction_id IS NOT NULL AND status = 'confirmed')`,
  ).all(r.type, lo, hi, r.account_id, r.account_id) as { id: number; occurred_on: string; amount: number; description: string }[];
  const ok = rows.filter((t) => !claimed.has(t.id) && Math.abs(t.amount - r.amount) <= r.amount * MATCH_TOLERANCE)
    .sort((a, b) => Math.abs(daysBetween(due, a.occurred_on)) - Math.abs(daysBetween(due, b.occurred_on)) || Math.abs(a.amount - r.amount) - Math.abs(b.amount - r.amount) || a.id - b.id);
  const m = ok[0];
  if (!m) return null;
  claimed.add(m.id);
  return { transaction_id: m.id, date: m.occurred_on, amount: m.amount, description: m.description };
}

/**
 * Occurrences that still need a decision: from the day the rule was created (never earlier than its start date and at most
 * LOOKBACK_DAYS back) up to LOOKAHEAD_DAYS ahead. Decided ones (confirmed with a live transaction, or skipped) are left out.
 */
export function listPlanned(db: Database.Database, today: string = todayWIB(), opts: { lookaheadDays?: number } = {}): PlannedItem[] {
  const ahead = shiftDate(today, opts.lookaheadDays ?? LOOKAHEAD_DAYS);
  const floor = shiftDate(today, -LOOKBACK_DAYS);
  const decided = new Set((db.prepare(
    `SELECT o.rule_id || ':' || o.due_date AS k FROM recurring_occurrences o LEFT JOIN transactions t ON t.id = o.transaction_id
     WHERE o.status = 'skipped' OR (o.status = 'confirmed' AND (o.transaction_id IS NULL OR t.status = 'posted'))`,
  ).all() as { k: string }[]).map((r) => r.k));
  const claimed = new Set<number>();
  const out: PlannedItem[] = [];
  for (const r of listRules(db).filter((x) => x.is_active)) {
    const anchor = [r.start_date, wibDate(r.created_at), floor].reduce((a, b) => (a > b ? a : b));
    for (const due of incomeOccurrences(asIncomeRule(r), shiftDate(anchor, -1), ahead)) {
      if (decided.has(`${r.id}:${due}`)) continue;
      const days = daysBetween(today, due);
      out.push({
        rule_id: r.id, name: r.name, type: r.type, amount: r.amount, account_id: r.account_id, account_name: r.account_name, category_id: r.category_id, due_date: due,
        state: days < 0 ? "overdue" : days === 0 ? "due" : "upcoming", days, match: findMatch(db, r, due, today, claimed),
      });
    }
  }
  return out.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.name.localeCompare(b.name));
}

function requireOccurrence(db: Database.Database, ruleId: number, due: string): RuleRow {
  const r = listRules(db).find((x) => x.id === ruleId);
  if (!r) throw new LedgerError("Aturan tidak ditemukan.");
  if (!isValidIsoDate(due) || !incomeOccurrences(asIncomeRule(r), shiftDate(due, -1), due).includes(due)) throw new LedgerError("Tanggal itu bukan jadwal aturan ini.");
  return r;
}

export interface ConfirmInput { rule_id: number; due_date: string; account_id?: number | null; amount?: number; paid_on?: string; link_transaction_id?: number }

/**
 * Confirm one occurrence. Either posts ONE transaction (normal ledger rules apply: not in the future, active account...)
 * or links an existing transaction that already represents it (no second posting). Idempotent per (rule, due date).
 */
export function confirmOccurrence(db: Database.Database, input: ConfirmInput, opts: { today?: string } = {}): { transactionId: number; posted: boolean } {
  const today = opts.today ?? todayWIB();
  const rule = requireOccurrence(db, input.rule_id, input.due_date);
  if (!rule.is_active) throw new LedgerError("Aturan ini tidak aktif.");
  return db.transaction(() => {
    const prev = db.prepare("SELECT o.id, o.status, o.transaction_id, t.status AS tx_status FROM recurring_occurrences o LEFT JOIN transactions t ON t.id = o.transaction_id WHERE o.rule_id = ? AND o.due_date = ?").get(rule.id, input.due_date) as { id: number; status: string; transaction_id: number | null; tx_status: string | null } | undefined;
    if (prev) {
      const stillDecided = prev.status === "skipped" || (prev.status === "confirmed" && (prev.transaction_id === null || prev.tx_status === "posted"));
      if (stillDecided) throw new LedgerError(prev.status === "skipped" ? "Jadwal ini sudah dilewati." : "Jadwal ini sudah dikonfirmasi.");
      db.prepare("DELETE FROM recurring_occurrences WHERE id = ?").run(prev.id); // its transaction was voided: the occurrence is open again
    }
    let txId: number;
    let posted = false;
    if (input.link_transaction_id) {
      const t = db.prepare("SELECT id, type, status, debt_payment_id, bill_id FROM transactions WHERE id = ?").get(input.link_transaction_id) as { id: number; type: string; status: string; debt_payment_id: number | null; bill_id: number | null } | undefined;
      if (!t || t.status !== "posted" || t.type !== rule.type) throw new LedgerError("Transaksi yang ditautkan tidak sesuai.");
      if (t.debt_payment_id || t.bill_id) throw new LedgerError("Transaksi cicilan/tagihan tidak bisa ditautkan ke aturan berulang.");
      const taken = db.prepare("SELECT 1 FROM recurring_occurrences WHERE transaction_id = ? AND status = 'confirmed'").get(t.id);
      if (taken) throw new LedgerError("Transaksi itu sudah ditautkan ke jadwal lain.");
      txId = t.id;
    } else {
      if (input.due_date > today && !input.paid_on) throw new LedgerError("Jadwal ini belum jatuh tempo. Konfirmasi setelah tanggalnya tiba.");
      const accountId = input.account_id ?? rule.account_id;
      if (!accountId) throw new LedgerError("Pilih akun untuk transaksi ini.", "account_id");
      const paidOn = input.paid_on ?? (input.due_date < today ? input.due_date : today);
      txId = createTransaction(db, {
        type: rule.type, account_id: accountId, category_id: rule.category_id, amount: input.amount ?? rule.amount, occurred_on: paidOn, description: rule.name,
        source: "recurring", source_ref: `rule:${rule.id}:${input.due_date}`,
      }, { today });
      posted = true;
    }
    db.prepare("INSERT INTO recurring_occurrences (rule_id, due_date, status, transaction_id) VALUES (?,?, 'confirmed', ?)").run(rule.id, input.due_date, txId);
    db.prepare("UPDATE recurring_rules SET last_generated_on = ? WHERE id = ? AND (last_generated_on IS NULL OR last_generated_on < ?)").run(input.due_date, rule.id, input.due_date);
    writeAudit(db, "recurring_occurrence", rule.id, posted ? "confirm" : "link", null, { rule_id: rule.id, due_date: input.due_date, transaction_id: txId });
    return { transactionId: txId, posted };
  })();
}

export function skipOccurrence(db: Database.Database, ruleId: number, due: string) {
  requireOccurrence(db, ruleId, due);
  db.transaction(() => {
    const exists = db.prepare("SELECT status FROM recurring_occurrences WHERE rule_id = ? AND due_date = ?").get(ruleId, due) as { status: string } | undefined;
    if (exists) throw new LedgerError("Jadwal ini sudah diputuskan.");
    db.prepare("INSERT INTO recurring_occurrences (rule_id, due_date, status) VALUES (?,?, 'skipped')").run(ruleId, due);
    writeAudit(db, "recurring_occurrence", ruleId, "skip", null, { due_date: due });
  })();
}

export function reopenSkipped(db: Database.Database, ruleId: number, due: string) {
  db.transaction(() => {
    db.prepare("DELETE FROM recurring_occurrences WHERE rule_id = ? AND due_date = ? AND status = 'skipped'").run(ruleId, due);
    writeAudit(db, "recurring_occurrence", ruleId, "reopen", null, { due_date: due });
  })();
}

/* ---------------- pattern detection ---------------- */

export interface PatternSuggestion {
  key: string; name: string; type: "income" | "expense"; amount: number; account_id: number; category_id: number | null; frequency: "weekly" | "monthly";
  day_of_month: number | null; start_date: string; occurrences: number; last_date: string; dates: string[];
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
export const patternKey = (type: string, accountId: number, text: string) => {
  const words = normalizeText(text).split(" ").filter((w) => w.length >= 2 && !/^\d+$/.test(w)).slice(0, 3);
  return words.length ? `${type}|${accountId}|${words.join(" ")}` : "";
};

function dismissed(db: Database.Database): string[] {
  try { return JSON.parse(getSetting(db, "dismissed_patterns") ?? "[]") as string[]; } catch { return []; }
}
export function dismissPattern(db: Database.Database, key: string) {
  const list = dismissed(db);
  if (!list.includes(key)) setSetting(db, "dismissed_patterns", JSON.stringify([...list, key].slice(-200)));
}

/**
 * Looks for entries that repeat at a steady rhythm (about monthly or weekly), with a steady amount, at least three times in
 * the last ~6 months. Suggestions only: nothing is created until the user confirms. Entries already covered by an active
 * rule or a bill, debt/bill payments, transfers and adjustments are ignored.
 */
export function detectPatterns(db: Database.Database, today: string = todayWIB()): PatternSuggestion[] {
  const from = shiftDate(today, -190);
  const rows = db.prepare(
    `SELECT account_id, type, amount, occurred_on, description, merchant, category_id FROM transactions
     WHERE status = 'posted' AND type IN ('income','expense') AND debt_payment_id IS NULL AND bill_id IS NULL AND source NOT IN ('transfer_fee','recurring') AND occurred_on >= ? AND occurred_on <= ?
     ORDER BY occurred_on`,
  ).all(from, today) as { account_id: number; type: "income" | "expense"; amount: number; occurred_on: string; description: string; merchant: string | null; category_id: number | null }[];
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = patternKey(r.type, r.account_id, r.merchant || r.description);
    if (key) groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const covered = [...listRules(db).filter((r) => r.is_active).map((r) => normalizeText(r.name)), ...(db.prepare("SELECT name FROM bills WHERE is_active = 1").all() as { name: string }[]).map((b) => normalizeText(b.name))].filter((n) => n.length >= 4);
  const skip = new Set(dismissed(db));
  const out: PatternSuggestion[] = [];
  for (const [key, g] of groups) {
    if (skip.has(key)) continue;
    const label = key.split("|")[2];
    if (covered.some((c) => c.includes(label) || label.includes(c))) continue;
    const dates = [...new Set(g.map((x) => x.occurred_on))];
    if (dates.length < 3) continue;
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    const mid = median(gaps);
    const frequency: "weekly" | "monthly" | null = mid >= 27 && mid <= 34 && gaps.filter((x) => x >= 25 && x <= 37).length >= gaps.length * 0.8 ? "monthly"
      : mid >= 6 && mid <= 8 && gaps.filter((x) => x >= 5 && x <= 9).length >= gaps.length * 0.8 ? "weekly" : null;
    if (!frequency) continue;
    const amount = median(g.map((x) => x.amount));
    if (g.some((x) => Math.abs(x.amount - amount) > amount * 0.15)) continue;
    const last = dates[dates.length - 1];
    if (daysBetween(last, today) > mid * 2 + 10) continue; // stopped
    const cats = new Map<number, number>();
    for (const x of g) if (x.category_id) cats.set(x.category_id, (cats.get(x.category_id) ?? 0) + 1);
    const category_id = [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
    const sample = g[g.length - 1];
    const name = (sample.merchant || sample.description).trim().slice(0, 60) || label;
    out.push({
      key, name: name.charAt(0).toUpperCase() + name.slice(1), type: sample.type, amount, account_id: sample.account_id, category_id, frequency,
      day_of_month: frequency === "monthly" ? median(dates.map((d) => Number(d.slice(8)))) : null, start_date: dates[0], occurrences: dates.length, last_date: last, dates,
    });
  }
  return out.sort((a, b) => b.occurrences - a.occurrences || a.name.localeCompare(b.name));
}
