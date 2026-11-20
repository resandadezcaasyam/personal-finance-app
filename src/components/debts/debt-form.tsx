"use client";
import { bannerMessage } from "@/lib/form-state";
import * as React from "react";
import { useFormState } from "react-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField, Input, Select, Textarea } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { formatIDR, formatDateID, parseIDR, parsePercentToBps } from "@/lib/format";
import { generateSchedule, parseManualSchedule, type ScheduleRow } from "@/lib/debts/schedule";
import type { AccountWithBalance } from "@/lib/ledger/types";
import { createDebtAction } from "@/app/actions/obligations";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };
const MODEL_HELP: Record<string, string> = {
  none: "Pokok dibagi rata. Cocok untuk cicilan 0% (misalnya paylater tanpa bunga).",
  flat: "Bunga = pokok × bunga per bulan × jumlah cicilan, dibagi rata tiap bulan.",
  reducing: "Cicilan tetap (anuitas); bunga dihitung dari sisa pokok sehingga makin kecil tiap bulan.",
  manual: "Isi sendiri tanggal dan nominal tiap cicilan. Gunakan jika aturan kontrak berbeda atau jadwalnya tidak teratur.",
};

function useForm() {
  const [f, setF] = React.useState({ model: "none", principal: "", rate: "", fee: "", count: "6", first: "", manual: "", paid: "0" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return { f, set };
}

function Preview({ f }: { f: ReturnType<typeof useForm>["f"] }) {
  let rows: ScheduleRow[] | null = null;
  let error: string | null = null;
  const principal = parseIDR(f.principal);
  if (principal && /^\d{4}-\d{2}-\d{2}$/.test(f.first) && (f.model === "manual" ? f.manual.trim() : f.count)) {
    try {
      const rate = f.model === "flat" || f.model === "reducing" ? (f.rate.trim() ? parsePercentToBps(f.rate) : 0) : 0;
      if (rate === null) throw new Error("Persentase bunga tidak valid.");
      rows = generateSchedule({
        model: f.model as "none", principal, rate_bps: rate, admin_fee: f.fee.trim() ? parseIDR(f.fee) ?? 0 : 0, count: Number(f.count), first_due_date: f.first,
        manual: f.model === "manual" ? parseManualSchedule(f.manual, parseIDR) : undefined,
      });
    } catch (e) { error = e instanceof Error ? e.message : "Input tidak valid"; }
  }
  if (!rows && !error) return <p className="rounded-md bg-sunken px-3 py-2 text-sm text-muted">Isi pokok, jumlah cicilan, dan tanggal jatuh tempo pertama untuk melihat pratinjau jadwal.</p>;
  if (error) return <p role="alert" className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{error}</p>;
  const total = rows!.reduce((s, r) => s + r.amount_due, 0);
  const interest = rows!.reduce((s, r) => s + r.interest_due, 0);
  const fees = rows!.reduce((s, r) => s + r.fee_due, 0);
  return (
    <div className="space-y-2 rounded-md bg-sunken p-3 text-sm" aria-live="polite">
      <p className="font-medium">Pratinjau jadwal</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-muted">Total kewajiban</dt><dd className="num text-right font-medium">{formatIDR(total)}</dd>
        <dt className="text-muted">Cicilan pertama</dt><dd className="num text-right">{formatIDR(rows![0].amount_due)}</dd>
        <dt className="text-muted">Bunga</dt><dd className="num text-right">{formatIDR(interest)}</dd>
        <dt className="text-muted">Biaya administrasi</dt><dd className="num text-right">{formatIDR(fees)}</dd>
        <dt className="text-muted">Jumlah cicilan</dt><dd className="num text-right">{rows!.length}×</dd>
      </dl>
      <div className="max-h-40 overflow-y-auto rounded border border-line bg-surface">
        <table className="w-full text-xs">
          <tbody>
            {rows!.map((r) => (
              <tr key={r.sequence_no} className="border-b border-line last:border-0">
                <td className="px-2 py-1 text-muted">#{r.sequence_no}</td><td className="px-2 py-1">{formatDateID(r.due_date)}</td><td className="num px-2 py-1 text-right">{formatIDR(r.amount_due)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DebtForm({ accounts, today, onDone }: { accounts: AccountWithBalance[]; today: string; onDone: () => void }) {
  const [state, action] = useFormState(createDebtAction, INIT);
  const { f, set } = useForm();
  const e = state.errors ?? {};
  const interestModel = f.model === "flat" || f.model === "reducing";
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="d-provider" label="Penyedia" error={e.provider} hint="ShopeePay, SeaBank, KrediFazz, GoPay Pinjam, dll.">
          <Input id="d-provider" name="provider" list="providers" required maxLength={60} autoFocus aria-invalid={!!e.provider} />
          <datalist id="providers"><option value="ShopeePay" /><option value="SeaBank" /><option value="KrediFazz" /><option value="GoPay Pinjam" /><option value="Kredivo" /><option value="Akulaku" /></datalist>
        </FormField>
        <FormField id="d-label" label="Keterangan (opsional)" error={e.label}><Input id="d-label" name="label" maxLength={80} placeholder="Contoh: Beli HP" /></FormField>
      </div>

      <FormField id="d-model" label="Jenis bunga" error={e.model} hint={MODEL_HELP[f.model]}>
        <Select id="d-model" name="model" value={f.model} onChange={set("model")}>
          <option value="none">Tanpa bunga</option><option value="flat">Bunga flat</option><option value="reducing">Bunga menurun (anuitas)</option><option value="manual">Jadwal manual</option>
        </Select>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="d-principal" label="Pokok pinjaman" error={e.principal}><Input id="d-principal" name="principal" inputMode="numeric" value={f.principal} onChange={set("principal")} required placeholder="3jt" aria-invalid={!!e.principal} /></FormField>
        {interestModel && <FormField id="d-rate" label="Bunga per bulan (%)" error={e.rate} hint="Contoh: 2,5"><Input id="d-rate" name="rate" inputMode="decimal" value={f.rate} onChange={set("rate")} aria-invalid={!!e.rate} /></FormField>}
        <FormField id="d-fee" label="Biaya administrasi total (opsional)" error={e.admin_fee} hint="Dibagi rata ke semua cicilan."><Input id="d-fee" name="admin_fee" inputMode="numeric" value={f.fee} onChange={set("fee")} aria-invalid={!!e.admin_fee} /></FormField>
        {f.model !== "manual" && <FormField id="d-count" label="Jumlah cicilan" error={e.count}><Input id="d-count" name="count" type="number" min={1} max={120} value={f.count} onChange={set("count")} required aria-invalid={!!e.count} /></FormField>}
        <FormField id="d-first" label="Jatuh tempo pertama" error={e.first_due_date}><Input id="d-first" name="first_due_date" type="date" value={f.first} onChange={set("first")} required aria-invalid={!!e.first_due_date} /></FormField>
        <FormField id="d-start" label="Tanggal mulai pinjaman" error={e.start_date}><Input id="d-start" name="start_date" type="date" defaultValue={today} max={today} required /></FormField>
      </div>

      {f.model === "manual" && (
        <FormField id="d-manual" label="Jadwal manual" error={e.manual} hint="Satu baris per cicilan: tanggal lalu nominal. Contoh: 2026-12-05 350rb">
          <Textarea id="d-manual" name="manual" rows={5} value={f.manual} onChange={set("manual")} placeholder={"2026-12-05 700rb\n2027-01-05 700rb"} className="font-mono text-xs" aria-invalid={!!e.manual} />
        </FormField>
      )}

      <Preview f={f} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="d-acc" label="Akun pembayaran" error={e.payment_account_id}>
          <Select id="d-acc" name="payment_account_id" defaultValue=""><option value="">Pilih saat membayar</option>{accounts.filter((a) => !a.is_archived).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </FormField>
        <FormField id="d-paid" label="Cicilan yang sudah dibayar" error={e.already_paid_count} hint="Untuk utang yang sudah berjalan. Tidak mengubah saldo akun apa pun.">
          <Input id="d-paid" name="already_paid_count" type="number" min={0} value={f.paid} onChange={set("paid")} aria-invalid={!!e.already_paid_count} />
        </FormField>
      </div>
      <FormField id="d-notes" label="Catatan (opsional)" error={e.notes}><Input id="d-notes" name="notes" maxLength={300} /></FormField>
      <FormError message={bannerMessage(state)} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Simpan utang</SubmitButton></div>
    </form>
  );
}

export function AddDebtButton({ accounts, today }: { accounts: AccountWithBalance[]; today: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" aria-hidden />Tambah utang</Button>
      <Dialog wide open={open} onClose={() => setOpen(false)} title="Tambah utang atau cicilan" description="Jadwal cicilan dibuat otomatis dari ketentuan di bawah. Periksa pratinjau sebelum menyimpan.">
        {open && <DebtForm accounts={accounts} today={today} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}
