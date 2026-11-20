"use client";
import * as React from "react";
import { useFormState } from "react-dom";
import { Plus, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/toast";
import { CategoryOptions } from "./category-options";
import { formatIDR, formatDateID } from "@/lib/format";
import type { AccountWithBalance, CategoryRow } from "@/lib/ledger/types";
import type { RecurringRuleRow } from "@/lib/ledger/recurring";
import { createRecurringIncomeAction, setRecurringActiveAction, type ActionState } from "@/app/actions/ledger";

const INIT: ActionState = { ok: false };
const FREQ: Record<string, string> = { weekly: "Mingguan", monthly: "Bulanan", quarterly: "Per 3 bulan", yearly: "Tahunan" };

function RuleForm({ accounts, categories, today, onDone }: { accounts: AccountWithBalance[]; categories: CategoryRow[]; today: string; onDone: () => void }) {
  const [state, action] = useFormState(createRecurringIncomeAction, INIT);
  const [freq, setFreq] = React.useState("monthly");
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast("Pengaturan pemasukan berulang disimpan"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  const usable = accounts.filter((a) => !a.is_archived);
  if (usable.length === 0) return <p className="text-sm">Tambahkan akun terlebih dahulu di halaman Akun &amp; Saldo.</p>;
  return (
    <form action={action} className="space-y-4">
      <FormField id="rr-name" label="Nama" error={e.name}><Input id="rr-name" name="name" placeholder="Contoh: Gaji bulanan" required autoFocus /></FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="rr-amt" label="Nominal" error={e.amount}><Input id="rr-amt" name="amount" inputMode="numeric" placeholder="9,5jt" required /></FormField>
        <FormField id="rr-acc" label="Akun tujuan" error={e.account_id}><Select id="rr-acc" name="account_id">{usable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormField>
        <FormField id="rr-freq" label="Frekuensi" error={e.frequency}>
          <Select id="rr-freq" name="frequency" value={freq} onChange={(ev) => setFreq(ev.target.value)}>{Object.entries(FREQ).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </FormField>
        {freq !== "weekly" && <FormField id="rr-day" label="Tanggal tiap bulan" error={e.day_of_month} hint="1–31"><Input id="rr-day" name="day_of_month" type="number" min={1} max={31} defaultValue={25} required /></FormField>}
        <FormField id="rr-start" label="Mulai" error={e.start_date}><Input id="rr-start" name="start_date" type="date" defaultValue={today} required /></FormField>
        <FormField id="rr-end" label="Berakhir (opsional)" error={e.end_date}><Input id="rr-end" name="end_date" type="date" /></FormField>
      </div>
      <FormField id="rr-cat" label="Kategori" error={e.category_id}><Select id="rr-cat" name="category_id"><CategoryOptions categories={categories} kind="income" /></Select></FormField>
      <FormError message={!state.errors ? state.message : undefined} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Simpan</SubmitButton></div>
    </form>
  );
}

export function RecurringIncomeManager({ rules, accounts, categories, today }: { rules: RecurringRuleRow[]; accounts: AccountWithBalance[]; categories: CategoryRow[]; today: string }) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const toast = useToast();
  const cols: Column<RecurringRuleRow>[] = [
    { key: "n", header: "Nama", render: (r) => <span className={r.is_active ? "font-medium" : "text-muted"}>{r.name}</span> },
    { key: "f", header: "Jadwal", render: (r) => `${FREQ[r.frequency]}${r.day_of_month ? `, tgl ${r.day_of_month}` : ""} · sejak ${formatDateID(r.start_date)}` },
    { key: "a", header: "Akun", render: (r) => r.account_name ?? "—" },
    { key: "m", header: "Nominal", align: "right", render: (r) => formatIDR(r.amount) },
    { key: "s", header: "Status", render: (r) => <Badge tone={r.is_active ? "brand" : "neutral"}>{r.is_active ? "Aktif" : "Nonaktif"}</Badge> },
    { key: "x", header: "", align: "right", render: (r) => (
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => { const res = await setRecurringActiveAction(r.id, !r.is_active); toast(res.ok ? "Status diperbarui" : res.message ?? "Gagal", res.ok ? "ok" : "error"); })}>{r.is_active ? "Nonaktifkan" : "Aktifkan"}</Button>
    ) },
  ];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted">Simpan pola pemasukan rutin seperti gaji. Ini hanya konfigurasi: <strong>tidak ada transaksi yang dibuat otomatis</strong>. Pemasukan baru masuk ke saldo setelah Anda mencatatnya. Pembuatan jadwal otomatis hadir di Fase 7.</p>
        <Button variant="secondary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />Tambah</Button>
      </div>
      <div className="rounded-card border border-line bg-surface">
        <DataTable columns={cols} rows={rules} rowKey={(r) => r.id} empty={<EmptyState icon={CalendarClock} title="Belum ada pemasukan berulang" description="Contoh: gaji bulanan tiap tanggal 25. Dipakai untuk proyeksi arus kas di fase berikutnya." />} />
      </div>
      <Dialog wide open={open} onClose={() => setOpen(false)} title="Pemasukan berulang">{open && <RuleForm accounts={accounts} categories={categories} today={today} onDone={() => setOpen(false)} />}</Dialog>
    </>
  );
}
