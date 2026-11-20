-- Migration 0002: ledger foundations for Phase 2. Additive only; no existing rows are changed.

-- Reconciliation adjustments need a direction because amount is always positive.
ALTER TABLE transactions ADD COLUMN adj_direction TEXT CHECK (adj_direction IN ('in','out'));

-- Integrity: adjustments must carry a direction; other types must not.
CREATE TRIGGER trg_tx_adjustment_direction_ins BEFORE INSERT ON transactions
WHEN (NEW.type = 'adjustment' AND NEW.adj_direction IS NULL) OR (NEW.type <> 'adjustment' AND NEW.adj_direction IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'adj_direction must be set only for adjustment transactions'); END;

CREATE TRIGGER trg_tx_adjustment_direction_upd BEFORE UPDATE ON transactions
WHEN (NEW.type = 'adjustment' AND NEW.adj_direction IS NULL) OR (NEW.type <> 'adjustment' AND NEW.adj_direction IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'adj_direction must be set only for adjustment transactions'); END;

CREATE INDEX idx_transfers_from ON transfers (from_account_id, occurred_on);
CREATE INDEX idx_transfers_to ON transfers (to_account_id, occurred_on);
CREATE INDEX idx_tx_status_date ON transactions (status, occurred_on);

-- Default categories. INSERT OR IGNORE so a database that already has some of these names is left alone.
INSERT OR IGNORE INTO categories (name, kind, parent_id) VALUES
 ('Makanan & Minuman','expense',NULL), ('Transportasi','expense',NULL), ('Tagihan & Utilitas','expense',NULL),
 ('Belanja','expense',NULL), ('Kesehatan','expense',NULL), ('Hiburan & Langganan','expense',NULL),
 ('Pendidikan','expense',NULL), ('Rumah Tangga','expense',NULL), ('Biaya Admin & Bunga','expense',NULL),
 ('Lainnya','expense',NULL),
 ('Gaji','income',NULL), ('Bonus','income',NULL), ('THR','income',NULL), ('Freelance','income',NULL),
 ('Refund','income',NULL), ('Reimbursement','income',NULL), ('Lainnya','income',NULL);

INSERT OR IGNORE INTO categories (name, kind, parent_id)
SELECT s.name, 'expense', p.id FROM (
 SELECT 'Makan' AS name, 'Makanan & Minuman' AS parent UNION ALL SELECT 'Kopi','Makanan & Minuman'
 UNION ALL SELECT 'Belanja Harian','Makanan & Minuman'
 UNION ALL SELECT 'BBM','Transportasi' UNION ALL SELECT 'Ojek Online','Transportasi' UNION ALL SELECT 'Parkir & Tol','Transportasi'
 UNION ALL SELECT 'Listrik','Tagihan & Utilitas' UNION ALL SELECT 'Air','Tagihan & Utilitas'
 UNION ALL SELECT 'Internet','Tagihan & Utilitas' UNION ALL SELECT 'Pulsa & Data','Tagihan & Utilitas'
 UNION ALL SELECT 'Pakaian','Belanja' UNION ALL SELECT 'Elektronik','Belanja'
 UNION ALL SELECT 'Langganan Digital','Hiburan & Langganan' UNION ALL SELECT 'Bioskop & Rekreasi','Hiburan & Langganan'
) s JOIN categories p ON p.name = s.parent AND p.parent_id IS NULL AND p.kind = 'expense';
