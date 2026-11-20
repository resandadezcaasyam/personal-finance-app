-- Migration 0004: smart capture. Additive only.

-- Merchant/keyword rules. 'default' rules ship with the app and can be disabled; 'user' rules are learned from
-- the user's corrections and always win over defaults. A rule never overrides a category the user chose explicitly.
CREATE TABLE merchant_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern       TEXT NOT NULL,                 -- normalized: lowercase words separated by single spaces
  merchant_name TEXT,
  kind          TEXT CHECK (kind IN ('income','expense')),
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  source        TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('default','user')),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_merchant_rules_unique ON merchant_rules (pattern, COALESCE(kind,''), source);

CREATE TABLE favorite_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('income','expense')),
  amount      INTEGER CHECK (amount IS NULL OR amount > 0),
  account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  merchant    TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_templates_name ON favorite_templates (name COLLATE NOCASE);

-- Saved column mappings for statement imports, matched by the header signature of a file.
CREATE TABLE import_templates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  header_signature TEXT NOT NULL,
  mapping_json     TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_import_templates_name ON import_templates (name COLLATE NOCASE);

ALTER TABLE inbox_items ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'import';   -- quick_capture | ocr | csv | xlsx | pdf
ALTER TABLE inbox_items ADD COLUMN note TEXT;
ALTER TABLE inbox_items ADD COLUMN match_json TEXT;            -- suggested reconciliation (installment / bill / transfer)
ALTER TABLE inbox_items ADD COLUMN match_dismissed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inbox_items ADD COLUMN category_source TEXT;       -- 'rule' | 'user' | 'parser'
ALTER TABLE inbox_items ADD COLUMN posted_ref TEXT;            -- tx:<id> | transfer:<id> | debt_payment:<id> | bill_payment:<id>
ALTER TABLE inbox_items ADD COLUMN duplicate_of TEXT;          -- ledger rows this looks like
CREATE INDEX idx_inbox_batch ON inbox_items (batch_id);

ALTER TABLE import_batches ADD COLUMN account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE import_batches ADD COLUMN imported_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN duplicate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN error_count INTEGER NOT NULL DEFAULT 0;

-- Default rules. INSERT OR IGNORE keeps re-runs and pre-existing rows safe.
INSERT OR IGNORE INTO merchant_rules (pattern, merchant_name, kind, category_id, source)
SELECT r.pattern, r.merchant, r.kind,
       (SELECT id FROM categories c WHERE c.name = r.category AND c.kind = r.kind ORDER BY c.parent_id IS NULL LIMIT 1), 'default'
