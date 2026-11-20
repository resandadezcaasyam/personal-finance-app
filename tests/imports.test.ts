import { describe, it, expect } from "vitest";
import { parseCsv, detectDelimiter, parseAmountCell, parseDateCell, guessMapping, normalizeRows, headerSignature, type Mapping } from "@/lib/imports/table";

const TODAY = "2026-11-20";

describe("CSV parsing", () => {
  it("handles quotes, embedded delimiters, escaped quotes and BOM", () => {
    const t = parseCsv('\uFEFFTanggal,Keterangan,Jumlah\n15/11/2026,"KOPI, ""KENANGAN""",25.000\n');
    expect(t).toEqual([["Tanggal", "Keterangan", "Jumlah"], ["15/11/2026", 'KOPI, "KENANGAN"', "25.000"]]);
  });
  it("detects semicolon, tab and pipe delimiters", () => {
    expect(detectDelimiter("a;b;c\n1;2;3\n")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("\t");
    expect(detectDelimiter("a|b|c\n1|2|3\n")).toBe("|");
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",");
  });
  it("keeps quoted newlines inside a cell and ignores blank lines", () => {
    expect(parseCsv('a,b\n"x\ny",2\n\n3,4\n')).toEqual([["a", "b"], ["x\ny", "2"], ["3", "4"]]);
  });
});

describe("amount cells", () => {
  it.each([
    ["1.250.000,50", 1_250_000.5], ["1,250,000.50", 1_250_000.5], ["25.000", 25_000], ["25,000", 25_000], ["25.50", 25.5], ["Rp 30.000", 30_000],
    ["(25.000)", -25_000], ["-25.000", -25_000], ["25.000-", -25_000], ["+9.500.000,00", 9_500_000],
  ])("%s", (i, v) => expect(parseAmountCell(i)?.value).toBe(v));
  it("reads DB/CR suffixes", () => {
    expect(parseAmountCell("25.000,00 DB")).toEqual({ value: 25_000, dc: "D" });
    expect(parseAmountCell("9.500.000,00 CR")).toEqual({ value: 9_500_000, dc: "C" });
    expect(parseAmountCell("150.000 K")).toEqual({ value: 150_000, dc: "C" });
  });
  it("honours an explicit number format", () => {
    expect(parseAmountCell("1,5", "id")?.value).toBe(1.5);
    expect(parseAmountCell("1.234", "en")?.value).toBe(1.234);
  });
  it("returns null for text and blanks; passes XLSX numbers through", () => {
    expect(parseAmountCell("abc")).toBeNull();
    expect(parseAmountCell("")).toBeNull();
    expect(parseAmountCell(null)).toBeNull();
    expect(parseAmountCell(25000)?.value).toBe(25_000);
  });
});

describe("date cells", () => {
  it.each([
    ["15/11/2026", "2026-11-15"], ["15-11-2026", "2026-11-15"], ["15.11.26", "2026-11-15"], ["2026-11-15", "2026-11-15"], ["2026/11/15", "2026-11-15"],
    ["15 Nov 2026", "2026-11-15"], ["15-Nov-26", "2026-11-15"], ["15 November 2026", "2026-11-15"], ["15/11/2026 09:41:07", "2026-11-15"], ["2026-11-15T09:41:00", "2026-11-15"],
  ])("%s", (i, v) => expect(parseDateCell(i)).toBe(v));
  it("prefers day-first, falls back when the day cannot be a month, and respects mdy", () => {
    expect(parseDateCell("03/04/2026")).toBe("2026-04-03");
    expect(parseDateCell("04/13/2026")).toBe("2026-04-13");
    expect(parseDateCell("03/04/2026", "mdy")).toBe("2026-03-04");
  });
  it("converts Excel serials and rejects invalid dates", () => {
    expect(parseDateCell(46341)).toBe("2026-11-15");
    expect(parseDateCell("31/02/2026")).toBeNull();
    expect(parseDateCell("besok")).toBeNull();
  });
});

describe("mapping detection", () => {
  it("finds the header row after a preamble and maps Indonesian column names", () => {
    const t = [["Rekening Tahapan"], ["Periode: November 2026"], ["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"], ["15/11/2026", "KOPI", "25.000,00", "", "4.975.000,00"]];
    const m = guessMapping(t);
    expect(m).toMatchObject({ header_row: 2, date: 0, description: 1, debit: 2, credit: 3, balance: 4 });
  });
  it("maps single-amount layouts and English headers", () => {
    expect(guessMapping([["Date", "Description", "Amount", "Reference"]])).toMatchObject({ header_row: 0, date: 0, description: 1, amount: 2, reference: 3 });
  });
  it("reports no header when none is recognisable", () => {
    expect(guessMapping([["a", "b"], ["1", "2"]]).header_row).toBe(-1);
  });
  it("produces a stable header signature for saved templates", () => {
    const t = [["Tanggal", "Keterangan", "Debet"]];
    expect(headerSignature(t, guessMapping(t))).toBe("tanggal|keterangan|debet");
  });
});

