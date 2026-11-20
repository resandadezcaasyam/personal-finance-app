import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import { loadMigrations, migrate } from "@/lib/db/migrate";
import { seedDemo } from "@/lib/db/demo";
import { listAccounts } from "@/lib/ledger/accounts";
import { monthTotals } from "@/lib/ledger/summary";

const dir = path.join(process.cwd(), "src/lib/db/migrations");

describe("migration 0002", () => {
  it("upgrades a Phase 1 database without losing data, and runs the backup hook", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    const all = loadMigrations(dir);
    migrate(db, all.filter((m) => m.version === 1));
    db.prepare("INSERT INTO accounts (name,type,initial_balance) VALUES ('BCA','bank',123)").run();
    db.prepare("INSERT INTO categories (name,kind) VALUES ('Gaji','income')").run(); // collides with a default name
    let backups = 0;
    expect(migrate(db, all, { backup: () => backups++ })).toEqual([2]);
    expect(backups).toBe(1);
    expect(db.prepare("SELECT initial_balance b FROM accounts WHERE name='BCA'").get()).toEqual({ b: 123 });
    expect(db.prepare("SELECT COUNT(*) c FROM categories WHERE name='Gaji' AND kind='income'").get()).toEqual({ c: 1 });
    expect((db.prepare("SELECT COUNT(*) c FROM categories").get() as { c: number }).c).toBeGreaterThan(20);
  });
});

describe("demo seed", () => {
  it("creates fictional data that reconciles", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    migrate(db, loadMigrations(dir));
    seedDemo(db, "2026-11-20");
    const accounts = listAccounts(db);
    expect(accounts.map((a) => a.name)).toEqual(["Demo Bank", "Demo Dompet Digital", "Demo Tunai"]);
    // opening 5.55jt + income 10.25jt - expenses (incl. 2.5rb transfer fee)
    const opening = 5_000_000 + 350_000 + 200_000;
    const incomeTotal = 9_500_000 + 750_000;
    const expenses = 450_000 + 320_000 + 45_000 + 54_000 + 28_000 + 25_000 + 60_000 + 350_000 + 2_500;
    expect(accounts.reduce((s, a) => s + a.balance, 0)).toBe(opening + incomeTotal - expenses);
    const t = monthTotals(db, "2026-11");
    expect(t.income + t.expense).toBeGreaterThan(0);
  });
});
