import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { LedgerError } from "@/lib/ledger/errors";
import { buildReport, exportRows, resolvePeriod } from "@/lib/reports/reports";
import { toCsv } from "@/lib/reports/csv";
import { buildReportPdf } from "@/lib/reports/pdf";
import { todayWIB } from "@/lib/format";
import { requireSession } from "@/lib/http";
import { exportAllData } from "@/lib/backup/backup";
import { APP_VERSION } from "@/lib/nav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["transactions", "monthly", "categories", "json", "pdf", "all"] as const;

/** Read-only downloads of the same figures the Reports page shows. Everything is generated locally. */
export async function GET(req: Request) {
  const locked = requireSession();
  if (locked) return locked;
  try {
    const u = new URL(req.url);
    const kind = KINDS.find((k) => k === u.searchParams.get("kind"));
    if (!kind) return NextResponse.json({ ok: false, error: "Jenis ekspor tidak dikenal." }, { status: 400 });
    const today = todayWIB();
    if (kind === "all") {
      const body = JSON.stringify(exportAllData(getDb(), { appVersion: APP_VERSION, exportedOn: today }), null, 2);
      return new NextResponse(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="data-lengkap-${today}.json"`, "Cache-Control": "no-store" } });
    }
    const period = resolvePeriod({ preset: u.searchParams.get("preset") ?? undefined, from: u.searchParams.get("from") ?? undefined, to: u.searchParams.get("to") ?? undefined }, today);
    const db = getDb();
    const name = `laporan-${period.from}_${period.to}`;
    const send = (body: BodyInit, type: string, ext: string) => new NextResponse(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}-${kind}.${ext}"`, "Cache-Control": "no-store" } });
    if (kind === "transactions") {
      const rows = exportRows(db, period);
      return send(toCsv(["Tanggal", "Jenis", "Akun", "Kategori", "Deskripsi", "Merchant", "Tag", "Nominal", "Sumber"], rows.map((r) => [r.date, r.kind, r.account, r.category, r.description, r.merchant, r.tags, r.amount, r.source])), "text/csv; charset=utf-8", "csv");
    }
    const report = buildReport(db, period, today);
    if (kind === "monthly") return send(toCsv(["Bulan", "Pemasukan", "Pengeluaran", "Selisih", "Tingkat tabungan (%)"], report.monthly.map((m) => [m.month, m.income, m.expense, m.net, m.savingsRate === null ? "" : Math.round(m.savingsRate * 1000) / 10])), "text/csv; charset=utf-8", "csv");
    if (kind === "categories") return send(toCsv(["Kategori", "Subkategori", "Total", "Porsi dari total pengeluaran (%)"], report.expenseByCategory.flatMap((c) => c.children.map((x) => [c.name, x.name, x.total, report.totals.expense ? Math.round((x.total / report.totals.expense) * 1000) / 10 : 0]))), "text/csv; charset=utf-8", "csv");
    if (kind === "json") return send(JSON.stringify({ meta: { app: "Personal Finance OS", currency: "IDR", timezone: "Asia/Jakarta", generatedOn: today }, report, transactions: exportRows(db, period) }, null, 2), "application/json; charset=utf-8", "json");
    const pdf = await buildReportPdf(report);
    return send(Buffer.from(pdf), "application/pdf", "pdf");
  } catch (e) {
    if (e instanceof LedgerError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    console.error("[export]", e);
    return NextResponse.json({ ok: false, error: "Gagal membuat ekspor." }, { status: 500 });
  }
}
