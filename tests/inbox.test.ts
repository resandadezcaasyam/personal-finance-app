import { describe, it, expect } from "vitest";
import { memDb, twoAccounts, TODAY } from "./helpers";
import { createInboxItems, approveInboxItems, listInbox, inboxCounts, updateInboxItem, rejectInboxItems, restoreInboxItem, setCategoryForItems, findLedgerDuplicates, setMatchDismissed, type NewInboxItem } from "@/lib/inbox/inbox";
import { commitStatementImport, commitReceipt } from "@/lib/inbox/import-commit";
import { lineFingerprint } from "@/lib/inbox/fingerprint";
import { loadMatcher, createUserRule, listRules, setRuleActive, deleteUserRule, suggestPattern } from "@/lib/capture/rules";
import { createTemplate, listTemplates, deleteTemplate } from "@/lib/capture/templates";
import { createTransaction } from "@/lib/ledger/transactions";
import { getBalance } from "@/lib/ledger/accounts";
import { findCategoryId } from "@/lib/ledger/categories";
import { createDebt, getDebt } from "@/lib/debts/debts";
import { createBill, listBills } from "@/lib/bills/bills";
import { monthTotals } from "@/lib/ledger/summary";
import { extractReceipt } from "@/lib/capture/receipt";
import { LedgerError } from "@/lib/ledger/errors";
import { normalizeRows, type NormalizedRow } from "@/lib/imports/table";

const T = { today: TODAY };
const item = (over: Partial<NewInboxItem> = {}): NewInboxItem => ({ type: "expense", amount: 25_000, occurred_on: "2026-11-15", description: "KOPI KENANGAN QRIS", account_id: 1, category_id: null, source_kind: "csv", confidence: 0.9, ...over });
const row = (o: Partial<NormalizedRow> = {}): NormalizedRow => ({ row_no: 2, occurred_on: "2026-11-15", description: "KOPI KENANGAN QRIS", amount: 25_000, type: "expense", reference: null, balance: null, ...o });

function setup() {
  const db = memDb();
  const { bca, gopay } = twoAccounts(db, 5_000_000, 500_000);
  return { db, bca, gopay, matcher: loadMatcher(db) };
}

describe("merchant rules", () => {
  it("ships the spec examples: Fore Coffee -> Kopi, PLN -> Listrik, Netflix -> Langganan Digital", () => {
    const { db, matcher } = setup();
    expect(matcher("Fore Coffee Plaza Indonesia", "expense")?.category_id).toBe(findCategoryId(db, "Kopi", "expense"));
    expect(matcher("PLN PREPAID 1234", "expense")?.category_id).toBe(findCategoryId(db, "Listrik", "expense"));
    expect(matcher("NETFLIX.COM", "expense")?.category_id).toBe(findCategoryId(db, "Langganan Digital", "expense"));
    expect(matcher("Fore Coffee", "expense")?.merchant).toBe("Fore Coffee");
    expect(matcher("gaji november", "income")?.category_id).toBe(findCategoryId(db, "Gaji", "income"));
  });
  it("matches whole phrases only and respects transaction kind", () => {
    const { db, matcher } = setup();
    expect(matcher("kopikenangan", "expense")?.category_id).not.toBe(findCategoryId(db, "Kopi", "expense")); // 'kopi' is not a whole word there
    expect(matcher("gaji", "expense")).toBeNull();
  });
  it("user rules win over defaults, upsert on repeat, and can be removed; defaults can only be disabled", () => {
    const { db, matcher } = setup();
    const makan = findCategoryId(db, "Makan", "expense")!;
    createUserRule(db, { pattern: "Kopi Kenangan", kind: "expense", category_id: makan });
    expect(loadMatcher(db)("KOPI KENANGAN QRIS", "expense")?.category_id).toBe(makan);
    const hot = findCategoryId(db, "Belanja Harian", "expense")!;
    createUserRule(db, { pattern: "kopi kenangan", kind: "expense", category_id: hot }); // same pattern: updates
    expect(listRules(db).filter((r) => r.source === "user")).toHaveLength(1);
    expect(loadMatcher(db)("kopi kenangan", "expense")?.category_id).toBe(hot);
    const id = listRules(db).find((r) => r.source === "user")!.id;
    deleteUserRule(db, id);
    expect(loadMatcher(db)("kopi kenangan", "expense")?.category_id).toBe(findCategoryId(db, "Kopi", "expense"));
    const def = listRules(db).find((r) => r.source === "default" && r.pattern === "netflix")!;
    expect(() => deleteUserRule(db, def.id)).toThrow(/bawaan/);
    setRuleActive(db, def.id, false);
    expect(loadMatcher(db)("netflix", "expense")).toBeNull();
    void matcher;
  });
  it("validates rule input and suggests a pattern", () => {
    const { db } = setup();
    expect(() => createUserRule(db, { pattern: "ab", kind: "expense", category_id: findCategoryId(db, "Kopi", "expense")! })).toThrow(/3 huruf/);
    expect(() => createUserRule(db, { pattern: "valid", kind: "expense", category_id: findCategoryId(db, "Gaji", "income")! })).toThrow(/tidak sesuai/);
    expect(suggestPattern("TRSF E-BANKING 123456 WARUNG BU TINI", null)).toBe("trsf banking warung");
    expect(suggestPattern("x", "Fore Coffee")).toBe("fore coffee");
  });
});

