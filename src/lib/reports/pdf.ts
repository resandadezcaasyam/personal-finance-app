import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatIDR, formatDateID, formatMonthID } from "../format";
import type { Report } from "./reports";

/** Standard PDF fonts only cover WinAnsi: replace anything else so generation can never fail on a stray character. */
const safe = (s: string) => s.replace(/[\u2212\u2013\u2014]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

/**
 * Offline PDF summary (pdf-lib, pure JavaScript: no network, no browser). Text and simple bars only, so it prints well and
 * every number can be checked against the on-screen report.
 */
export async function buildReportPdf(r: Report): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 48;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const ink = rgb(0.08, 0.12, 0.1), muted = rgb(0.4, 0.45, 0.43), green = rgb(0.06, 0.46, 0.43), red = rgb(0.75, 0.15, 0.2), amber = rgb(0.7, 0.33, 0.04);

  const need = (h: number) => { if (y - h < M + 20) { page = doc.addPage([W, H]); y = H - M; } };
  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = ink) => page.drawText(safe(s), { x, y, size, font: f, color });
  const right = (s: string, xr: number, size = 10, f: PDFFont = font, color = ink) => { const t = safe(s); page.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y, size, font: f, color }); };
  const h2 = (s: string) => { need(34); y -= 10; text(s, M, 13, bold); y -= 6; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: muted }); y -= 14; };
  const table = (cols: { title: string; w: number; align?: "right" }[], rows: string[][], opts: { colorLast?: boolean } = {}) => {
    need(20);
    let x = M;
    cols.forEach((c) => { c.align === "right" ? right(c.title, x + c.w, 8.5, bold, muted) : text(c.title, x, 8.5, bold, muted); x += c.w + 8; });
    y -= 13;
    for (const row of rows) {
      need(14);
      x = M;
      row.forEach((cell, i) => {
        const c = cols[i];
        const neg = opts.colorLast && i === row.length - 1 && cell.startsWith("-");
        c.align === "right" ? right(cell, x + c.w, 9, font, neg ? red : ink) : text(cell.length > 46 ? `${cell.slice(0, 45)}.` : cell, x, 9);
        x += c.w + 8;
      });
      y -= 13;
    }
    y -= 4;
  };
  const money = (n: number) => formatIDR(n);

  text("Laporan Keuangan", M, 20, bold); y -= 20;
  text(`${formatDateID(r.period.from)} sampai ${formatDateID(r.period.to)}`, M, 11, font, muted); y -= 14;
  text(`Dibuat ${formatDateID(r.generatedOn)}. Seluruh data berasal dari komputer ini (Personal Finance OS).`, M, 8.5, font, muted); y -= 8;

  h2("Ringkasan");
  const t = r.totals;
  const kv = (k: string, v: string, color = ink) => { need(16); text(k, M, 10, font, muted); right(v, W - M, 11, bold, color); y -= 16; };
  kv("Pemasukan", money(t.income), green); kv("Pengeluaran", money(t.expense)); kv("Selisih (pemasukan - pengeluaran)", money(t.net), t.net < 0 ? red : green);
  kv("Tingkat tabungan", t.savingsRate === null ? "-" : `${Math.round(t.savingsRate * 100)}%`); kv("Jumlah transaksi", String(t.transactions));

  h2("Pemasukan vs pengeluaran per bulan");
  const max = Math.max(1, ...r.monthly.flatMap((m) => [m.income, m.expense]));
  const barW = W - 2 * M - 150;
  for (const m of r.monthly) {
    need(26);
    text(formatMonthID(m.month), M, 9);
    page.drawRectangle({ x: M + 110, y: y - 1, width: Math.max(1, (m.income / max) * barW), height: 7, color: green });
    right(money(m.income), W - M, 8.5); y -= 10;
    page.drawRectangle({ x: M + 110, y: y - 1, width: Math.max(1, (m.expense / max) * barW), height: 7, color: amber });
    right(money(m.expense), W - M, 8.5); y -= 13;
  }
  y -= 2;
  table([{ title: "Bulan", w: 90 }, { title: "Pemasukan", w: 100, align: "right" }, { title: "Pengeluaran", w: 100, align: "right" }, { title: "Selisih", w: 100, align: "right" }, { title: "Tabungan", w: 50, align: "right" }],
    r.monthly.map((m) => [formatMonthID(m.month), money(m.income), money(m.expense), money(m.net), m.savingsRate === null ? "-" : `${Math.round(m.savingsRate * 100)}%`]), { colorLast: false });

  h2("Pengeluaran per kategori");
  table([{ title: "Kategori", w: 250 }, { title: "Total", w: 110, align: "right" }, { title: "Porsi", w: 60, align: "right" }], r.expenseByCategory.map((c) => [c.name, money(c.total), `${Math.round(c.pct * 100)}%`]));

  if (r.incomeByCategory.length) { h2("Pemasukan per kategori"); table([{ title: "Kategori", w: 250 }, { title: "Total", w: 110, align: "right" }], r.incomeByCategory.map((c) => [c.name, money(c.total)])); }

  h2("Pengurangan utang");
  kv("Dibayar pada periode ini", money(r.debt.paidInPeriod)); kv("Biaya & denda", money(r.debt.extraInPeriod)); kv("Sisa utang sekarang", money(r.debt.outstandingNow));
  table([{ title: "Bulan", w: 100 }, { title: "Dibayar", w: 110, align: "right" }, { title: "Sisa utang akhir bulan", w: 140, align: "right" }], r.debt.months.map((m) => [formatMonthID(m.month), money(m.paid), money(m.outstandingEnd)]));

  if (r.budgets.length) { h2("Anggaran vs aktual"); table([{ title: "Bulan", w: 100 }, { title: "Anggaran", w: 110, align: "right" }, { title: "Aktual (kategori beranggaran)", w: 150, align: "right" }, { title: "Terlampaui", w: 60, align: "right" }], r.budgets.map((b) => [formatMonthID(b.month), money(b.budget), money(b.actual), `${b.over} kategori`])); }

  h2("Kondisi keuangan akhir bulan");
  table([{ title: "Bulan", w: 100 }, { title: "Kas", w: 110, align: "right" }, { title: "Sisa utang", w: 110, align: "right" }, { title: "Kas - utang", w: 110, align: "right" }], r.performance.map((p) => [formatMonthID(p.month), money(p.cash), money(p.debt), money(p.net)]), { colorLast: true });

  doc.getPages().forEach((p, i, all) => { p.drawText(safe(`Halaman ${i + 1} dari ${all.length}`), { x: W / 2 - 30, y: 24, size: 8, font, color: muted }); });
  doc.setTitle("Laporan Keuangan"); doc.setCreator("Personal Finance OS");
  return doc.save();
}
