-- Migration 0007: indexes found missing by the large-ledger query-plan checks (25,000 transactions).
-- Lookups by linked payment/bill (ledger links, integrity checks), by creation time (daily review), by category over time
-- (reports, budgets) and debt payments by debt were full scans. Additive only; no data changes.
CREATE INDEX IF NOT EXISTS idx_tx_debt_payment ON transactions (debt_payment_id) WHERE debt_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_bill ON transactions (bill_id) WHERE bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_tx_category_date ON transactions (category_id, occurred_on);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments (debt_id, paid_on);
