import { describe, it, expect } from "vitest";
import { parseQuickCapture, type ParseContext } from "@/lib/capture/nl-parser";
import { extractReceipt, parseReceiptAmount } from "@/lib/capture/receipt";
import { findDateInText, normalizeText, containsPhrase } from "@/lib/capture/text";
import { parseIDR } from "@/lib/format";

const TODAY = "2026-11-20"; // a Friday
const accounts = [
  { id: 1, name: "BCA", type: "bank" as const }, { id: 2, name: "SeaBank", type: "bank" as const },
  { id: 3, name: "GoPay", type: "ewallet" as const }, { id: 4, name: "ShopeePay", type: "ewallet" as const }, { id: 5, name: "Tunai", type: "cash" as const },
];
const RULES: [string, string | null, "income" | "expense", number][] = [
  ["kopi", null, "expense", 10], ["makan", null, "expense", 11], ["listrik", null, "expense", 12], ["fore coffee", "Fore Coffee", "expense", 10], ["gaji", null, "income", 20],
  ["pln", "PLN", "expense", 12], ["parkir", null, "expense", 13],
];
const ctx: ParseContext = {
  today: TODAY, accounts,
  matchRule: (text, kind) => {
    const hit = RULES.filter(([p, , k]) => k === kind && containsPhrase(text, p)).sort((a, b) => b[0].length - a[0].length)[0];
    return hit ? { category_id: hit[3], merchant: hit[1] } : null;
  },
};
const one = (s: string) => { const d = parseQuickCapture(s, ctx); expect(d).toHaveLength(1); return d[0]; };

describe("parseIDR shorthand", () => {
  it.each([["9.5jt", 9_500_000], ["9,5jt", 9_500_000], ["1.5k", 1_500], ["25rb", 25_000], ["1.250.000", 1_250_000], ["2.5jt", 2_500_000]])("%s", (i, v) => expect(parseIDR(i)).toBe(v));
  it("does not misread thousands separators", () => {
    expect(parseIDR("1.250rb")).toBe(1_250_000); // 1.250 ribu
    expect(parseIDR("12.000")).toBe(12_000);
  });
});

describe("quick capture: the spec examples", () => {
  it("kopi 25rb gopay", () => {
    const d = one("kopi 25rb gopay");
    expect(d).toMatchObject({ type: "expense", amount: 25_000, account_id: 3, category_id: 10, occurred_on: TODAY });
    expect(d.description).toBe("Kopi");
    expect(d.issues).toEqual([]);
  });
  it("makan 30k cash maps cash to the cash account", () => {
    expect(one("makan 30k cash")).toMatchObject({ type: "expense", amount: 30_000, account_id: 5, category_id: 11 });
  });
  it("gaji masuk 9.5jt seabank is income", () => {
    const d = one("gaji masuk 9.5jt seabank");
    expect(d).toMatchObject({ type: "income", amount: 9_500_000, account_id: 2, category_id: 20 });
    expect(d.description).toBe("Gaji");
  });
  it("bayar listrik 150rb bca", () => {
    const d = one("bayar listrik 150rb bca");
    expect(d).toMatchObject({ type: "expense", amount: 150_000, account_id: 1, category_id: 12 });
  });
  it("beli kopi 25rb sama makan siang 35rb yields two transactions", () => {
    const d = parseQuickCapture("beli kopi 25rb sama makan siang 35rb", ctx);
    expect(d.map((x) => [x.amount, x.category_id])).toEqual([[25_000, 10], [35_000, 11]]);
    expect(d.every((x) => x.account_id === null && x.issues.includes("Akun belum dipilih"))).toBe(true);
  });
});

describe("quick capture: more shapes", () => {
  it("handles several lines and accounts per item", () => {
    const d = parseQuickCapture("kopi 25rb gopay\nmakan 30k cash\nparkir 5rb tunai", ctx);
    expect(d.map((x) => [x.amount, x.account_id])).toEqual([[25_000, 3], [30_000, 5], [5_000, 5]]);
  });
  it("splits consecutive amounts without a connector and keeps trailing accounts with their item", () => {
    const d = parseQuickCapture("kopi 25rb gopay makan 30rb cash", ctx);
    expect(d.map((x) => [x.amount, x.account_id])).toEqual([[25_000, 3], [30_000, 5]]);
  });
  it("keeps 'dan' inside a description when the first part has no amount", () => {
    const d = parseQuickCapture("bakso dan es teh 40rb gopay", ctx);
    expect(d).toHaveLength(1);
    expect(d[0].amount).toBe(40_000);
    expect(d[0].description.toLowerCase()).toContain("bakso");
  });
  it("accepts Rp prefixes and thousands dots", () => {
    expect(one("makan Rp 30.000 bca").amount).toBe(30_000);
    expect(one("makan rp30.000 bca").amount).toBe(30_000);
    expect(one("belanja 1.250.000 bca").amount).toBe(1_250_000);
  });
  it("does not treat small bare numbers as money", () => {
    const d = one("makan 2 porsi bca");
    expect(d.amount).toBeNull();
    expect(d.issues).toContain("Nominal tidak ditemukan");
    expect(d.confidence).toBeLessThan(0.3);
  });
  it("understands relative and explicit dates", () => {
    expect(one("kopi 25rb gopay kemarin").occurred_on).toBe("2026-11-19");
    expect(one("kopi 25rb gopay kemarin lusa").occurred_on).toBe("2026-11-18");
    expect(one("kopi 25rb gopay tadi pagi").occurred_on).toBe(TODAY);
    expect(one("kopi 25rb gopay 17/11").occurred_on).toBe("2026-11-17");
    expect(one("kopi 25rb gopay 17 nov").occurred_on).toBe("2026-11-17");
    expect(one("kopi 25rb gopay 2026-11-10").occurred_on).toBe("2026-11-10");
    expect(one("kopi 25rb gopay tgl 3").occurred_on).toBe("2026-11-03");
    expect(one("kopi 25rb gopay hari senin").occurred_on).toBe("2026-11-16");
  });
  it("never produces a future date: a day/month still ahead means last year or last month", () => {
    expect(one("kopi 25rb gopay 25/12").occurred_on).toBe("2025-12-25");
    expect(one("kopi 25rb gopay tgl 28").occurred_on).toBe("2026-10-28");
  });
  it("removes date words from the description", () => {
    expect(one("kopi 25rb gopay kemarin").description).toBe("Kopi");
  });
  it("detects transfers and their direction", () => {
    expect(one("transfer 500rb dari bca ke gopay")).toMatchObject({ type: "transfer", amount: 500_000, account_id: 1, to_account_id: 3 });
    expect(one("tf 200rb bca ke seabank")).toMatchObject({ type: "transfer", account_id: 1, to_account_id: 2 });
    expect(one("isi gopay 100rb dari bca")).toMatchObject({ type: "transfer", account_id: 1, to_account_id: 3 });
  });
  it("flags a transfer whose accounts are unclear", () => {
    expect(one("transfer 500rb bca").issues.join()).toContain("transfer");
  });
  it("uses a rule's merchant name", () => {
    const d = one("fore coffee 32rb gopay");
    expect(d.merchant).toBe("Fore Coffee");
    expect(d.category_id).toBe(10);
  });
  it("returns nothing for empty input", () => { expect(parseQuickCapture("  \n ", ctx)).toEqual([]); });
  it("leaves category empty and says so when no rule matches", () => {
    const d = one("sesuatu 12rb bca");
    expect(d.category_id).toBeNull();
    expect(d.issues).toContain("Kategori belum ditentukan");
  });
});