describe("normalizing rows", () => {
  const split: Mapping = { header_row: 0, date: 0, description: 1, debit: 2, credit: 3, amount: null, dc: null, reference: null, balance: 4, date_format: "auto", number_format: "auto", positive_is: null };
  it("maps debit/credit columns to expense/income and skips non-transaction lines", () => {
    const t = [
      ["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"],
      ["", "SALDO AWAL", "", "", "5.000.000,00"],
      ["15/11/2026", "KOPI KENANGAN", "25.000,00", "", "4.975.000,00"],
      ["17/11/2026", "GAJI", "", "9.500.000,00", "14.475.000,00"],
      ["", "TOTAL", "", "", ""],
    ];
    const r = normalizeRows(t, split, TODAY);
    expect(r.rows.map((x) => [x.occurred_on, x.type, x.amount, x.description])).toEqual([["2026-11-15", "expense", 25_000, "KOPI KENANGAN"], ["2026-11-17", "income", 9_500_000, "GAJI"]]);
    expect(r.rows[0].row_no).toBe(3);
    expect(r.skipped).toBe(2);
    expect(r.errors).toEqual([]);
  });
  it("reports broken rows with their original row number instead of guessing", () => {
    const t = [
      ["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"],
      ["bukan tanggal", "X", "1.000", "", ""],
      ["15/11/2026", "TANPA NOMINAL", "", "", ""],
      ["15/11/2026", "DUA KOLOM", "1.000", "2.000", ""],
      ["25/12/2026", "MASA DEPAN", "1.000", "", ""],
      ["16/11/2026", "OK", "1.000", "", ""],
    ];
    const r = normalizeRows(t, split, TODAY);
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.row_no)).toEqual([2, 3, 4, 5]);
    expect(r.errors[0].reason).toContain("Tanggal tidak terbaca");
    expect(r.errors[3].reason).toContain("masa depan");
  });
  it("single signed amount column: negative is expense, positive needs an explicit choice", () => {
    const m: Mapping = { ...split, debit: null, credit: null, amount: 2, balance: null };
    const t = [["Tanggal", "Keterangan", "Jumlah"], ["15/11/2026", "A", "-25.000"], ["16/11/2026", "B", "50.000"]];
    const r = normalizeRows(t, m, TODAY);
    expect(r.rows.map((x) => x.type)).toEqual(["expense"]);
    expect(r.errors[0].reason).toContain("nominal positif");
    const r2 = normalizeRows(t, { ...m, positive_is: "income" }, TODAY);
    expect(r2.rows.map((x) => x.type)).toEqual(["expense", "income"]);
  });
  it("uses a D/C column or a DB/CR suffix", () => {
    const m: Mapping = { ...split, debit: null, credit: null, amount: 2, dc: 3, balance: null };
    const t = [["Tanggal", "Keterangan", "Jumlah", "D/K"], ["15/11/2026", "A", "25.000", "D"], ["16/11/2026", "B", "50.000", "K"], ["17/11/2026", "C", "10.000 DB", ""]];
    expect(normalizeRows(t, m, TODAY).rows.map((x) => x.type)).toEqual(["expense", "income", "expense"]);
  });
  it("infers direction from the running balance when nothing else says, and refuses when it cannot", () => {
    const m: Mapping = { ...split, debit: null, credit: null, amount: 2, balance: 3 };
    const t = [
      ["Tanggal", "Keterangan", "Jumlah", "Saldo"],
      ["15/11/2026", "pertama", "25.000", "4.975.000"],
      ["16/11/2026", "kedua keluar", "100.000", "4.875.000"],
      ["17/11/2026", "ketiga masuk", "9.500.000", "14.375.000"],
      ["18/11/2026", "tidak cocok", "1.000", "99.000"],
    ];
    const r = normalizeRows(t, m, TODAY);
    expect(r.rows.map((x) => [x.description, x.type])).toEqual([["kedua keluar", "expense"], ["ketiga masuk", "income"]]);
    expect(r.errors.map((e) => e.row_no)).toEqual([2, 5]);
  });
  it("accepts XLSX numeric cells and Excel date serials, rounds decimals", () => {
    const t = [["Tanggal", "Keterangan", "Debet", "Kredit"], [46341, "KOPI", 25000.4, null], [46342, "GAJI", null, 9500000]];
    const r = normalizeRows(t, { ...split, balance: null }, TODAY);
    expect(r.rows.map((x) => [x.occurred_on, x.amount, x.type])).toEqual([["2026-11-15", 25_000, "expense"], ["2026-11-16", 9_500_000, "income"]]);
  });
  it("captures references and ignores them when blank", () => {
    const m: Mapping = { ...split, reference: 4, balance: null };
    const t = [["Tanggal", "Keterangan", "Debet", "Kredit", "Ref"], ["15/11/2026", "A", "1.000", "", "TRX001"], ["16/11/2026", "B", "2.000", "", ""]];
    expect(normalizeRows(t, m, TODAY).rows.map((x) => x.reference)).toEqual(["TRX001", null]);
  });
});
