"use client";
import { bannerMessage } from "@/lib/form-state";
import * as React from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import { Copy, Trash2, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { useToast } from "@/components/toast";
import { formatIDR } from "@/lib/format";
import { confirmSettlementAction, deleteRepayScenarioAction, duplicateRepayScenarioAction, saveRepayScenarioAction } from "@/app/actions/repay";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };

export interface SavedItem { id: number; name: string; summary: string; openHref: string; compared: boolean; toggleHref: string }

/** Save the current assumptions, and manage saved scenarios (open, compare, duplicate, delete). None of this touches real data. */
export function ScenarioManager({ fields, saved, canSave }: { fields: Record<string, string>; saved: SavedItem[]; canSave: boolean }) {
  const [state, action] = useFormState(saveRepayScenarioAction, INIT);
  const [pending, startTransition] = React.useTransition();
  const ref = React.useRef<HTMLFormElement>(null);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast("Skenario disimpan"); ref.current?.reset(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = (fn: () => Promise<ActionState>, ok: string) => startTransition(async () => { const r = await fn(); toast(r.ok ? ok : r.message ?? "Gagal", r.ok ? "ok" : "error"); });
  return (
    <div className="space-y-4">
      <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
        {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="space-y-1 text-xs text-muted">Simpan simulasi ini sebagai<Input name="name" required maxLength={50} placeholder="Contoh: Lunasi SeaBank Januari" disabled={!canSave} className="h-9 w-64 text-sm text-ink" /></label>
        <SubmitButton pendingLabel="Menyimpan…" disabled={!canSave}>Simpan skenario</SubmitButton>
      </form>
      <FormError message={!state.ok ? state.message : undefined} />
      {saved.length === 0 ? <p className="text-sm text-muted">Belum ada skenario tersimpan. Simpan beberapa variasi (tanggal atau nominal berbeda) lalu bandingkan berdampingan.</p> : (
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {saved.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0"><Link href={s.openHref} className="font-medium text-brand-text underline">{s.name}</Link><p className="text-xs text-muted">{s.summary}</p></div>
              <div className="flex items-center gap-1">
                <Link href={s.toggleHref} className="inline-flex h-8 items-center rounded-md border border-line px-2 text-xs hover:bg-sunken">{s.compared ? "✓ Dibandingkan" : "Bandingkan"}</Link>
                <Button size="sm" variant="ghost" aria-label={`Duplikat ${s.name}`} disabled={pending} onClick={() => act(() => duplicateRepayScenarioAction(s.id), "Skenario diduplikat")}><Copy className="h-4 w-4" aria-hidden /></Button>
                <Button size="sm" variant="ghost" aria-label={`Hapus ${s.name}`} disabled={pending} onClick={() => act(() => deleteRepayScenarioAction(s.id), "Skenario dihapus")}><Trash2 className="h-4 w-4" aria-hidden /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Recording the real repayment: explicit, separate, and only for a settlement the ledger can represent exactly. */
export function ConfirmSettlement({ debtId, debtName, outstanding, fee, penalty, today, accounts, defaultAccountId }: {
  debtId: number; debtName: string; outstanding: number; fee: number; penalty: number; today: string; accounts: { id: number; name: string; balance: number }[]; defaultAccountId: number | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, action] = useFormState(confirmSettlementAction, INIT);
  const e = state.errors ?? {};
  return (
    <>
      <Button onClick={() => setOpen(true)}><Banknote className="h-4 w-4" aria-hidden />Catat pelunasan sungguhan…</Button>
      <Dialog wide open={open} onClose={() => setOpen(false)} title={`Catat pelunasan ${debtName}`} description="Ini bukan simulasi: saldo akun akan berkurang dan utang ditandai lunas.">
        {open && (
          <form action={action} className="space-y-4">
            <input type="hidden" name="debt_id" value={debtId} />
            <p className="rounded-md bg-sunken px-3 py-2 text-sm">Sisa kewajiban saat ini <strong className="num">{formatIDR(outstanding)}</strong>{fee + penalty > 0 && <> + biaya/denda <strong className="num">{formatIDR(fee + penalty)}</strong></>}. Total uang keluar: <strong className="num">{formatIDR(outstanding + fee + penalty)}</strong>, dicatat sebagai satu pengeluaran.</p>
            <input type="hidden" name="fee" value={fee} /><input type="hidden" name="penalty" value={penalty} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="cs-acc" label="Dibayar dari akun" error={e.account_id}><Select id="cs-acc" name="account_id" defaultValue={defaultAccountId ?? accounts[0]?.id}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {formatIDR(a.balance)}</option>)}</Select></FormField>
              <FormField id="cs-date" label="Tanggal bayar" error={e.paid_on}><Input id="cs-date" name="paid_on" type="date" defaultValue={today} max={today} required /></FormField>
            </div>
            <FormError message={bannerMessage(state)} />
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Batal</Button><SubmitButton pendingLabel="Mencatat…" disabled={accounts.length === 0}>Ya, catat pelunasan</SubmitButton></div>
          </form>
        )}
      </Dialog>
    </>
  );
}
