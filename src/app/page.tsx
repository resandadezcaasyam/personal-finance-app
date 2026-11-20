import Link from "next/link";
import { CalendarClock, Landmark, TrendingUp, TrendingDown, Scale, PieChart, ArrowLeftRight, Database, Wallet, ArrowRight } from "lucide-react";
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
