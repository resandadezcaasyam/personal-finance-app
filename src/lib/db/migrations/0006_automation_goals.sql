-- Migration 0006: recurring-entry decisions and savings-goal contributions. Additive only.

-- A planned occurrence of a recurring rule is DERIVED from the rule (never stored as a transaction). Only the user's
-- decision is stored: confirmed (posted or linked to an existing transaction) or skipped. The unique key makes
-- confirming the same occurrence twice impossible.
CREATE TABLE recurring_occurrences (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id        INTEGER NOT NULL REFERENCES recurring_rules(id) ON DELETE CASCADE,
  due_date       TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('confirmed','skipped')),
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (rule_id, due_date)
);
CREATE INDEX idx_occ_tx ON recurring_occurrences (transaction_id);

-- Savings goals are earmarks: a contribution records money set aside for a goal. It does not move money between accounts.
CREATE TABLE goal_contributions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id        INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  amount         INTEGER NOT NULL CHECK (amount <> 0),      -- negative = withdrawn from the goal
  contributed_on TEXT NOT NULL,
  note           TEXT,
  account_id     INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_goal_contrib ON goal_contributions (goal_id, contributed_on);

-- Goals created before contributions were tracked keep their saved amount as an opening contribution, so recomputing
-- saved_amount from the contribution rows never loses it.
INSERT INTO goal_contributions (goal_id, amount, contributed_on, note)
SELECT id, saved_amount, substr(created_at, 1, 10), 'Saldo awal (sebelum pencatatan dana)' FROM goals WHERE saved_amount > 0;
