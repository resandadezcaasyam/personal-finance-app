import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import { loadMigrations, migrate } from "@/lib/db/migrate";
import { seedDemo } from "@/lib/db/demo";
import { listAccounts } from "@/lib/ledger/accounts";
import { monthTotals } from "@/lib/ledger/summary";
import { getCommitmentsOverview } from "@/lib/obligations";

const dir = path.join(process.cwd(), "src/lib/db/migrations");

describe("migration 0002", () => {
  it("upgrades a Phase 1 database (through 0002 to 0005) without losing data, and runs the backup hook", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    const all = loadMigrations(dir);
    migrate(db, all.filter((m) => m.version === 1));
    db.prepare("INSERT INTO accounts (name,type,initial_balance) VALUES ('BCA','bank',123)").run();
    db.prepare("INSERT INTO categories (name,kind) VALUES ('Gaji','income')").run(); // collides with a default name
    let backups = 0;
    expect(migrate(db, all, { backup: () => backups++ })).toEqual([2, 3, 4, 5]);
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
    // Invariant: total cash = opening balances + income - every posted expense (transfers net to zero).
    const opening = 5_000_000 + 350_000 + 200_000;
    const sum = (type: string) => (db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE type=? AND status='posted'").get(type) as { s: number }).s;
    expect(accounts.reduce((s, a) => s + a.balance, 0)).toBe(opening + sum("income") - sum("expense"));
    // Obligations were seeded too: a paid-down loan, an upcoming loan, and bills (one overdue).
    expect(db.prepare("SELECT COUNT(*) c FROM debts").get()).toEqual({ c: 2 });
    expect(db.prepare("SELECT COUNT(*) c FROM bills").get()).toEqual({ c: 4 });
    expect(db.prepare("SELECT status FROM inbox_items ORDER BY id").all()).toEqual([{ status: "new" }, { status: "needs_review" }, { status: "potential_duplicate" }]);
    expect(db.prepare("SELECT COUNT(*) c FROM favorite_templates").get()).toEqual({ c: 1 });
    expect(db.prepare("SELECT COUNT(*) c FROM recurring_rules WHERE type='income'").get()).toEqual({ c: 1 });
    expect(getCommitmentsOverview(db, "2026-11-20").overdue.map((i) => i.title)).toEqual(["Iuran sampah (fiktif)"]);
    const t = monthTotals(db, "2026-11");
    expect(t.income + t.expense).toBeGreaterThan(0);
  });
});