describe("receipt amount parsing", () => {
  it.each([["Rp 50.000", 50_000], ["Rp25.000,00", 25_000], ["IDR 25,000", 25_000], ["1.250.000", 1_250_000], ["Rp 1.250.000,50", 1_250_001], ["25.50", 26]])("%s", (i, v) => expect(parseReceiptAmount(i)).toBe(v));
  it("rejects non-numbers", () => { expect(parseReceiptAmount("abc")).toBeNull(); expect(parseReceiptAmount("")).toBeNull(); });
});

describe("receipt extraction", () => {
  const GOPAY = `Pembayaran Berhasil\nMerchant: Fore Coffee\n\n20 November 2026, 09:41\n\nMetode: GoPay\n\nSubtotal Rp 48.000\n\nBiaya layanan Rp 2.000\n\nTotal Pembayaran Rp 50.000\nSisa saldo Rp 1.250.000\n\nNo. Referensi: GP20261120ABC123\n`;
  it("takes the total, not the balance, subtotal or fee", () => {
    const r = extractReceipt(GOPAY, { today: TODAY, ocrConfidence: 94 });
    expect(r).toMatchObject({ amount: 50_000, fee: 2_000, occurred_on: "2026-11-20", merchant: "Fore Coffee", reference: "GP20261120ABC123", payment_method: "gopay", type: "expense" });
    expect(r.confidence).toBeGreaterThan(0.85);
    expect(r.issues).toEqual([]);
  });
  it("handles the utility receipt layout with a separate admin fee", () => {
    const r = extractReceipt(`PLN Token Listrik\nTanggal 18/11/2026\n\nNominal Rp 150.000\n\nBiaya admin Rp 2.500\n\nTotal Bayar Rp 152.500\nID Transaksi 8812345600\nDibayar dengan BCA\n`, { today: TODAY, ocrConfidence: 95 });
    expect(r).toMatchObject({ amount: 152_500, fee: 2_500, occurred_on: "2026-11-18", reference: "8812345600", payment_method: "bca" });
    expect(r.merchant).toBe("PLN Token Listrik");
  });
  it("reads a total whose value is on the next line", () => {
    expect(extractReceipt("Toko Abadi\nTotal\nRp 85.000\n", { today: TODAY }).amount).toBe(85_000);
  });
  it("flags a guessed amount instead of presenting it as certain", () => {
    const r = extractReceipt("Warung Bu Tini\nNasi ayam 25.000\nEs teh 5.000\n", { today: TODAY });
    expect(r.amount).toBe(25_000);
    expect(r.fields.amount).toBeLessThan(0.5);
    expect(r.issues.join()).toContain("ditebak");
    expect(r.confidence).toBeLessThan(0.6);
  });
  it("reports missing fields", () => {
    const r = extractReceipt("blur blur\n", { today: TODAY });
    expect(r.amount).toBeNull();
    expect(r.issues).toContain("Nominal transaksi tidak ditemukan");
    expect(r.issues).toContain("Tanggal tidak terbaca");
  });
  it("ignores dates in the future", () => {
    expect(findDateInText("Tanggal 25/12/2026", TODAY)).toBeNull();
  });
  it("detects incoming money", () => {
    expect(extractReceipt("Dana masuk\nRp 500.000\n", { today: TODAY }).type).toBe("income");
  });
});

describe("text helpers", () => {
  it("normalizes and matches whole phrases", () => {
    expect(normalizeText("KOPI-Kenangan  #12")).toBe("kopi kenangan 12");
    expect(containsPhrase("Beli KOPI Kenangan", "kopi kenangan")).toBe(true);
    expect(containsPhrase("kopikenangan", "kopi")).toBe(false);
  });
});
