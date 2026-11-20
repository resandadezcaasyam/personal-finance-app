import Link from "next/link";
import { Download, FileText, ArrowDownLeft, ArrowUpRight, Scale, PiggyBank } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/form-field";
import { IncomeExpenseChart, PerformanceChart } from "@/components/reports/report-charts";
import { getDb } from "@/lib/db/client";
import { PRESET_LABEL, buildReport, resolvePeriod, type Preset } from "@/lib/reports/reports";
import { LedgerError } from "@/lib/ledger/errors";
import { formatDateID, formatIDR, formatMonthID, todayWIB } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const PRESETS: Preset[] = ["this_month", "last_month", "3m", "6m", "12m", "ytd"];
const pctText = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

export default function ReportsPage({ searchParams: sp }: { searchParams: Record<string, string | undefined> }) {
  const today = todayWIB();
  let period;
  let error: string | null = null;
  try { period = resolvePeriod(sp, today); } catch (e) { error = e instanceof LedgerError ? e.message : "Periode tidak valid."; period = resolvePeriod({ preset: "6m" }, today); }
  const r = buildReport(getDb(), period, today);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ preset: period.preset, ...(period.preset === "custom" ? { from: period.from, to: period.to } : {}), ...extra }).toString();
  const exp = (kind: string, label: string) => <a key={kind} href={`/api/export?${qs({ kind })}`} download className={buttonClass("secondary", "sm")}><Download className="h-4 w-4" aria-hidden />{label}</a>;
  const empty = r.totals.transactions === 0;

  return (
    <>
      <PageHeader title="Laporan & Analitik" description="Pemasukan dan pengeluaran, kategori, pengurangan utang, anggaran, dan kondisi keuangan dari waktu ke waktu. Semua angka berasal dari catatan Anda dan cocok dengan buku besar." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Periode" className="flex flex-wrap gap-0.5 rounded-xl bg-sunken p-1">
          {PRESETS.map((p) => <Link key={p} href={`/reports?preset=${p}`} aria-current={period.preset === p ? "page" : undefined} className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors", period.preset === p ? "bg-surface text-brand-text shadow-card" : "text-muted hover:text-ink")}>{PRESET_LABEL[p]}</Link>)}
        </nav>
        <form method="get" action="/reports" className="flex flex-wrap items-end gap-2 text-sm">
          <input type="hidden" name="preset" value="custom" />
          <label className="space-y-1 text-xs text-muted">Dari<Input type="date" name="from" defaultValue={period.from} max={today} className="h-9 w-40 text-sm text-ink" /></label>
          <label className="space-y-1 text-xs text-muted">Sampai<Input type="date" name="to" defaultValue={period.to} max={today} className="h-9 w-40 text-sm text-ink" /></label>
          <Button type="submit" size="sm" variant="secondary">Terapkan</Button>
        </form>
      </div>
      <p className="mb-5 text-sm text-muted">Periode: <strong>{formatDateID(period.from)}</strong> sampai <strong>{formatDateID(period.to)}</strong> ({period.months.length} bulan).</p>
      {error && <p role="alert" className="mb-4 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error} Menampilkan 6 bulan terakhir.</p>}

      <div className="mb-8 flex flex-wrap items-center gap-2"><span className="flex items-center gap-1.5 text-sm font-medium"><FileText className="h-4 w-4" aria-hidden />Ekspor (dibuat di komputer ini):</span>{exp("pdf", "PDF")}{exp("json", "JSON")}{exp("transactions", "CSV transaksi")}{exp("monthly", "CSV ringkasan bulanan")}{exp("categories", "CSV kategori")}</div>

      {empty ? (
        <Card><CardBody><EmptyState icon={FileText} title="Belum ada transaksi pada periode ini" description="Catat pemasukan dan pengeluaran, atau pilih periode yang lebih panjang." /></CardBody></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard emphasis label="Pemasukan" icon={ArrowDownLeft} value={formatIDR(r.totals.income)} caption={`${period.months.length} bulan · ${r.totals.transactions} transaksi`} />
            <KpiCard label="Pengeluaran" icon={ArrowUpRight} value={formatIDR(r.totals.expense)} caption="Termasuk cicilan, tagihan, dan biaya transfer" />
            <KpiCard label="Selisih" icon={Scale} value={formatIDR(r.totals.net)} negative={r.totals.net < 0} caption="Pemasukan − pengeluaran" status={{ label: r.totals.net > 0 ? "Surplus" : r.totals.net < 0 ? "Defisit" : "Impas", good: r.totals.net > 0 ? true : r.totals.net < 0 ? false : null }} />
            <KpiCard label="Tingkat tabungan" icon={PiggyBank} value={pctText(r.totals.savingsRate)} empty={r.totals.savingsRate === null} caption="Selisih ÷ pemasukan" />
          </div>

          <section aria-labelledby="h-trend" className="mt-8">
            <Card><CardHeader><CardTitle><span id="h-trend">Pemasukan vs pengeluaran</span></CardTitle><Badge>{r.totals.transactions} transaksi</Badge></CardHeader><CardBody><IncomeExpenseChart data={r.monthly} /></CardBody></Card>
            <div className="mt-3 overflow-x-auto rounded-card border border-line bg-surface">
              <table className="w-full text-sm">
                <caption className="sr-only">Ringkasan bulanan</caption>
                <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2.5 font-medium">Bulan</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Pemasukan</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Pengeluaran</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Selisih (tabungan)</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Tingkat tabungan</th></tr></thead>
                <tbody>{r.monthly.map((m) => <tr key={m.month} className="border-b border-line last:border-0"><td className="px-4 py-2.5 font-medium">{formatMonthID(m.month)}</td><td className="num px-4 py-2.5 text-right text-gain">{formatIDR(m.income)}</td><td className="num px-4 py-2.5 text-right">{formatIDR(m.expense)}</td><td className={cn("num px-4 py-2.5 text-right", m.net < 0 && "text-loss")}>{formatIDR(m.net)}</td><td className="num px-4 py-2.5 text-right">{pctText(m.savingsRate)}</td></tr>)}</tbody>
                <tfoot><tr className="border-t border-line font-medium"><td className="px-4 py-2.5">Total</td><td className="num px-4 py-2.5 text-right">{formatIDR(r.totals.income)}</td><td className="num px-4 py-2.5 text-right">{formatIDR(r.totals.expense)}</td><td className="num px-4 py-2.5 text-right">{formatIDR(r.totals.net)}</td><td className="num px-4 py-2.5 text-right">{pctText(r.totals.savingsRate)}</td></tr></tfoot>
              </table>
            </div>
          </section>

          <section aria-labelledby="h-cat" className="mt-8 grid gap-6 lg:grid-cols-2">
            <div>
              <h2 id="h-cat" className="mb-2 text-lg font-semibold tracking-tight">Pengeluaran per kategori</h2>
              <div className="rounded-card border border-line bg-surface">
                {r.expenseByCategory.length === 0 ? <p className="p-5 text-sm text-muted">Tidak ada pengeluaran.</p> : (
                  <ul className="divide-y divide-line text-sm">
                    {r.expenseByCategory.map((c) => (
                      <li key={c.name} className="px-5 py-3">
                        <div className="flex items-center justify-between gap-3"><span className="font-medium">{c.name}</span><span className="num">{formatIDR(c.total)} <span className="text-muted">· {pctText(c.pct)}</span></span></div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Math.round(c.pct * 100))}%` }} /></div>
                        {c.children.length > 1 && <ul className="mt-2 space-y-0.5 text-xs text-muted">{c.children.map((x) => <li key={x.name} className="flex justify-between"><span>{x.name}</span><span className="num">{formatIDR(x.total)}</span></li>)}</ul>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div>
              <h2 className="mb-2 text-lg font-semibold tracking-tight">Pemasukan per kategori</h2>
              <div className="rounded-card border border-line bg-surface">
                {r.incomeByCategory.length === 0 ? <p className="p-5 text-sm text-muted">Tidak ada pemasukan.</p> : <ul className="divide-y divide-line text-sm">{r.incomeByCategory.map((c) => <li key={c.name} className="flex justify-between px-5 py-3"><span className="font-medium">{c.name}</span><span className="num text-gain">{formatIDR(c.total)}</span></li>)}</ul>}
              </div>
            </div>
          </section>

          <section aria-labelledby="h-debt" className="mt-8">
            <h2 id="h-debt" className="mb-2 text-lg font-semibold tracking-tight">Pengurangan utang</h2>
            <div className="mb-3 grid gap-4 sm:grid-cols-3">
              <Card><CardBody><p className="text-sm text-muted">Dibayar pada periode ini</p><p className="num mt-2 text-xl font-semibold">{formatIDR(r.debt.paidInPeriod)}</p></CardBody></Card>
              <Card><CardBody><p className="text-sm text-muted">Biaya & denda</p><p className="num mt-2 text-xl font-semibold">{formatIDR(r.debt.extraInPeriod)}</p></CardBody></Card>
              <Card><CardBody><p className="text-sm text-muted">Sisa utang sekarang</p><p className="num mt-2 text-xl font-semibold">{formatIDR(r.debt.outstandingNow)}</p></CardBody></Card>
            </div>
            <div className="overflow-x-auto rounded-card border border-line bg-surface"><table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2.5 font-medium">Bulan</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Dibayar</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Biaya & denda</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Sisa utang akhir bulan</th></tr></thead>
              <tbody>{r.debt.months.map((m) => <tr key={m.month} className="border-b border-line last:border-0"><td className="px-4 py-2.5 font-medium">{formatMonthID(m.month)}</td><td className="num px-4 py-2.5 text-right">{formatIDR(m.paid)}</td><td className="num px-4 py-2.5 text-right">{formatIDR(m.extra)}</td><td className="num px-4 py-2.5 text-right">{formatIDR(m.outstandingEnd)}</td></tr>)}</tbody>
            </table></div>
          </section>

          <section aria-labelledby="h-budget" className="mt-8">
            <h2 id="h-budget" className="mb-2 text-lg font-semibold tracking-tight">Anggaran vs aktual</h2>
            {r.budgets.length === 0 ? <p className="rounded-card border border-line bg-surface p-5 text-sm text-muted">Belum ada anggaran pada bulan-bulan ini. Atur di halaman <Link href="/expenses" className="underline">Pengeluaran</Link>.</p> : (
              <div className="overflow-x-auto rounded-card border border-line bg-surface"><table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2.5 font-medium">Bulan</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Anggaran</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Aktual (kategori beranggaran)</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Selisih</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Kategori terlampaui</th></tr></thead>
                <tbody>{r.budgets.map((b) => <tr key={b.month} className="border-b border-line last:border-0"><td className="px-4 py-2.5 font-medium">{formatMonthID(b.month)}</td><td className="num px-4 py-2.5 text-right">{formatIDR(b.budget)}</td><td className="num px-4 py-2.5 text-right">{formatIDR(b.actual)}</td><td className={cn("num px-4 py-2.5 text-right", b.budget - b.actual < 0 ? "text-loss" : "text-gain")}>{formatIDR(b.budget - b.actual)}</td><td className="num px-4 py-2.5 text-right">{b.over}</td></tr>)}</tbody>
              </table></div>
            )}
          </section>

          <section aria-labelledby="h-perf" className="mt-8">
            <Card><CardHeader><CardTitle><span id="h-perf">Kondisi keuangan dari waktu ke waktu</span></CardTitle></CardHeader><CardBody><PerformanceChart data={r.performance} /></CardBody></Card>
            <div className="mt-3 overflow-x-auto rounded-card border border-line bg-surface"><table className="w-full text-sm">
              <caption className="sr-only">Kas dan utang di akhir tiap bulan</caption>
              <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2.5 font-medium">Akhir bulan</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Kas</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Sisa utang</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Kas − utang</th></tr></thead>
              <tbody>{r.performance.map((p) => <tr key={p.month} className="border-b border-line last:border-0"><td className="px-4 py-2.5 font-medium">{formatMonthID(p.month)}</td><td className="num px-4 py-2.5 text-right">{formatIDR(p.cash)}</td><td className="num px-4 py-2.5 text-right">{formatIDR(p.debt)}</td><td className={cn("num px-4 py-2.5 text-right font-medium", p.net < 0 && "text-loss")}>{formatIDR(p.net)}</td></tr>)}</tbody>
            </table></div>
            <p className="mt-2 text-xs text-muted">Kas adalah total akun yang aktif sekarang, dihitung ulang dari catatan untuk tiap akhir bulan. Sisa utang memakai jadwal dan pembayaran yang tercatat.</p>
          </section>
        </>
      )}
    </>
  );
}
