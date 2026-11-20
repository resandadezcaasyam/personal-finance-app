import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { loadMigrations, migrate } from "@/lib/db/migrate";
import { runIntegrityChecks, quickHealth } from "@/lib/db/integrity";
import { createBackup, listBackups, validateBackupFile, restoreBackup, safeBackupPath, deleteBackup, exportAllData, lastBackupAt } from "@/lib/backup/backup";
import { createTransaction } from "@/lib/ledger/transactions";
import { createTransfer } from "@/lib/ledger/transfers";
import { createDebt, recordDebtPayment, voidDebtPayment } from "@/lib/debts/debts";
import { createBill, payBill } from "@/lib/bills/bills";
import { createGoal, addContribution } from "@/lib/goals/goals";
import { createRule, confirmOccurrence } from "@/lib/automation/recurring";
import { getBalance } from "@/lib/ledger/accounts";
import { LedgerError } from "@/lib/ledger/errors";

const T = { today: TODAY };
const known = loadMigrations(path.join(process.cwd(), "src/lib/db/migrations"));
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "pfos-bk-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** A database that has been through every workflow, so the invariants are exercised on realistic data. */
function busy() {
  const db = memDb();
  const { bca, gopay } = twoAccounts(db, 5_000_000, 500_000);
  createTransaction(db, { type: "income", account_id: bca, category_id: null, amount: 9_000_000, occurred_on: "2026-11-01", description: "gaji" }, T);
  createTransaction(db, { type: "expense", account_id: bca, category_id: null, amount: 80_000, occurred_on: "2026-11-02", description: "kopi" }, T);
  createTransfer(db, { from_account_id: bca, to_account_id: gopay, amount: 700_000, fee: 2_500, occurred_on: "2026-11-09" }, T);
  const debt = createDebt(db, { provider: "SeaBank", model: "flat", principal: 1_200_000, rate_bps: 200, count: 6, start_date: "2026-09-01", first_due_date: "2026-10-05", payment_account_id: bca, opening_paid: 1 } as never);
  const p1 = recordDebtPayment(db, { debt_id: debt, account_id: bca, amount: 224_000, penalty: 5_000, paid_on: "2026-11-05" }, T);
  recordDebtPayment(db, { debt_id: debt, account_id: bca, amount: 300_000, paid_on: "2026-11-10" }, T);
  void p1;
  const bill = createBill(db, { name: "Internet", kind: "bill", category_id: null, account_id: bca, amount: 350_000, frequency: "monthly", next_due_date: "2026-11-15", remind_days: 3 });
  payBill(db, { bill_id: bill, account_id: bca, amount: 350_000, paid_on: "2026-11-15" }, T);
  const g = createGoal(db, { name: "Darurat", kind: "emergency", target_amount: 5_000_000, target_date: null }, T);
  addContribution(db, g, { amount: 1_000_000, contributed_on: TODAY }, T);
  const rule = createRule(db, { name: "Gaji", type: "income", amount: 9_000_000, account_id: bca, category_id: null, frequency: "monthly", day_of_month: 18, start_date: "2026-01-18" });
  db.prepare("UPDATE recurring_rules SET created_at='2026-10-01T00:00:00.000Z'").run();
  confirmOccurrence(db, { rule_id: rule, due_date: "2026-11-18" }, T);
  return { db, bca, gopay, debt, p1 };
}