describe("inbox creation and statuses", () => {
  it("auto-categorizes by rule and marks clean items 'new', incomplete ones 'needs_review'", () => {
    const { db, matcher } = setup();
    const r = createInboxItems(db, [item(), item({ description: "SESUATU ANEH", amount: 11_000, fingerprint: "b" }), item({ account_id: null, description: "TANPA AKUN KOPI", fingerprint: "c" })], { matcher, today: TODAY });
    expect(r.created).toBe(3);
    const { rows } = listInbox(db, {});
    const by = Object.fromEntries(rows.map((x) => [x.description, x]));
    expect(by["KOPI KENANGAN QRIS"]).toMatchObject({ status: "new", category_name: "Kopi", category_source: "rule", merchant: "Kopi Kenangan" });
    expect(by["SESUATU ANEH"]).toMatchObject({ status: "needs_review", category_id: null });
    expect(by["SESUATU ANEH"].note).toContain("kategori");
    expect(by["TANPA AKUN KOPI"].status).toBe("needs_review");
    expect(inboxCounts(db)).toMatchObject({ new: 1, needs_review: 2, pending: 3 });
  });
  it("low OCR-style confidence forces review even when every field is present", () => {
    const { db, matcher } = setup();
    createInboxItems(db, [item({ confidence: 0.6 })], { matcher });
    expect(listInbox(db, {}).rows[0].status).toBe("needs_review");
  });
  it("never overrides a category that was set explicitly", () => {
    const { db, matcher } = setup();
    const belanja = findCategoryId(db, "Belanja Harian", "expense")!;
    createInboxItems(db, [item({ category_id: belanja, category_source: "user" })], { matcher });
    expect(listInbox(db, {}).rows[0]).toMatchObject({ category_id: belanja, category_source: "user" });
  });
});

