import Link from "next/link";
import { ListChecks, LineChart as LineIcon, Inbox as InboxIcon, CalendarClock, Landmark, TrendingUp, TrendingDown, Scale, PieChart, ArrowLeftRight, Database, Wallet, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SpendingChart } from "@/components/ledger/spending-chart";
import { getDb } from "@/lib/db/client";
import { getDbStatus } from "@/lib/db/status";
import { getDashboardSummary } from "@/lib/ledger/summary";
import { getCommitmentsOverview } from "@/lib/obligations";
import { inboxCounts } from "@/lib/inbox/inbox";
import { loadActions } from "@/lib/actions/data";
import { horizonDays, loadForecastContext } from "@/lib/forecast/data";
import { PRESETS, runForecast } from "@/lib/forecast/engine";
import { currentMonthWIB, formatDateID, formatIDR, formatMonthID, formatNumber, todayWIB } from "@/lib/format";
import type { LedgerEntry } from "@/lib/ledger/types";

export const dynamic = "force-dynamic";

function entrySign(r: LedgerEntry) {
  if (r.kind === "income" || (r.kind === "adjustment" && r.adj_direction === "in")) return { text: "text-gain", sign: "+" };
  if (r.kind === "transfer") return { text: "", sign: "" };
  return { text: "text-loss", sign: "−" };
}

