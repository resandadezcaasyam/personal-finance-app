import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ocrImage, shutdownOcr } from "@/lib/imports/ocr";
import { readPdf, readSpreadsheet, detectKind, renderPdfPages } from "@/lib/imports/files";
import { parseCsv, guessMapping, normalizeRows } from "@/lib/imports/table";
import { extractReceipt } from "@/lib/capture/receipt";

const fx = (n: string) => fs.readFileSync(path.join(process.cwd(), "tests/fixtures", n));
const TODAY = "2026-11-20";
afterAll(async () => { await shutdownOcr(); });

describe("file type detection", () => {
  it("uses content, not only the extension", () => {
    expect(detectKind("x.bin", fx("mutasi_text.pdf"))).toBe("pdf");
    expect(detectKind("m.xlsx", fx("mutasi.xlsx"))).toBe("xlsx");
    expect(detectKind("m.csv", fx("mutasi.csv"))).toBe("csv");
    expect(detectKind("s.png", fx("struk_gopay.png"))).toBe("image");
    expect(detectKind("evil.exe", Buffer.from("MZ...."))).toBeNull();
  });
});

describe("CSV fixture end to end", () => {
  it("parses a semicolon CSV with quoted delimiters into transactions", () => {
    const t = parseCsv(fx("mutasi.csv").toString("utf8"));
    const r = normalizeRows(t, guessMapping(t), TODAY);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.description, x.type, x.amount])).toEqual([["KOPI KENANGAN; QRIS", "expense", 25_000], ["BAYAR LISTRIK PLN", "expense", 150_000], ["GAJI PT MAJU JAYA", "income", 9_500_000]]);
  });
});

describe("XLSX fixture", () => {
  it("reads typed cells and ISO dates (no timezone shift)", async () => {
    const t = await readSpreadsheet(fx("mutasi.xlsx"));
    expect(t[0]).toEqual(["Tanggal", "Keterangan", "Debet", "Kredit"]);
    expect(t[1]).toEqual(["2026-11-15", "KOPI KENANGAN", 25000, null]);
    const r = normalizeRows(t, guessMapping(t), TODAY);
    expect(r.rows.map((x) => [x.occurred_on, x.type, x.amount])).toEqual([["2026-11-15", "expense", 25_000], ["2026-11-17", "income", 9_500_000]]);
  });
});

describe("text PDF fixture", () => {
  it("rebuilds the table from positions and keeps debit/credit separate", async () => {
    const out = await readPdf(fx("mutasi_text.pdf"));
    expect(out.scanned).toBe(false);
    expect(out.mapping).toMatchObject({ date: 0, description: 1, debit: 2, credit: 3, balance: 4 });
    const r = normalizeRows(out.table, out.mapping, TODAY);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.occurred_on, x.type, x.amount, x.description])).toEqual([
      ["2026-11-15", "expense", 25_000, "KOPI KENANGAN QRIS"], ["2026-11-16", "expense", 150_000, "BAYAR LISTRIK PLN TOKEN"],
      ["2026-11-17", "income", 9_500_000, "GAJI PT MAJU JAYA"], ["2026-11-18", "expense", 224_000, "SEABANK ANGSURAN 1"],
    ]);
  }, 30_000);
});

describe("offline OCR", () => {
  it("reads the e-wallet receipt and extracts the right fields", async () => {
    const { text, confidence } = await ocrImage(fx("struk_gopay.png"));
    const r = extractReceipt(text, { today: TODAY, ocrConfidence: confidence });
    expect(r).toMatchObject({ amount: 50_000, occurred_on: "2026-11-20", merchant: "Fore Coffee", reference: "GP20261120ABC123", payment_method: "gopay" });
    expect(r.fee).toBe(2_000);
  }, 60_000);
  it("reads the utility receipt", async () => {
    const { text, confidence } = await ocrImage(fx("struk_listrik.png"));
    expect(extractReceipt(text, { today: TODAY, ocrConfidence: confidence })).toMatchObject({ amount: 152_500, fee: 2_500, occurred_on: "2026-11-18", reference: "8812345600" });
  }, 60_000);
  it("handles several images in a row through one worker", async () => {
    const [a, b] = [await ocrImage(fx("struk_gopay.png")), await ocrImage(fx("struk_listrik.png"))];
    expect(a.text).toContain("Fore Coffee");
    expect(b.text).toContain("PLN");
  }, 60_000);
});

describe("scanned PDF (rendered by PDFium, read by OCR)", () => {
  it("renders pages to PNG", async () => {
    const pages = await renderPdfPages(fx("mutasi_scan.pdf"), 3);
    expect(pages).toHaveLength(1);
    expect(pages[0].subarray(1, 4).toString("latin1")).toBe("PNG");
  }, 30_000);
  it("OCRs the page into transaction rows and flags it as scanned", async () => {
    const out = await readPdf(fx("mutasi_scan.pdf"));
    expect(out.scanned).toBe(true);
    expect(out.note).toContain("OCR");
    const r = normalizeRows(out.table, out.mapping, TODAY);
    // the first row's direction cannot be known from balances alone, so it is reported, not guessed
    expect(r.rows.map((x) => [x.type, x.amount])).toEqual([["expense", 150_000], ["income", 9_500_000]]);
    expect(r.errors).toHaveLength(1);
  }, 90_000);
});
