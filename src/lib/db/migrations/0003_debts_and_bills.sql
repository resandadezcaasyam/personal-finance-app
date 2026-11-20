-- Migration 0003: debt payment allocations and bill payment tracking. Additive only.

-- A payment can cover several installments (early/lump-sum), so allocations are tracked per schedule row.
-- This is what makes voiding a payment exact.
CREATE TABLE debt_payment_allocations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id  INTEGER NOT NULL REFERENCES debt_payments(id) ON DELETE CASCADE,
  schedule_id INTEGER NOT NULL REFERENCES installment_schedules(id) ON DELETE RESTRICT,
  amount      INTEGER NOT NULL CHECK (amount > 0)
);
CREATE INDEX idx_alloc_payment ON debt_payment_allocations (payment_id);
CREATE INDEX idx_alloc_schedule ON debt_payment_allocations (schedule_id);

ALTER TABLE debt_payments ADD COLUMN note TEXT;
-- Installments already paid before the debt was entered here (they do NOT touch any account balance).
ALTER TABLE debts ADD COLUMN opening_paid_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE bills ADD COLUMN kind TEXT NOT NULL DEFAULT 'bill' CHECK (kind IN ('bill','subscription'));
ALTER TABLE bills ADD COLUMN notes TEXT;

CREATE TABLE bill_payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id        INTEGER NOT NULL REFERENCES bills(id) ON DELETE RESTRICT,
  due_date       TEXT NOT NULL,                 -- the occurrence this settles
  amount         INTEGER NOT NULL DEFAULT 0,
  paid_on        TEXT NOT NULL,
  account_id     INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','skipped','voided')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- One settlement (paid or skipped) per bill occurrence: a bill can never be paid twice for the same due date.
CREATE UNIQUE INDEX idx_bill_payments_once ON bill_payments (bill_id, due_date) WHERE status IN ('paid','skipped');
CREATE INDEX idx_bills_due ON bills (is_active, next_due_date);

INSERT OR IGNORE INTO categories (name, kind, parent_id) VALUES ('Cicilan & Utang', 'expense', NULL);