FROM (
  SELECT NULL AS pattern, NULL AS merchant, NULL AS kind, NULL AS category WHERE 0
  UNION ALL VALUES
  ('fore coffee', 'Fore Coffee', 'expense', 'Kopi'),
  ('kopi kenangan', 'Kopi Kenangan', 'expense', 'Kopi'),
  ('starbucks', 'Starbucks', 'expense', 'Kopi'),
  ('janji jiwa', 'Janji Jiwa', 'expense', 'Kopi'),
  ('tomoro', 'Tomoro Coffee', 'expense', 'Kopi'),
  ('kopi', NULL, 'expense', 'Kopi'),
  ('ngopi', NULL, 'expense', 'Kopi'),
  ('makan siang', NULL, 'expense', 'Makan'),
  ('makan malam', NULL, 'expense', 'Makan'),
  ('makan', NULL, 'expense', 'Makan'),
  ('sarapan', NULL, 'expense', 'Makan'),
  ('bakso', NULL, 'expense', 'Makan'),
  ('nasi', NULL, 'expense', 'Makan'),
  ('warteg', NULL, 'expense', 'Makan'),
  ('gofood', 'GoFood', 'expense', 'Makan'),
  ('grabfood', 'GrabFood', 'expense', 'Makan'),
  ('shopeefood', 'ShopeeFood', 'expense', 'Makan'),
  ('mcdonald', 'McDonald''s', 'expense', 'Makan'),
  ('kfc', 'KFC', 'expense', 'Makan'),
  ('indomaret', 'Indomaret', 'expense', 'Belanja Harian'),
  ('alfamart', 'Alfamart', 'expense', 'Belanja Harian'),
  ('alfamidi', 'Alfamidi', 'expense', 'Belanja Harian'),
  ('supermarket', NULL, 'expense', 'Belanja Harian'),
  ('belanja bulanan', NULL, 'expense', 'Belanja Harian'),
  ('sayur', NULL, 'expense', 'Belanja Harian'),
  ('pln', 'PLN', 'expense', 'Listrik'),
  ('token listrik', 'PLN', 'expense', 'Listrik'),
  ('listrik', NULL, 'expense', 'Listrik'),
  ('pdam', 'PDAM', 'expense', 'Air'),
  ('indihome', 'IndiHome', 'expense', 'Internet'),
  ('biznet', 'Biznet', 'expense', 'Internet'),
  ('first media', 'First Media', 'expense', 'Internet'),
  ('wifi', NULL, 'expense', 'Internet'),
  ('internet', NULL, 'expense', 'Internet'),
  ('telkomsel', 'Telkomsel', 'expense', 'Pulsa & Data'),
  ('indosat', 'Indosat', 'expense', 'Pulsa & Data'),
  ('axis', 'Axis', 'expense', 'Pulsa & Data'),
  ('smartfren', 'Smartfren', 'expense', 'Pulsa & Data'),
  ('paket data', NULL, 'expense', 'Pulsa & Data'),
  ('pulsa', NULL, 'expense', 'Pulsa & Data'),
  ('netflix', 'Netflix', 'expense', 'Langganan Digital'),
  ('spotify', 'Spotify', 'expense', 'Langganan Digital'),
  ('youtube premium', 'YouTube Premium', 'expense', 'Langganan Digital'),
  ('disney', 'Disney+', 'expense', 'Langganan Digital'),
  ('vidio', 'Vidio', 'expense', 'Langganan Digital'),
  ('langganan', NULL, 'expense', 'Langganan Digital'),
  ('gojek', 'Gojek', 'expense', 'Ojek Online'),
  ('gocar', 'GoCar', 'expense', 'Ojek Online'),
  ('goride', 'GoRide', 'expense', 'Ojek Online'),
  ('grab', 'Grab', 'expense', 'Ojek Online'),
  ('maxim', 'Maxim', 'expense', 'Ojek Online'),
  ('ojek', NULL, 'expense', 'Ojek Online'),
  ('bluebird', 'Bluebird', 'expense', 'Ojek Online'),
  ('pertamina', 'Pertamina', 'expense', 'BBM'),
  ('pertamax', NULL, 'expense', 'BBM'),
  ('pertalite', NULL, 'expense', 'BBM'),
  ('bensin', NULL, 'expense', 'BBM'),
  ('shell', 'Shell', 'expense', 'BBM'),
  ('parkir', NULL, 'expense', 'Parkir & Tol'),
  ('e toll', NULL, 'expense', 'Parkir & Tol'),
  ('tol', NULL, 'expense', 'Parkir & Tol'),
  ('tokopedia', 'Tokopedia', 'expense', 'Belanja'),
  ('shopee', 'Shopee', 'expense', 'Belanja'),
  ('lazada', 'Lazada', 'expense', 'Belanja'),
  ('blibli', 'Blibli', 'expense', 'Belanja'),
  ('uniqlo', 'Uniqlo', 'expense', 'Pakaian'),
  ('apotek', NULL, 'expense', 'Kesehatan'),
  ('klinik', NULL, 'expense', 'Kesehatan'),
  ('dokter', NULL, 'expense', 'Kesehatan'),
  ('rumah sakit', NULL, 'expense', 'Kesehatan'),
  ('bpjs', 'BPJS', 'expense', 'Kesehatan'),
  ('spp', NULL, 'expense', 'Pendidikan'),
  ('kursus', NULL, 'expense', 'Pendidikan'),
  ('bioskop', NULL, 'expense', 'Bioskop & Rekreasi'),
  ('cgv', 'CGV', 'expense', 'Bioskop & Rekreasi'),
  ('xxi', 'XXI', 'expense', 'Bioskop & Rekreasi'),
  ('biaya admin', NULL, 'expense', 'Biaya Admin & Bunga'),
  ('admin bank', NULL, 'expense', 'Biaya Admin & Bunga'),
  ('pajak bunga', NULL, 'expense', 'Biaya Admin & Bunga'),
  ('angsuran', NULL, 'expense', 'Cicilan & Utang'),
  ('cicilan', NULL, 'expense', 'Cicilan & Utang'),
  ('gaji', NULL, 'income', 'Gaji'),
  ('gajian', NULL, 'income', 'Gaji'),
  ('salary', NULL, 'income', 'Gaji'),
  ('bonus', NULL, 'income', 'Bonus'),
  ('thr', NULL, 'income', 'THR'),
  ('freelance', NULL, 'income', 'Freelance'),
  ('honor', NULL, 'income', 'Freelance'),
  ('refund', NULL, 'income', 'Refund'),
  ('cashback', NULL, 'income', 'Refund'),
  ('reimburse', NULL, 'income', 'Reimbursement'),
  ('reimbursement', NULL, 'income', 'Reimbursement')
) AS r;