describe("integrity checks", () => {
  it("pass on a database that has been through every workflow", () => {
    const { db } = busy();
    const r = runIntegrityChecks(db);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["sqlite", "fk", "inst-alloc", "pay-ledger", "bill-ledger", "goals"]));
    expect(quickHealth(db)).toBeNull();
  });
  it("still pass after a debt payment is voided", () => {
    const { db, p1 } = busy();
    voidDebtPayment(db, p1.paymentId);
    expect(runIntegrityChecks(db).ok).toBe(true);
  });
  const corrupt = (name: string, sql: string, id: string) => it(`detect: ${name}`, () => {
    const { db } = busy();
    db.pragma("foreign_keys = OFF");
    db.exec(sql);
    const r = runIntegrityChecks(db);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === id)?.ok).toBe(false);
  });
  corrupt("an installment paid more than due", "UPDATE installment_schedules SET amount_paid = amount_due + 1 WHERE id = (SELECT MAX(id) FROM installment_schedules)", "inst-range");
  corrupt("an installment whose paid amount does not match its payments", "UPDATE installment_schedules SET amount_paid = amount_paid + 1000 WHERE amount_paid > 0 AND sequence_no = 2", "inst-alloc");
  corrupt("a debt payment without its ledger expense", "UPDATE transactions SET status = 'voided' WHERE debt_payment_id IS NOT NULL", "pay-ledger");
  corrupt("a debt payment whose allocations vanished", "DELETE FROM debt_payment_allocations", "pay-alloc");
  corrupt("a bill payment without a live expense", "UPDATE transactions SET status='voided' WHERE bill_id IS NOT NULL", "bill-ledger");
  corrupt("a goal whose saved amount drifted", "UPDATE goals SET saved_amount = saved_amount + 5", "goals");
  corrupt("a row pointing at a missing account", "UPDATE transactions SET account_id = 999 WHERE id = 1", "fk");
  corrupt("a confirmed occurrence whose transaction was deleted", "DELETE FROM transactions WHERE source = 'recurring'", "occurrences");
  it("are read-only", () => {
    const { db } = busy();
    const c = () => (db.prepare("SELECT (SELECT COUNT(*) FROM transactions)||'|'||(SELECT COUNT(*) FROM audit_logs)||'|'||(SELECT SUM(amount_paid) FROM installment_schedules) AS c").get() as { c: string }).c;
    const before = c();
    runIntegrityChecks(db); quickHealth(db);
    expect(c()).toBe(before);
  });
});