describe("only approved items affect the ledger", () => {
  it("pending items change nothing; approval posts exactly one transaction with the import source", () => {
    const { db, bca, matcher } = setup();
    const { ids } = createInboxItems(db, [item({ fingerprint: "fp1" })], { matcher });
    expect(getBalance(db, bca)).toBe(5_000_000);
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 0 });
    const r = approveInboxItems(db, ids, T);
    expect(r[0]).toMatchObject({ ok: true });
    expect(getBalance(db, bca)).toBe(4_975_000);
    expect(db.prepare("SELECT source, source_ref, category_id FROM transactions").get()).toEqual({ source: "import", source_ref: "fp1", category_id: findCategoryId(db, "Kopi", "expense") });
    expect(approveInboxItems(db, ids, T)[0]).toMatchObject({ ok: false, code: "done" }); // approving twice never posts twice
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 1 });
  });
  it("rejected items never post and can be restored", () => {
    const { db, bca } = setup();
    const { ids } = createInboxItems(db, [item()]);
    expect(rejectInboxItems(db, ids)).toBe(1);
    expect(approveInboxItems(db, ids, T)[0].ok).toBe(false);
    restoreInboxItem(db, ids[0]);
    expect(approveInboxItems(db, ids, T)[0].ok).toBe(true);
    expect(getBalance(db, bca)).toBe(4_975_000);
  });
  it("incomplete or invalid items are reported per item without blocking the rest", () => {
    const { db, bca } = setup();
    const { ids } = createInboxItems(db, [item({ fingerprint: "ok" }), item({ account_id: null, fingerprint: "noacc" }), item({ occurred_on: "2026-11-25", fingerprint: "future" }), item({ amount: null, fingerprint: "noamt" })]);
    const r = approveInboxItems(db, ids, T);
    expect(r.map((x) => x.ok)).toEqual([true, false, false, false]);
    expect(r[1].error).toContain("Akun"); expect(r[2].error).toContain("masa depan"); expect(r[3].error).toContain("Nominal");
    expect(getBalance(db, bca)).toBe(4_975_000);
  });
  it("editing then approving posts the edited values and marks the category as the user's", () => {
    const { db, bca } = setup();
    const { ids } = createInboxItems(db, [item({ description: "SESUATU ANEH" })]);
    const belanja = findCategoryId(db, "Belanja", "expense")!;
    updateInboxItem(db, ids[0], { type: "expense", amount: 40_000, occurred_on: "2026-11-16", description: "Baju", merchant: null, account_id: bca, category_id: belanja });
    expect(listInbox(db, {}).rows[0]).toMatchObject({ status: "new", category_source: "user", amount: 40_000 });
    approveInboxItems(db, ids, T);
    expect(db.prepare("SELECT amount, occurred_on, category_id, description FROM transactions").get()).toEqual({ amount: 40_000, occurred_on: "2026-11-16", category_id: belanja, description: "Baju" });
    expect(() => updateInboxItem(db, ids[0], { type: "expense", amount: 1, occurred_on: "2026-11-16", description: "x", merchant: null, account_id: bca, category_id: null })).toThrow(/disetujui/);
  });
  it("rejects a category of the wrong kind", () => {
    const { db, bca } = setup();
    const { ids } = createInboxItems(db, [item()]);
    expect(() => updateInboxItem(db, ids[0], { type: "expense", amount: 1_000, occurred_on: "2026-11-16", description: "x", merchant: null, account_id: bca, category_id: findCategoryId(db, "Gaji", "income") })).toThrow(/tidak sesuai/);
  });
  it("bulk categorize only touches items whose type fits the category", () => {
    const { db } = setup();
    const { ids } = createInboxItems(db, [item({ description: "A", fingerprint: "1" }), item({ type: "income", description: "B", fingerprint: "2" })]);
    expect(setCategoryForItems(db, ids, findCategoryId(db, "Belanja", "expense")!)).toEqual({ updated: 1, skipped: 1 });
  });
});

describe("duplicate detection", () => {
  it("flags a statement line that matches a manually recorded transaction, and never auto-posts it", () => {
    const { db, bca, matcher } = setup();
    createTransaction(db, { type: "expense", account_id: bca, category_id: null, amount: 25_000, occurred_on: "2026-11-15", description: "kopi (manual)" }, T);
    expect(findLedgerDuplicates(db, { account_id: bca, type: "expense", amount: 25_000, occurred_on: "2026-11-16" })).toHaveLength(1); // +/- 1 day
    expect(findLedgerDuplicates(db, { account_id: bca, type: "expense", amount: 25_000, occurred_on: "2026-11-18" })).toHaveLength(0);
    const { ids } = createInboxItems(db, [item({ account_id: bca })], { matcher });
    expect(listInbox(db, {}).rows[0]).toMatchObject({ status: "potential_duplicate", duplicates: [expect.stringMatching(/^tx:/)] });
    const bulk = approveInboxItems(db, ids, T);
    expect(bulk[0]).toMatchObject({ ok: false, code: "duplicate" });
    expect(getBalance(db, bca)).toBe(4_975_000); // only the manual one
    expect(approveInboxItems(db, ids, { ...T, includeDuplicates: true })[0].ok).toBe(true); // explicit confirmation
    expect(getBalance(db, bca)).toBe(4_950_000);
  });
  it("also checks transfers", () => {
    const { db, bca, gopay } = setup();
    db.prepare("INSERT INTO transfers (from_account_id,to_account_id,amount,occurred_on) VALUES (?,?,?,?)").run(bca, gopay, 100_000, "2026-11-15");
    expect(findLedgerDuplicates(db, { account_id: bca, type: "expense", amount: 100_000, occurred_on: "2026-11-15" })).toEqual(["transfer:1"]);
    expect(findLedgerDuplicates(db, { account_id: gopay, type: "income", amount: 100_000, occurred_on: "2026-11-15" })).toEqual(["transfer:1"]);
    expect(findLedgerDuplicates(db, { account_id: gopay, type: "expense", amount: 100_000, occurred_on: "2026-11-15" })).toEqual([]);
  });
  it("identical purchases in one file are kept apart; overlapping statements do not double up", () => {
    const { db, bca, matcher } = setup();
    const two = [row({ row_no: 2 }), row({ row_no: 3 })]; // two real 25rb coffees the same day
    const first = commitStatementImport(db, { sourceType: "csv", fileName: "a.csv", fileHash: "h1", accountId: bca, rows: two, errors: [], skipped: 0, matcher, today: TODAY });
    expect(first.imported).toBe(2);
    // a second, overlapping statement with different bytes: same two lines plus one new line
    const second = commitStatementImport(db, { sourceType: "csv", fileName: "b.csv", fileHash: "h2", accountId: bca, rows: [...two, row({ row_no: 4, description: "BARU", amount: 9_000 })], errors: [], skipped: 0, matcher, today: TODAY });
    expect(second).toMatchObject({ imported: 1, duplicates: 2 });
    expect(listInbox(db, {}).total).toBe(3);
  });
  it("uses the bank reference as identity when present", () => {
    const f = (ref: string | null, occ = 1) => lineFingerprint({ account_id: 1, occurred_on: "2026-11-15", amount: 25_000, type: "expense", description: "X", reference: ref, occurrence: occ });
    expect(f("TRX1")).toBe(f("TRX1", 5));
    expect(f("TRX1")).not.toBe(f("TRX2"));
    expect(f(null, 1)).not.toBe(f(null, 2));
  });
});

