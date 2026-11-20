import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardCheck, ListChecks, Inbox as InboxIcon, CalendarClock, Scale } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { MarkReviewed } from "@/components/actions/mark-reviewed";
import { getDb } from "@/lib/db/client";
import { loadActions, loadDailyReview } from "@/lib/actions/data";
import type { Severity } from "@/lib/actions/engine";
import { formatDateID, formatIDR, todayWIB } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SEV: Record<Severity, { label: string; tone: "loss" | "warn" | "neutral" | "brand"; bar: string }> = {
  critical: { label: "Segera", tone: "loss", bar: "border-l-loss" }, high: { label: "Penting", tone: "loss", bar: "border-l-loss/70" },
  medium: { label: "Perlu perhatian", tone: "warn", bar: "border-l-warn" }, low: { label: "Bisa menunggu", tone: "neutral", bar: "border-l-line" },
};

export default function NextActionsPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const db = getDb();
  const today = todayWIB();
  const view = searchParams.view === "review" ? "review" : "next";
  const actions = loadActions(db, today);
  const review = loadDailyReview(db, today);
  const tab = (v: string, label: string) => <Link key={v} href={`/next-actions?view=${v}`} aria-current={view === v ? "page" : undefined} className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium", view === v ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")}>{label}</Link>;

  return (
    <>
      <PageHeader title="Langkah Keuangan Berikutnya" description="Daftar yang diurutkan dari data Anda sendiri, lengkap dengan alasan tiap langkah. Aplikasi hanya menyarankan; tidak ada yang diubah otomatis." />
      <nav aria-label="Tampilan" className="mb-5 flex gap-1 border-b border-line">{tab("next", `Langkah berikutnya${actions.length ? ` (${actions.length})` : ""}`)}{tab("review", "Tinjauan harian")}</nav>

      {view === "next" && (
        actions.length === 0 ? (
          <Card><CardBody><EmptyState icon={CheckCircle2} title="Tidak ada yang mendesak" description="Tidak ada pembayaran terlambat, kekurangan kas yang diproyeksikan, anggaran terlampaui, pemasukan yang belum dikonfirmasi, atau impor yang menunggu. Daftar ini diperbarui dari data terbaru tiap kali halaman dibuka." /></CardBody></Card>
        ) : (
          <ol className="space-y-3" aria-label="Langkah berikutnya, urut prioritas">
            {actions.map((a, i) => (
              <li key={a.id} className={cn("rounded-card border border-l-4 border-line bg-surface p-4", SEV[a.severity].bar)}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium"><span className="text-xs text-muted">{i + 1}.</span>{a.title}<Badge tone={SEV[a.severity].tone}>{SEV[a.severity].label}</Badge></p>
                    <p className="mt-1.5 max-w-prose text-sm"><span className="font-medium text-muted">Mengapa: </span>{a.why}</p>
                  </div>
                  <Link href={a.href} className="inline-flex h-9 shrink-0 items-center rounded-md border border-line px-3 text-sm font-medium hover:bg-sunken">{a.cta}</Link>
                </div>
              </li>
            ))}
          </ol>
        )
      )}

      {view === "review" && (
        <div className="space-y-6">
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-medium"><ClipboardCheck className="h-4 w-4" aria-hidden />Tinjauan terakhir: {review.lastReviewOn ? `${formatDateID(review.lastReviewOn)}${review.daysSince === 0 ? " (hari ini)" : ` (${review.daysSince} hari lalu)`}` : "belum pernah"}</p>
                <p className="text-sm text-muted">Lihat apa yang berubah sejak itu, lalu tandai selesai.</p>
              </div>
              <MarkReviewed />
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Transaksi baru{review.newTransactionCount ? ` (${review.newTransactionCount})` : ""}</CardTitle></CardHeader>
              {review.newTransactions.length === 0 ? <CardBody><p className="text-sm text-muted">Tidak ada transaksi baru sejak tinjauan terakhir.</p></CardBody> : (
                <ul className="divide-y divide-line text-sm">
                  {review.newTransactions.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5"><span className="min-w-0"><span className="block truncate font-medium">{t.description || "(tanpa keterangan)"}</span><span className="text-xs text-muted">{formatDateID(t.occurred_on)} · {t.account_name}</span></span>
                      <span className={cn("num shrink-0", t.type === "income" && "text-gain")}>{t.type === "income" ? "+" : "−"}{formatIDR(t.amount)}</span></li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader><CardTitle><span className="flex items-center gap-2"><InboxIcon className="h-4 w-4" aria-hidden />Impor belum ditinjau</span></CardTitle><Link href="/inbox" className="text-sm font-medium text-brand">Buka kotak masuk</Link></CardHeader>
              <CardBody className="space-y-3 text-sm">
                <dl className="space-y-1.5">
                  <div className="flex justify-between"><dt className="text-muted">Siap disetujui</dt><dd className="num">{review.inbox.newItems}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Perlu ditinjau</dt><dd className="num">{review.inbox.needsReview}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Potensi duplikat</dt><dd className={cn("num", review.inbox.duplicates > 0 && "text-loss")}>{review.inbox.duplicates}</dd></div>
                </dl>
                {review.duplicates.length > 0 && <ul className="space-y-1 border-t border-line pt-3">{review.duplicates.map((d) => <li key={d.id} className="flex items-start gap-2 text-xs"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-loss" aria-hidden /><span>{d.description ?? "(tanpa keterangan)"} · {d.amount ? formatIDR(d.amount) : "—"} · {d.occurred_on ? formatDateID(d.occurred_on) : "—"}</span></li>)}</ul>}
              </CardBody>
            </Card>

            <Card>
              <CardHeader><CardTitle><span className="flex items-center gap-2"><CalendarClock className="h-4 w-4" aria-hidden />Pembayaran mendatang (7 hari)</span></CardTitle></CardHeader>
              {review.upcoming.length === 0 ? <CardBody><p className="text-sm text-muted">Tidak ada cicilan atau tagihan yang jatuh tempo dalam 7 hari.</p></CardBody> : (
                <ul className="divide-y divide-line text-sm">
                  {review.upcoming.map((u, i) => <li key={i}><Link href={u.href} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-sunken"><span><span className="font-medium">{u.title}</span> <span className={cn("text-xs", u.overdue ? "text-loss" : "text-muted")}>{u.overdue ? "Terlambat · " : ""}{formatDateID(u.date)}</span></span><span className="num shrink-0">{u.amount ? formatIDR(u.amount) : "—"}</span></Link></li>)}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader><CardTitle><span className="flex items-center gap-2"><Scale className="h-4 w-4" aria-hidden />Perlu dicek</span></CardTitle></CardHeader>
              <CardBody className="space-y-3 text-sm">
                <p className="flex justify-between"><span className="text-muted">Jadwal berulang menunggu keputusan</span>{review.plannedPending > 0 ? <Link href="/automation" className="font-medium text-brand underline">{review.plannedPending} jadwal</Link> : <span>0</span>}</p>
                {review.discrepancies.length === 0 ? <p className="text-muted">Tidak ada akun yang perlu direkonsiliasi.</p> : <ul className="space-y-1.5">{review.discrepancies.map((d) => <li key={d.account} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden /><span><strong>{d.account}</strong>: {d.reason}. <Link href="/accounts" className="underline">Rekonsiliasi</Link></span></li>)}</ul>}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
      {view === "next" && actions.length > 0 && <p className="mt-4 flex items-center gap-2 text-xs text-muted"><ListChecks className="h-3.5 w-3.5" aria-hidden />Urutan memakai tingkat urgensi, lalu seberapa terlambat atau dekat. Cek tab Tinjauan harian untuk ringkasan lengkap.</p>}
    </>
  );
}