describe("backups", () => {
  it("creates a consistent backup that contains the data, even from a database in WAL mode", () => {
    const file = path.join(dir, "live.db");
    const db = new Database(file); db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON");
    migrate(db, known);
    db.prepare("INSERT INTO accounts (name,type,initial_balance) VALUES ('BCA','bank',123456)").run();
    const b = createBackup(db, path.join(dir, "backups"));
    expect(b.kind).toBe("manual");
    expect(b.name).toMatch(/^finance-\d{4}-\d{2}-\d{2}_.*-manual\.db$/);
    const copy = new Database(path.join(dir, "backups", b.name), { readonly: true });
    expect(copy.prepare("SELECT initial_balance FROM accounts").get()).toEqual({ initial_balance: 123456 });
    expect(copy.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    copy.close(); db.close();
  });
  it("lists backups newest first with their kind, ignoring other files", () => {
    const { db } = busy();
    const bdir = path.join(dir, "backups");
    createBackup(db, bdir, "manual", new Date("2026-11-01T01:00:00Z"));
    createBackup(db, bdir, "pre-restore", new Date("2026-11-02T01:00:00Z"));
    fs.writeFileSync(path.join(bdir, "finance.db.pre-migration-2026-10-01.bak"), "x");
    fs.writeFileSync(path.join(bdir, "notes.txt"), "ignore me");
    const list = listBackups(bdir);
    expect(list.map((b) => b.kind).sort()).toEqual(["manual", "pre-migration", "pre-restore"]);
    expect(list.some((b) => b.name === "notes.txt")).toBe(false);
    expect(listBackups(path.join(dir, "missing"))).toEqual([]);
    expect(lastBackupAt(bdir)).not.toBeNull();
  });
  it("validates a good backup, and reports what is wrong with bad ones", () => {
    const { db } = busy();
    const bdir = path.join(dir, "backups");
    const good = createBackup(db, bdir);
    expect(validateBackupFile(path.join(bdir, good.name), known)).toMatchObject({ ok: true, schemaVersion: 7, accounts: 2, newerThanApp: false });
    fs.writeFileSync(path.join(dir, "garbage.db"), "this is not sqlite");
    expect(validateBackupFile(path.join(dir, "garbage.db"), known)).toMatchObject({ ok: false, problems: [expect.stringMatching(/rusak|SQLite/)] });
    expect(validateBackupFile(path.join(dir, "absent.db"), known).ok).toBe(false);
    const other = new Database(path.join(dir, "other.db")); other.exec("CREATE TABLE foo (x)"); other.close();
    expect(validateBackupFile(path.join(dir, "other.db"), known)).toMatchObject({ ok: false, problems: [expect.stringContaining("bukan basis data Personal Finance OS")] });
    // newer than this app
    const newer = new Database(path.join(dir, "newer.db")); migrate(newer, known); newer.prepare("INSERT INTO schema_migrations (version,name,checksum) VALUES (99,'0099_future','x')").run(); newer.close();
    expect(validateBackupFile(path.join(dir, "newer.db"), known)).toMatchObject({ ok: false, newerThanApp: true });
    // a migration whose content differs
    const edited = new Database(path.join(dir, "edited.db")); migrate(edited, known); edited.prepare("UPDATE schema_migrations SET checksum='deadbeef' WHERE version=3").run(); edited.close();
    expect(validateBackupFile(path.join(dir, "edited.db"), known).problems.join()).toMatch(/Migrasi 3/);
  });
  it("accepts only plain file names inside the backup folder (no path traversal)", () => {
    const bdir = path.join(dir, "backups"); fs.mkdirSync(bdir);
    fs.writeFileSync(path.join(bdir, "ok.db"), "x"); fs.writeFileSync(path.join(dir, "secret.db"), "x");
    expect(safeBackupPath(bdir, "ok.db")).toBe(path.join(bdir, "ok.db"));
    for (const bad of ["../secret.db", "..\\secret.db", "/etc/passwd", "sub/ok.db", "ok.db/", "ok", "ok.txt", "", ".db", "a..db", "x".repeat(300) + ".db", "ok.db\0", "C:\\x.db"]) expect(() => safeBackupPath(bdir, bad)).toThrow(LedgerError);
    expect(() => safeBackupPath(bdir, "missing.db")).toThrow(/tidak ditemukan/);
    deleteBackup(bdir, "ok.db");
    expect(fs.existsSync(path.join(bdir, "ok.db"))).toBe(false);
    expect(() => deleteBackup(bdir, "../secret.db")).toThrow();
    expect(fs.existsSync(path.join(dir, "secret.db"))).toBe(true);
  });
});

describe("restore", () => {
  /** A real on-disk database, so closing, swapping and reopening are exercised for real. */
  function disk() {
    const file = path.join(dir, "finance.db");
    let db = new Database(file); db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); migrate(db, known);
    db.prepare("INSERT INTO accounts (name,type,initial_balance) VALUES ('BCA','bank',1000000)").run();
    const hooks = { close: () => { try { db.close(); } catch { /* already closed */ } }, reopen: () => { db = new Database(file); db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON"); migrate(db, known); } };
    return { file, get db() { return db; }, hooks, bdir: path.join(dir, "backups") };
  }
  it("brings back the backed-up data, keeps what was there as a pre-restore backup, and the app keeps working", () => {
    const d = disk();
    const b = createBackup(d.db, d.bdir);
    d.db.prepare("INSERT INTO accounts (name,type,initial_balance) VALUES ('Dompet','cash',50)").run();
    d.db.prepare("UPDATE accounts SET initial_balance = 7 WHERE name = 'BCA'").run();
    const r = restoreBackup({ db: d.db, liveFile: d.file, dir: d.bdir, name: b.name, known, hooks: d.hooks });
    expect(r.restored).toBe(b.name);
    expect(d.db.prepare("SELECT name, initial_balance FROM accounts ORDER BY id").all()).toEqual([{ name: "BCA", initial_balance: 1_000_000 }]);
    // the state before the restore was kept
    const pre = new Database(path.join(d.bdir, r.preRestore.name), { readonly: true });
    expect(pre.prepare("SELECT COUNT(*) c FROM accounts").get()).toEqual({ c: 2 });
    pre.close();
    d.db.prepare("INSERT INTO accounts (name,type,initial_balance) VALUES ('Baru','cash',1)").run(); // handle is live and writable
    expect(listBackups(d.bdir).filter((x) => x.kind === "pre-restore")).toHaveLength(1);
    d.db.close();
  });
  it("refuses an invalid, newer, or traversal backup BEFORE touching anything", () => {
    const d = disk();
    fs.mkdirSync(d.bdir, { recursive: true });
    fs.writeFileSync(path.join(d.bdir, "broken.db"), "not a database");
    let closed = 0;
    const hooks = { close: () => { closed++; d.hooks.close(); }, reopen: d.hooks.reopen };
    expect(() => restoreBackup({ db: d.db, liveFile: d.file, dir: d.bdir, name: "broken.db", known, hooks })).toThrow(/tidak bisa dipulihkan/);
    expect(() => restoreBackup({ db: d.db, liveFile: d.file, dir: d.bdir, name: "../finance.db", known, hooks })).toThrow(/tidak valid/);
    expect(closed).toBe(0);
    expect(d.db.prepare("SELECT COUNT(*) c FROM accounts").get()).toEqual({ c: 1 });
    expect(listBackups(d.bdir).filter((x) => x.kind === "pre-restore")).toHaveLength(0);
    d.db.close();
  });
  it("rolls back to the previous data if the restored database cannot be reopened", () => {
    const d = disk();
    const b = createBackup(d.db, d.bdir);
    d.db.prepare("INSERT INTO accounts (name,type,initial_balance) VALUES ('Dompet','cash',50)").run();
    let calls = 0;
    const hooks = { close: d.hooks.close, reopen: () => { calls++; if (calls === 1) throw new Error("gagal membuka"); d.hooks.reopen(); } };
    expect(() => restoreBackup({ db: d.db, liveFile: d.file, dir: d.bdir, name: b.name, known, hooks })).toThrow(/dikembalikan/);
    expect(d.db.prepare("SELECT COUNT(*) c FROM accounts").get()).toEqual({ c: 2 }); // the data from before the attempt is back
    d.db.close();
  });
  it("upgrades an older backup to the current schema when restored (with the usual migration safety)", () => {
    const d = disk();
    const old = new Database(path.join(dir, "old.db")); migrate(old, known.filter((m) => m.version <= 3)); old.prepare("INSERT INTO accounts (name,type,initial_balance) VALUES ('Lama','bank',42)").run(); old.close();
    fs.mkdirSync(d.bdir, { recursive: true }); fs.copyFileSync(path.join(dir, "old.db"), path.join(d.bdir, "finance-old-manual.db"));
    restoreBackup({ db: d.db, liveFile: d.file, dir: d.bdir, name: "finance-old-manual.db", known, hooks: d.hooks });
    expect(d.db.prepare("SELECT name FROM accounts").all()).toEqual([{ name: "Lama" }]);
    expect(d.db.prepare("SELECT MAX(version) v FROM schema_migrations").get()).toEqual({ v: 7 });
    d.db.close();
  });
});

describe("export of all data", () => {
  it("contains every table with the same row counts as the database", () => {
    const { db, bca } = busy();
    const x = exportAllData(db, { appVersion: "1.0.0", exportedOn: TODAY });
    for (const t of ["accounts", "transactions", "transfers", "debts", "installment_schedules", "debt_payments", "bills", "goals", "goal_contributions", "recurring_rules", "categories", "audit_logs"]) {
      const n = (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
      expect(x.tables[t]).toHaveLength(n);
      expect(x.meta.tableCounts[t]).toBe(n);
    }
    expect(x.meta).toMatchObject({ app: "Personal Finance OS", appVersion: "1.0.0", schemaVersion: 7, currency: "IDR" });
    const income = (x.tables.transactions as { type: string; amount: number; status: string }[]).filter((t) => t.type === "income" && t.status === "posted").reduce((a, t) => a + t.amount, 0);
    expect(income).toBe((db.prepare("SELECT SUM(amount) s FROM transactions WHERE type='income' AND status='posted'").get() as { s: number }).s);
    void bca;
    expect(() => JSON.stringify(x)).not.toThrow();
  });
});