describe("idempotent imports", () => {
  it("refuses the same file twice and creates nothing the second time", () => {
    const { db, bca } = setup();
    const p = { sourceType: "csv" as const, fileName: "mutasi.csv", fileHash: "same", accountId: bca, rows: [row()], errors: [], skipped: 0, today: TODAY };
    commitStatementImport(db, p);
    expect(() => commitStatementImport(db, p)).toThrow(/sudah pernah diimpor/);
    expect(listInbox(db, {}).total).toBe(1);
    expect(db.prepare("SELECT COUNT(*) c FROM import_batches").get()).toEqual({ c: 1 }); // the failed attempt left no batch behind
  });
  it("approving a re-queued line never creates a second ledger row (ledger-level guard)", () => {
    const { db, bca } = setup();
    const a = createInboxItems(db, [item({ account_id: bca, fingerprint: "dup-fp", category_id: findCategoryId(db, "Kopi", "expense")! })]);
    approveInboxItems(db, a.ids, T);
    const again = createInboxItems(db, [item({ account_id: bca, fingerprint: "dup-fp" })]);
    expect(again).toMatchObject({ created: 0, skippedDuplicates: 1 });
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 1 });
  });
  it("records batch counts, errors and history", () => {
    const { db, bca } = setup();
    const s = commitStatementImport(db, { sourceType: "csv", fileName: "x.csv", fileHash: "hx", accountId: bca, rows: [row()], errors: [{ row_no: 5, reason: "Tanggal tidak terbaca" }], skipped: 2, today: TODAY });
    expect(s).toMatchObject({ imported: 1, duplicates: 0, skippedRows: 2 });
    const b = db.prepare("SELECT imported_count, duplicate_count, error_count, error_report, status FROM import_batches").get() as { imported_count: number; error_count: number; error_report: string; status: string };
    expect(b).toMatchObject({ imported_count: 1, error_count: 1, status: "completed" });
    expect(JSON.parse(b.error_report)).toEqual([{ row_no: 5, reason: "Tanggal tidak terbaca" }]);
  });
  it("requires an active account and at least one row", () => {
    const { db } = setup();
    expect(() => commitStatementImport(db, { sourceType: "csv", fileName: "x", fileHash: "h", accountId: 999, rows: [row()], errors: [], skipped: 0 })).toThrow(LedgerError);
    expect(() => commitStatementImport(db, { sourceType: "csv", fileName: "x", fileHash: "h", accountId: 1, rows: [], errors: [], skipped: 0 })).toThrow(/Tidak ada transaksi/);
  });
});

