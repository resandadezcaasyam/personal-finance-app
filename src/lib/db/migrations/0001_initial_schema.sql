-- Migration 0001: foundational schema for all 8 phases.
-- Money is stored as INTEGER rupiah (IDR has no minor unit in practice).
-- Dates are ISO 'YYYY-MM-DD' (local WIB calendar date); timestamps are ISO-8601 UTC.
-- Later phases add columns/tables via new migrations; nothing here is dropped.

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE accounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('cash','bank','ewallet','other')),
  initial_balance  INTEGER NOT NULL DEFAULT 0,
  is_archived      INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_accounts_name ON accounts (name COLLATE NOCASE) WHERE is_archived = 0;

CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('income','expense')),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_categories_unique ON categories (COALESCE(parent_id,0), kind, name COLLATE NOCASE);

-- Actual ledger entries only. Projections never live here.
-- Transfers are two linked rows in transfers, NOT income/expense rows.
CREATE TABLE transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN ('income','expense','adjustment')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  occurred_on   TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  merchant      TEXT,
  tags          TEXT,
  status        TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','voided')),
  source        TEXT NOT NULL DEFAULT 'manual',
  source_ref    TEXT,
  debt_payment_id INTEGER,
  bill_id       INTEGER,
  import_batch_id INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tx_account_date ON transactions (account_id, occurred_on);
CREATE INDEX idx_tx_date ON transactions (occurred_on);
CREATE UNIQUE INDEX idx_tx_source_ref ON transactions (source, source_ref) WHERE source_ref IS NOT NULL AND status = 'posted';

CREATE TABLE transfers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  from_account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount           INTEGER NOT NULL CHECK (amount > 0),
  fee              INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  occurred_on      TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','voided')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (from_account_id <> to_account_id)
);

CREATE TABLE debts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  provider              TEXT NOT NULL,
  label                 TEXT NOT NULL DEFAULT '',
  original_principal    INTEGER NOT NULL CHECK (original_principal >= 0),
  interest_model        TEXT NOT NULL DEFAULT 'none' CHECK (interest_model IN ('none','flat','reducing','manual')),
  interest_rate_bps     INTEGER,            -- basis points per period; NULL when unknown
  admin_fee             INTEGER NOT NULL DEFAULT 0,
  total_obligation      INTEGER NOT NULL,
  installment_amount    INTEGER,
  installment_count     INTEGER,
  start_date            TEXT NOT NULL,
  maturity_date         TEXT,
  payment_account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','settled','cancelled')),
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE installment_schedules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id        INTEGER NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  sequence_no    INTEGER NOT NULL,
  due_date       TEXT NOT NULL,
  principal_due  INTEGER NOT NULL DEFAULT 0,
  interest_due   INTEGER NOT NULL DEFAULT 0,
  fee_due        INTEGER NOT NULL DEFAULT 0,
  amount_due     INTEGER NOT NULL,
  amount_paid    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','partial','paid','skipped')),
  UNIQUE (debt_id, sequence_no)
);
CREATE INDEX idx_sched_due ON installment_schedules (due_date, status);

CREATE TABLE debt_payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id        INTEGER NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  schedule_id    INTEGER REFERENCES installment_schedules(id) ON DELETE SET NULL,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount         INTEGER NOT NULL CHECK (amount > 0),
  penalty        INTEGER NOT NULL DEFAULT 0,
  fee            INTEGER NOT NULL DEFAULT 0,
  paid_on        TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular','partial','early','settlement')),
  status         TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','voided')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE bills (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  amount        INTEGER,
  is_variable   INTEGER NOT NULL DEFAULT 0 CHECK (is_variable IN (0,1)),
  frequency     TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','quarterly','yearly','once')),
  due_day       INTEGER,
  next_due_date TEXT,
  remind_days   INTEGER NOT NULL DEFAULT 3,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE recurring_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  frequency     TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  day_of_month  INTEGER,
  start_date    TEXT NOT NULL,
  end_date      TEXT,
  last_generated_on TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE budgets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,              -- 'YYYY-MM'
  amount       INTEGER NOT NULL CHECK (amount >= 0),
  UNIQUE (category_id, month)
);

CREATE TABLE goals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('emergency','travel','purchase','custom')),
  target_amount  INTEGER NOT NULL CHECK (target_amount > 0),
  saved_amount   INTEGER NOT NULL DEFAULT 0,
  target_date    TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','archived')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE import_batches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type   TEXT NOT NULL,             -- csv | xlsx | pdf | ocr | quick_capture | clipboard
  file_name     TEXT,
  file_hash     TEXT,
  row_count     INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',
  error_report  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_import_file_hash ON import_batches (file_hash) WHERE file_hash IS NOT NULL;

-- Review queue. Only 'approved' items are posted to the ledger.
CREATE TABLE inbox_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id         INTEGER REFERENCES import_batches(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','needs_review','potential_duplicate','approved','rejected')),
  type             TEXT CHECK (type IN ('income','expense','transfer')),
  amount           INTEGER,
  occurred_on      TEXT,
  description      TEXT,
  merchant         TEXT,
  account_id       INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  source_ref       TEXT,
  fingerprint      TEXT,
  confidence       REAL,
  raw_payload      TEXT,
  posted_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_inbox_status ON inbox_items (status);
CREATE UNIQUE INDEX idx_inbox_fingerprint ON inbox_items (fingerprint) WHERE fingerprint IS NOT NULL;

CREATE TABLE simulation_scenarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('forecast','early_repayment','strategy')),
  parameters  TEXT NOT NULL,               -- JSON
  result      TEXT,                        -- JSON snapshot, never feeds the ledger
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity       TEXT NOT NULL,
  entity_id    INTEGER,
  action       TEXT NOT NULL,
  before_json  TEXT,
  after_json   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_entity ON audit_logs (entity, entity_id);
