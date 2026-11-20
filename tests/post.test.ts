import { describe, it, expect } from "vitest";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { postDrafts, type ConfirmedDraft } from "@/lib/capture/post";
import { loadMatcher } from "@/lib/capture/rules";
import { getBalance } from "@/lib/ledger/accounts";
import { listInbox } from "@/lib/inbox/inbox";
import { findCategoryId } from "@/lib/ledger/categories";
import { createTransaction } from "@/lib/ledger/transactions";
import { createDebt, getDebt } from "@/lib/debts/debts";
import { monthTotals } from "@/lib/ledger/summary";
import { LedgerError } from "@/lib/ledger/errors";

const d = (o: Partial<ConfirmedDraft> = {}): ConfirmedDraft => ({ type: "expense", amount: 25_000, occurred_on: "2026-11-20", description: "Kopi", merchant: null, account_id: 2, to_account_id: null, category_id: null, category_source: null, confidence: 0.9, ...o });

function setup() {
  const db = memDb();
  const { bca, gopay } = twoAccounts(db, 1_000_000, 500_000);
  return { db, bca, gopay, matcher: loadMatcher(db) };
}
const O = (matcher: ReturnType<typeof loadMatcher>) => ({ matcher, today: TODAY });

describe("quick capture posting", () => {
  it("'now' posts every draft to the ledger via the inbox pipeline (rules fill the category)", () => {
    const { db, bca, gopay, matcher } = setup();
    const r = postDrafts(db, [d({ account_id: gopay }), d({ description: "Makan siang", amount: 35_000, account_id: bca })], "now", O(matcher));
    expect(r).toEqual({ posted: 2, queued: 0 });
    expect(getBalance(db, gopay)).toBe(475_000);
    expect(getBalance(db, bca)).toBe(965_000);
    expect(db.prepare("SELECT category_id FROM transactions ORDER BY id").all()).toEqual([{ category_id: findCategoryId(db, "Kopi", "expense") }, { category_id: findCategoryId(db, "Makan", "expense") }]);
    expect(db.prepare("SELECT source FROM transactions").get()).toEqual({ source: "quick_capture" });
    expect(listInbox(db, { status: "approved" }).total).toBe(2); // the inbox keeps an audit trail
  });
  it("is all or nothing: one bad draft rolls the whole submission back", () => {
    const { db, bca, gopay, matcher } = setup();
    expect(() => postDrafts(db, [d({ account_id: gopay }), d({ account_id: bca, occurred_on: "2026-11-25" })], "now", O(matcher))).toThrow(/baris 2.*masa depan/);
    expect(getBalance(db, gopay)).toBe(500_000);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM inbox_items").get()).toEqual({ c: 0 });
  });
  it("'inbox' only queues, leaving incomplete drafts for review", () => {
    const { db, bca, matcher } = setup();
    const r = postDrafts(db, [d({ account_id: null, description: "Kopi", confidence: 0.5 }), d({ amount: null, account_id: bca })], "inbox", O(matcher));
    expect(r).toEqual({ posted: 0, queued: 2 });
    expect(listInbox(db, { status: "needs_review" }).total).toBe(2);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 0 });
  });
  it("transfers post directly as one transfer (not income/expense) and cannot go to the inbox", () => {
    const { db, bca, gopay, matcher } = setup();
    postDrafts(db, [d({ type: "transfer", amount: 200_000, account_id: bca, to_account_id: gopay, description: "Transfer" })], "now", O(matcher));
    expect(getBalance(db, bca)).toBe(800_000);
    expect(getBalance(db, gopay)).toBe(700_000);
    expect(monthTotals(db, "2026-11")).toEqual({ income: 0, expense: 0, net: 0 });
    expect(() => postDrafts(db, [d({ type: "transfer", amount: 1_000, account_id: bca, to_account_id: gopay })], "inbox", O(matcher))).toThrow(/kotak masuk/);
    expect(() => postDrafts(db, [d({ type: "transfer", amount: 1_000, account_id: bca, to_account_id: null })], "now", O(matcher))).toThrow(/akun asal dan tujuan/);
  });
  it("a typed installment payment is recorded against the debt instead of becoming a stray expense", () => {
    const { db, bca, matcher } = setup();
    const debt = createDebt(db, { provider: "SeaBank", model: "none", principal: 224_000, count: 1, start_date: "2026-10-01", first_due_date: "2026-11-20", payment_account_id: bca });
    postDrafts(db, [d({ amount: 224_000, account_id: bca, description: "Bayar SeaBank" })], "now", O(matcher));
    expect(getDebt(db, debt, TODAY)).toMatchObject({ status: "settled", outstanding: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 1 });
  });
  it("posting an exact repeat is allowed after the user saw the duplicate warning, and posts once per draft", () => {
    const { db, gopay, matcher } = setup();
    createTransaction(db, { type: "expense", account_id: gopay, category_id: null, amount: 25_000, occurred_on: "2026-11-20", description: "kopi" }, { today: TODAY });
    postDrafts(db, [d({ account_id: gopay })], "now", O(matcher));
    expect(getBalance(db, gopay)).toBe(450_000);
  });
  it("rejects empty and oversized submissions", () => {
    const { db, matcher } = setup();
    expect(() => postDrafts(db, [], "now", O(matcher))).toThrow(LedgerError);
    expect(() => postDrafts(db, Array.from({ length: 101 }, () => d()), "now", O(matcher))).toThrow(/Maksimal 100/);
  });
});