describe("matching to installments, bills and transfers", () => {
  it("an imported installment payment records the installment as paid instead of a second expense", () => {
    const { db, bca, matcher } = setup();
    const debt = createDebt(db, { provider: "SeaBank", model: "none", principal: 672_000, count: 3, start_date: "2026-10-01", first_due_date: "2026-11-18", payment_account_id: bca });
    const { ids } = createInboxItems(db, [item({ amount: 224_000, occurred_on: "2026-11-18", description: "SEABANK ANGSURAN 1", account_id: bca, fingerprint: "inst" })], { matcher });
    const v = listInbox(db, {}).rows[0];
    expect(v.match).toMatchObject({ kind: "debt", debt_id: debt, sequence_no: 1 });
    expect(approveInboxItems(db, ids, T)[0]).toMatchObject({ ok: true, posted_ref: expect.stringMatching(/^debt_payment:/) });
    expect(getBalance(db, bca)).toBe(5_000_000 - 224_000);
    expect(getDebt(db, debt, TODAY)).toMatchObject({ outstanding: 448_000, remaining_installments: 2 });
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 1 }); // ONE expense, not two
    expect(monthTotals(db, "2026-11").expense).toBe(224_000);
  });
  it("matches by amount within the date window and by provider name; ambiguity yields no suggestion", () => {
    const { db, bca, matcher } = setup();
    createDebt(db, { provider: "KrediFazz", model: "none", principal: 300_000, count: 1, start_date: "2026-10-01", first_due_date: "2026-11-18", payment_account_id: bca });
    createDebt(db, { provider: "Akulaku", model: "none", principal: 300_000, count: 1, start_date: "2026-10-01", first_due_date: "2026-11-18", payment_account_id: bca });
    // two debts with the same amount and due date, no name in the text: ambiguous
    createInboxItems(db, [item({ amount: 300_000, occurred_on: "2026-11-18", description: "TRANSFER KE 9988", account_id: bca, fingerprint: "amb" })], { matcher });
    expect(listInbox(db, {}).rows[0].match).toBeNull();
    // naming one of them resolves it
    createInboxItems(db, [item({ amount: 300_000, occurred_on: "2026-11-18", description: "KREDIFAZZ PEMBAYARAN", account_id: bca, fingerprint: "named" })], { matcher });
    expect(listInbox(db, {}).rows.find((r) => r.fingerprint === "named")?.match).toMatchObject({ kind: "debt" });
    // too far from the due date: no match on amount alone
    createInboxItems(db, [item({ amount: 300_000, occurred_on: "2026-12-30", description: "LAIN", account_id: bca, fingerprint: "far" })], { matcher });
    expect(listInbox(db, {}).rows.find((r) => r.fingerprint === "far")?.match).toBeNull();
  });
  it("an imported utility payment settles the bill occurrence once", () => {
    const { db, bca, matcher } = setup();
    const bill = createBill(db, { name: "Internet", kind: "bill", category_id: null, account_id: bca, amount: 350_000, frequency: "monthly", next_due_date: "2026-11-20", remind_days: 3 });
    const { ids } = createInboxItems(db, [item({ amount: 350_000, occurred_on: "2026-11-19", description: "INDIHOME INTERNET", account_id: bca, fingerprint: "bill" })], { matcher });
    expect(listInbox(db, {}).rows[0].match).toMatchObject({ kind: "bill", bill_id: bill });
    expect(approveInboxItems(db, ids, T)[0].posted_ref).toMatch(/^bill_payment:/);
    expect(listBills(db, TODAY)[0].next_due_date).toBe("2026-12-20");
    expect(getBalance(db, bca)).toBe(5_000_000 - 350_000);
  });
  it("a dismissed suggestion posts a plain expense instead", () => {
    const { db, bca, matcher } = setup();
    const debt = createDebt(db, { provider: "SeaBank", model: "none", principal: 224_000, count: 1, start_date: "2026-10-01", first_due_date: "2026-11-18" });
    const { ids } = createInboxItems(db, [item({ amount: 224_000, occurred_on: "2026-11-18", account_id: bca, fingerprint: "x" })], { matcher });
    setMatchDismissed(db, ids[0], true);
    expect(approveInboxItems(db, ids, T)[0].posted_ref).toMatch(/^tx:/);
    expect(getDebt(db, debt, TODAY)?.outstanding).toBe(224_000); // untouched
  });
  it("a changed situation invalidates the suggestion instead of double-posting", () => {
    const { db, bca, matcher } = setup();
    const debt = createDebt(db, { provider: "SeaBank", model: "none", principal: 224_000, count: 1, start_date: "2026-10-01", first_due_date: "2026-11-18", payment_account_id: bca });
    const { ids } = createInboxItems(db, [item({ amount: 224_000, occurred_on: "2026-11-18", description: "SEABANK", account_id: bca, fingerprint: "stale" })], { matcher });
    // the user pays the installment in the app first
    db.prepare("UPDATE installment_schedules SET amount_paid = amount_due, status='paid' WHERE debt_id = ?").run(debt);
    const r = approveInboxItems(db, ids, T)[0];
    expect(r).toMatchObject({ ok: false, code: "match_changed" });
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 0 });
    expect(listInbox(db, {}).rows[0]).toMatchObject({ status: "needs_review", match: null });
  });
  it("pairs a transfer between two own accounts and posts ONE transfer, no income/expense", () => {
    const { db, bca, gopay, matcher } = setup();
    const { ids } = createInboxItems(db, [
      item({ amount: 400_000, occurred_on: "2026-11-15", description: "TRSF KE GOPAY", account_id: bca, fingerprint: "out" }),
      item({ type: "income", amount: 400_000, occurred_on: "2026-11-16", description: "TOP UP DARI BCA", account_id: gopay, fingerprint: "in", source_kind: "csv" }),
    ], { matcher });
    const rows = listInbox(db, {}).rows;
    expect(rows.every((r) => r.match?.kind === "transfer")).toBe(true);
    expect(rows.every((r) => r.status === "new" && r.note === null)).toBe(true); // a transfer needs no category to be ready
    const res = approveInboxItems(db, ids, T);
    expect(res[0]).toMatchObject({ ok: true, posted_ref: "transfer:1" });
    expect(res[1]).toMatchObject({ ok: false, code: "done" }); // the partner was posted together with it
    expect(getBalance(db, bca)).toBe(4_600_000);
    expect(getBalance(db, gopay)).toBe(900_000);
    expect(monthTotals(db, "2026-11")).toEqual({ income: 0, expense: 0, net: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM transactions").get()).toEqual({ c: 0 });
    expect(inboxCounts(db).approved).toBe(2);
  });
  it("does not pair items in the same account, with different amounts, or more than a day apart", () => {
    const { db, bca, gopay } = setup();
    createInboxItems(db, [
      item({ amount: 400_000, account_id: bca, fingerprint: "a" }), item({ type: "income", amount: 400_000, account_id: bca, fingerprint: "b" }),
      item({ type: "income", amount: 399_000, account_id: gopay, fingerprint: "c" }), item({ type: "income", amount: 400_000, occurred_on: "2026-11-18", account_id: gopay, fingerprint: "d" }),
    ]);
    expect(listInbox(db, {}).rows.filter((r) => r.match).length).toBe(0);
  });
});

