import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, TrendingDown, Wallet, CalendarClock, LineChart as LineIcon, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/form-field";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ForecastChart, type ChartPoint } from "@/components/forecast/forecast-chart";
import { ForecastCalendar, calMonthRange } from "@/components/forecast/forecast-calendar";
import { ScenarioSaver } from "@/components/forecast/scenario-saver";
import { getDb } from "@/lib/db/client";
import { actualCashHistory, clampParams, horizonDays, listScenarios, loadForecastContext } from "@/lib/forecast/data";
import { PRESETS, runForecast, type PresetKey, type ScenarioParams } from "@/lib/forecast/engine";
import { formatDateID, formatIDR, formatMonthID, isoOrNull, todayWIB } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;
const MONTHS = [1, 3, 6, 12];
const KEYS = ["baseline", "conservative", "optimistic"] as const;

export default function ForecastPage({ searchParams: sp }: { searchParams: SP }) {
  const db = getDb();
  const today = todayWIB();
  const months = MONTHS.includes(Number(sp.months)) ? Number(sp.months) : 3;
  const scenario = (KEYS as readonly string[]).includes(sp.scenario ?? "") ? (sp.scenario as PresetKey) : sp.scenario === "custom" ? "custom" : "baseline";
  const base = scenario === "custom" ? PRESETS.baseline : PRESETS[scenario];
  const custom = scenario === "custom";
  const params: ScenarioParams = clampParams(
    { income_pct: custom ? Number(sp.ip ?? base.income_pct) : base.income_pct, spending_pct: custom ? Number(sp.sp ?? base.spending_pct) : base.spending_pct, bills_pct: custom ? Number(sp.bp ?? base.bills_pct) : base.bills_pct,
      income_delay_days: custom ? Number(sp.dd ?? base.income_delay_days) : base.income_delay_days, buffer: sp.buf !== undefined ? Number(sp.buf) : base.buffer },
    base,
  );
  const ruleId = /^\d+$/.test(sp.rule ?? "") ? Number(sp.rule) : null;
  const payday = isoOrNull(sp.payday);
  const ctx = loadForecastContext(db, { today, paydayRuleId: ruleId, paydayOverride: payday });
  const days = horizonDays(today, months);
  const r = runForecast(ctx.input, params, days);
  const compare = KEYS.map((k) => ({ key: k, label: PRESETS[k].label, res: runForecast(ctx.input, { ...PRESETS[k], buffer: params.buffer }, days) }));
  const saved = listScenarios(db);

  const qs = (over: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const cur: Record<string, string | number | undefined> = { months, scenario, ip: custom ? params.income_pct : undefined, sp: custom ? params.spending_pct : undefined, bp: custom ? params.bills_pct : undefined, dd: custom ? params.income_delay_days : undefined, buf: params.buffer || undefined, payday: payday ?? undefined, rule: ruleId ?? undefined, ...over };
    for (const [k, v] of Object.entries(cur)) if (v !== undefined && v !== "") q.set(k, String(v));
    return `/forecast?${q}`;
  };

  const history = actualCashHistory(db, today, 30);
  const points: ChartPoint[] = [
    ...history.map((h) => ({ date: h.date, actual: h.balance, forecast: h.date === today ? h.balance : null })),
    ...r.days.filter((d) => d.date > today).map((d) => ({ date: d.date, actual: null, forecast: d.closing })),
  ];

  const calMonths = calMonthRange(today, days);
  const calMonth = calMonths.includes(sp.cal ?? "") ? (sp.cal as string) : calMonths[0];
  const ci = calMonths.indexOf(calMonth);
  const s = r.summary;
  const sv = r.survival;
  const eventDays = r.days.filter((d) => d.events.length > 0);

  return (
    <>
      <PageHeader title="Proyeksi Arus Kas" description="Perkiraan saldo kas harian dari saldo sekarang, pemasukan berulang, cicilan yang belum dibayar, tagihan, dan kebiasaan belanja Anda. Semua angka di halaman ini adalah proyeksi, bukan catatan; tidak ada yang mengubah saldo Anda." />

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <nav aria-label="Rentang proyeksi" className="flex gap-0.5 rounded-xl bg-sunken p-1">
          {MONTHS.map((m) => <Link key={m} href={qs({ months: m, cal: undefined })} aria-current={months === m ? "page" : undefined} className={cn("rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors", months === m ? "bg-surface text-brand-text shadow-card" : "text-muted hover:text-ink")}>{m} bulan</Link>)}
        </nav>
        <nav aria-label="Skenario" className="flex flex-wrap gap-0.5 rounded-xl bg-sunken p-1">
          {KEYS.map((k) => <Link key={k} href={qs({ scenario: k, ip: undefined, sp: undefined, bp: undefined, dd: undefined, cal: undefined })} aria-current={scenario === k ? "page" : undefined} className={cn("rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors", scenario === k ? "bg-surface text-brand-text shadow-card" : "text-muted hover:text-ink")}>{PRESETS[k].label}</Link>)}
          <Link href={qs({ scenario: "custom", ip: params.income_pct, sp: params.spending_pct, bp: params.bills_pct, dd: params.income_delay_days })} aria-current={custom ? "page" : undefined} className={cn("rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors", custom ? "bg-surface text-brand-text shadow-card" : "text-muted hover:text-ink")}>Kustom</Link>
        </nav>
      </div>
      <p className="mb-6 text-sm text-muted">{custom ? "Asumsi buatan Anda (atur di bagian Asumsi di bawah)." : PRESETS[scenario as PresetKey].description}</p>

      {ctx.warnings.length > 0 && (
        <div role="region" aria-label="Catatan kualitas data" className="mb-6 space-y-2 rounded-card border border-warn/40 bg-warn/10 p-4 text-sm">
          {ctx.warnings.map((w) => <p key={w} className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden /><span>{w}</span></p>)}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard emphasis label="Kas sekarang" icon={Wallet} value={formatIDR(s.openingCash)} negative={s.openingCash < 0} caption="Aktual, semua akun aktif" />
        <KpiCard label={`Proyeksi kas ${months} bulan lagi`} icon={LineIcon} value={formatIDR(s.closingCash)} negative={s.closingCash < 0} caption={`Proyeksi · per ${formatDateID(r.days[r.days.length - 1].date)}`} />
        <KpiCard label="Saldo terendah" icon={TrendingDown} value={formatIDR(s.lowest.balance)} negative={s.lowest.balance < 0} caption={s.lowest.date === today ? "Hari ini" : formatDateID(s.lowest.date)} />
        <KpiCard label="Hari saldo negatif" icon={AlertTriangle} value={`${s.deficitDays} hari`} negative={s.deficitDays > 0} caption={s.firstDeficitDate ? `Mulai ${formatDateID(s.firstDeficitDate)}` : "Tidak ada defisit dalam rentang ini"} />
      </div>

      <section aria-labelledby="h-payday" className="mt-6">
        <Card className={sv ? (sv.survives ? "border-gain/50" : "border-loss/50") : ""}>
          <CardHeader><CardTitle><span id="h-payday" className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" aria-hidden />Cukup sampai gajian?</span></CardTitle>{sv && <Badge tone={sv.survives ? "brand" : "loss"}>{sv.survives ? "Aman" : "Tidak cukup"}</Badge>}</CardHeader>
          <CardBody>
            {!sv ? (
              <EmptyState icon={CalendarClock} title="Tanggal gajian belum diketahui" description="Tambahkan pemasukan berulang (mis. gaji tiap tanggal 25) di halaman Pemasukan, atau isi tanggal gajian manual di bawah." />
            ) : (
              <div className="grid gap-4 text-sm md:grid-cols-2">
                <div className="space-y-2">
                  <p className="flex items-start gap-2 text-base font-medium">{sv.survives ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-gain" aria-hidden /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-loss" aria-hidden />}
                    {sv.survives ? `Kas Anda diperkirakan cukup sampai ${formatDateID(sv.payday)}.` : `Kas Anda diperkirakan kurang ${formatIDR(sv.shortfall)} sebelum ${formatDateID(sv.payday)}.`}</p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <dt className="text-muted">Gajian berikutnya</dt><dd>{formatDateID(sv.payday)} ({sv.daysUntil} hari lagi) · {sv.sourceLabel}</dd>
                    <dt className="text-muted">Saldo terendah sebelum itu</dt><dd className={cn("num", sv.lowest < 0 && "text-loss")}>{formatIDR(sv.lowest)} ({formatDateID(sv.lowestDate)})</dd>
                    <dt className="text-muted">Saldo sehari sebelum gajian</dt><dd className="num">{formatIDR(sv.endBalance)}</dd>
                  </dl>
                </div>
                <div className="rounded-md bg-sunken p-3">
                  <p className="font-medium">Batas belanja aman</p>
                  <p className="num mt-1 text-2xl font-semibold">{formatIDR(sv.safePerDay)}<span className="text-sm font-normal text-muted"> / hari</span></p>
                  <p className="mt-1 text-muted">Total {formatIDR(sv.safeTotal)} di luar cicilan dan tagihan{params.buffer ? `, setelah menyisihkan cadangan ${formatIDR(params.buffer)}` : ""}. Kebiasaan belanja rata-rata Anda: {formatIDR(sv.baselinePerDay)} / hari{sv.baselinePerDay > sv.safePerDay ? <strong className="text-loss"> (melebihi batas aman)</strong> : <> (dalam batas aman)</>}.</p>
                </div>
              </div>
            )}
            <form method="get" action="/forecast" className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4 text-sm">
              <input type="hidden" name="months" value={months} /><input type="hidden" name="scenario" value={scenario} />
              {custom && <><input type="hidden" name="ip" value={params.income_pct} /><input type="hidden" name="sp" value={params.spending_pct} /><input type="hidden" name="bp" value={params.bills_pct} /><input type="hidden" name="dd" value={params.income_delay_days} /></>}
              {ctx.incomeRules.length > 1 && (
                <label className="space-y-1 text-xs text-muted">Pemasukan yang dianggap gajian
                  <Select name="rule" defaultValue={ruleId ?? ""} className="h-9 w-56 text-sm text-ink"><option value="">Otomatis</option>{ctx.incomeRules.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
              )}
              <label className="space-y-1 text-xs text-muted">Atau tanggal gajian manual<Input type="date" name="payday" defaultValue={payday ?? ""} min={today} className="h-9 w-44 text-sm text-ink" /></label>
              <label className="space-y-1 text-xs text-muted">Cadangan yang tidak disentuh (Rp)<Input name="buf" inputMode="numeric" defaultValue={params.buffer || ""} placeholder="0" className="h-9 w-40 text-sm text-ink" /></label>
              <Button type="submit" size="sm" variant="secondary">Terapkan</Button>
            </form>
          </CardBody>
        </Card>
      </section>

      {s.deficitPeriods.length > 0 && (
        <Card className="mt-6 border-loss/50">
          <CardHeader><CardTitle className="flex items-center gap-2 text-loss"><AlertTriangle className="h-4 w-4" aria-hidden />Periode defisit yang diproyeksikan</CardTitle></CardHeader>
          <ul className="divide-y divide-line text-sm">
            {s.deficitPeriods.map((p) => (
              <li key={p.from} className="px-5 py-3">Saldo negatif dari <strong>{formatDateID(p.from)}</strong> sampai <strong>{formatDateID(p.to)}</strong> ({p.days} hari), terendah <span className="num text-loss">{formatIDR(p.lowest)}</span> pada {formatDateID(p.lowestDate)}.</li>
            ))}
            <li className="px-5 py-3 text-muted">Yang bisa dipertimbangkan: menunda pengeluaran tidak mendesak, memindahkan dana antar akun, atau meninjau cicilan di halaman Utang. Tidak ada yang diubah otomatis.</li>
          </ul>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader><CardTitle><span className="flex items-center gap-2"><LineIcon className="h-4 w-4" aria-hidden />Saldo kas: aktual dan proyeksi</span></CardTitle><Badge tone="warn">Proyeksi {months} bulan</Badge></CardHeader>
        <CardBody><ForecastChart points={points} today={today} lowest={s.lowest} /></CardBody>
      </Card>

      <section aria-labelledby="h-compare" className="mt-8">
        <h2 id="h-compare" className="mb-2 text-lg font-semibold tracking-tight">Perbandingan skenario</h2>
        <div tabIndex={0} role="region" aria-label="Tabel yang dapat digulir ke samping" className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2.5 font-medium">Skenario</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Kas akhir</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Saldo terendah</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Hari negatif</th><th scope="col" className="px-4 py-2.5 font-medium">Sampai gajian</th></tr></thead>
            <tbody>
              {compare.map((c) => (
                <tr key={c.key} className={cn("border-b border-line last:border-0", scenario === c.key && "bg-brand/5")}>
                  <td className="px-4 py-2.5 font-medium"><Link href={qs({ scenario: c.key, ip: undefined, sp: undefined, bp: undefined, dd: undefined })} className="hover:underline">{c.label}</Link></td>
                  <td className={cn("num px-4 py-2.5 text-right", c.res.summary.closingCash < 0 && "text-loss")}>{formatIDR(c.res.summary.closingCash)}</td>
                  <td className={cn("num px-4 py-2.5 text-right", c.res.summary.lowest.balance < 0 && "text-loss")}>{formatIDR(c.res.summary.lowest.balance)}</td>
                  <td className="num px-4 py-2.5 text-right">{c.res.summary.deficitDays}</td>
                  <td className="px-4 py-2.5">{c.res.survival ? <Badge tone={c.res.survival.survives ? "brand" : "loss"}>{c.res.survival.survives ? "Aman" : "Tidak cukup"}</Badge> : <span className="text-muted">—</span>}</td>
                </tr>
              ))}
              {custom && (
                <tr className="bg-brand/5"><td className="px-4 py-2.5 font-medium">Kustom</td>
                  <td className={cn("num px-4 py-2.5 text-right", s.closingCash < 0 && "text-loss")}>{formatIDR(s.closingCash)}</td><td className={cn("num px-4 py-2.5 text-right", s.lowest.balance < 0 && "text-loss")}>{formatIDR(s.lowest.balance)}</td><td className="num px-4 py-2.5 text-right">{s.deficitDays}</td>
                  <td className="px-4 py-2.5">{sv ? <Badge tone={sv.survives ? "brand" : "loss"}>{sv.survives ? "Aman" : "Tidak cukup"}</Badge> : "—"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="h-assume" className="mt-8">
        <h2 id="h-assume" className="mb-2 text-lg font-semibold tracking-tight">Asumsi yang dipakai</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><CardTitle>Skenario {custom ? "Kustom" : PRESETS[scenario as PresetKey].label}</CardTitle></CardHeader>
            <CardBody className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <dt className="text-muted">Pemasukan</dt><dd className="num">{params.income_pct}% dari jadwal</dd>
                <dt className="text-muted">Keterlambatan pemasukan</dt><dd className="num">{params.income_delay_days} hari</dd>
                <dt className="text-muted">Belanja harian</dt><dd className="num">{params.spending_pct}% dari rata-rata · {formatIDR(r.assumptions.scenarioDailySpend)} / hari</dd>
                <dt className="text-muted">Tagihan berubah-ubah</dt><dd className="num">{params.bills_pct}% dari estimasi</dd>
                <dt className="text-muted">Cadangan</dt><dd className="num">{formatIDR(params.buffer)}</dd>
              </dl>
              <form method="get" action="/forecast" className="grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-4">
                <input type="hidden" name="months" value={months} /><input type="hidden" name="scenario" value="custom" />{payday && <input type="hidden" name="payday" value={payday} />}{ruleId && <input type="hidden" name="rule" value={ruleId} />}{params.buffer > 0 && <input type="hidden" name="buf" value={params.buffer} />}
                <label className="space-y-1 text-xs text-muted">Pemasukan %<Input name="ip" type="number" min={0} max={200} defaultValue={params.income_pct} className="h-9 text-sm text-ink" /></label>
                <label className="space-y-1 text-xs text-muted">Belanja %<Input name="sp" type="number" min={0} max={300} defaultValue={params.spending_pct} className="h-9 text-sm text-ink" /></label>
                <label className="space-y-1 text-xs text-muted">Tagihan %<Input name="bp" type="number" min={0} max={300} defaultValue={params.bills_pct} className="h-9 text-sm text-ink" /></label>
                <label className="space-y-1 text-xs text-muted">Telat (hari)<Input name="dd" type="number" min={0} max={30} defaultValue={params.income_delay_days} className="h-9 text-sm text-ink" /></label>
                <div className="col-span-2 sm:col-span-4"><Button type="submit" size="sm" variant="secondary">Pakai asumsi ini</Button></div>
              </form>
              <ScenarioSaver months={months} params={{ ip: params.income_pct, sp: params.spending_pct, bp: params.bills_pct, dd: params.income_delay_days, buf: params.buffer }}
                saved={saved.map((x) => ({ ...x, href: qs({ scenario: "custom", ip: x.params.income_pct, sp: x.params.spending_pct, bp: x.params.bills_pct, dd: x.params.income_delay_days, buf: x.params.buffer || undefined, cal: undefined }) }))} />
            </CardBody></Card>
          <Card><CardHeader><CardTitle>Dari mana angkanya</CardTitle></CardHeader>
            <CardBody className="space-y-3 text-sm">
              <p><strong>Saldo awal:</strong> {formatIDR(s.openingCash)} dari saldo akun aktif (catatan aktual, termasuk transaksi hari ini).</p>
              <p><strong>Pemasukan:</strong> {ctx.incomeRules.length ? ctx.incomeRules.map((x) => `${x.name} ${formatIDR(x.amount)}`).join("; ") : "tidak ada aturan pemasukan berulang"}. Yang sudah diterima beberapa hari sebelum jadwal tidak dihitung dua kali.</p>
              <p><strong>Cicilan:</strong> sisa yang belum dibayar pada jadwal utang aktif. Cicilan yang sudah lunas tidak diproyeksikan lagi{r.assumptions.overdueCount > 0 ? `; ${r.assumptions.overdueCount} kewajiban sudah lewat jatuh tempo dan dihitung hari ini` : ""}.</p>
              <p><strong>Tagihan &amp; langganan:</strong> tanggal jatuh tempo berikutnya lalu berulang sesuai jadwal. Nominal berubah-ubah memakai rata-rata 3 pembayaran terakhir.{r.assumptions.unknownBills.length > 0 && <span className="text-warn"> Belum ada riwayat untuk: {r.assumptions.unknownBills.join(", ")} (dihitung Rp 0).</span>}</p>
              <p><strong>Belanja harian:</strong> {ctx.baseline.days > 0 ? `${formatIDR(ctx.baseline.perDay)} / hari (±${formatIDR(ctx.baseline.perMonth)} / bulan), rata-rata ${ctx.baseline.days} hari terakhir sejak ${formatDateID(ctx.baseline.from!)}. Tidak termasuk pembayaran cicilan, tagihan, transfer, dan penyesuaian saldo.` : "belum ada riwayat."}</p>
              {r.assumptions.skippedIncome.map((x) => <p key={x} className="text-muted">• {x}</p>)}
              <p className="text-muted">Perkiraan ini tidak tahu pengeluaran besar yang tidak rutin. Hasilnya bukan jaminan.</p>
            </CardBody></Card>
        </div>
      </section>

      <section aria-labelledby="h-months" className="mt-8">
        <h2 id="h-months" className="mb-2 text-lg font-semibold tracking-tight">Proyeksi per bulan <Badge tone="warn">Proyeksi</Badge></h2>
        <div tabIndex={0} role="region" aria-label="Tabel yang dapat digulir ke samping" className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-muted">
              <th scope="col" className="px-3 py-2.5 font-medium">Bulan</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Kas awal</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Pemasukan</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Belanja</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Cicilan</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Tagihan</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Kas akhir</th><th scope="col" className="px-3 py-2.5 text-right font-medium">Terendah</th><th scope="col" className="px-3 py-2.5 font-medium">Status</th>
            </tr></thead>
            <tbody>
              {r.months.map((m) => (
                <tr key={m.month} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium">{formatMonthID(m.month)}{m.partial && <span className="text-xs text-muted"> (sisa bulan)</span>}</td>
                  <td className="num whitespace-nowrap px-3 py-2.5 text-right">{formatIDR(m.opening)}</td><td className="num whitespace-nowrap px-3 py-2.5 text-right text-gain">{formatIDR(m.income)}</td>
                  <td className="num whitespace-nowrap px-3 py-2.5 text-right">{formatIDR(m.spending)}</td><td className="num whitespace-nowrap px-3 py-2.5 text-right">{formatIDR(m.installments)}</td><td className="num whitespace-nowrap px-3 py-2.5 text-right">{formatIDR(m.bills)}</td>
                  <td className={cn("num whitespace-nowrap px-3 py-2.5 text-right font-medium", m.closing < 0 && "text-loss")}>{formatIDR(m.closing)}</td>
                  <td className={cn("num whitespace-nowrap px-3 py-2.5 text-right", m.lowest < 0 && "text-loss")}>{formatIDR(m.lowest)}</td>
                  <td className="px-3 py-2.5"><Badge tone={m.status === "surplus" ? "brand" : "loss"}>{m.status === "surplus" ? "Surplus" : "Defisit"}</Badge></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-line font-medium"><td className="px-3 py-2.5">Total</td><td /><td className="num px-3 py-2.5 text-right">{formatIDR(s.totalIncome)}</td><td className="num px-3 py-2.5 text-right">{formatIDR(s.totalSpending)}</td><td className="num px-3 py-2.5 text-right">{formatIDR(s.totalInstallments)}</td><td className="num px-3 py-2.5 text-right">{formatIDR(s.totalBills)}</td><td className="num px-3 py-2.5 text-right">{formatIDR(s.closingCash)}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Kas awal + pemasukan − belanja − cicilan − tagihan = kas akhir. Kas akhir tiap bulan menjadi kas awal bulan berikutnya.</p>
      </section>

      <section aria-labelledby="h-cal" className="mt-8">
        <h2 id="h-cal" className="mb-3 text-lg font-semibold tracking-tight">Kalender keuangan</h2>
        <ForecastCalendar month={calMonth} days={r.days} today={today} hrefFor={(m) => qs({ cal: m })} prev={ci > 0 ? calMonths[ci - 1] : null} next={ci < calMonths.length - 1 ? calMonths[ci + 1] : null} />
      </section>

      <section aria-labelledby="h-daily" className="mt-8">
        <details className="rounded-card border border-line bg-surface">
          <summary id="h-daily" className="cursor-pointer px-5 py-3 text-sm font-medium">Rincian harian: hari dengan pemasukan, cicilan, atau tagihan ({eventDays.length})</summary>
          <div tabIndex={0} role="region" aria-label="Tabel yang dapat digulir ke samping" className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2 font-medium">Tanggal</th><th scope="col" className="px-4 py-2 font-medium">Peristiwa</th><th scope="col" className="px-4 py-2 text-right font-medium">Masuk</th><th scope="col" className="px-4 py-2 text-right font-medium">Keluar terjadwal</th><th scope="col" className="px-4 py-2 text-right font-medium">Belanja rata-rata</th><th scope="col" className="px-4 py-2 text-right font-medium">Saldo akhir</th></tr></thead>
              <tbody>
                {eventDays.slice(0, 400).map((d) => (
                  <tr key={d.date} className="border-b border-line align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-2">{formatDateID(d.date)}</td>
                    <td className="px-4 py-2"><ul className="space-y-0.5">{d.events.map((e, i) => <li key={i} className={e.overdue ? "text-loss" : ""}>{e.kind === "income" ? "＋" : "－"} {e.label}{e.note && <span className="text-xs text-muted"> · {e.note}</span>}</li>)}</ul></td>
                    <td className="num px-4 py-2 text-right text-gain">{d.income ? formatIDR(d.income) : "—"}</td><td className="num px-4 py-2 text-right">{d.installments + d.bills ? formatIDR(d.installments + d.bills) : "—"}</td>
                    <td className="num px-4 py-2 text-right text-muted">{formatIDR(d.spending)}</td><td className={cn("num px-4 py-2 text-right font-medium", d.closing < 0 && "text-loss")}>{formatIDR(d.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </>
  );
}
