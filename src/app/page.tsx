import Link from "next/link";
import {
  ListChecks, LineChart as LineIcon, Inbox as InboxIcon, CalendarClock, Landmark, Scale, PieChart, ArrowLeftRight,
  Database, Wallet, ArrowRight, Plus, Banknote, Smartphone, BarChart3, ChevronRight, ArrowDownLeft, ArrowUpRight, Lightbulb,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SpendingChart } from "@/components/ledger/spending-chart";
import { KpiCard, type Delta } from "@/components/dashboard/kpi-card";
import { MonthSwitcher } from "@/components/dashboard/month-switcher";
import { HighlightCard } from "@/components/dashboard/highlight-card";
import { CHART } from "@/lib/chart-colors";
import { CashFlowChart, type TrendPoint } from "@/components/dashboard/cashflow-chart";
import { getActiveProfile, getDb, getStartupHealth } from "@/lib/db/client";
import { backupDir } from "@/lib/db/paths";
import { getDbStatus } from "@/lib/db/status";
import { getDashboardSummary, monthTotals } from "@/lib/ledger/summary";
import { getCommitmentsOverview } from "@/lib/obligations";
import { inboxCounts } from "@/lib/inbox/inbox";
import { loadActions } from "@/lib/actions/data";
import { isMonth, previousMonthOf } from "@/lib/budgets/budgets";
import { horizonDays, loadForecastContext } from "@/lib/forecast/data";
import { PRESETS, runForecast } from "@/lib/forecast/engine";
import { addMonthsClamped, currentMonthWIB, daysBetween, formatDateShortID, formatDateID, formatIDR, formatMonthID, formatNumber, todayWIB } from "@/lib/format";
import { ACCOUNT_TYPE_LABEL } from "@/lib/ledger/types";
import type { LedgerEntry } from "@/lib/ledger/types";
import { EntryAvatar, CategoryPill, entrySign } from "@/components/ledger/entry-visuals";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const ACCOUNT_ICON = { cash: Banknote, bank: Landmark, ewallet: Smartphone, other: Wallet } as const;
const SEVERITY = {
  critical: { label: "Segera", tone: "loss" }, high: { label: "Penting", tone: "loss" }, medium: { label: "Perlu perhatian", tone: "warn" }, low: { label: "Bisa menunggu", tone: "neutral" },
} as const;

const pctChange = (cur: number, prev: number) => ((cur - prev) / prev) * 100;

