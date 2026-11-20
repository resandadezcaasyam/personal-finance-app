"use client";
import * as React from "react";
import { useFormState } from "react-dom";
import { Check, Link2, Pencil, Plus, SkipForward, Trash2, Wand2, X, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/toast";
import { CategoryOptions } from "@/components/ledger/category-options";
import { formatDateID, formatIDR } from "@/lib/format";
import type { AccountWithBalance, CategoryRow } from "@/lib/ledger/types";
import type { PlannedItem, PatternSuggestion, RuleRow } from "@/lib/automation/recurring";
import { confirmOccurrenceAction, createRuleFromPatternAction, deleteRuleAction, dismissPatternAction, saveRuleAction, skipOccurrenceAction, toggleRuleAction } from "@/app/actions/phase7";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };
const FREQ: Record<string, string> = { weekly: "Mingguan", monthly: "Bulanan", quarterly: "Per 3 bulan", yearly: "Tahunan" };

function ConfirmForm({ item, accounts, onDone }: { item: PlannedItem; accounts: AccountWithBalance[]; onDone: () => void }) {
  const [state, action] = useFormState(confirmOccurrenceAction, INIT);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast(item.match ? "Ditautkan ke transaksi yang ada" : "Transaksi dicatat"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="rule_id" value={item.rule_id} /><input type="hidden" name="due_date" value={item.due_date} />
      {item.match ? (
        <>
          <input type="hidden" name="link_transaction_id" value={item.match.transaction_id} />
          <p className="rounded-md bg-sunken px-3 py-2 text-sm">Sudah ada transaksi yang tampak sama: <strong>{item.match.description || "(tanpa keterangan)"}</strong> {formatIDR(item.match.amount)} pada {formatDateID(item.match.date)}. Menautkannya <strong>tidak membuat transaksi baru</strong>, jadi saldo tidak terhitung dua kali.</p>
        </>
      ) : (
        <>
          <p className="rounded-md bg-sunken px-3 py-2 text-sm">{item.type === "income" ? "Pemasukan" : "Pengeluaran"} <strong>{item.name}</strong> jadwal {formatDateID(item.due_date)} akan dicatat sebagai satu transaksi.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="cf-acc" label={item.type === "income" ? "Masuk ke akun" : "Dibayar dari akun"} error={e.account_id}>
              <Select id="cf-acc" name="account_id" defaultValue={item.account_id ?? accounts[0]?.id}>{accounts.filter((a) => !a.is_archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            </FormField>
            <FormField id="cf-amt" label="Nominal" error={e.amount} hint="Ubah bila nominal bulan ini berbeda."><Input id="cf-amt" name="amount" inputMode="numeric" defaultValue={item.amount} /></FormField>
          </div>
        </>
      )}
      <FormError message={!state.errors ? state.message : undefined} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton pendingLabel="Memproses…">{item.match ? "Tautkan" : "Catat transaksi"}</SubmitButton></div>
    </form>
  );
}

function RuleForm({ rule, accounts, categories, today, onDone }: { rule?: RuleRow; accounts: AccountWithBalance[]; categories: CategoryRow[]; today: string; onDone: () => void }) {
  const [state, action] = useFormState(saveRuleAction, INIT);
  const [type, setType] = React.useState<"income" | "expense">(rule?.type ?? "income");
  const [freq, setFreq] = React.useState(rule?.frequency ?? "monthly");
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast(rule ? "Aturan diperbarui" : "Aturan ditambahkan"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="rl-name" label="Nama" error={e.name}><Input id="rl-name" name="name" defaultValue={rule?.name} required maxLength={80} autoFocus placeholder="Gaji, Sewa kos, Arisan" /></FormField>
        <FormField id="rl-type" label="Jenis" error={e.type}><Select id="rl-type" name="type" value={type} onChange={(ev) => setType(ev.target.value as "income" | "expense")}><option value="income">Pemasukan</option><option value="expense">Pengeluaran</option></Select></FormField>
        <FormField id="rl-amt" label="Nominal" error={e.amount}><Input id="rl-amt" name="amount" inputMode="numeric" defaultValue={rule?.amount} required placeholder="9jt" /></FormField>
        <FormField id="rl-acc" label="Akun" error={e.account_id}><Select id="rl-acc" name="account_id" defaultValue={rule?.account_id ?? ""}><option value="">Pilih saat konfirmasi</option>{accounts.filter((a) => !a.is_archived || a.id === rule?.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormField>
        <FormField id="rl-cat" label="Kategori" error={e.category_id}><Select id="rl-cat" name="category_id" key={type} defaultValue={rule?.category_id ?? ""}><CategoryOptions categories={categories} kind={type} selectedId={rule?.category_id} /></Select></FormField>
        <FormField id="rl-freq" label="Frekuensi" error={e.frequency}><Select id="rl-freq" name="frequency" value={freq} onChange={(ev) => setFreq(ev.target.value as typeof freq)}>{Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
        {freq !== "weekly" && <FormField id="rl-day" label="Tanggal tiap periode" error={e.day_of_month} hint="1–31; bulan yang lebih pendek memakai tanggal terakhir."><Input id="rl-day" name="day_of_month" type="number" min={1} max={31} defaultValue={rule?.day_of_month ?? 25} required /></FormField>}
        <FormField id="rl-start" label="Mulai" error={e.start_date}><Input id="rl-start" name="start_date" type="date" defaultValue={rule?.start_date ?? today} required /></FormField>
        <FormField id="rl-end" label="Berakhir (opsional)" error={e.end_date}><Input id="rl-end" name="end_date" type="date" defaultValue={rule?.end_date ?? ""} /></FormField>
      </div>
      <p className="text-xs text-muted">Aturan hanya menyiapkan jadwal. Tidak ada transaksi yang dibuat sebelum Anda mengonfirmasinya. Perubahan berlaku untuk jadwal yang belum diputuskan.</p>
      <FormError message={!state.errors ? state.message : undefined} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Simpan</SubmitButton></div>
    </form>
  );
}

export function AutomationManager({ planned, rules, patterns, accounts, categories, today }: {
  planned: PlannedItem[]; rules: RuleRow[]; patterns: (PatternSuggestion & { account_name: string; category_name: string | null })[]; accounts: AccountWithBalance[]; categories: CategoryRow[]; today: string;
}) {
  const [confirm, setConfirm] = React.useState<PlannedItem | null>(null);
  const [skip, setSkip] = React.useState<PlannedItem | null>(null);
  const [ruleDlg, setRuleDlg] = React.useState<{ rule?: RuleRow } | null>(null);
  const [del, setDel] = React.useState<RuleRow | null>(null);
  const [err, setErr] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const toast = useToast();
  const run = (fn: () => Promise<ActionState>, ok: string) => startTransition(async () => { const r = await fn(); toast(r.ok ? ok : r.message ?? "Gagal", r.ok ? "ok" : "error"); });
  const stateBadge = (p: PlannedItem) => p.state === "overdue" ? <Badge tone="loss">Terlambat {-p.days} hari</Badge> : p.state === "due" ? <Badge tone="warn">Hari ini</Badge> : <Badge>{p.days} hari lagi</Badge>;

  return (
    <div className="space-y-10">
      <section aria-labelledby="h-planned">
        <h2 id="h-planned" className="mb-1 font-display text-xl font-semibold">Jadwal menunggu keputusan</h2>
        <p className="mb-3 max-w-prose text-sm text-muted">Ini rencana, bukan catatan. Saldo baru berubah setelah Anda mengonfirmasi. Jadwal yang sudah ada transaksinya ditawarkan untuk ditautkan agar tidak dicatat ganda.</p>
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          {planned.length === 0 ? <div className="p-5"><EmptyState icon={Repeat} title="Tidak ada jadwal yang menunggu" description="Jadwal dari aturan berulang yang jatuh tempo (dan 7 hari ke depan) muncul di sini." /></div> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2.5 font-medium">Jadwal</th><th scope="col" className="px-4 py-2.5 font-medium">Nama</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Nominal</th><th scope="col" className="px-4 py-2.5 font-medium">Akun</th><th scope="col" className="px-4 py-2.5 font-medium">Status</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Aksi</th></tr></thead>
              <tbody>
                {planned.map((p) => (
                  <tr key={`${p.rule_id}-${p.due_date}`} className="border-b border-line align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-3">{formatDateID(p.due_date)}</td>
                    <td className="px-4 py-3"><span className="font-medium">{p.name}</span> <Badge tone={p.type === "income" ? "brand" : "neutral"}>{p.type === "income" ? "Pemasukan" : "Pengeluaran"}</Badge>
                      {p.match && <p className="mt-1 flex items-center gap-1 text-xs text-brand"><Link2 className="h-3 w-3" aria-hidden />Cocok dengan transaksi {formatDateID(p.match.date)} · {formatIDR(p.match.amount)}</p>}</td>
                    <td className={`num whitespace-nowrap px-4 py-3 text-right ${p.type === "income" ? "text-gain" : ""}`}>{p.type === "income" ? "+" : "−"}{formatIDR(p.amount)}</td>
                    <td className="px-4 py-3">{p.account_name ?? <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-3">{stateBadge(p)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {p.state === "upcoming" && !p.match ? <span className="text-xs text-muted">Belum jatuh tempo</span> : <Button size="sm" onClick={() => setConfirm(p)}>{p.match ? <><Link2 className="h-4 w-4" aria-hidden />Tautkan</> : <><Check className="h-4 w-4" aria-hidden />Konfirmasi</>}</Button>}
                      <Button size="sm" variant="ghost" aria-label={`Lewati ${p.name}`} onClick={() => setSkip(p)}><SkipForward className="h-4 w-4" aria-hidden /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {patterns.length > 0 && (
        <section aria-labelledby="h-patterns">
          <h2 id="h-patterns" className="mb-1 font-display text-xl font-semibold">Pola berulang terdeteksi</h2>
          <p className="mb-3 max-w-prose text-sm text-muted">Dari riwayat transaksi Anda: kemunculan teratur dengan nominal yang stabil. Ini hanya saran; tidak ada aturan dibuat sebelum Anda menyetujuinya.</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {patterns.map((s) => (
              <li key={s.key} className="rounded-card border border-line bg-surface p-4">
                <p className="flex items-center gap-2 font-medium"><Wand2 className="h-4 w-4 text-brand" aria-hidden />{s.name}</p>
                <p className="mt-1 text-sm text-muted">{s.type === "income" ? "Pemasukan" : "Pengeluaran"} {formatIDR(s.amount)} · {s.frequency === "monthly" ? `tiap bulan sekitar tanggal ${s.day_of_month}` : "tiap minggu"} · {s.account_name}{s.category_name ? ` · ${s.category_name}` : ""}</p>
                <p className="mt-1 text-xs text-muted">Terdeteksi {s.occurrences} kali, terakhir {formatDateID(s.last_date)}.</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" disabled={pending} onClick={() => run(() => createRuleFromPatternAction(s.key), "Aturan dibuat")}><Plus className="h-4 w-4" aria-hidden />Buat aturan</Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dismissPatternAction(s.key), "Saran diabaikan")}><X className="h-4 w-4" aria-hidden />Abaikan</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="h-rules">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="h-rules" className="font-display text-xl font-semibold">Aturan berulang</h2>
          <Button variant="secondary" onClick={() => setRuleDlg({})}><Plus className="h-4 w-4" aria-hidden />Tambah aturan</Button>
        </div>
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          {rules.length === 0 ? <div className="p-5"><EmptyState icon={Repeat} title="Belum ada aturan berulang" description="Tambahkan gaji, sewa, arisan, atau pengeluaran rutin lain agar tinggal dikonfirmasi tiap periode, dan agar proyeksi arus kas lebih akurat." /></div> : (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-left text-muted"><th scope="col" className="px-4 py-2.5 font-medium">Nama</th><th scope="col" className="px-4 py-2.5 font-medium">Jadwal</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Nominal</th><th scope="col" className="px-4 py-2.5 font-medium">Akun · Kategori</th><th scope="col" className="px-4 py-2.5 font-medium">Status</th><th scope="col" className="px-4 py-2.5 text-right font-medium">Aksi</th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className={`px-4 py-3 ${r.is_active ? "" : "opacity-60"}`}><span className="font-medium">{r.name}</span> <Badge tone={r.type === "income" ? "brand" : "neutral"}>{r.type === "income" ? "Pemasukan" : "Pengeluaran"}</Badge></td>
                    <td className="px-4 py-3">{FREQ[r.frequency]}{r.day_of_month ? `, tgl ${r.day_of_month}` : ""}<p className="text-xs text-muted">sejak {formatDateID(r.start_date)}{r.end_date ? ` sampai ${formatDateID(r.end_date)}` : ""}</p></td>
                    <td className="num whitespace-nowrap px-4 py-3 text-right">{formatIDR(r.amount)}</td>
                    <td className="px-4 py-3">{r.account_name ?? "—"} <span className="text-muted">· {r.category_name ?? "tanpa kategori"}</span></td>
                    <td className="px-4 py-3"><Badge tone={r.is_active ? "brand" : "neutral"}>{r.is_active ? "Aktif" : "Nonaktif"}</Badge></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" aria-label={`Ubah ${r.name}`} onClick={() => setRuleDlg({ rule: r })}><Pencil className="h-4 w-4" aria-hidden /></Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => toggleRuleAction(r.id, !r.is_active), r.is_active ? "Aturan dinonaktifkan" : "Aturan diaktifkan")}>{r.is_active ? "Nonaktifkan" : "Aktifkan"}</Button>
                      <Button size="sm" variant="ghost" aria-label={`Hapus ${r.name}`} onClick={() => { setDel(r); setErr(undefined); }}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <Dialog wide open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.match ? "Tautkan jadwal" : "Konfirmasi jadwal"}>{confirm && <ConfirmForm item={confirm} accounts={accounts} onDone={() => setConfirm(null)} />}</Dialog>
      <Dialog wide open={!!ruleDlg} onClose={() => setRuleDlg(null)} title={ruleDlg?.rule ? "Ubah aturan" : "Aturan berulang baru"}>{ruleDlg && <RuleForm rule={ruleDlg.rule} accounts={accounts} categories={categories} today={today} onDone={() => setRuleDlg(null)} />}</Dialog>
      <ConfirmDialog open={!!skip} onCancel={() => setSkip(null)} pending={pending} confirmLabel="Lewati jadwal ini" title={`Lewati ${skip?.name ?? ""}?`} description={skip ? `Jadwal ${formatDateID(skip.due_date)} tidak akan dicatat dan tidak muncul lagi. Gunakan jika pemasukan/pengeluaran ini tidak terjadi.` : ""}
        onConfirm={() => skip && startTransition(async () => { const r = await skipOccurrenceAction(skip.rule_id, skip.due_date); toast(r.ok ? "Jadwal dilewati" : r.message ?? "Gagal", r.ok ? "ok" : "error"); setSkip(null); })} />
      <ConfirmDialog open={!!del} onCancel={() => setDel(null)} danger pending={pending} error={err} confirmLabel="Hapus aturan" title={`Hapus aturan ${del?.name ?? ""}?`} description="Aturan yang sudah punya riwayat konfirmasi tidak bisa dihapus; nonaktifkan saja."
        onConfirm={() => del && startTransition(async () => { const r = await deleteRuleAction(del.id); if (r.ok) { toast("Aturan dihapus"); setDel(null); } else setErr(r.message); })} />
    </div>
  );
}
