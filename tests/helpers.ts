import Database from "better-sqlite3";
import path from "node:path";
import { loadMigrations, migrate } from "@/lib/db/migrate";
import { createAccount } from "@/lib/ledger/accounts";

export const TODAY = "2026-11-20";

export function memDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db, loadMigrations(path.join(process.cwd(), "src/lib/db/migrations")));
  return db;
}

export function twoAccounts(db: Database.Database, a = 1_000_000, b = 0) {
  const bca = createAccount(db, { name: "BCA", type: "bank", initial_balance: a });
  const gopay = createAccount(db, { name: "GoPay", type: "ewallet", initial_balance: b });
  return { bca, gopay };
}
