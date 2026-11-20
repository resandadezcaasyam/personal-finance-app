"use client";
import * as React from "react";
import { useFormState } from "react-dom";
import { Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/toast";
import { CategoryOptions } from "@/components/ledger/category-options";
import { formatIDR } from "@/lib/format";
import type { AccountWithBalance, CategoryRow } from "@/lib/ledger/types";
import type { TemplateRow } from "@/lib/capture/templates";
import { createTemplateAction, deleteTemplateAction } from "@/app/actions/capture";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };

function Form({ accounts, categories, onDone }: { accounts: AccountWithBalance[]; categories: CategoryRow[]; onDone: () => void }) {
  const [state, action] = useFormState(createTemplateAction, INIT);
  const [type, setType] = React.useState<"expense" | "income">("expense");
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast("Template disimpan"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="t-name" label="Nama" error={e.name}><Input id="t-name" name="name" required maxLength={40} autoFocus placeholder="Kopi pagi" /></FormField>
        <FormField id="t-type" label="Jenis"><Select id="t-type" name="type" value={type} onChange={(ev) => setType(ev.target.value as "expense" | "income")}><option value="expense">Pengeluaran</option><option value="income">Pemasukan</option></Select></FormField>
        <FormField id="t-amount" label="Nominal (opsional)" error={e.amount} hint="Kosongkan bila berubah-ubah."><Input id="t-amount" name="amount" inputMode="numeric" placeholder="25rb" /></FormField>
        <FormField id="t-acc" label="Akun" error={e.account_id}><Select id="t-acc" name="account_id" defaultValue=""><option value="">Pilih saat dipakai</option>{accounts.filter((a) => !a.is_archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormField>
        <FormField id="t-cat" label="Kategori" error={e.category_id}><Select id="t-cat" name="category_id" key={type} defaultValue=""><CategoryOptions categories={categories} kind={type} /></Select></FormField>
        <FormField id="t-desc" label="Deskripsi" error={e.description}><Input id="t-desc" name="description" maxLength={200} placeholder="Kopi pagi" /></FormField>
      </div>
      <FormField id="t-merchant" label="Merchant (opsional)" error={e.merchant}><Input id="t-merchant" name="merchant" maxLength={100} /></FormField>
      <FormError message={!state.errors ? state.message : undefined} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Simpan</SubmitButton></div>
    </form>
  );
}

export function TemplatesManager({ templates, accounts, categories }: { templates: TemplateRow[]; accounts: AccountWithBalance[]; categories: CategoryRow[] }) {
  const [open, setOpen] = React.useState(false);
  const [del, setDel] = React.useState<TemplateRow | null>(null);
  const [pending, startTransition] = React.useTransition();
  const toast = useToast();
  const cols: Column<TemplateRow>[] = [
    { key: "n", header: "Template", render: (t) => <span className="font-medium">{t.name}</span> },
    { key: "t", header: "Jenis", render: (t) => (t.type === "income" ? "Pemasukan" : "Pengeluaran") },
    { key: "a", header: "Akun", render: (t) => t.account_name ?? <span className="text-muted">Pilih saat dipakai</span> },
    { key: "c", header: "Kategori", render: (t) => t.category_name ?? <span className="text-muted">—</span> },
    { key: "m", header: "Nominal", align: "right", render: (t) => (t.amount ? formatIDR(t.amount) : <span className="text-muted">Berubah-ubah</span>) },
    { key: "x", header: "", align: "right", render: (t) => <Button size="sm" variant="ghost" aria-label={`Hapus ${t.name}`} onClick={() => setDel(t)}><Trash2 className="h-4 w-4" aria-hidden /></Button> },
  ];
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">Template favorit</h2>
        <Button variant="secondary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />Tambah template</Button>
      </div>
      <div className="rounded-card border border-line bg-surface">
        <DataTable columns={cols} rows={templates} rowKey={(t) => t.id} empty={<EmptyState icon={Star} title="Belum ada template" description="Simpan pengeluaran atau pemasukan yang sering berulang (kopi pagi, parkir, gaji) agar bisa dicatat dengan satu klik dari halaman ini." />} />
      </div>
      <Dialog wide open={open} onClose={() => setOpen(false)} title="Template favorit baru">{open && <Form accounts={accounts} categories={categories} onDone={() => setOpen(false)} />}</Dialog>
      <ConfirmDialog open={!!del} onCancel={() => setDel(null)} danger pending={pending} confirmLabel="Hapus template" title={`Hapus template "${del?.name ?? ""}"?`} description="Transaksi yang sudah dicatat dari template ini tidak terpengaruh."
        onConfirm={() => del && startTransition(async () => { const r = await deleteTemplateAction(del.id); toast(r.ok ? "Template dihapus" : r.message ?? "Gagal", r.ok ? "ok" : "error"); setDel(null); })} />
    </>
  );
}
