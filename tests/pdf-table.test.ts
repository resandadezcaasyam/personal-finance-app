import { describe, it, expect } from "vitest";
import { itemsToLines, linesToTable, textLinesToTable, guessTextTableMapping, type TextItem } from "@/lib/imports/pdf-table";
import { normalizeRows, guessMapping } from "@/lib/imports/table";

const it_ = (str: string, x: number, y: number, w = str.length * 5): TextItem => ({ str, x, y, w, h: 10 });

describe("positional PDF text to table", () => {
  const page: TextItem[] = [
    it_("REKENING TAHAPAN 1234567890", 40, 800, 150),
    it_("Tanggal", 40, 770), it_(" ", 75, 770, 4), it_("Keterangan", 120, 770), it_("Debet", 330, 770), it_("Kredit", 410, 770), it_("Saldo", 490, 770),
    it_("15/11/2026", 40, 752), it_("KOPI", 120, 752), it_(" ", 140, 752, 3), it_("KENANGAN", 143, 752), it_("25.000,00", 330, 752), it_("4.975.000,00", 490, 752),
    it_("17/11/2026", 40, 734), it_("GAJI PT MAJU", 120, 734, 70), it_("9.500.000,00", 410, 734), it_("14.475.000,00", 490, 734),
    it_("JAYA TBK", 120, 722), // continuation line
  ];
  it("keeps debit and credit apart even though the text layer drops empty cells", () => {
    const { table, hasHeader } = linesToTable([itemsToLines(page)]);
    expect(hasHeader).toBe(true);
    expect(table[0]).toEqual(["Tanggal", "Keterangan", "Debet", "Kredit", "Saldo"]);
    expect(table[1]).toEqual(["15/11/2026", "KOPI KENANGAN", "25.000,00", "", "4.975.000,00"]);
    expect(table[2][1]).toBe("GAJI PT MAJU JAYA TBK");
    expect(table[2][2]).toBe("");
    expect(table[2][3]).toBe("9.500.000,00");
    const r = normalizeRows(table, guessMapping(table), "2026-11-20");
    expect(r.rows.map((x) => [x.type, x.amount])).toEqual([["expense", 25_000], ["income", 9_500_000]]);
  });
  it("assigns right-aligned numbers under wider headers to the right column", () => {
    const p: TextItem[] = [
      it_("Tanggal", 40, 770), it_("Keterangan", 120, 770), it_("Debet", 330, 770, 60), it_("Kredit", 420, 770, 60), it_("Saldo", 520, 770, 60),
      it_("15/11/2026", 40, 752), it_("X", 120, 752), it_("5.000,00", 352, 752, 40), // right edge aligned with the header's right edge
      it_("1.000.000,00", 508, 752, 72),
    ];
    const { table } = linesToTable([itemsToLines(p)]);
    expect(table[1]).toEqual(["15/11/2026", "X", "5.000,00", "", "1.000.000,00"]);
  });
  it("drops repeated headers on later pages", () => {
    const hdr = (y: number) => [it_("Tanggal", 40, y), it_("Keterangan", 120, y), it_("Debet", 330, y), it_("Kredit", 410, y)];
    const p1 = [...hdr(770), it_("15/11/2026", 40, 752), it_("A", 120, 752), it_("1.000,00", 330, 752)];
    const p2 = [...hdr(770), it_("16/11/2026", 40, 752), it_("B", 120, 752), it_("2.000,00", 330, 752)];
    const { table } = linesToTable([itemsToLines(p1), itemsToLines(p2)]);
    expect(table.map((r) => r[1])).toEqual(["Keterangan", "A", "B"]);
  });
  it("reports no header when there are no recognisable columns", () => {
    const { hasHeader, table } = linesToTable([itemsToLines([it_("hello", 10, 10), it_("world", 100, 10)])]);
    expect(hasHeader).toBe(false);
    expect(table[0]).toEqual(["hello", "world"]);
  });
});

describe("text-line fallback (scanned pages)", () => {
  const lines = ["MUTASI REKENING", "15/11/2026 KOPI KENANGAN QRIS 25.000,00 4.975.000,00", "16/11/2026 BAYAR LISTRIK PLN", "TOKEN 123456 150.000,00 4.825.000,00", "17/11/2026 GAJI PT MAJU JAYA 9.500.000,00 14.325.000,00"];
  it("builds [date, description, numbers] rows and continues wrapped descriptions", () => {
    const t = textLinesToTable(lines);
    expect(t[0].slice(0, 4)).toEqual(["15/11/2026", "KOPI KENANGAN QRIS", "25.000,00", "4.975.000,00"]);
    expect(t[1][1]).toBe("BAYAR LISTRIK PLN");
    expect(t[2][1]).toBe("GAJI PT MAJU JAYA");
  });
  it("maps amount + balance and infers direction from the balance", () => {
    const t = textLinesToTable(["15/11/2026 KOPI 25.000,00 4.975.000,00", "16/11/2026 BAYAR 150.000,00 4.825.000,00", "17/11/2026 GAJI 9.500.000,00 14.325.000,00"]);
    const m = guessTextTableMapping(t);
    expect(m).toMatchObject({ date: 0, description: 1, amount: 2, balance: 3 });
    const r = normalizeRows(t, m, "2026-11-20");
    // the first row has no previous balance, so its direction is reported instead of guessed
    expect(r.errors.map((e) => e.row_no)).toEqual([1]);
    expect(r.rows.map((x) => [x.type, x.amount])).toEqual([["expense", 150_000], ["income", 9_500_000]]);
  });
});
