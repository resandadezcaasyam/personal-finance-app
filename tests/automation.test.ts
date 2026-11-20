import { describe, it, expect } from "vitest";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { createRule, updateRule, setRuleActive, deleteRule, listPlanned, confirmOccurrence, skipOccurrence, reopenSkipped, detectPatterns, dismissPattern, listRules, wibDate, type RuleInput } from "@/lib/automation/recurring";
import { createTransaction, voidTransaction } from "@/lib/ledger/transactions";
import { getBalance } from "@/lib/ledger/accounts";
import { findCategoryId } from "@/lib/ledger/categories";
import { getSetting, setSetting, deleteSetting } from "@/lib/settings";
import { createBill } from "@/lib/bills/bills";
import { LedgerError } from "@/lib/ledger/errors";

const T = { today: TODAY }; // Friday 2026-11-20
function setup() { const db = memDb(); const { bca, gopay } = twoAccounts(db, 5_000_000, 0); return { db, bca, gopay }; }
const salary = (bca: number, db: ReturnType<typeof memDb>, o: Partial<RuleInput> = {}): RuleInput => ({
  name: "Gaji", type: "income", amount: 9_000_000, account_id: bca, category_id: findCategoryId(db, "Gaji", "income"), frequency: "monthly", day_of_month: 20, start_date: "2026-01-20", ...o,
});
/** Rules are created "now"; tests move created_at back to simulate an older rule. */
const age = (db: ReturnType<typeof memDb>, id: number, iso: string) => db.prepare("UPDATE recurring_rules SET created_at = ? WHERE id = ?").run(`${iso}T03:00:00.000Z`, id);
const tx = (db: ReturnType<typeof memDb>, account: number, type: "income" | "expense", amount: number, date: string, description = "x") =>
  createTransaction(db, { type, account_id: account, category_id: null, amount, occurred_on: date, description }, T);

describe("rules", () => {
  it("creates, validates, updates, deactivates and deletes", () => {
    const { db, bca } = setup();
    const id = createRule(db, salary(bca, db));
    expect(listRules(db)[0]).toMatchObject({ id, name: "Gaji", amount: 9_000_000, account_name: "BCA", category_name: "Gaji" });
    expect(() => createRule(db, salary(bca, db, { name: " " }))).toThrow(LedgerError);
    expect(() => createRule(db, salary(bca, db, { amount: 0 }))).toThrow(LedgerError);
    expect(() => createRule(db, salary(bca, db, { day_of_month: 40 }))).toThrow(/1 dan 31/);
    expect(() => createRule(db, salary(bca, db, { start_date: "2026-02-30" }))).toThrow(/mulai/);
    expect(() => createRule(db, salary(bca, db, { end_date: "2025-01-01" }))).toThrow(/berakhir/);
    expect(() => createRule(db, salary(bca, db, { category_id: findCategoryId(db, "Kopi", "expense") }))).toThrow(/Kategori/);
    expect(() => createRule(db, salary(bca, db, { account_id: 999 }))).toThrow(/tidak ditemukan/);
    updateRule(db, id, salary(bca, db, { amount: 9_500_000 }));
    expect(listRules(db)[0].amount).toBe(9_500_000);
    setRuleActive(db, id, false);
    expect(listRules(db)[0].is_active).toBe(0);
    deleteRule(db, id);
    expect(listRules(db)).toEqual([]);
  });
  it("converts stored UTC timestamps to the WIB calendar date", () => {
    expect(wibDate("2026-11-19T18:00:00.000Z")).toBe("2026-11-20");
    expect(wibDate("2026-11-19T16:59:00.000Z")).toBe("2026-11-19");
  });
});

