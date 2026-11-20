"use client";
import { bannerMessage } from "@/lib/form-state";
import * as React from "react";
import Link from "next/link";
import { useFormState } from "react-dom";
import { Pencil, Scale, Archive, ArchiveRestore, History, Plus, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
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
      <FormField id="acc-name" label="Nama akun" error={e.name} hint="Contoh: BCA, SeaBank, ShopeePay, GoPay, Tunai">
        <Input id="acc-name" name="name" defaultValue={account?.name} required maxLength={60} autoFocus aria-invalid={!!e.name} />
      </FormField>
      <FormField id="acc-type" label="Jenis" error={e.type}>
        <Select id="acc-type" name="type" defaultValue={account?.type ?? "bank"}>
          {Object.entries(ACCOUNT_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </FormField>
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
      <p className="rounded-md bg-sunken px-3 py-2 text-sm">Saldo tercatat di aplikasi: <strong className="num">{formatIDR(account.balance)}</strong></p>
      <FormField id="rc-actual" label="Saldo aktual" error={e.actual_balance} hint="Lihat saldo di aplikasi bank/e-wallet atau hitung uang tunai.">
        <Input id="rc-actual" name="actual_balance" inputMode="numeric" value={actual} onChange={(ev) => setActual(ev.target.value)} required autoFocus aria-invalid={!!e.actual_balance} />
      </FormField>
      {diff !== null && (
        <p role="status" className="text-sm">
          {diff === 0 ? "Saldo sudah sesuai." : <>Selisih <strong className={`num ${diff > 0 ? "text-gain" : "text-loss"}`}>{diff > 0 ? "+" : "−"}{formatIDR(Math.abs(diff))}</strong> akan dicatat sebagai <em>penyesuaian</em> (bukan pemasukan atau pengeluaran).</>}
        </p>
      )}
      <FormField id="rc-date" label="Tanggal" error={e.occurred_on}><Input id="rc-date" name="occurred_on" type="date" defaultValue={today} max={today} required /></FormField>
      <FormField id="rc-note" label="Catatan (opsional)" error={e.note}><Input id="rc-note" name="note" maxLength={150} placeholder="Contoh: cek m-banking" /></FormField>
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

  const cols: Column<AccountWithBalance>[] = [
    { key: "name", header: "Akun", render: (a) => <span className="font-medium">{a.name}</span> },
    { key: "type", header: "Jenis", render: (a) => <Badge>{ACCOUNT_TYPE_LABEL[a.type]}</Badge> },
    { key: "bal", header: "Saldo", align: "right", render: (a) => <span className={a.balance < 0 ? "text-loss" : ""}>{formatIDR(a.balance)}</span> },
    {
      key: "act", header: "Aksi", align: "right",
      render: (a) => (
        <div className="flex justify-end gap-1">
          {a.is_archived ? (
            <Button size="sm" variant="secondary" onClick={() => startTransition(async () => { const r = await restoreAccountAction(a.id); toast(r.ok ? "Akun dipulihkan" : r.message ?? "Gagal", r.ok ? "ok" : "error"); })}><ArchiveRestore className="h-4 w-4" aria-hidden />Pulihkan</Button>
          ) : (
            <>
              <Link href={`/transactions?account=${a.id}`} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm hover:bg-sunken" aria-label={`Riwayat ${a.name}`}><History className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Riwayat</span></Link>
              <Button size="sm" variant="ghost" onClick={() => setDlg({ kind: "reconcile", account: a })} aria-label={`Rekonsiliasi ${a.name}`}><Scale className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Rekonsiliasi</span></Button>
              <Button size="sm" variant="ghost" onClick={() => setDlg({ kind: "edit", account: a })} aria-label={`Ubah ${a.name}`}><Pencil className="h-4 w-4" aria-hidden /></Button>
              <Button size="sm" variant="ghost" onClick={() => setDlg({ kind: "archive", account: a })} aria-label={`Arsipkan ${a.name}`}><Archive className="h-4 w-4" aria-hidden /></Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const empty = (
    <EmptyState icon={Landmark} title="Belum ada akun" description="Tambahkan akun tempat uang Anda berada: rekening bank, e-wallet, atau uang tunai. Saldo dihitung dari saldo awal ditambah semua transaksi."
      action={<Button onClick={() => setDlg({ kind: "create" })}><Plus className="h-4 w-4" aria-hidden />Tambah akun</Button>} />
  );

  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setDlg({ kind: "create" })}><Plus className="h-4 w-4" aria-hidden />Tambah akun</Button></div>
      <div className="rounded-card border border-line bg-surface">
        <DataTable columns={cols} rows={accounts} rowKey={(a) => a.id} empty={empty} />
      </div>
      {archived.length > 0 && (
        <details className="mt-6 rounded-card border border-line bg-surface">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium">Akun diarsipkan ({archived.length})</summary>
          <DataTable columns={cols} rows={archived} rowKey={(a) => a.id} empty={null} />
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
