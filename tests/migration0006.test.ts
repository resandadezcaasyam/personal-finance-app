import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import path from "node:path";
import { loadMigrations, migrate } from "@/lib/db/migrate";
import { listGoals, addContribution, listContributions } from "@/lib/goals/goals";
import { listRules } from "@/lib/automation/recurring";
import { getBudgetView } from "@/lib/budgets/budgets";

const dir = path.join(process.cwd(), "src/lib/db/migrations");

describe("migration 0006 on a Phase 5 database", () => {
  it("keeps existing rules, budgets and goals, and turns a goal's saved amount into an opening contribution", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    const all = loadMigrations(dir);
    migrate(db, all.filter((m) => m.version <= 5));
    db.prepare("INSERT INTO accounts (name,type,initial_balance) VALUES ('BCA','bank',1000)").run();
    db.prepare("INSERT INTO recurring_rules (name,type,amount,account_id,frequency,day_of_month,start_date) VALUES ('Gaji','income',8000000,1,'monthly',25,'2026-01-25')").run();
    db.prepare("INSERT INTO goals (name,kind,target_amount,saved_amount,created_at) VALUES ('Target lama','travel',5000000,750000,'2026-03-01T00:00:00.000Z')").run();
    db.prepare("INSERT INTO goals (name,kind,target_amount,saved_amount) VALUES ('Kosong','custom',1000000,0)").run();
    let backups = 0;
    expect(migrate(db, all, { backup: () => backups++ })).toEqual([6]);
    expect(backups).toBe(1);
    expect(listRules(db)[0]).toMatchObject({ name: "Gaji", amount: 8_000_000 });
    expect(getBudgetView(db, "2026-11").month).toBe("2026-11");
    const g = listGoals(db, "2026-11-20").find((x) => x.name === "Target lama")!;
    expect(g.saved_amount).toBe(750_000);
    expect(listContributions(db, g.id)).toMatchObject([{ amount: 750_000, contributed_on: "2026-03-01", note: expect.stringContaining("Saldo awal") }]);
    // adding to the goal recomputes from the rows: the opening amount survives
    addContribution(db, g.id, { amount: 250_000, contributed_on: "2026-11-20" }, { today: "2026-11-20" });
    expect(listGoals(db, "2026-11-20").find((x) => x.name === "Target lama")!.saved_amount).toBe(1_000_000);
    expect(db.prepare("SELECT COUNT(*) c FROM goal_contributions WHERE goal_id = (SELECT id FROM goals WHERE name='Kosong')").get()).toEqual({ c: 0 });
  });
});
