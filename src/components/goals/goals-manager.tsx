"use client";
import { bannerMessage } from "@/lib/form-state";
import * as React from "react";
import { useFormState } from "react-dom";
import { Archive, ArchiveRestore, PiggyBank, Plus, Trash2, Pencil, HandCoins, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/toast";
import { formatDateID, formatIDR } from "@/lib/format";
import { GOAL_KIND_LABEL, type GoalView } from "@/lib/goals/goals";
import type { AccountWithBalance } from "@/lib/ledger/types";
import { archiveGoalAction, contributeAction, deleteGoalAction, removeContributionAction, saveGoalAction } from "@/app/actions/phase7";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };
interface Contribution { id: number; amount: number; contributed_on: string; note: string | null; account_name: string | null }

function GoalForm({ goal, hint, onDone }: { goal?: GoalView; hint: { months3: number; months6: number }; onDone: () => void }) {
  const [state, action] = useFormState(saveGoalAction, INIT);
  const [kind, setKind] = React.useState(goal?.kind ?? "custom");
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast(goal ? "Target diperbarui" : "Target dibuat"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      {goal && <input type="hidden" name="id" value={goal.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="g-name" label="Nama target" error={e.name}><Input id="g-name" name="name" defaultValue={goal?.name} required maxLength={60} autoFocus placeholder="Dana darurat, Liburan Bali" /></FormField>
        <FormField id="g-kind" label="Jenis" error={e.kind}><Select id="g-kind" name="kind" value={kind} onChange={(ev) => setKind(ev.target.value as typeof kind)}>{Object.entries(GOAL_KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
        <FormField id="g-target" label="Jumlah target" error={e.target_amount}><Input id="g-target" name="target_amount" inputMode="numeric" defaultValue={goal?.target_amount} required placeholder="10jt" /></FormField>
        <FormField id="g-date" label="Tanggal target (opsional)" error={e.target_date}><Input id="g-date" name="target_date" type="date" defaultValue={goal?.target_date ?? ""} /></FormField>
      </div>
      {kind === "emergency" && hint.months3 > 0 && <p className="rounded-md bg-sunken px-3 py-2 text-sm">Patokan umum dana darurat adalah 3–6 bulan pengeluaran. Dari kebiasaan belanja Anda: <strong className="num">{formatIDR(hint.months3)}</strong> (3 bulan) sampai <strong className="num">{formatIDR(hint.months6)}</strong> (6 bulan). Ini hanya petunjuk, bukan keharusan.</p>}
      <FormError message={bannerMessage(state)} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Simpan</SubmitButton></div>
    </form>
  );
}

function ContributeForm({ goal, accounts, today, onDone }: { goal: GoalView; accounts: AccountWithBalance[]; today: string; onDone: () => void }) {
  const [state, action] = useFormState(contributeAction, INIT);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast("Dana tercatat"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="goal_id" value={goal.id} />
      <p className="rounded-md bg-sunken px-3 py-2 text-sm">Terkumpul <strong className="num">{formatIDR(goal.saved_amount)}</strong> dari {formatIDR(goal.target_amount)}. Mencatat dana di sini hanya <strong>menandai uang yang Anda sisihkan</strong>; saldo akun dan transaksi tidak berubah.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="c-dir" label="Jenis"><Select id="c-dir" name="direction" defaultValue="add"><option value="add">Tambah dana</option><option value="withdraw">Tarik dana</option></Select></FormField>
        <FormField id="c-amt" label="Nominal" error={e.amount}><Input id="c-amt" name="amount" inputMode="numeric" required autoFocus placeholder="500rb" aria-invalid={!!e.amount} /></FormField>
        <FormField id="c-date" label="Tanggal" error={e.contributed_on}><Input id="c-date" name="contributed_on" type="date" defaultValue={today} max={today} required /></FormField>
        <FormField id="c-acc" label="Disimpan di akun (opsional)" error={e.account_id}><Select id="c-acc" name="account_id" defaultValue=""><option value="">—</option>{accounts.filter((a) => !a.is_archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormField>
      </div>
      <FormField id="c-note" label="Catatan (opsional)" error={e.note}><Input id="c-note" name="note" maxLength={120} /></FormField>
      <FormError message={bannerMessage(state)} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Catat</SubmitButton></div>
    </form>
  );
}

export function GoalsManager({ goals, histories, accounts, today, hint }: { goals: GoalView[]; histories: Record<number, Contribution[]>; accounts: AccountWithBalance[]; today: string; hint: { months3: number; months6: number } }) {
  const [dlg, setDlg] = React.useState<{ kind: "new" } | { kind: "edit" | "contribute" | "history" | "delete"; goal: GoalView } | null>(null);
  const [err, setErr] = React.useState<string>();
  const [pending, start] = React.useTransition();
  const toast = useToast();
  const close = () => { setDlg(null); setErr(undefined); };
  const act = (fn: () => Promise<ActionState>, ok: string) => start(async () => { const r = await fn(); toast(r.ok ? ok : r.message ?? "Gagal", r.ok ? "ok" : "error"); });
  const active = goals.filter((g) => g.status !== "archived");
  const archived = goals.filter((g) => g.status === "archived");

  const card = (g: GoalView) => (
    <li key={g.id} className="rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-display text-lg font-semibold">{g.name}</h3><p className="text-xs text-muted">{GOAL_KIND_LABEL[g.kind]}{g.target_date ? ` · target ${formatDateID(g.target_date)}` : ""}</p></div>
        <Badge tone={g.status === "achieved" ? "brand" : g.status === "archived" ? "neutral" : g.onTrack === false ? "warn" : "neutral"}>{g.status === "achieved" ? "Tercapai" : g.status === "archived" ? "Diarsipkan" : g.onTrack === false ? "Tertinggal" : g.onTrack ? "Sesuai jalur" : "Berjalan"}</Badge>
      </div>
      <p className="num mt-3 text-2xl font-semibold">{formatIDR(g.saved_amount)}<span className="text-sm font-normal text-muted"> / {formatIDR(g.target_amount)}</span></p>
      <div className="mt-2"><Progress value={Math.min(100, g.pct * 100)} label={`Progres ${g.name}`} /><p className="mt-1 text-xs text-muted">{Math.round(g.pct * 100)}% · sisa {formatIDR(g.remaining)}</p></div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Laju 3 bulan terakhir</dt><dd className="num text-right">{formatIDR(g.avgPerMonth)} / bln</dd>
        {g.requiredPerMonth !== null && <><dt className="text-muted">Dibutuhkan agar tepat waktu</dt><dd className="num text-right">{formatIDR(g.requiredPerMonth)} / bln</dd></>}
        {g.projectedDate && <><dt className="text-muted">Perkiraan tercapai</dt><dd className="text-right">{formatDateID(g.projectedDate)}</dd></>}
      </dl>
      {g.status !== "achieved" && g.status !== "archived" && g.avgPerMonth <= 0 && <p className="mt-2 text-xs text-muted">Belum ada dana dalam 3 bulan terakhir, jadi tanggal tercapai belum bisa diperkirakan.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {g.status !== "archived" && <Button size="sm" onClick={() => setDlg({ kind: "contribute", goal: g })}><HandCoins className="h-4 w-4" aria-hidden />Catat dana</Button>}
        <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "history", goal: g })}><History className="h-4 w-4" aria-hidden />Riwayat ({g.contributions})</Button>
        <Button size="sm" variant="ghost" aria-label={`Ubah ${g.name}`} onClick={() => setDlg({ kind: "edit", goal: g })}><Pencil className="h-4 w-4" aria-hidden /></Button>
        {g.status === "archived" ? <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => archiveGoalAction(g.id, false), "Target dipulihkan")}><ArchiveRestore className="h-4 w-4" aria-hidden />Pulihkan</Button>
          : <Button size="sm" variant="ghost" aria-label={`Arsipkan ${g.name}`} disabled={pending} onClick={() => act(() => archiveGoalAction(g.id, true), "Target diarsipkan")}><Archive className="h-4 w-4" aria-hidden /></Button>}
        {g.contributions === 0 && <Button size="sm" variant="ghost" aria-label={`Hapus ${g.name}`} onClick={() => setDlg({ kind: "delete", goal: g })}><Trash2 className="h-4 w-4" aria-hidden /></Button>}
      </div>
    </li>
  );

  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setDlg({ kind: "new" })}><Plus className="h-4 w-4" aria-hidden />Target baru</Button></div>
      {active.length === 0 ? <div className="rounded-card border border-line bg-surface p-5"><EmptyState icon={PiggyBank} title="Belum ada target tabungan" description="Buat target seperti dana darurat, liburan, atau pembelian besar, lalu catat dana yang Anda sisihkan untuk melihat progres dan perkiraan kapan tercapai." /></div> : <ul className="grid gap-4 lg:grid-cols-2">{active.map(card)}</ul>}
      {archived.length > 0 && <details className="mt-6 rounded-card border border-line bg-surface"><summary className="cursor-pointer px-5 py-3 text-sm font-medium">Diarsipkan ({archived.length})</summary><ul className="grid gap-4 p-4 lg:grid-cols-2">{archived.map(card)}</ul></details>}

      <Dialog wide open={dlg?.kind === "new"} onClose={close} title="Target tabungan baru">{dlg?.kind === "new" && <GoalForm hint={hint} onDone={close} />}</Dialog>
      <Dialog wide open={dlg?.kind === "edit"} onClose={close} title="Ubah target">{dlg?.kind === "edit" && <GoalForm goal={dlg.goal} hint={hint} onDone={close} />}</Dialog>
      <Dialog wide open={dlg?.kind === "contribute"} onClose={close} title={dlg?.kind === "contribute" ? `Catat dana: ${dlg.goal.name}` : ""}>{dlg?.kind === "contribute" && <ContributeForm goal={dlg.goal} accounts={accounts} today={today} onDone={close} />}</Dialog>
      <Dialog wide open={dlg?.kind === "history"} onClose={close} title={dlg?.kind === "history" ? `Riwayat: ${dlg.goal.name}` : ""}>
        {dlg?.kind === "history" && ((histories[dlg.goal.id] ?? []).length === 0 ? <p className="text-sm text-muted">Belum ada catatan dana.</p> : (
          <ul className="divide-y divide-line text-sm">{(histories[dlg.goal.id] ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2"><span><span className={`num font-medium ${c.amount < 0 ? "text-loss" : "text-gain"}`}>{c.amount < 0 ? "−" : "+"}{formatIDR(Math.abs(c.amount))}</span> <span className="text-muted">· {formatDateID(c.contributed_on)}{c.account_name ? ` · ${c.account_name}` : ""}{c.note ? ` · ${c.note}` : ""}</span></span>
              <Button size="sm" variant="ghost" aria-label="Hapus catatan" disabled={pending} onClick={() => act(() => removeContributionAction(c.id), "Catatan dihapus")}><Trash2 className="h-4 w-4" aria-hidden /></Button></li>))}</ul>))}
      </Dialog>
      <ConfirmDialog open={dlg?.kind === "delete"} onCancel={close} danger pending={pending} error={err} confirmLabel="Hapus target" title={dlg?.kind === "delete" ? `Hapus ${dlg.goal.name}?` : ""} description="Target yang belum punya catatan dana dihapus permanen."
        onConfirm={() => dlg?.kind === "delete" && start(async () => { const r = await deleteGoalAction(dlg.goal.id); if (r.ok) { toast("Target dihapus"); close(); } else setErr(r.message); })} />
    </>
  );
}