describe("OCR receipts", () => {
  const EX = extractReceipt("Pembayaran Berhasil\nMerchant: Fore Coffee\n20 November 2026\nMetode: GoPay\nBiaya layanan Rp 2.000\nTotal Pembayaran Rp 50.000\nSisa saldo Rp 1.250.000\nNo. Referensi: GP20261120ABC123\n", { today: TODAY, ocrConfidence: 94 });
  it("queues a receipt for review with the wallet account guessed from the payment method", () => {
    const { db, gopay, matcher } = setup();
    const r = commitReceipt(db, { fileName: "struk.png", fileHash: "img1", extraction: EX, ocrText: "...", matcher, today: TODAY });
    expect(r.created).toBe(true);
    const v = listInbox(db, {}).rows[0];
    expect(v).toMatchObject({ amount: 50_000, occurred_on: "2026-11-20", account_id: gopay, merchant: "Fore Coffee", source_kind: "ocr", category_name: "Kopi", source_ref: "GP20261120ABC123" });
    expect(v.note).toContain("2.000");
    expect(getBalance(db, gopay)).toBe(500_000); // inbox only
  });
  it("the same screenshot or the same reference is never queued twice", () => {
    const { db, matcher } = setup();
    commitReceipt(db, { fileName: "a.png", fileHash: "img1", extraction: EX, ocrText: "", matcher, today: TODAY });
    expect(() => commitReceipt(db, { fileName: "a.png", fileHash: "img1", extraction: EX, ocrText: "", matcher, today: TODAY })).toThrow(/sudah pernah diimpor/);
    const again = commitReceipt(db, { fileName: "crop.png", fileHash: "img2", extraction: EX, ocrText: "", matcher, today: TODAY }); // different image, same reference
    expect(again.created).toBe(false);
    expect(listInbox(db, {}).total).toBe(1);
  });
  it("uncertain extractions are flagged for review with the reasons", () => {
    const { db } = setup();
    const weak = extractReceipt("Warung Bu Tini\nNasi ayam 25.000\n", { today: TODAY });
    commitReceipt(db, { fileName: "w.png", fileHash: "img3", extraction: weak, ocrText: "", today: TODAY });
    const v = listInbox(db, {}).rows[0];
    expect(v.status).toBe("needs_review");
    expect(v.note).toContain("ditebak");
  });
});

