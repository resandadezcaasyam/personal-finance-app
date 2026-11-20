import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Calculator, Scale } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/form-field";
import { ScenarioChart, StrategyChart, type ScenarioPoint } from "@/components/repay/charts";
import { ScenarioManager, ConfirmSettlement, type SavedItem } from "@/components/repay/repay-actions";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { getDebt } from "@/lib/debts/debts";
import { horizonDays } from "@/lib/forecast/data";
import { PRESETS, runForecast } from "@/lib/forecast/engine";
import { listRepayScenarios, loadRepayContext, type StoredRepay } from "@/lib/repay/data";
import { parseRepayQuery } from "@/lib/repay/query";
import { simulateEarlyRepayment, type Risk, type SimulationResult } from "@/lib/repay/simulate";
import { compareStrategies, impliedCostRatio, STRATEGY_HELP, STRATEGY_LABEL, type StrategyResult } from "@/lib/repay/strategies";
import { formatDateID, formatIDR, formatMonthID, todayWIB } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;
const KNOWN = ["debt", "date", "mode", "amt", "quote", "rb", "fee", "pen", "preset", "buf", "extra", "srb", "p1", "p2", "p3", "p4", "cmp"];
const RISK: Record<Risk, ["brand" | "warn" | "loss", string]> = { rendah: ["brand", "Rendah"], sedang: ["warn", "Sedang"], tinggi: ["loss", "Tinggi"] };
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatIDR(Math.abs(n))}`;

function storedToQuery(s: StoredRepay): Record<string, string> {
  const o: Record<string, string> = { debt: String(s.debt_id), date: s.date, mode: s.mode, preset: s.preset };
  if (s.amount !== null) o.amt = String(s.amount);
  if (s.quote !== null) o.quote = String(s.quote);
  if (s.rebate_pct) o.rb = String(s.rebate_pct);
  if (s.fee) o.fee = String(s.fee);
  if (s.penalty) o.pen = String(s.penalty);
  if (s.buffer) o.buf = String(s.buffer);
  return o;
}

export default function EarlyRepaymentPage({ searchParams: sp }: { searchParams: SP }) {
  const db = getDb();
  const today = todayWIB();
  const ctx = loadRepayContext(db, { today });
  const q = parseRepayQuery(sp, ctx.debts, today);
  const days = horizonDays(today, 12);
  const debtName = (id: number) => { const d = ctx.debts.find((x) => x.debt_id === id); return d ? (d.label ? `${d.provider} · ${d.label}` : d.provider) : `Utang #${id}`; };

  let sim: SimulationResult | null = null;
  let simError: string | null = null;
  if (q.params && q.errors.length === 0) {
    try { sim = simulateEarlyRepayment(ctx.forecast.input, ctx.debts, q.params, q.scenario, days); } catch (e) { simError = e instanceof Error ? e.message : "Simulasi gagal."; }
  }
  let strategies: StrategyResult[] = [];
  let strategyError: string | null = null;
  try { if (ctx.debts.length) strategies = compareStrategies(ctx.debts, today, q.strategy); } catch (e) { strategyError = e instanceof Error ? e.message : "Perbandingan strategi gagal."; }

  const link = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const k of KNOWN) { const v = over[k] !== undefined ? over[k] : sp[k]; if (v !== undefined && v !== "") u.set(k, v); }
    for (const [k, v] of Object.entries(over)) if (!KNOWN.includes(k) && v) u.set(k, v);
    return `/early-repayment?${u}`;
  };

  const saved = listRepayScenarios(db);
  const savedItems: SavedItem[] = saved.map((s) => {
    const cmp = q.compare.includes(s.id) ? q.compare.filter((x) => x !== s.id) : [...q.compare, s.id].slice(0, 4);
    return {
      id: s.id, name: s.name, compared: q.compare.includes(s.id),
      summary: `${debtName(s.params.debt_id)} · ${s.params.date ? formatDateID(s.params.date) : "—"} · ${s.params.mode === "full" ? "penuh" : "sebagian"}${s.snapshot?.cashOut ? ` · keluar ${formatIDR(s.snapshot.cashOut)}` : ""}`,
      openHref: link({ ...storedToQuery(s.params), cmp: undefined }), toggleHref: link({ cmp: cmp.join(",") || undefined }),
    };
  });

  const compareCols = q.compare.map((id) => {
    const s = saved.find((x) => x.id === id);
    if (!s) return null;
    try {
      const qq = parseRepayQuery(storedToQuery(s.params), ctx.debts, today);
      if (!qq.params) throw new Error("Utang sudah lunas atau tidak ditemukan.");
      return { s, sim: simulateEarlyRepayment(ctx.forecast.input, ctx.debts, qq.params, qq.scenario, days), error: null as string | null };
    } catch (e) { return { s, sim: null as SimulationResult | null, error: e instanceof Error ? e.message : "Gagal" }; }
  }).filter(Boolean) as { s: (typeof saved)[number]; sim: SimulationResult | null; error: string | null }[];

  const accounts = listAccounts(db, { archived: false });
  const hidden = (names: string[]) => names.map((k) => (sp[k] ? <input key={k} type="hidden" name={k} value={sp[k]} /> : null));
  const baselineSurplus = (() => { const r = runForecast(ctx.forecast.input, PRESETS.baseline, 91); return Math.round((r.summary.totalIncome - r.summary.totalSpending - r.summary.totalInstallments - r.summary.totalBills) / 3); })();
  const points: ScenarioPoint[] = sim ? sim.a.days.map((d, i) => ({ date: d.date, a: d.closing, b: sim!.b.days[i].closing })) : [];
  const stratRows = (() => {
    if (!strategies.length) return [];
    const longest = Math.max(...strategies.map((s) => s.months.length));
    const ref = strategies.reduce((a, b) => (b.months.length > a.months.length ? b : a)).months;
    return Array.from({ length: longest }, (_, i) => {
      const row: Record<string, string | number> = { month: ref[i].month };
      for (const s of strategies) row[s.key] = s.months[i]?.outstanding ?? 0;
      return row;
    });
  })();
  const monthOf = (id: number, s: StrategyResult) => (s.clearedMonth[id] ? formatMonthID(s.clearedMonth[id]) : "—");

  return (
    <>
      <PageHeader title="Simulasi Pelunasan Dini" description="Bandingkan terus mencicil dengan melunasi lebih awal: dampaknya ke saldo kas 12 bulan ke depan, risiko kekurangan uang, dan tanggal bebas utang. Ini simulasi murni: tidak ada catatan Anda yang berubah kecuali Anda menekan tombol pencatatan pelunasan sungguhan." />

      {ctx.debts.length === 0 ? (
        <Card><CardBody><EmptyState icon={Calculator} title="Belum ada utang aktif" description="Tambahkan utang atau cicilan di halaman Utang & Cicilan, lalu kembali ke sini untuk membandingkan pelunasan dini dan strategi pelunasan." action={<Link href="/debts"><Button size="sm">Buka Utang & Cicilan</Button></Link>} /></CardBody></Card>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>1. Atur simulasi</CardTitle></CardHeader>
            <CardBody>
              <form method="get" action="/early-repayment" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {hidden(["extra", "srb", "p1", "p2", "p3", "p4", "cmp"])}
                <label className="space-y-1.5 text-sm font-medium sm:col-span-2">Utang yang dilunasi
                  <Select name="debt" defaultValue={sp.debt ?? ""} required className="font-normal"><option value="">Pilih utang…</option>{ctx.debts.map((d) => <option key={d.debt_id} value={d.debt_id}>{debtName(d.debt_id)} · sisa {formatIDR(d.rows.reduce((s, r) => s + r.remaining, 0))}</option>)}</Select></label>
                <label className="space-y-1.5 text-sm font-medium">Tanggal pelunasan<Input type="date" name="date" defaultValue={q.raw.date} min={today} className="font-normal" /></label>
                <label className="space-y-1.5 text-sm font-medium">Jenis<Select name="mode" defaultValue={q.params?.mode ?? "full"} className="font-normal"><option value="full">Pelunasan penuh</option><option value="partial">Pembayaran sebagian</option></Select></label>
                <label className="space-y-1.5 text-sm font-medium">Nominal (sebagian)<Input name="amt" defaultValue={q.raw.amount} inputMode="numeric" placeholder="Contoh: 500rb" className="font-normal" /><span className="block text-xs font-normal text-muted">Dipakai untuk cicilan berikutnya, urut dari yang terdekat.</span></label>
                <label className="space-y-1.5 text-sm font-medium">Kuotasi pelunasan (penuh)<Input name="quote" defaultValue={q.raw.quote} inputMode="numeric" placeholder="Opsional" className="font-normal" /><span className="block text-xs font-normal text-muted">Nominal pelunasan dari penyedia. Menggantikan hitungan jadwal.</span></label>
                <label className="space-y-1.5 text-sm font-medium">Rebat bunga (%)<Input name="rb" defaultValue={q.raw.rebate} inputMode="decimal" placeholder="0" className="font-normal" /><span className="block text-xs font-normal text-muted">Bagian bunga terjadwal yang dihapus penyedia. Isi hanya jika tahu pasti.</span></label>
                <label className="space-y-1.5 text-sm font-medium">Biaya pelunasan dini<Input name="fee" defaultValue={q.raw.fee} inputMode="numeric" placeholder="0" className="font-normal" /></label>
                <label className="space-y-1.5 text-sm font-medium">Denda<Input name="pen" defaultValue={q.raw.penalty} inputMode="numeric" placeholder="0" className="font-normal" /></label>
                <label className="space-y-1.5 text-sm font-medium">Skenario proyeksi dasar<Select name="preset" defaultValue={q.preset} className="font-normal"><option value="baseline">Baseline</option><option value="conservative">Konservatif</option><option value="optimistic">Optimis</option></Select></label>
                <label className="space-y-1.5 text-sm font-medium">Cadangan kas (tidak disentuh)<Input name="buf" defaultValue={q.raw.buffer} inputMode="numeric" placeholder="0" className="font-normal" /></label>
                <div className="flex items-end"><Button type="submit"><Calculator className="h-4 w-4" aria-hidden />Hitung simulasi</Button></div>
              </form>
              {q.errors.length > 0 && <ul role="alert" className="mt-4 list-disc space-y-1 rounded-md border border-loss/40 bg-loss/10 py-2 pl-8 pr-3 text-sm text-loss">{q.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
              {simError && <p role="alert" className="mt-4 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{simError}</p>}
              {!q.params && q.errors.length === 0 && <p className="mt-4 text-sm text-muted">Pilih utang dan tanggal, lalu tekan &ldquo;Hitung simulasi&rdquo;. Hasilnya dibandingkan dengan proyeksi standar Anda.</p>}
            </CardBody>
          </Card>

          {sim && q.params && (() => {
            const { settlement: s, ma, mb } = sim;
            const [tone, label] = RISK[mb.risk];
            const rows: { label: string; a: string; b: string; d?: number; note?: string }[] = [
              { label: "Kas akhir (12 bulan)", a: formatIDR(ma.closingCash), b: formatIDR(mb.closingCash), d: mb.closingCash - ma.closingCash },
              { label: "Saldo terendah", a: `${formatIDR(ma.lowest.balance)} (${formatDateID(ma.lowest.date)})`, b: `${formatIDR(mb.lowest.balance)} (${formatDateID(mb.lowest.date)})`, d: mb.lowest.balance - ma.lowest.balance },
              { label: "Hari saldo negatif", a: String(ma.deficitDays), b: String(mb.deficitDays), d: mb.deficitDays - ma.deficitDays },
              { label: "Pembayaran utang ini dalam 12 bulan", a: formatIDR(ma.debtPaidInHorizon), b: formatIDR(mb.debtPaidInHorizon), d: mb.debtPaidInHorizon - ma.debtPaidInHorizon },
              { label: "Total sisa pembayaran utang ini (seluruh jadwal)", a: formatIDR(s.totalRemainingA), b: formatIDR(s.totalRemainingB), d: s.totalRemainingB - s.totalRemainingA },
              { label: "Bunga & biaya terjadwal tersisa", a: formatIDR(s.interestFeeA), b: formatIDR(s.interestFeeB), d: s.interestFeeB - s.interestFeeA, note: s.knownSaving === null ? "Tanpa rebat/kuotasi dari Anda, tidak ada penghematan yang diasumsikan." : "Selisih berasal dari rebat/kuotasi yang Anda isi." },
              { label: "Biaya & denda pelunasan", a: formatIDR(0), b: formatIDR(s.fee + s.penalty), d: s.fee + s.penalty },
              { label: "Rata-rata cicilan per bulan (semua utang)", a: formatIDR(ma.avgMonthlyInstallments), b: formatIDR(mb.avgMonthlyInstallments), d: mb.avgMonthlyInstallments - ma.avgMonthlyInstallments },
              { label: "Surplus rutin per bulan", a: formatIDR(ma.avgMonthlySurplus), b: formatIDR(mb.avgMonthlySurplus), d: mb.avgMonthlySurplus - ma.avgMonthlySurplus, note: "Pemasukan − belanja − cicilan − tagihan; pembayaran pelunasan sekali jalan tidak dihitung." },
              { label: "Tanggal bebas utang (semua utang)", a: sim.debtFreeA ? formatDateID(sim.debtFreeA) : "—", b: sim.debtFreeB ? formatDateID(sim.debtFreeB) : "—" },
            ];
            const canRecord = s.mode === "full" && s.rebateKind === "none" && q.params.date === today;
            const debtNow = getDebt(db, q.params.debt_id, today);
            return (
              <>
                <section aria-labelledby="h-verdict" className="mt-8">
                  <Card className={mb.risk === "tinggi" ? "border-loss/50" : mb.risk === "rendah" ? "border-gain/50" : "border-warn/50"}>
                    <CardHeader><CardTitle><span id="h-verdict" className="flex items-center gap-2">{mb.risk === "tinggi" ? <AlertTriangle className="h-4 w-4 text-loss" aria-hidden /> : <CheckCircle2 className="h-4 w-4 text-gain" aria-hidden />}2. Hasil: {sim.debtLabel}, {s.mode === "full" ? "dilunasi" : "dibayar sebagian"} pada {formatDateID(s.date)}</span></CardTitle><Badge tone={tone}>Risiko likuiditas {label}</Badge></CardHeader>
                    <CardBody className="space-y-2 text-sm">
                      <p>{mb.risk === "tinggi" ? <>Dengan skenario ini saldo kas diproyeksikan <strong className="text-loss">negatif {mb.deficitDays} hari</strong>{mb.firstDeficitDate && <> mulai {formatDateID(mb.firstDeficitDate)}</>}, terendah <strong className="num text-loss">{formatIDR(mb.lowest.balance)}</strong>. Tanpa pelunasan: {ma.deficitDays === 0 ? "tidak ada hari negatif" : `${ma.deficitDays} hari negatif`}.</>
                        : <>Saldo kas tetap positif; titik terendah turun dari <strong className="num">{formatIDR(ma.lowest.balance)}</strong> menjadi <strong className="num">{formatIDR(mb.lowest.balance)}</strong>{mb.risk === "sedang" && <> (di bawah cadangan atau satu bulan belanja Anda)</>}.</>}</p>
                      <p>{s.knownSaving === null ? <>Total yang dibayar untuk utang ini <strong>sama dengan jadwal</strong>{s.fee + s.penalty > 0 ? <> ditambah biaya/denda {formatIDR(s.fee + s.penalty)}</> : null}. <span className="text-muted">Tidak ada penghematan bunga yang diasumsikan karena aturan kontrak tidak diketahui aplikasi.</span></> : <>Selisih terhadap jadwal berdasarkan {s.rebateKind === "quote" ? "kuotasi" : "rebat"} yang Anda isi: <strong className={cn("num", s.knownSaving >= 0 ? "text-gain" : "text-loss")}>{signed(s.knownSaving)}</strong>.</>}</p>
                      <p className="text-xs text-muted">Hasil ini adalah proyeksi berdasarkan data saat ini dan asumsi skenario {PRESETS[q.preset].label}; bukan saran keuangan.</p>
                    </CardBody>
                  </Card>
                </section>

                <section aria-labelledby="h-cmp" className="mt-8">
                  <h2 id="h-cmp" className="mb-2 font-display text-xl font-semibold">3. Perbandingan <Badge tone="warn">Proyeksi</Badge></h2>
                  <div className="overflow-x-auto rounded-card border border-line bg-surface">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2.5 font-medium">Ukuran</th><th scope="col" className="px-4 py-2.5 font-medium">A: lanjut mencicil</th><th scope="col" className="px-4 py-2.5 font-medium">B: {s.mode === "full" ? "lunasi" : "bayar sebagian"} {formatDateID(s.date)}</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Selisih (B − A)</th></tr></thead>
                      <tbody>
                        <tr className="border-b border-line"><td className="px-4 py-2.5 font-medium">Risiko likuiditas</td><td className="px-4 py-2.5"><Badge tone={RISK[ma.risk][0]}>{RISK[ma.risk][1]}</Badge></td><td className="px-4 py-2.5"><Badge tone={tone}>{label}</Badge></td><td /></tr>
                        {rows.map((r) => (
                          <tr key={r.label} className="border-b border-line last:border-0 align-top">
                            <td className="px-4 py-2.5 font-medium">{r.label}{r.note && <p className="text-xs font-normal text-muted">{r.note}</p>}</td>
                            <td className="num px-4 py-2.5">{r.a}</td><td className="num px-4 py-2.5">{r.b}</td>
                            <td className={cn("num whitespace-nowrap px-4 py-2.5 text-right", r.d && r.d !== 0 && (r.label.startsWith("Hari") || r.label.startsWith("Biaya") || r.label.startsWith("Bunga") || r.label.startsWith("Total") || r.label.startsWith("Pembayaran") || r.label.startsWith("Rata") ? (r.d > 0 ? "text-loss" : "text-gain") : r.d > 0 ? "text-gain" : "text-loss"))}>{r.d === undefined ? "—" : r.label.startsWith("Hari") ? (r.d === 0 ? "0" : `${r.d > 0 ? "+" : "−"}${Math.abs(r.d)} hari`) : signed(r.d)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section aria-labelledby="h-break" className="mt-8">
                  <h2 id="h-break" className="mb-2 font-display text-xl font-semibold">4. Rincian pembayaran pada {formatDateID(s.date)}</h2>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card><CardBody className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm">
                      <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2 font-medium">Cicilan</th><th scope="col" className="px-4 py-2 font-medium">Jatuh tempo</th><th scope="col" className="px-4 py-2 text-right font-medium">Sisa jadwal</th><th scope="col" className="px-4 py-2 text-right font-medium">Dibayar</th><th scope="col" className="px-4 py-2 text-right font-medium">Sisa setelahnya</th></tr></thead>
                      <tbody>{s.covered.map((c) => <tr key={c.sequence_no} className="border-b border-line last:border-0"><td className="px-4 py-2">#{c.sequence_no}</td><td className="whitespace-nowrap px-4 py-2">{formatDateID(c.due_date)}</td><td className="num whitespace-nowrap px-4 py-2 text-right">{formatIDR(c.before)}</td><td className="num whitespace-nowrap px-4 py-2 text-right">{formatIDR(c.paid)}</td><td className="num whitespace-nowrap px-4 py-2 text-right">{formatIDR(c.after)}</td></tr>)}</tbody>
                    </table></div></CardBody></Card>
                    <Card><CardBody>
                      <dl className="space-y-1.5 text-sm">
                        <div className="flex justify-between gap-3"><dt className="text-muted">Menurut jadwal</dt><dd className="num">{formatIDR(s.scheduledCost)}</dd></div>
                        {s.rebateKind !== "none" && <div className="flex justify-between gap-3"><dt className="text-muted">{s.rebateKind === "quote" ? "Kuotasi dari penyedia" : `Rebat bunga ${q.params.rebate_pct}%`}</dt><dd className="num">{s.rebateKind === "quote" ? formatIDR(s.payoff) : `−${formatIDR(s.knownSaving ?? 0)}`}</dd></div>}
                        <div className="flex justify-between gap-3"><dt className="text-muted">Dibayar untuk cicilan</dt><dd className="num">{formatIDR(s.payoff)}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-muted">Biaya pelunasan</dt><dd className="num">{formatIDR(s.fee)}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-muted">Denda</dt><dd className="num">{formatIDR(s.penalty)}</dd></div>
                        <div className="flex justify-between gap-3 border-t border-line pt-1.5 font-semibold"><dt>Uang keluar</dt><dd className="num">{formatIDR(s.cashOut)}</dd></div>
                      </dl>
                      <p className="mt-3 flex items-start gap-2 rounded-md bg-sunken p-2.5 text-xs"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{s.mode === "full" ? <span>{s.knownSaving === null ? <>Bunga terjadwal pada cicilan yang dilunasi lebih awal: <strong>{formatIDR(s.interestUpperBound)}</strong>. Ini <strong>batas atas</strong> penghematan yang mungkin, bukan jaminan; tanyakan kuotasi pelunasan ke penyedia dan isi di atas.</> : <>Penghematan dihitung dari angka yang Anda isi, bukan dari aturan kontrak yang diketahui aplikasi.</>}</span> : <span>Pembayaran sebagian dihitung memajukan uang ke cicilan berikutnya (urut dari terdekat). Tanpa aturan kontrak, tidak ada bunga yang dianggap hemat.</span>}</p>
                    </CardBody></Card>
                  </div>
                </section>

                <section aria-labelledby="h-chart" className="mt-8">
                  <Card><CardHeader><CardTitle><span id="h-chart">Saldo kas 12 bulan: A vs B</span></CardTitle><Badge tone="warn">Proyeksi</Badge></CardHeader><CardBody><ScenarioChart points={points} repayDate={s.date} /></CardBody></Card>
                  <details className="mt-3 rounded-card border border-line bg-surface">
                    <summary className="cursor-pointer px-5 py-3 text-sm font-medium">Tabel perbandingan bulanan</summary>
                    <div className="overflow-x-auto"><table className="w-full text-sm">
                      <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2 font-medium">Bulan</th><th scope="col" className="px-4 py-2 text-right font-medium">Kas akhir A</th><th scope="col" className="px-4 py-2 text-right font-medium">Kas akhir B</th><th scope="col" className="px-4 py-2 text-right font-medium">Selisih</th><th scope="col" className="px-4 py-2 text-right font-medium">Terendah A</th><th scope="col" className="px-4 py-2 text-right font-medium">Terendah B</th></tr></thead>
                      <tbody>{sim.a.months.map((m, i) => { const mbm = sim!.b.months[i]; return (
                        <tr key={m.month} className="border-b border-line last:border-0"><td className="whitespace-nowrap px-4 py-2">{formatMonthID(m.month)}</td><td className="num px-4 py-2 text-right">{formatIDR(m.closing)}</td><td className={cn("num px-4 py-2 text-right", mbm.closing < 0 && "text-loss")}>{formatIDR(mbm.closing)}</td><td className="num px-4 py-2 text-right">{signed(mbm.closing - m.closing)}</td><td className="num px-4 py-2 text-right">{formatIDR(m.lowest)}</td><td className={cn("num px-4 py-2 text-right", mbm.lowest < 0 && "text-loss")}>{formatIDR(mbm.lowest)}</td></tr>); })}</tbody>
                    </table></div>
                  </details>
                </section>

                <section aria-labelledby="h-real" className="mt-8">
                  <Card><CardHeader><CardTitle><span id="h-real">5. Catat pelunasan sungguhan</span></CardTitle></CardHeader>
                    <CardBody className="space-y-3 text-sm">
                      <p className="text-muted">Simulasi di atas tidak mengubah catatan apa pun. Mencatat pelunasan yang benar-benar Anda bayar adalah langkah terpisah dan hanya dengan konfirmasi Anda.</p>
                      {canRecord && debtNow ? <ConfirmSettlement debtId={debtNow.id} debtName={sim.debtLabel} outstanding={debtNow.outstanding} fee={s.fee} penalty={s.penalty} today={today} accounts={accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance }))} defaultAccountId={debtNow.payment_account_id} />
                        : <p className="flex items-start gap-2 rounded-md bg-sunken p-3"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{s.mode === "partial" ? <>Untuk pembayaran sebagian, catat lewat <Link className="underline" href={`/debts/${q.params.debt_id}`}>halaman utang</Link> setelah Anda membayar.</> : s.rebateKind !== "none" ? <>Pelunasan dengan rebat atau kuotasi tidak bisa dicatat otomatis di sini karena buku besar tidak mengenal potongan. Catat nominal yang benar-benar Anda bayar lewat <Link className="underline" href={`/debts/${q.params.debt_id}`}>halaman utang</Link>.</> : <>Tanggal pelunasan belum tiba. Setelah Anda membayar, ubah tanggal ke hari ini atau catat lewat <Link className="underline" href={`/debts/${q.params.debt_id}`}>halaman utang</Link>.</>}</span></p>}
                    </CardBody></Card>
                </section>
              </>
            );
          })()}

          <section aria-labelledby="h-saved" className="mt-8">
            <h2 id="h-saved" className="mb-2 font-display text-xl font-semibold">Skenario tersimpan</h2>
            <Card><CardBody>
              <ScenarioManager canSave={!!sim} saved={savedItems} fields={{ debt: sp.debt ?? "", date: q.raw.date, mode: q.params?.mode ?? "full", amt: q.raw.amount, quote: q.raw.quote, rb: q.raw.rebate, fee: q.raw.fee, pen: q.raw.penalty, preset: q.preset, buf: q.raw.buffer }} />
              {compareCols.length > 0 && (
                <div className="mt-5 overflow-x-auto"><table className="w-full text-sm">
                  <caption className="mb-2 flex items-center gap-2 text-left font-medium"><Scale className="h-4 w-4" aria-hidden />Perbandingan skenario tersimpan (dihitung ulang dengan data hari ini)</caption>
                  <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-3 py-2 font-medium">Ukuran</th>{compareCols.map((c) => <th key={c.s.id} scope="col" className="px-3 py-2 font-medium">{c.s.name}</th>)}</tr></thead>
                  <tbody>
                    {([
                      ["Utang", (c: SimulationResult) => c.debtLabel], ["Tanggal", (c: SimulationResult) => formatDateID(c.settlement.date)], ["Jenis", (c: SimulationResult) => (c.settlement.mode === "full" ? "Penuh" : "Sebagian")],
                      ["Uang keluar", (c: SimulationResult) => formatIDR(c.settlement.cashOut)], ["Kas akhir 12 bulan", (c: SimulationResult) => formatIDR(c.mb.closingCash)], ["Saldo terendah", (c: SimulationResult) => formatIDR(c.mb.lowest.balance)],
                      ["Hari negatif", (c: SimulationResult) => String(c.mb.deficitDays)], ["Risiko likuiditas", (c: SimulationResult) => RISK[c.mb.risk][1]], ["Tanggal bebas utang", (c: SimulationResult) => (c.debtFreeB ? formatDateID(c.debtFreeB) : "—")],
                    ] as [string, (c: SimulationResult) => string][]).map(([l, f]) => (
                      <tr key={l} className="border-b border-line last:border-0"><th scope="row" className="px-3 py-2 text-left font-medium">{l}</th>{compareCols.map((c) => <td key={c.s.id} className="num px-3 py-2">{c.sim ? f(c.sim) : <span className="text-loss">{l === "Utang" ? c.error : "—"}</span>}</td>)}</tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </CardBody></Card>
          </section>

          <section aria-labelledby="h-strat" className="mt-10">
            <h2 id="h-strat" className="mb-1 font-display text-xl font-semibold">Strategi pelunasan beberapa utang</h2>
            <p className="mb-3 max-w-prose text-sm text-muted">Semua utang tetap dicicil sesuai jadwal. Anggaran tambahan per bulan dipakai untuk melunasi cicilan berikutnya dari satu utang sasaran, sesuai strategi. Tanpa rebat, semua strategi membayar total yang sama dan hanya berbeda pada kecepatan bebas utang.</p>
            <Card><CardBody className="space-y-5">
              <form method="get" action="/early-repayment" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                {hidden(["debt", "date", "mode", "amt", "quote", "rb", "fee", "pen", "preset", "buf", "cmp"])}
                <label className="space-y-1.5 text-sm font-medium lg:col-span-2">Anggaran tambahan per bulan<Input name="extra" defaultValue={q.strategy.rawExtra} inputMode="numeric" placeholder="Contoh: 500rb" className="font-normal" /><span className="block text-xs font-normal text-muted">Surplus rutin Anda ±{formatIDR(Math.max(0, baselineSurplus))} / bulan (proyeksi baseline).</span></label>
                <label className="space-y-1.5 text-sm font-medium">Rebat bunga (%)<Input name="srb" defaultValue={q.strategy.rawRebate} inputMode="decimal" placeholder="0" className="font-normal" /><span className="block text-xs font-normal text-muted">Berlaku bagi cicilan yang dibayar lebih awal.</span></label>
                {[1, 2, 3, 4].slice(0, Math.min(4, ctx.debts.length)).map((n) => (
                  <label key={n} className="space-y-1.5 text-sm font-medium">Prioritas kustom {n}<Select name={`p${n}`} defaultValue={sp[`p${n}`] ?? ""} className="font-normal"><option value="">—</option>{ctx.debts.map((d) => <option key={d.debt_id} value={d.debt_id}>{debtName(d.debt_id)}</option>)}</Select></label>
                ))}
                <div className="flex items-end"><Button type="submit" variant="secondary">Bandingkan strategi</Button></div>
              </form>
              {strategyError && <p role="alert" className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{strategyError}</p>}
              {strategies.length > 0 && (
                <>
                  <div className="overflow-x-auto rounded-md border border-line"><table className="w-full text-sm">
                    <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-3 py-2 font-medium">Strategi</th><th scope="col" className="px-3 py-2 text-right font-medium">Bebas utang</th><th scope="col" className="px-3 py-2 text-right font-medium">Bulan</th><th scope="col" className="px-3 py-2 text-right font-medium">Total dibayar</th><th scope="col" className="px-3 py-2 text-right font-medium">Bunga &amp; biaya dibayar</th><th scope="col" className="px-3 py-2 text-right font-medium">Hemat vs minimum</th><th scope="col" className="px-3 py-2 font-medium">Lunas per utang</th></tr></thead>
                    <tbody>{strategies.map((s) => { const min = strategies[0]; const saved = min.interestFeePaid - s.interestFeePaid; return (
                      <tr key={s.key} className="border-b border-line align-top last:border-0">
                        <td className="px-3 py-2"><span className="font-medium">{STRATEGY_LABEL[s.key]}</span><p className="max-w-xs text-xs text-muted">{STRATEGY_HELP[s.key]}</p></td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{s.debtFreeMonth ? formatMonthID(s.debtFreeMonth) : "—"}</td><td className="num px-3 py-2 text-right">{s.monthsToDebtFree}</td>
                        <td className="num whitespace-nowrap px-3 py-2 text-right">{formatIDR(s.totalPaid)}</td><td className="num whitespace-nowrap px-3 py-2 text-right">{formatIDR(s.interestFeePaid)}</td>
                        <td className={cn("num whitespace-nowrap px-3 py-2 text-right", saved > 0 && "text-gain")}>{s.key === "minimum" ? "—" : saved > 0 ? formatIDR(saved) : "Rp 0"}</td>
                        <td className="px-3 py-2 text-xs"><ul className="space-y-0.5">{ctx.debts.map((d) => <li key={d.debt_id}>{debtName(d.debt_id)}: {monthOf(d.debt_id, s)}</li>)}</ul></td>
                      </tr>); })}</tbody>
                  </table></div>
                  {q.strategy.extra === 0 && <p className="flex items-start gap-2 text-sm text-muted"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Anggaran tambahan masih Rp 0, jadi semua strategi sama dengan cicilan minimum. Isi anggaran tambahan untuk melihat perbedaannya.</p>}
                  <StrategyChart rows={stratRows} />
                  <div className="overflow-x-auto rounded-md border border-line"><table className="w-full text-sm">
                    <caption className="px-3 pt-3 text-left text-sm font-medium">Dasar peringkat avalanche (angka dari jadwal Anda)</caption>
                    <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-3 py-2 font-medium">Utang</th><th scope="col" className="px-3 py-2 text-right font-medium">Sisa saldo</th><th scope="col" className="px-3 py-2 text-right font-medium">Bunga+biaya terjadwal / Rp pokok</th><th scope="col" className="px-3 py-2 text-right font-medium">Bunga tercatat</th></tr></thead>
                    <tbody>{ctx.debts.map((d) => <tr key={d.debt_id} className="border-b border-line last:border-0"><td className="px-3 py-2">{debtName(d.debt_id)}</td><td className="num px-3 py-2 text-right">{formatIDR(d.rows.reduce((s, r) => s + r.remaining, 0))}</td><td className="num px-3 py-2 text-right">{(impliedCostRatio(d) * 100).toFixed(1)}%</td><td className="px-3 py-2 text-right">{d.rate_bps ? `${(d.rate_bps / 100).toLocaleString("id-ID")}% / bulan` : "—"}</td></tr>)}</tbody>
                  </table></div>
                </>
              )}
            </CardBody></Card>
          </section>
        </>
      )}
    </>
  );
}
