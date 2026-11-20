import Link from "next/link";
import { CreditCard, AlertTriangle, CalendarDays, Wallet, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { AddDebtButton } from "@/components/debts/debt-form";
import { MonthCalendar, STATUS_LABEL, STATUS_STYLE } from "@/components/commitments/month-calendar";
import { MonthNav } from "@/components/commitments/month-nav";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { getCommitmentsOverview, getMonthAgenda } from "@/lib/obligations";
import { formatDateID, formatIDR, formatMonthID, todayWIB } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DebtSummary } from "@/lib/debts/debts";

export const dynamic = "force-dynamic";

const TABS = [["debts", "Utang"], ["monthly", "Jadwal bulanan"], ["calendar", "Kalender"]] as const;
const STATUS_BADGE = { active: ["Aktif", "brand"], settled: ["Lunas", "neutral"], cancelled: ["Dibatalkan", "loss"] } as const;

function DebtTable({ debts }: { debts: DebtSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-muted">
          <th scope="col" className="px-5 py-2.5 font-medium">Utang</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Sisa kewajiban</th>
          <th scope="col" className="px-5 py-2.5 text-right font-medium">Sisa pokok</th><th scope="col" className="px-5 py-2.5 font-medium">Progres</th>
          <th scope="col" className="px-5 py-2.5 font-medium">Jatuh tempo berikutnya</th><th scope="col" className="px-5 py-2.5 font-medium">Status</th>
        </tr></thead>
        <tbody>
          {debts.map((d) => {
            const [label, tone] = STATUS_BADGE[d.status];
            return (
              <tr key={d.id} className="border-b border-line last:border-0">
                <td className="px-5 py-3"><Link href={`/debts/${d.id}`} className="font-medium text-brand-text hover:underline">{d.provider}</Link>{d.label && <p className="text-xs text-muted">{d.label}</p>}</td>
                <td className="num whitespace-nowrap px-5 py-3 text-right">{formatIDR(d.outstanding)}</td>
                <td className="num whitespace-nowrap px-5 py-3 text-right">{formatIDR(d.remaining_principal)}</td>
                <td className="min-w-36 px-5 py-3"><Progress value={d.total_rows ? (d.paid_rows / d.total_rows) * 100 : 0} label={`Progres ${d.provider}`} /><p className="mt-1 text-xs text-muted">{d.paid_rows} dari {d.total_rows} cicilan</p></td>
                <td className="whitespace-nowrap px-5 py-3">{d.status === "active" && d.next_due_date ? <>{formatDateID(d.next_due_date)}{d.overdue_count > 0 && <div className="mt-0.5"><Badge tone="loss">Terlambat {d.overdue_count} cicilan</Badge></div>}</> : "—"}</td>
                <td className="px-5 py-3"><Badge tone={tone}>{label}</Badge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DebtsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const db = getDb();
  const today = todayWIB();
  const view = TABS.some(([v]) => v === searchParams.view) ? (searchParams.view as string) : "debts";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(searchParams.month ?? "") ? (searchParams.month as string) : today.slice(0, 7);
  const o = getCommitmentsOverview(db, today);
  const accounts = listAccounts(db);
  const current = o.debts.filter((d) => d.status === "active");
  const closed = o.debts.filter((d) => d.status !== "active");
  const agenda = view === "monthly" || view === "calendar" ? getMonthAgenda(db, month, today) : [];
  const stats = [
    { label: "Total sisa kewajiban", icon: Wallet, value: formatIDR(o.totalOutstanding), note: `Sisa pokok ${formatIDR(o.totalRemainingPrincipal)}` },
    { label: "Cicilan bulan ini", icon: CalendarDays, value: formatIDR(o.monthInstallmentTotal), note: `${formatMonthID(o.month)} · terbayar ${formatIDR(o.monthInstallmentPaid)}, sisa ${formatIDR(o.monthInstallmentRemaining)}` },
    { label: "Jatuh tempo 30 hari", icon: CreditCard, value: formatIDR(o.upcomingTotal), note: `${o.upcoming.length} kewajiban, termasuk tagihan` },
    { label: "Terlambat", icon: AlertTriangle, value: formatIDR(o.overdueTotal), note: o.overdue.length ? `${o.overdue.length} kewajiban perlu dibayar` : "Tidak ada yang terlambat", tone: o.overdue.length ? "text-loss" : "" },
  ];

  return (
    <>
      <PageHeader title="Utang & Cicilan" description="Pantau seluruh kewajiban, jadwal cicilan, dan pembayaran. Jadwal bukan pembayaran: saldo baru berubah saat Anda mencatat pembayaran."
        actions={<AddDebtButton accounts={accounts} today={today} />} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, icon: Icon, value, note, tone }) => (
          <Card key={label}><CardBody>
            <div className="flex items-center justify-between text-sm text-muted">{label}<Icon className="h-4 w-4" aria-hidden /></div>
            <p className={`num mt-3 whitespace-nowrap text-xl font-semibold ${tone ?? ""}`}>{value}</p>
            <p className="mt-1 text-xs text-muted">{note}</p>
          </CardBody></Card>
        ))}
      </div>

      {o.totalInstallments > 0 && (
        <div className="mt-4 flex items-center gap-3 text-sm text-muted">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-text" aria-hidden />
          <span className="shrink-0">Penyelesaian cicilan aktif: {o.paidInstallments} dari {o.totalInstallments} ({o.completionPct}%)</span>
          <div className="max-w-xs flex-1"><Progress value={o.completionPct} label="Penyelesaian cicilan" /></div>
        </div>
      )}

      {o.overdue.length > 0 && (
        <Card className="mt-6 border-loss/50">
          <CardHeader><CardTitle className="flex items-center gap-2 text-loss"><AlertTriangle className="h-4 w-4" aria-hidden />Perlu segera dibayar</CardTitle></CardHeader>
          <ul className="divide-y divide-line">
            {o.overdue.map((i, k) => (
              <li key={k}><Link href={i.href} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-sunken">
                <span><span className="font-medium">{i.title}</span> <span className="text-muted">· {i.subtitle} · jatuh tempo {formatDateID(i.date)}</span></span>
                <span className="num shrink-0 text-loss">{i.amount > 0 ? formatIDR(i.amount) : "Nominal belum diketahui"}</span>
              </Link></li>
            ))}
          </ul>
        </Card>
      )}

      <nav aria-label="Tampilan" className="mb-4 mt-8 flex gap-1 border-b border-line">
        {TABS.map(([v, l]) => (
          <Link key={v} href={`/debts?view=${v}${v !== "debts" ? `&month=${month}` : ""}`} aria-current={view === v ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium", view === v ? "border-brand text-brand-text" : "border-transparent text-muted hover:text-ink")}>{l}</Link>
        ))}
      </nav>

      {view === "debts" && (
        <>
          <Card>
            {current.length ? <DebtTable debts={current} /> : (
              <CardBody><EmptyState icon={CreditCard} title="Belum ada utang aktif" description="Tambahkan pinjaman atau cicilan dari ShopeePay, SeaBank, KrediFazz, GoPay Pinjam, atau penyedia lain. Jadwal cicilan dibuat otomatis." /></CardBody>
            )}
          </Card>
          {closed.length > 0 && (
            <details className="mt-6 rounded-card border border-line bg-surface">
              <summary className="cursor-pointer px-5 py-3 text-sm font-medium">Lunas &amp; dibatalkan ({closed.length})</summary>
              <DebtTable debts={closed} />
            </details>
          )}
        </>
      )}

      {view === "monthly" && (
        <>
          <MonthNav month={month} view="monthly" />
          <Card>
            {agenda.length === 0 ? <CardBody><EmptyState icon={CalendarDays} title="Tidak ada kewajiban bulan ini" description="Cicilan dan tagihan yang jatuh tempo pada bulan ini akan tampil di sini." /></CardBody> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-5 py-2.5 font-medium">Tanggal</th><th scope="col" className="px-5 py-2.5 font-medium">Kewajiban</th><th scope="col" className="px-5 py-2.5 font-medium">Status</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Nominal</th></tr></thead>
                <tbody>
                  {agenda.map((it, k) => (
                    <tr key={k} className="border-b border-line last:border-0">
                      <td className="whitespace-nowrap px-5 py-3">{formatDateID(it.date)}</td>
                      <td className="px-5 py-3"><Link href={it.href} className="font-medium hover:underline">{it.title}</Link><p className="text-xs text-muted">{it.subtitle}</p></td>
                      <td className="px-5 py-3"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[it.status].replace("line-through decoration-1", ""))}>{STATUS_LABEL[it.status]}</span></td>
                      <td className="num whitespace-nowrap px-5 py-3 text-right">{it.amount > 0 ? formatIDR(it.amount) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t border-line font-medium"><td colSpan={3} className="px-5 py-3">Total bulan ini</td><td className="num px-5 py-3 text-right">{formatIDR(agenda.reduce((s, i) => s + i.amount, 0))}</td></tr></tfoot>
              </table></div>
            )}
          </Card>
          <p className="mt-2 text-xs text-muted">Baris &ldquo;Proyeksi&rdquo; adalah perkiraan jatuh tempo tagihan berulang, bukan catatan pembayaran.</p>
        </>
      )}

      {view === "calendar" && (
        <>
          <MonthNav month={month} view="calendar" />
          <MonthCalendar month={month} items={agenda} today={today} />
          <ul className="mt-3 flex flex-wrap gap-2 text-xs">
            {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => <li key={s} className={cn("rounded px-2 py-0.5", STATUS_STYLE[s].replace("line-through decoration-1", ""))}>{STATUS_LABEL[s]}</li>)}
          </ul>
        </>
      )}
    </>
  );
}
