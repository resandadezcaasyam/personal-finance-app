import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import { loadMigrations, migrate } from "@/lib/db/migrate";

const dir = path.join(process.cwd(), "src/lib/db/migrations");
const fresh = () => {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
};

describe("migrations", () => {
  it("applies the initial schema and creates all planned tables", () => {
    const db = fresh();
    expect(migrate(db, loadMigrations(dir))).toEqual([1, 2, 3, 4]);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of [
      "accounts", "categories", "transactions", "transfers", "debts", "installment_schedules", "debt_payments",
      "bills", "recurring_rules", "budgets", "goals", "import_batches", "inbox_items", "simulation_scenarios",
      "settings", "audit_logs", "debt_payment_allocations", "bill_payments", "merchant_rules", "favorite_templates", "import_templates",
    ]) expect(names).toContain(t);
  });

  it("is idempotent and preserves existing data", () => {
    const db = fresh();
    const ms = loadMigrations(dir);
    migrate(db, ms);
    db.prepare("INSERT INTO accounts (name,type,initial_balance) VALUES ('BCA','bank',1000)").run();
    expect(migrate(db, ms)).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) c FROM accounts").get()).toEqual({ c: 1 });
  });

  it("runs a backup hook only when upgrading an existing database", () => {
    const db = fresh();
    let backups = 0;
    const ms = loadMigrations(dir);
    migrate(db, ms, { backup: () => backups++ });
    expect(backups).toBe(0);
    const extra = { version: 5, name: "0005_test", sql: "CREATE TABLE t2 (id INTEGER)", checksum: "x" };
    migrate(db, [...ms, extra], { backup: () => backups++ });
    expect(backups).toBe(1);
  });

  it("refuses to run if an applied migration was edited", () => {
    const db = fresh();
    const ms = loadMigrations(dir);
    migrate(db, ms);
    expect(() => migrate(db, [{ ...ms[0], checksum: "tampered" }])).toThrow(/modified/);
  });

  it("enforces foreign keys and positive amounts", () => {
    const db = fresh();
    migrate(db, loadMigrations(dir));
    expect(() =>
      db.prepare("INSERT INTO transactions (account_id,type,amount,occurred_on) VALUES (999,'expense',100,'2026-01-01')").run(),
    ).toThrow();
    db.prepare("INSERT INTO accounts (name,type) VALUES ('Tunai','cash')").run();
    expect(() =>
      db.prepare("INSERT INTO transactions (account_id,type,amount,occurred_on) VALUES (1,'expense',0,'2026-01-01')").run(),
    ).toThrow();
  });

  it("prevents duplicate postings with the same source reference", () => {
    const db = fresh();
    migrate(db, loadMigrations(dir));
    db.prepare("INSERT INTO accounts (name,type) VALUES ('Bank','bank')").run();
    const ins = db.prepare("INSERT INTO transactions (account_id,type,amount,occurred_on,source,source_ref) VALUES (1,'expense',100,'2026-01-01','csv','REF1')");
    ins.run();
    expect(() => ins.run()).toThrow();
  });
});
