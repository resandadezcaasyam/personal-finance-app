"use client";
import { bannerMessage } from "@/lib/form-state";
import * as React from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import { Pencil, Scale, Archive, ArchiveRestore, History, Plus, Landmark, Banknote, Smartphone, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/toast";
import { formatIDR, parseIDR } from "@/lib/format";
import { ACCOUNT_TYPE_LABEL, type AccountWithBalance } from "@/lib/ledger/types";
import { saveAccountAction, reconcileAction, archiveAccountAction, restoreAccountAction, type ActionState } from "@/app/actions/ledger";

const INIT: ActionState = { ok: false };
type Dlg = { kind: "create" } | { kind: "edit" | "reconcile" | "archive"; account: AccountWithBalance } | null;

function AccountForm({ account, onDone }: { account?: AccountWithBalance; onDone: () => void }) {
  const [state, action] = useFormState(saveAccountAction, INIT);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast(account ? "Akun diperbarui" : "Akun ditambahkan"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      {account && <input type="hidden" name="id" value={account.id} />}
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <FormField id="acc-name" label="Nama akun" error={e.name} hint="Contoh: BCA, SeaBank, ShopeePay, GoPay, Tunai">
          <Input id="acc-name" name="name" defaultValue={account?.name} required maxLength={60} autoFocus aria-invalid={!!e.name} />
        </FormField>
        <FormField id="acc-type" label="Jenis" error={e.type}>
          <Select id="acc-type" name="type" defaultValue={account?.type ?? "bank"}>
            {Object.entries(ACCOUNT_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </FormField>
      </div>
      <FormField id="acc-init" label="Saldo awal" error={e.initial_balance}
        hint={account ? "Mengubah saldo awal ikut mengubah saldo saat ini sebesar selisihnya. Untuk menyesuaikan dengan saldo nyata, gunakan Rekonsiliasi." : "Saldo saat akun mulai dicatat di sini. Contoh: 1.500.000 atau 2jt"}>
        <Input id="acc-init" name="initial_balance" inputMode="numeric" defaultValue={account ? String(account.initial_balance) : "0"} aria-invalid={!!e.initial_balance} />
      </FormField>
      <FormError message={bannerMessage(state)} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Simpan</SubmitButton></div>
    </form>
  );
}

function ReconcileForm({ account, today, onDone }: { account: AccountWithBalance; today: string; onDone: () => void }) {
  const [state, action] = useFormState(reconcileAction, INIT);
  const [actual, setActual] = React.useState("");
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast(state.message ?? "Rekonsiliasi selesai"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const neg = actual.trim().startsWith("-");
  const parsed = parseIDR(neg ? actual.trim().slice(1) : actual);
  const diff = parsed === null ? null : (neg ? -parsed : parsed) - account.balance;
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="account_id" value={account.id} />
      <div className="rounded-xl bg-tint px-4 py-3"><p className="text-xs text-muted">Saldo tercatat di aplikasi</p><p className="num text-xl font-semibold tracking-tight">{formatIDR(account.balance)}</p></div>
      <FormField id="rc-actual" label="Saldo aktual" error={e.actual_balance} hint="Lihat saldo di aplikasi bank/e-wallet atau hitung uang tunai.">
        <Input id="rc-actual" name="actual_balance" inputMode="numeric" value={actual} onChange={(ev) => setActual(ev.target.value)} required autoFocus aria-invalid={!!e.actual_balance} />
      </FormField>
      {diff !== null && (
        <p role="status" className="text-sm">
          {diff === 0 ? "Saldo sudah sesuai." : <>Selisih <strong className={`num ${diff > 0 ? "text-gain" : "text-loss"}`}>{diff > 0 ? "+" : "−"}{formatIDR(Math.abs(diff))}</strong> akan dicatat sebagai <em>penyesuaian</em> (bukan pemasukan atau pengeluaran).</>}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <FormField id="rc-date" label="Tanggal" error={e.occurred_on}><Input id="rc-date" name="occurred_on" type="date" defaultValue={today} max={today} required /></FormField>
        <FormField id="rc-note" label="Catatan (opsional)" error={e.note}><Input id="rc-note" name="note" maxLength={150} placeholder="Contoh: cek m-banking" /></FormField>
      </div>
      <FormError message={bannerMessage(state)} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton disabled={diff === null}>Rekonsiliasi</SubmitButton></div>
    </form>
  );
}

export function AccountsManager({ accounts, archived, today }: { accounts: AccountWithBalance[]; archived: AccountWithBalance[]; today: string }) {
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const [pending, startTransition] = React.useTransition();
  const [err, setErr] = React.useState<string>();
  const toast = useToast();
  const close = () => { setDlg(null); setErr(undefined); };

  const icons = { cash: Banknote, bank: Landmark, ewallet: Smartphone, other: Wallet } as const;
  const positiveTotal = accounts.reduce((sum, a) => sum + Math.max(0, a.balance), 0);
  const restore = (a: AccountWithBalance) => startTransition(async () => { const r = await restoreAccountAction(a.id); toast(r.ok ? "Akun dipulihkan" : r.message ?? "Gagal", r.ok ? "ok" : "error"); });

  const empty = (
    <div className="rounded-card border border-dashed border-line bg-surface">
      <EmptyState icon={Landmark} title="Belum ada akun" description="Tambahkan akun tempat uang Anda berada: rekening bank, e-wallet, atau uang tunai. Saldo dihitung dari saldo awal ditambah semua transaksi."
        action={<Button onClick={() => setDlg({ kind: "create" })}><Plus className="h-4 w-4" aria-hidden />Tambah akun</Button>} />
    </div>
  );

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Akun aktif <span className="font-normal text-muted">({accounts.length})</span></h2>
        <Button onClick={() => setDlg({ kind: "create" })}><Plus className="h-4 w-4" aria-hidden />Tambah akun</Button>
      </div>
      {accounts.length === 0 ? empty : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => {
            const Icon = icons[a.type] ?? Wallet;
            const share = positiveTotal > 0 && a.balance > 0 ? (a.balance / positiveTotal) * 100 : 0;
            return (
              <li key={a.id}>
                <article data-account-name={a.name} className="flex h-full flex-col rounded-card border border-line bg-surface p-5 shadow-card transition-transform hover:-translate-y-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-tint text-brand-text"><Icon className="h-5 w-5" aria-hidden /></span>
                      <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{a.name}</h3><Badge className="mt-1">{ACCOUNT_TYPE_LABEL[a.type]}</Badge></div>
                    </div>
                    <div className="-mr-1.5 -mt-1 flex shrink-0">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDlg({ kind: "edit", account: a })} aria-label={`Ubah ${a.name}`}><Pencil className="h-4 w-4" aria-hidden /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setDlg({ kind: "archive", account: a })} aria-label={`Arsipkan ${a.name}`}><Archive className="h-4 w-4" aria-hidden /></Button>
                    </div>
                  </div>
                  <p data-balance className={`num mt-5 text-[26px] font-semibold leading-8 tracking-tight ${a.balance < 0 ? "text-loss" : ""}`}>{formatIDR(a.balance)}</p>
                  <p className="mt-1 text-xs text-muted">{share > 0 ? `${Math.round(share)}% dari total kas` : a.balance < 0 ? "Saldo negatif: periksa pencatatan" : "Tidak ada saldo positif"} · saldo awal {formatIDR(a.initial_balance)}</p>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden><div className="h-full rounded-full bg-grad-accent" style={{ width: `${share > 0 ? Math.max(3, Math.round(share)) : 0}%` }} /></div>
                  <div className="mt-auto flex flex-wrap gap-2 pt-5">
                    <Link href={`/transactions?account=${a.id}`} aria-label={`Riwayat ${a.name}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium shadow-card transition-colors hover:bg-sunken"><History className="h-4 w-4" aria-hidden />Riwayat</Link>
                    <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: "reconcile", account: a })} aria-label={`Rekonsiliasi ${a.name}`}><Scale className="h-4 w-4" aria-hidden />Rekonsiliasi</Button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
      {archived.length > 0 && (
        <details className="mt-6 rounded-card border border-line bg-surface">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium">Akun diarsipkan ({archived.length})</summary>
          <ul className="divide-y divide-line border-t border-line">
            {archived.map((a) => (
              <li key={a.id} data-account-name={a.name} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sunken text-muted">{(() => { const I = icons[a.type] ?? Wallet; return <I className="h-4 w-4" aria-hidden />; })()}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{a.name}</p><p className="text-xs text-muted">{ACCOUNT_TYPE_LABEL[a.type]}</p></div>
                <span data-balance className="num text-sm">{formatIDR(a.balance)}</span>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => restore(a)}><ArchiveRestore className="h-4 w-4" aria-hidden />Pulihkan</Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={dlg?.kind === "create"} onClose={close} title="Tambah akun">{dlg?.kind === "create" && <AccountForm onDone={close} />}</Dialog>
      <Dialog open={dlg?.kind === "edit"} onClose={close} title="Ubah akun">{dlg?.kind === "edit" && <AccountForm account={dlg.account} onDone={close} />}</Dialog>
      <Dialog open={dlg?.kind === "reconcile"} onClose={close} title="Rekonsiliasi saldo" description="Samakan saldo di aplikasi dengan saldo nyata. Selisihnya dicatat sebagai penyesuaian yang bisa ditelusuri.">
        {dlg?.kind === "reconcile" && <ReconcileForm account={dlg.account} today={today} onDone={close} />}
      </Dialog>
      <ConfirmDialog
        open={dlg?.kind === "archive"} onCancel={close} title={`Arsipkan ${dlg?.kind === "archive" ? dlg.account.name : ""}?`}
        description="Akun diarsipkan hanya jika saldonya Rp 0. Riwayat transaksi tetap tersimpan dan akun dapat dipulihkan kapan saja."
        confirmLabel="Arsipkan" pending={pending} error={err}
        onConfirm={() => dlg?.kind === "archive" && startTransition(async () => {
          const r = await archiveAccountAction(dlg.account.id);
          if (r.ok) { toast("Akun diarsipkan"); close(); } else setErr(r.message);
        })}
      />
    </>
  );
}