export default function DashboardPage({ searchParams }: { searchParams: SP }) {
  const today = todayWIB();
  const thisMonth = currentMonthWIB();
  const raw = one(searchParams.bulan) ?? "";
  const month = isMonth(raw) && raw <= thisMonth ? raw : thisMonth;
  const trendN = ([3, 6, 12] as const).find((n) => String(n) === one(searchParams.tren)) ?? 6;
  const isCurrent = month === thisMonth;

  const s = getDbStatus();
  const db = getDb();
  const d = getDashboardSummary(db, month);
  const hasAccounts = d.accounts.length > 0;
  const prevMonth = previousMonthOf(month);
  const prev = monthTotals(db, prevMonth);
  // A month in progress is compared with the previous FULL month, and says so.
  const prevLabel = isCurrent ? `${formatMonthID(prevMonth)} (penuh)` : formatMonthID(prevMonth);
  const incomeDelta: Delta | null = prev.income > 0 ? { pct: pctChange(d.income, prev.income), upIsGood: true } : null;
  const expenseDelta: Delta | null = prev.expense > 0 ? { pct: pctChange(d.expense, prev.expense), upIsGood: false } : null;
  /** Caption with the REAL difference in rupiah; falls back to the month name when there is nothing to compare. */
  const diffCaption = (cur: number, before: number) => {
    if (before <= 0) return formatMonthID(month);
    const diff = cur - before;
    return diff === 0 ? `Sama dengan ${prevLabel}` : `${diff > 0 ? "Naik" : "Turun"} ${formatIDR(Math.abs(diff))} dibanding ${prevLabel}`;
  };

  const trend: TrendPoint[] = Array.from({ length: trendN }, (_, i) => {
    const m = addMonthsClamped(`${month}-01`, i - (trendN - 1)).slice(0, 7);
    const t = monthTotals(db, m);
    return { month: m, income: t.income, expense: t.expense, net: t.net };
  });
  const hasTrend = trend.some((t) => t.income > 0 || t.expense > 0);

  const ob = getCommitmentsOverview(db, today, 14);
  const obItems = [...ob.overdue.map((o) => ({ ...o, overdue: true })), ...ob.upcoming.map((o) => ({ ...o, overdue: false }))].slice(0, 5);
  const inbox = inboxCounts(db);
  const todo = loadActions(db, today, { backupDir: getActiveProfile() === "personal" ? backupDir() : null });
  const fc = runForecast(loadForecastContext(db, { today }).input, PRESETS.baseline, horizonDays(today, 1));
  const spendTotal = d.spendingByCategory.reduce((sum, c) => sum + c.total, 0);
  const topCategory = d.spendingByCategory[0];
  const positiveTotal = d.accounts.reduce((sum, a) => sum + Math.max(0, a.balance), 0);

  const nextMonth = addMonthsClamped(`${month}-01`, 1).slice(0, 7);
  const href = (o: { bulan?: string; tren?: number }) => {
    const u = new URLSearchParams();
    const m = o.bulan ?? month;
    if (m !== thisMonth) u.set("bulan", m);
    const t = o.tren ?? trendN;
    if (t !== 6) u.set("tren", String(t));
    const q = u.toString();
    return q ? `/?${q}` : "/";
  };
  const label = isCurrent ? "bulan ini" : formatMonthID(month);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-9 tracking-tight">Ringkasan Keuangan</h1>
          <p className="mt-1 text-sm text-muted">Pantau kondisi keuangan dan rencanakan langkah berikutnya.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthSwitcher month={month} prev={prevMonth} next={nextMonth <= thisMonth ? nextMonth : null} hrefFor={(m) => href({ bulan: m })} />
          <Link href="/transactions?tambah=1" className={buttonClass("primary", "md")}><Plus className="h-4 w-4" aria-hidden />Tambah Transaksi</Link>
        </div>
      </div>

      {getStartupHealth() && <p role="alert" className="mb-4 rounded-lg border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss"><strong>Pemeriksaan awal basis data menemukan masalah.</strong> Buka <Link href="/backup" className="underline">Cadangan &amp; Kesehatan Data</Link> untuk pemeriksaan lengkap dan opsi pemulihan.</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard emphasis label="Total kas" icon={Wallet} value={hasAccounts ? formatIDR(d.totalCash) : "—"} empty={!hasAccounts} negative={d.totalCash < 0} caption={hasAccounts ? `Saldo saat ini · ${d.accounts.length} akun aktif` : "Belum ada akun"} />
        <KpiCard label="Pemasukan bulanan" icon={ArrowDownLeft} value={hasAccounts ? formatIDR(d.income) : "—"} empty={!hasAccounts} caption={hasAccounts ? diffCaption(d.income, prev.income) : "Belum ada akun"} delta={hasAccounts ? incomeDelta : null} />
        <KpiCard label="Pengeluaran bulanan" icon={ArrowUpRight} value={hasAccounts ? formatIDR(d.expense) : "—"} empty={!hasAccounts} caption={hasAccounts ? diffCaption(d.expense, prev.expense) : "Belum ada akun"} delta={hasAccounts ? expenseDelta : null} />
        <KpiCard label="Arus kas bersih" icon={Scale} value={hasAccounts ? formatIDR(d.net) : "—"} empty={!hasAccounts} negative={d.net < 0} caption={!hasAccounts ? "Belum ada akun" : `Pemasukan − pengeluaran, ${formatMonthID(month)}`}
          status={hasAccounts ? { label: d.net > 0 ? "Surplus" : d.net < 0 ? "Defisit" : "Impas", good: d.net > 0 ? true : d.net < 0 ? false : null } : null} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-12">
        <Card className="flex flex-col xl:col-span-8">
          <CardHeader className="flex-wrap">
            <div>
              <CardTitle>Tren arus kas</CardTitle>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: CHART.primary }} aria-hidden />Pemasukan</span>
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: CHART.cyan }} aria-hidden />Pengeluaran</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full bg-muted" aria-hidden />Selisih</span>
              </p>
            </div>
            <nav aria-label="Rentang tren" className="inline-flex rounded-lg bg-sunken p-0.5">
              {([3, 6, 12] as const).map((n) => (
                <Link key={n} href={href({ tren: n })} aria-current={trendN === n ? "page" : undefined} className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", trendN === n ? "bg-surface text-brand-text shadow-card" : "text-muted hover:text-ink")}>{n} bln</Link>
              ))}
            </nav>
          </CardHeader>
          <CardBody className="flex-1">
            {hasTrend ? <CashFlowChart data={trend} /> : <EmptyState icon={BarChart3} title="Belum ada arus kas" description="Tren pemasukan dan pengeluaran muncul setelah Anda mencatat transaksi." action={<Link href="/transactions?tambah=1" className={buttonClass("secondary", "sm")}>Tambah transaksi</Link>} />}
          </CardBody>
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader><CardTitle>Pengeluaran per kategori</CardTitle><span className="text-xs text-muted">{formatMonthID(month)}</span></CardHeader>
          <CardBody>
            {d.spendingByCategory.length > 0 ? (
              <>
                <SpendingChart data={d.spendingByCategory} stacked />
                {topCategory && (
                  <p className="mt-5 flex items-start gap-2.5 rounded-xl bg-tint p-3 text-xs leading-5">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" aria-hidden />
                    <span>Kategori terbesar {label}: <strong className="font-semibold">{topCategory.name}</strong>, {Math.round((topCategory.total / spendTotal) * 100)}% dari seluruh pengeluaran ({formatIDR(topCategory.total)}).</span>
                  </p>
                )}
              </>
            ) : <EmptyState icon={PieChart} title="Belum ada pengeluaran" description={`Rincian kategori muncul setelah ada pengeluaran ${label}.`} />}
          </CardBody>
        </Card>

        <Card className="xl:col-span-8">
          <CardHeader><CardTitle>Transaksi terbaru</CardTitle>{d.recent.length > 0 && <Link href="/transactions" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-text hover:underline">Lihat semua<ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>}</CardHeader>
          {d.recent.length === 0 ? (
            <CardBody>
              <EmptyState icon={ArrowLeftRight} title="Belum ada transaksi" description={hasAccounts ? "Mulai catat pemasukan dan pengeluaran untuk melihat ringkasan keuanganmu." : "Mulai dengan menambahkan akun, lalu catat transaksi pertama Anda."}
                action={hasAccounts ? <Link href="/transactions?tambah=1" className={buttonClass("primary", "sm")}><Plus className="h-4 w-4" aria-hidden />Tambah Transaksi</Link> : <Link href="/accounts" className={buttonClass("primary", "sm")}>Tambah akun</Link>} />
            </CardBody>
          ) : (
            <div className="overflow-x-auto px-3 pb-3 pt-1">
              <table className="w-full text-[13px]">
                <caption className="sr-only">Transaksi terbaru</caption>
                <thead><tr className="bg-sunken/70 text-left [&>th:first-child]:rounded-l-lg [&>th:last-child]:rounded-r-lg"><th scope="col" className="px-3 py-2.5">Keterangan</th><th scope="col" className="hidden px-3 py-2.5 md:table-cell">Kategori</th><th scope="col" className="hidden px-3 py-2.5 sm:table-cell">Tanggal</th><th scope="col" className="px-3 py-2.5 text-right">Jumlah</th></tr></thead>
                <tbody>
                  {d.recent.map((r) => {
                    const { text, sign } = entrySign(r);
                    const title = r.kind === "transfer" ? `Transfer ${r.account_name} → ${r.to_account_name}` : r.description || r.merchant || r.category_name || "(tanpa keterangan)";
                    const pill = r.kind === "transfer" ? "Transfer" : r.kind === "adjustment" ? "Penyesuaian" : r.category_name;
                    return (
                      <tr key={`${r.src}-${r.id}`} className="border-b border-line/70 last:border-0">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <EntryAvatar r={r} className="hidden sm:flex" />
                            <div className="min-w-0 max-w-[9.5rem] sm:max-w-[17rem]"><p className="truncate font-medium">{title}</p><p className="truncate text-xs text-muted">{r.kind === "transfer" ? "Antar akun" : r.account_name}<span className="sm:hidden"> · {formatDateShortID(r.occurred_on)}</span></p></div>
                          </div>
                        </td>
                        <td className="hidden px-3 py-3 md:table-cell">{pill ? <CategoryPill>{pill}</CategoryPill> : <span className="text-muted">—</span>}</td>
                        <td className="hidden whitespace-nowrap px-3 py-3 text-muted sm:table-cell">{formatDateShortID(r.occurred_on)}</td>
                        <td className={cn("num whitespace-nowrap px-3 py-3 text-right font-semibold", text)}>{sign}{formatIDR(r.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-5 xl:col-span-4">
          <HighlightCard
            eyebrow="Prioritas utama"
            title={todo[0] ? todo[0].title : "Semua terkendali"}
            body={todo[0] ? todo[0].why : "Tidak ada pembayaran terlambat, kekurangan kas, atau anggaran terlampaui saat ini."}
            href={todo[0] ? todo[0].href : "/next-actions"}
            cta={todo[0] ? todo[0].cta : "Lihat langkah keuangan"}
          />
          <Card>
            <CardHeader><CardTitle>Saldo akun</CardTitle>{hasAccounts && <Link href="/accounts" className="text-[13px] font-medium text-brand-text hover:underline">Kelola</Link>}</CardHeader>
            {hasAccounts ? (
              <ul className="pb-2">
                {d.accounts.map((a) => {
                  const Icon = ACCOUNT_ICON[a.type] ?? Wallet;
                  const share = positiveTotal > 0 && a.balance > 0 ? (a.balance / positiveTotal) * 100 : 0;
                  return (
                    <li key={a.id} className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tint text-brand-text"><Icon className="h-4 w-4" aria-hidden /></span>
                        <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{a.name}</p><p className="text-xs text-muted">{ACCOUNT_TYPE_LABEL[a.type] ?? a.type}</p></div>
                        <span className={cn("num shrink-0 text-[13px] font-semibold", a.balance < 0 && "text-loss")}>{formatIDR(a.balance)}</span>
                      </div>
                      {share > 0 && <div className="ml-12 mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(3, Math.round(share))}%` }} /></div>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <CardBody><EmptyState icon={Landmark} title="Belum ada akun" description="Tambahkan akun seperti BCA, SeaBank, atau tunai." action={<Link href="/accounts" className={buttonClass("primary", "sm")}>Tambah akun</Link>} /></CardBody>
            )}
          </Card>
        </div>

        <Card className="xl:col-span-6">
          <CardHeader>
            <CardTitle>Pembayaran mendatang</CardTitle>
            {ob.overdue.length > 0 ? <Badge tone="loss">{ob.overdue.length} terlambat</Badge> : <Link href="/debts" className="text-[13px] font-medium text-brand-text hover:underline">Lihat semua</Link>}
          </CardHeader>
          {obItems.length === 0 ? (
            <CardBody><EmptyState icon={CalendarClock} title="Tidak ada jatuh tempo" description="Cicilan dan tagihan 14 hari ke depan tampil di sini." action={<Link href="/debts" className={buttonClass("secondary", "sm")}>Kelola utang</Link>} /></CardBody>
          ) : (
            <ul className="pb-2">
              {obItems.map((i, k) => {
                const days = daysBetween(today, i.date);
                return (
                  <li key={k}>
                    <Link href={i.href} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-sunken/60">
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", i.overdue ? "bg-loss/10 text-loss" : "bg-tint text-brand-text")}><CalendarClock className="h-4 w-4" aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{i.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          {i.overdue ? <Badge tone="loss">Terlambat {Math.abs(days)} hari</Badge> : days <= 3 ? <Badge tone="warn">{days === 0 ? "Hari ini" : `${days} hari lagi`}</Badge> : <Badge>{days} hari lagi</Badge>}
                          <span>{formatDateID(i.date)}</span>
                        </p>
                      </div>
                      <span className="num shrink-0 text-[13px] font-semibold">{i.amount > 0 ? formatIDR(i.amount) : "Berubah-ubah"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-6">
          <CardHeader><CardTitle>Langkah keuangan berikutnya</CardTitle>{todo.length > 0 ? <Link href="/next-actions" className="text-[13px] font-medium text-brand-text hover:underline">Lihat semua ({todo.length})</Link> : null}</CardHeader>
          {todo.length <= 1 ? (
            <CardBody><EmptyState icon={ListChecks} title={todo.length === 0 ? "Tidak ada yang mendesak" : "Tidak ada langkah lain"} description={todo.length === 0 ? "Tidak ada pembayaran terlambat, kekurangan kas, atau anggaran terlampaui." : "Prioritas utama sudah ditampilkan di atas."} /></CardBody>
          ) : (
            <ul className="pb-2">
              {todo.slice(1, 5).map((a) => (
                <li key={a.id}>
                  <Link href={a.href} className="group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-sunken/60">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">{a.title}<Badge tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Badge></p>
                      <p className="mt-1 line-clamp-2 text-xs leading-[18px] text-muted">{a.why}</p>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted/60 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-[13px] font-medium uppercase tracking-wider text-muted">Alat cerdas &amp; sistem</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Kotak masuk</CardTitle>{inbox.pending > 0 ? <Badge tone="warn">{inbox.pending} menunggu</Badge> : null}</CardHeader>
          <CardBody>
            {inbox.pending === 0 ? (
              <EmptyState icon={InboxIcon} title="Kotak masuk kosong" description="Impor mutasi, foto struk, atau ketik transaksi dengan Catat Cepat." action={<Link href="/quick-capture" className={buttonClass("secondary", "sm")}>Catat cepat</Link>} />
            ) : (
              <div className="space-y-3 text-[13px]">
                <dl className="space-y-1.5">
                  <div className="flex justify-between"><dt className="text-muted">Perlu ditinjau</dt><dd className="num font-medium">{inbox.needs_review}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Potensi duplikat</dt><dd className="num font-medium">{inbox.potential_duplicate}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Siap disetujui</dt><dd className="num font-medium">{inbox.new}</dd></div>
                </dl>
                <Link href="/inbox" className={buttonClass("primary", "sm")}>Tinjau sekarang</Link>
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
              <div className="space-y-3 text-[13px]">
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-3"><dt className="text-muted">Kas akhir</dt><dd className={cn("num font-medium", fc.summary.closingCash < 0 && "text-loss")}>{formatIDR(fc.summary.closingCash)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted">Saldo terendah</dt><dd className={cn("num font-medium", fc.summary.lowest.balance < 0 && "text-loss")}>{formatIDR(fc.summary.lowest.balance)}</dd></div>
                  {fc.survival && <div className="flex justify-between gap-3"><dt className="text-muted">Sampai gajian</dt><dd><Badge tone={fc.survival.survives ? "gain" : "loss"}>{fc.survival.survives ? "Aman" : "Tidak cukup"}</Badge></dd></div>}
                </dl>
                {fc.summary.firstDeficitDate && <p className="text-loss">Saldo diperkirakan negatif mulai {formatDateID(fc.summary.firstDeficitDate)}.</p>}
                <Link href="/forecast" className={buttonClass("secondary", "sm")}>Lihat proyeksi</Link>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Status basis data</CardTitle><Badge tone={s.profile === "demo" ? "warn" : "brand"}>{s.profile === "demo" ? "Demo" : "Pribadi"}</Badge></CardHeader>
          <CardBody>
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-4"><dt className="text-muted">Versi skema</dt><dd className="num font-medium">{s.schemaVersion}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Akun aktif</dt><dd className="num font-medium">{formatNumber(s.accounts)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Transaksi</dt><dd className="num font-medium">{formatNumber(s.transactions)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted">Ukuran</dt><dd className="num font-medium">{formatNumber(Math.round(s.sizeBytes / 1024))} KB</dd></div>
            </dl>
            <p className="mt-3 flex items-start gap-2 text-xs text-muted"><Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span className="break-all">{s.file}</span></p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
