import type Database from "better-sqlite3";
import { listAccounts } from "../ledger/accounts";
import { daysBetween, monthRange, todayWIB } from "../format";
import { getCommitmentsOverview } from "../obligations";
import { horizonDays, loadForecastContext } from "../forecast/data";
import { PRESETS, runForecast } from "../forecast/engine";
import { getBudgetView } from "../budgets/budgets";
import { listPlanned, wibDate } from "../automation/recurring";
import { inboxCounts } from "../inbox/inbox";
import { getSetting, setSetting } from "../settings";
import { lastBackupAt } from "../backup/backup";
import { buildActions, type Action, type ActionFacts } from "./engine";

/** Last day an account was reconciled (from the audit trail), and how many transactions it has had since. */
function accountFacts(db: Database.Database, today: string): ActionFacts["accounts"] {
  return listAccounts(db, { archived: false }).map((a) => {
    const last = db.prepare("SELECT MAX(created_at) AS t FROM audit_logs WHERE entity = 'account' AND entity_id = ? AND action = 'reconcile'").get(a.id) as { t: string | null };
    const lastOn = last.t ? wibDate(last.t) : null;
    const since = (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status = 'posted' AND account_id = ? AND (? IS NULL OR occurred_on > ?)").get(a.id, lastOn, lastOn) as { n: number }).n;
    return { id: a.id, name: a.name, balance: a.balance, lastReconciledOn: lastOn, transactionsSince: since, daysSinceReconcile: lastOn ? daysBetween(lastOn, today) : null };
  });
}

/** `backupDir` is only passed for personal data in the running app; leaving it out skips the backup reminder. */
export function loadActionFacts(db: Database.Database, today: string = todayWIB(), opts: { backupDir?: string | null } = {}): ActionFacts {
  const overview = getCommitmentsOverview(db, today, 7);
  const ctx = loadForecastContext(db, { today });
  const fc = runForecast(ctx.input, PRESETS.baseline, horizonDays(today, 1));
  const month = today.slice(0, 7);
  const bv = getBudgetView(db, month);
  const planned = listPlanned(db, today);
  const counts = inboxCounts(db);
  const first = fc.summary.deficitPeriods[0];
  return {
    today, cash: ctx.input.openingCash,
    overdue: overview.overdue.map((o) => ({ title: o.title, subtitle: o.subtitle, date: o.date, amount: o.amount, href: o.href, variable: o.bill_variable })),
    upcoming: overview.upcoming.map((o) => ({ title: o.title, subtitle: o.subtitle, date: o.date, amount: o.amount, href: o.href, variable: o.bill_variable })),
    deficit: first ? { firstDate: first.from, days: fc.summary.deficitDays, lowest: fc.summary.lowest.balance, lowestDate: fc.summary.lowest.date } : null,
    payday: fc.survival ? { date: fc.survival.payday, survives: fc.survival.survives, lowest: fc.survival.lowest } : null,
    budgetMonth: month, daysLeftInMonth: daysBetween(today, monthRange(month).to) + 1,
    budgets: bv.lines.filter((l) => l.budget !== null && l.budget > 0 && l.status !== "none").map((l) => ({ name: l.name, budget: l.budget as number, actual: l.actual, status: l.status as "ok" | "warning" | "over" })),
    planned: planned.map((p) => ({ rule_id: p.rule_id, name: p.name, type: p.type, amount: p.amount, due_date: p.due_date, state: p.state, days: p.days, matched: !!p.match })),
    accounts: accountFacts(db, today),
    inbox: { newItems: counts.new, needsReview: counts.needs_review, duplicates: counts.potential_duplicate },
    backup: opts.backupDir ? (() => {
      const last = lastBackupAt(opts.backupDir);
      return { daysSince: last ? daysBetween(wibDate(last), today) : null, transactions: (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status = 'posted'").get() as { n: number }).n };
    })() : null,
  };
}

export function loadActions(db: Database.Database, today: string = todayWIB(), opts: { backupDir?: string | null } = {}): Action[] {
  return buildActions(loadActionFacts(db, today, opts));
}

/* ---------------- daily review ---------------- */

export interface DailyReview {
  lastReviewOn: string | null;
  daysSince: number | null;
  newTransactions: { id: number; occurred_on: string; type: string; amount: number; description: string; account_name: string; source: string }[];
  newTransactionCount: number;
  inbox: { newItems: number; needsReview: number; duplicates: number };
  duplicates: { id: number; description: string | null; amount: number | null; occurred_on: string | null }[];
  upcoming: { title: string; subtitle: string; date: string; amount: number; href: string; overdue: boolean }[];
  plannedPending: number;
  discrepancies: { account: string; reason: string }[];
}

export function loadDailyReview(db: Database.Database, today: string = todayWIB()): DailyReview {
  const lastOn = getSetting(db, "last_review_on");
  const lastAt = getSetting(db, "last_review_at");
  const since = lastAt ?? new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000 * 2).toISOString();
  const txs = db.prepare(
    `SELECT t.id, t.occurred_on, t.type, t.amount, t.description, a.name AS account_name, t.source FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.status = 'posted' AND t.created_at > ? ORDER BY t.created_at DESC, t.id DESC LIMIT 15`,
  ).all(since) as DailyReview["newTransactions"];
  const count = (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status = 'posted' AND created_at > ?").get(since) as { n: number }).n;
  const overview = getCommitmentsOverview(db, today, 7);
  const facts = accountFacts(db, today);
  const discrepancies: DailyReview["discrepancies"] = [];
  for (const a of facts) {
    if (a.balance < 0) discrepancies.push({ account: a.name, reason: `saldo negatif ${a.balance.toLocaleString("id-ID")}` });
    else if (a.transactionsSince >= 5 && (a.daysSinceReconcile === null || a.daysSinceReconcile >= 30)) discrepancies.push({ account: a.name, reason: a.daysSinceReconcile === null ? "belum pernah direkonsiliasi" : `belum direkonsiliasi ${a.daysSinceReconcile} hari` });
  }
  return {
    lastReviewOn: lastOn, daysSince: lastOn ? daysBetween(lastOn, today) : null, newTransactions: txs, newTransactionCount: count, inbox: ((c) => ({ newItems: c.new, needsReview: c.needs_review, duplicates: c.potential_duplicate }))(inboxCounts(db)),
    duplicates: db.prepare("SELECT id, description, amount, occurred_on FROM inbox_items WHERE status = 'potential_duplicate' ORDER BY id DESC LIMIT 5").all() as DailyReview["duplicates"],
    upcoming: [...overview.overdue.map((o) => ({ ...o, overdue: true })), ...overview.upcoming.map((o) => ({ ...o, overdue: false }))].map((o) => ({ title: o.title, subtitle: o.subtitle, date: o.date, amount: o.amount, href: o.href, overdue: o.overdue })),
    plannedPending: listPlanned(db, today).filter((p) => p.state !== "upcoming").length, discrepancies,
  };
}

export function markReviewed(db: Database.Database, today: string = todayWIB()) {
  setSetting(db, "last_review_on", today);
  setSetting(db, "last_review_at", new Date().toISOString());
}