describe("planned occurrences (derived, never stored as money)", () => {
  it("a brand-new rule starts from its creation day: no backlog of past months", () => {
    const { db, bca } = setup();
    createRule(db, salary(bca, db)); // created "now" (real clock), start_date far in the past
    const planned = listPlanned(db, TODAY);
    // the real clock is later than TODAY in the test environment, so nothing before creation is generated
    expect(planned.every((p) => p.due_date >= wibDate(new Date().toISOString()) || p.due_date >= TODAY)).toBe(true);
  });
  it("an older rule yields overdue, due and upcoming items inside the window, nothing older than 62 days", () => {
    const { db, bca } = setup();
    const id = createRule(db, salary(bca, db, { day_of_month: 22 })); age(db, id, "2026-05-01");
    const p = listPlanned(db, TODAY);
    expect(p.map((x) => [x.due_date, x.state])).toEqual([["2026-09-22", "overdue"], ["2026-10-22", "overdue"], ["2026-11-22", "upcoming"]].filter(([d]) => d >= "2026-09-19"));
    expect(p.find((x) => x.due_date === "2026-11-22")).toMatchObject({ state: "upcoming", days: 2 });
    const wk = createRule(db, salary(bca, db, { name: "Mingguan", frequency: "weekly", day_of_month: null, start_date: "2026-11-02", amount: 100_000 })); age(db, wk, "2026-01-01");
    expect(listPlanned(db, TODAY).filter((x) => x.rule_id === wk).map((x) => x.due_date)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
  });
  it("respects end dates, inactive rules and month-end clamping", () => {
    const { db, bca } = setup();
    const a = createRule(db, salary(bca, db, { day_of_month: 31, end_date: "2026-10-31" })); age(db, a, "2026-01-01");
    expect(listPlanned(db, TODAY).map((x) => x.due_date)).toEqual(["2026-09-30", "2026-10-31"]);
    setRuleActive(db, a, false);
    expect(listPlanned(db, TODAY)).toEqual([]);
  });
});

describe("confirming", () => {
  function open() {
    const { db, bca, gopay } = setup();
    const id = createRule(db, salary(bca, db, { day_of_month: 18 })); age(db, id, "2026-10-01");
    return { db, bca, gopay, id };
  }
  it("posts exactly ONE transaction through the normal ledger and is idempotent", () => {
    const { db, bca, id } = open();
    const before = listPlanned(db, TODAY).map((p) => p.due_date);
    expect(before).toEqual(["2026-10-18", "2026-11-18"]);
    const r = confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18" }, T);
    expect(r.posted).toBe(true);
    expect(db.prepare("SELECT type, amount, occurred_on, source, source_ref, description FROM transactions WHERE id = ?").get(r.transactionId)).toEqual({ type: "income", amount: 9_000_000, occurred_on: "2026-11-18", source: "recurring", source_ref: `rule:${id}:2026-11-18`, description: "Gaji" });
    expect(getBalance(db, bca)).toBe(14_000_000);
    expect(() => confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18" }, T)).toThrow(/sudah dikonfirmasi/);
    expect(getBalance(db, bca)).toBe(14_000_000);
    expect(listPlanned(db, TODAY).map((p) => p.due_date)).toEqual(["2026-10-18"]);
  });
  it("can override the amount and date (a different salary this month)", () => {
    const { db, bca, id } = open();
    const r = confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18", amount: 8_750_000, paid_on: "2026-11-19" }, T);
    expect(db.prepare("SELECT amount, occurred_on FROM transactions WHERE id = ?").get(r.transactionId)).toEqual({ amount: 8_750_000, occurred_on: "2026-11-19" });
    void bca;
  });
  it("refuses a future occurrence, a date that is not on the schedule, and posting in the future", () => {
    const { db, id } = open();
    expect(() => confirmOccurrence(db, { rule_id: id, due_date: "2026-12-18" }, T)).toThrow(/belum jatuh tempo/);
    expect(() => confirmOccurrence(db, { rule_id: id, due_date: "2026-11-17" }, T)).toThrow(/bukan jadwal/);
    expect(() => confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18", paid_on: "2026-11-25" }, T)).toThrow(/masa depan/);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 0 });
  });
  it("needs an account when the rule has none", () => {
    const { db, bca } = setup();
    const id = createRule(db, salary(bca, db, { account_id: null, day_of_month: 18 })); age(db, id, "2026-10-01");
    expect(() => confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18" }, T)).toThrow(/Pilih akun/);
    expect(confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18", account_id: bca }, T).posted).toBe(true);
  });
  it("an expense rule posts an expense", () => {
    const { db, bca } = setup();
    const id = createRule(db, { name: "Sewa kos", type: "expense", amount: 1_500_000, account_id: bca, category_id: findCategoryId(db, "Rumah Tangga", "expense"), frequency: "monthly", day_of_month: 15, start_date: "2026-01-15" }); age(db, id, "2026-10-01");
    confirmOccurrence(db, { rule_id: id, due_date: "2026-11-15" }, T);
    expect(getBalance(db, bca)).toBe(3_500_000);
  });
  it("skipping hides the occurrence, cannot be confirmed afterwards, and can be reopened", () => {
    const { db, id } = open();
    skipOccurrence(db, id, "2026-11-18");
    expect(listPlanned(db, TODAY).map((p) => p.due_date)).toEqual(["2026-10-18"]);
    expect(() => confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18" }, T)).toThrow(/dilewati/);
    expect(() => skipOccurrence(db, id, "2026-11-18")).toThrow(/sudah diputuskan/);
    reopenSkipped(db, id, "2026-11-18");
    expect(listPlanned(db, TODAY).map((p) => p.due_date)).toContain("2026-11-18");
  });
  it("voiding the posted transaction reopens the occurrence, and it can be confirmed again once", () => {
    const { db, bca, id } = open();
    const r = confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18" }, T);
    voidTransaction(db, r.transactionId);
    expect(listPlanned(db, TODAY).map((p) => p.due_date)).toContain("2026-11-18");
    confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18" }, T);
    expect(getBalance(db, bca)).toBe(14_000_000);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions WHERE status='posted' AND source='recurring'").get()).toEqual({ c: 1 });
  });
  it("a rule with history cannot be deleted, only deactivated", () => {
    const { db, id } = open();
    confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18" }, T);
    expect(() => deleteRule(db, id)).toThrow(/Nonaktifkan/);
  });
});

describe("existing transactions are matched instead of duplicated", () => {
  it("salary that already arrived (even a bit early) is offered for linking, not posted twice", () => {
    const { db, bca } = setup();
    const id = createRule(db, salary(bca, db, { day_of_month: 22 })); age(db, id, "2026-11-01");
    const early = tx(db, bca, "income", 9_000_000, "2026-11-19", "gaji masuk");
    const p = listPlanned(db, TODAY).find((x) => x.due_date === "2026-11-22")!;
    expect(p.match).toMatchObject({ transaction_id: early, amount: 9_000_000 });
    const r = confirmOccurrence(db, { rule_id: id, due_date: "2026-11-22", link_transaction_id: early }, T);
    expect(r).toEqual({ transactionId: early, posted: false });
    expect(getBalance(db, bca)).toBe(14_000_000); // nothing was added
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 1 });
    expect(listPlanned(db, TODAY).find((x) => x.due_date === "2026-11-22")).toBeUndefined();
  });
  it("one transaction can settle only one occurrence; very different amounts or far dates do not match", () => {
    const { db, bca } = setup();
    const id = createRule(db, salary(bca, db, { frequency: "weekly", day_of_month: null, start_date: "2026-11-02", amount: 1_000_000 })); age(db, id, "2026-10-01");
    tx(db, bca, "income", 1_000_000, "2026-11-10");
    tx(db, bca, "income", 3_000_000, "2026-11-16");
    const p = listPlanned(db, TODAY).filter((x) => x.due_date <= TODAY);
    expect(p.filter((x) => x.match).map((x) => x.due_date)).toEqual(["2026-11-09"]); // the 1jt on the 10th claims the 9th only
  });
  it("cannot link the wrong type, a debt/bill payment, or an already-linked transaction", () => {
    const { db, bca } = setup();
    const id = createRule(db, salary(bca, db, { day_of_month: 18 })); age(db, id, "2026-10-01");
    const spend = tx(db, bca, "expense", 9_000_000, "2026-11-18");
    expect(() => confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18", link_transaction_id: spend }, T)).toThrow(/tidak sesuai/);
    const inc = tx(db, bca, "income", 9_000_000, "2026-11-18");
    confirmOccurrence(db, { rule_id: id, due_date: "2026-11-18", link_transaction_id: inc }, T);
    expect(() => confirmOccurrence(db, { rule_id: id, due_date: "2026-10-18", link_transaction_id: inc }, T)).toThrow(/sudah ditautkan/);
  });
});

describe("recurring pattern detection", () => {
  const monthly = (db: ReturnType<typeof memDb>, acc: number, desc: string, amounts: number[], day = 5, startMonth = 7) => amounts.forEach((a, i) => tx(db, acc, "expense", a, `2026-${String(startMonth + i).padStart(2, "0")}-${String(day).padStart(2, "0")}`, desc));
  it("suggests a monthly pattern with the median amount, usual day and most common category", () => {
    const { db, bca } = setup();
    monthly(db, bca, "Netflix 123456", [54_000, 54_000, 54_000, 54_000, 54_000]); // Jul..Nov
    monthly(db, bca, "Sekali beli", [100_000]);
    const s = detectPatterns(db, TODAY);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ type: "expense", amount: 54_000, frequency: "monthly", day_of_month: 5, start_date: "2026-07-05", occurrences: 5, account_id: bca });
    expect(s[0].name.toLowerCase()).toContain("netflix");
  });
  it("detects weekly patterns and tolerates small amount changes, but not big ones or irregular timing", () => {
    const { db, bca } = setup();
    ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"].forEach((d, i) => tx(db, bca, "expense", 50_000 + i * 1_000, d, "Laundry kiloan"));
    ["2026-06-01", "2026-07-20", "2026-08-02", "2026-11-11"].forEach((d) => tx(db, bca, "expense", 75_000, d, "Acak tidak teratur"));
    monthly(db, bca, "Belanja besar", [100_000, 400_000, 100_000, 900_000]);
    const s = detectPatterns(db, TODAY);
    expect(s.map((x) => x.frequency)).toEqual(["weekly"]);
    expect(s[0].amount).toBe(51_500); // median of 50k..53k
  });
  it("ignores patterns already covered by a rule or a bill, dismissed ones, stopped ones, debt/bill payments and transfers", () => {
    const { db, bca, gopay } = setup();
    monthly(db, bca, "Spotify premium", [55_000, 55_000, 55_000, 55_000]);
    monthly(db, bca, "Listrik PLN", [400_000, 410_000, 405_000, 400_000]);
    monthly(db, bca, "Gym lama", [300_000, 300_000, 300_000], 5, 2); // stopped in April
    expect(detectPatterns(db, TODAY).map((s) => s.name).sort()).toEqual(["Listrik PLN", "Spotify premium"]);
    createBill(db, { name: "Listrik PLN", kind: "bill", category_id: null, account_id: bca, amount: null, frequency: "monthly", next_due_date: "2026-12-05", remind_days: 3 });
    const sp = detectPatterns(db, TODAY);
    expect(sp.map((s) => s.name)).toEqual(["Spotify premium"]);
    dismissPattern(db, sp[0].key);
    expect(detectPatterns(db, TODAY)).toEqual([]);
    void gopay;
  });
  it("does not suggest what is already a recurring rule", () => {
    const { db, bca } = setup();
    monthly(db, bca, "Spotify premium", [55_000, 55_000, 55_000, 55_000]);
    createRule(db, { name: "Spotify", type: "expense", amount: 55_000, account_id: bca, category_id: null, frequency: "monthly", day_of_month: 5, start_date: "2026-05-05" });
    expect(detectPatterns(db, TODAY)).toEqual([]);
  });
});

describe("settings helper", () => {
  it("round-trips and overwrites values", () => {
    const { db } = setup();
    expect(getSetting(db, "x")).toBeNull();
    setSetting(db, "x", "1"); setSetting(db, "x", "2");
    expect(getSetting(db, "x")).toBe("2");
    deleteSetting(db, "x");
    expect(getSetting(db, "x")).toBeNull();
  });
});