describe("templates", () => {
  it("creates, lists, validates and deletes favourites", () => {
    const { db, bca } = setup();
    const id = createTemplate(db, { name: "Kopi pagi", type: "expense", amount: 25_000, account_id: bca, category_id: findCategoryId(db, "Kopi", "expense"), description: "Kopi pagi" });
    expect(listTemplates(db)).toMatchObject([{ id, name: "Kopi pagi", amount: 25_000, account_name: "BCA", category_name: "Kopi" }]);
    expect(() => createTemplate(db, { name: "kopi PAGI", type: "expense", amount: null, account_id: null, category_id: null, description: "" })).toThrow(/Sudah ada/);
    expect(() => createTemplate(db, { name: "Salah", type: "income", amount: 1_000, account_id: null, category_id: findCategoryId(db, "Kopi", "expense"), description: "" })).toThrow(/tidak sesuai/);
    deleteTemplate(db, id);
    expect(listTemplates(db)).toEqual([]);
  });
});

describe("end to end: a statement through the inbox", () => {
  it("imports, categorizes, matches and approves a realistic file without double counting", () => {
    const { db, bca, matcher } = setup();
    createDebt(db, { provider: "SeaBank", model: "none", principal: 224_000, count: 1, start_date: "2026-10-01", first_due_date: "2026-11-18", payment_account_id: bca });
    createTransaction(db, { type: "expense", account_id: bca, category_id: null, amount: 150_000, occurred_on: "2026-11-16", description: "listrik (manual)" }, T); // already recorded by hand
    const table = [
      ["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"],
      ["15/11/2026", "KOPI KENANGAN QRIS", "25.000,00", "", ""], ["16/11/2026", "BAYAR LISTRIK PLN TOKEN", "150.000,00", "", ""],
      ["17/11/2026", "GAJI PT MAJU JAYA", "", "9.500.000,00", ""], ["18/11/2026", "SEABANK ANGSURAN 1", "224.000,00", "", ""], ["19/11/2026", "ENTAH APA", "7.000,00", "", ""],
    ];
    const norm = normalizeRows(table, { header_row: 0, date: 0, description: 1, debit: 2, credit: 3, amount: null, dc: null, reference: null, balance: null, date_format: "auto", number_format: "auto", positive_is: null }, TODAY);
    const s = commitStatementImport(db, { sourceType: "csv", fileName: "nov.csv", fileHash: "e2e", accountId: bca, rows: norm.rows, errors: norm.errors, skipped: norm.skipped, matcher, today: TODAY });
    expect(s.imported).toBe(5);
    const counts = inboxCounts(db);
    expect(counts).toMatchObject({ new: 3, needs_review: 1, potential_duplicate: 1 }); // listrik is a duplicate of the manual entry; "ENTAH APA" has no category
    const all = listInbox(db, { status: "pending" }).rows;
    const res = approveInboxItems(db, all.map((r) => r.id), T);
    expect(res.filter((r) => r.ok).length).toBe(4);
    expect(res.find((r) => r.code === "duplicate")).toBeTruthy();
    // balance: 5jt - manual 150k - kopi 25k + gaji 9.5jt - installment 224k - entah 7k
    expect(getBalance(db, bca)).toBe(5_000_000 - 150_000 - 25_000 + 9_500_000 - 224_000 - 7_000);
    expect(db.prepare("SELECT COUNT(*) c FROM debt_payments").get()).toEqual({ c: 1 });
  });
});
