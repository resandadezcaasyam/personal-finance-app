-- Migration 0005: named, saved forecast scenarios. Additive only.
-- simulation_scenarios already exists (0001); scenarios are assumptions + a result snapshot and never touch the ledger.
CREATE UNIQUE INDEX idx_scenarios_name ON simulation_scenarios (kind, name COLLATE NOCASE);