export default function DashboardPage() {
  const s = getDbStatus();
  const month = currentMonthWIB();
  const d = getDashboardSummary(getDb(), month);
  const hasAccounts = d.accounts.length > 0;
  const ob = getCommitmentsOverview(getDb(), todayWIB(), 14);
  const inbox = inboxCounts(getDb());
  const todo = loadActions(getDb(), todayWIB());
  const fc = runForecast(loadForecastContext(getDb(), { today: todayWIB() }).input, PRESETS.baseline, horizonDays(todayWIB(), 1));
  const obItems = [...ob.overdue, ...ob.upcoming].slice(0, 5);
  const metrics = [
    { label: "Total kas", icon: Wallet, value: d.totalCash, tone: d.totalCash < 0 ? "text-loss" : "", note: `${d.accounts.length} akun aktif` },
    { label: "Pemasukan bulan ini", icon: TrendingUp, value: d.income, tone: "", note: formatMonthID(month) },
    { label: "Pengeluaran bulan ini", icon: TrendingDown, value: d.expense, tone: "", note: formatMonthID(month) },
    { label: "Arus kas bersih", icon: Scale, value: d.net, tone: d.net < 0 ? "text-loss" : d.net > 0 ? "text-gain" : "", note: "Pemasukan − pengeluaran" },
  ];
  return (
    <>
      <PageHeader title="Dasbor" description={`Hari ini, ${formatDateID(todayWIB())} (WIB). Transfer antar akun tidak dihitung sebagai pemasukan atau pengeluaran.`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, icon: Icon, value, tone, note }) => (
          <Card key={label}>
            <CardBody>
              <div className="flex items-center justify-between text-sm text-muted">{label}<Icon className="h-4 w-4" aria-hidden /></div>
              {hasAccounts ? (
                <>
                  <p className={`num mt-3 whitespace-nowrap text-xl font-semibold xl:text-[1.35rem] ${tone}`}>{formatIDR(value)}</p>
                  <p className="mt-1 text-xs text-muted">{note}</p>
                </>
              ) : (
                <>
                  <p className="num mt-3 text-xl font-semibold text-muted" aria-label="Belum ada data">—</p>
                  <p className="mt-1 text-xs text-muted">Belum ada akun</p>
                </>
              )}
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Transaksi terbaru</CardTitle>{d.recent.length > 0 && <Link href="/transactions" className="inline-flex items-center gap-1 text-sm font-medium text-brand">Lihat semua<ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>}</CardHeader>
          {d.recent.length === 0 ? (
            <CardBody>
              <EmptyState icon={ArrowLeftRight} title="Belum ada transaksi" description={hasAccounts ? "Catat pengeluaran atau pemasukan pertama Anda." : "Mulai dengan menambahkan akun, lalu catat transaksi pertama Anda."}
                action={<Link href={hasAccounts ? "/transactions" : "/accounts"}><Button size="sm">{hasAccounts ? "Catat transaksi" : "Tambah akun"}</Button></Link>} />
            </CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {d.recent.map((r) => {
                const { text, sign } = entrySign(r);
                return (
                  <li key={`${r.src}-${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.kind === "transfer" ? `Transfer ${r.account_name} → ${r.to_account_name}` : r.description || r.merchant || r.category_name || "(tanpa keterangan)"}</p>
                      <p className="text-xs text-muted">{formatDateID(r.occurred_on)}{r.kind !== "transfer" ? ` · ${r.account_name}` : ""}{r.kind === "adjustment" ? " · Penyesuaian" : ""}</p>
                    </div>
                    <span className={`num shrink-0 ${text}`}>{sign}{formatIDR(r.amount)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader><CardTitle>Saldo akun</CardTitle>{hasAccounts && <Link href="/accounts" className="text-sm font-medium text-brand">Kelola</Link>}</CardHeader>
          {hasAccounts ? (
            <ul className="divide-y divide-line">
              {d.accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="truncate">{a.name}</span>
                  <span className={`num shrink-0 ${a.balance < 0 ? "text-loss" : ""}`}>{formatIDR(a.balance)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody><EmptyState icon={Landmark} title="Belum ada akun" description="Tambahkan akun seperti BCA, SeaBank, atau tunai." action={<Link href="/accounts"><Button size="sm">Tambah akun</Button></Link>} /></CardBody>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Rincian pengeluaran · {formatMonthID(month)}</CardTitle></CardHeader>
          <CardBody>
            {d.spendingByCategory.length > 0 ? <SpendingChart data={d.spendingByCategory} /> : <EmptyState icon={PieChart} title="Belum ada pengeluaran bulan ini" description="Grafik kategori muncul setelah ada pengeluaran yang dicatat." />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kewajiban mendatang</CardTitle>
            {ob.overdue.length > 0 ? <Badge tone="loss">{ob.overdue.length} terlambat</Badge> : <Link href="/debts" className="text-sm font-medium text-brand">Lihat semua</Link>}
          </CardHeader>
          {obItems.length === 0 ? (
            <CardBody><EmptyState icon={CalendarClock} title="Tidak ada jatuh tempo 14 hari ke depan" description="Cicilan dan tagihan yang akan jatuh tempo tampil di sini." action={<Link href="/debts"><Button size="sm" variant="secondary">Kelola utang & tagihan</Button></Link>} /></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {obItems.map((i, k) => (
                <li key={k}><Link href={i.href} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-sunken">
                  <div className="min-w-0"><p className="truncate font-medium">{i.title}</p><p className={`text-xs ${i.overdue ? "text-loss" : "text-muted"}`}>{i.overdue ? "Terlambat · " : ""}{formatDateID(i.date)}</p></div>
                  <span className="num shrink-0">{i.amount > 0 ? formatIDR(i.amount) : "—"}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader><CardTitle>Kotak masuk</CardTitle>{inbox.pending > 0 ? <Badge tone="warn">{inbox.pending} menunggu</Badge> : null}</CardHeader>
          <CardBody>
            {inbox.pending === 0 ? (
              <EmptyState icon={InboxIcon} title="Kotak masuk kosong" description="Impor mutasi, foto struk, atau ketik transaksi dengan Catat Cepat." action={<Link href="/quick-capture"><Button size="sm" variant="secondary">Catat cepat</Button></Link>} />
            ) : (
              <div className="space-y-3 text-sm">
                <dl className="space-y-1.5">
                  <div className="flex justify-between"><dt className="text-muted">Perlu ditinjau</dt><dd className="num">{inbox.needs_review}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Potensi duplikat</dt><dd className="num">{inbox.potential_duplicate}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Siap disetujui</dt><dd className="num">{inbox.new}</dd></div>
                </dl>
                <Link href="/inbox"><Button size="sm">Tinjau sekarang</Button></Link>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Proyeksi 30 hari</CardTitle><Badge tone="warn">Proyeksi</Badge></CardHeader>
          <CardBody>
            {!hasAccounts ? (
              <EmptyState icon={LineIcon} title="Belum bisa diproyeksikan" description="Tambahkan akun dan catat transaksi agar perkiraan arus kas bisa dihitung." />
            ) : (
              <div className="space-y-3 text-sm">
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-3"><dt className="text-muted">Kas akhir</dt><dd className={`num ${fc.summary.closingCash < 0 ? "text-loss" : ""}`}>{formatIDR(fc.summary.closingCash)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Saldo terendah</dt><dd className={`num ${fc.summary.lowest.balance < 0 ? "text-loss" : ""}`}>{formatIDR(fc.summary.lowest.balance)}</dd></div>
                  {fc.survival && <div className="flex justify-between gap-3"><dt className="text-muted">Sampai gajian</dt><dd><Badge tone={fc.survival.survives ? "brand" : "loss"}>{fc.survival.survives ? "Aman" : "Tidak cukup"}</Badge></dd></div>}
                </dl>
                {fc.summary.firstDeficitDate && <p className="text-loss">Saldo diperkirakan negatif mulai {formatDateID(fc.summary.firstDeficitDate)}.</p>}
                <Link href="/forecast"><Button size="sm" variant="secondary">Lihat proyeksi</Button></Link>
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Langkah keuangan berikutnya</CardTitle>{todo.length > 0 ? <Link href="/next-actions" className="text-sm font-medium text-brand">Lihat semua ({todo.length})</Link> : null}</CardHeader>
          {todo.length === 0 ? (
            <CardBody><EmptyState icon={ListChecks} title="Tidak ada yang mendesak" description="Tidak ada pembayaran terlambat, kekurangan kas, atau anggaran terlampaui saat ini." /></CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {todo.slice(0, 3).map((a) => (
                <li key={a.id}><Link href={a.href} className="block px-5 py-3 text-sm hover:bg-sunken">
                  <p className="flex flex-wrap items-center gap-2 font-medium">{a.title}<Badge tone={a.severity === "critical" || a.severity === "high" ? "loss" : a.severity === "medium" ? "warn" : "neutral"}>{a.severity === "critical" ? "Segera" : a.severity === "high" ? "Penting" : a.severity === "medium" ? "Perlu perhatian" : "Bisa menunggu"}</Badge></p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted">{a.why}</p>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status basis data</CardTitle>
            <Badge tone={s.profile === "demo" ? "warn" : "brand"}>{s.profile === "demo" ? "Demo" : "Pribadi"}</Badge>
          </CardHeader>
          <CardBody>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted">Versi skema</dt><dd className="num">{s.schemaVersion}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Akun aktif</dt><dd className="num">{formatNumber(s.accounts)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Transaksi</dt><dd className="num">{formatNumber(s.transactions)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Ukuran</dt><dd className="num">{formatNumber(Math.round(s.sizeBytes / 1024))} KB</dd></div>
            </dl>
            <p className="mt-3 flex items-start gap-2 text-xs text-muted"><Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span className="break-all">{s.file}</span></p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
