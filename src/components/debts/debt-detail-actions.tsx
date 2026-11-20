"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useFormState } from "react-dom";
import { Banknote, Pencil, XCircle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/toast";
import { PaymentForm } from "./payment-form";
import { formatIDR, formatDateID } from "@/lib/format";
import type { DebtPaymentRow, DebtSummary } from "@/lib/debts/debts";
import type { OpenRow } from "@/lib/debts/schedule";
import type { AccountWithBalance } from "@/lib/ledger/types";
import { updateDebtDetailsAction, cancelDebtAction, voidDebtPaymentAction } from "@/app/actions/obligations";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };

function DetailsForm({ debt, accounts, onDone }: { debt: DebtSummary; accounts: AccountWithBalance[]; onDone: () => void }) {
  const [state, action] = useFormState(updateDebtDetailsAction, INIT);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast("Data utang diperbarui"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={debt.id} />
      <FormField id="u-provider" label="Penyedia" error={e.provider}><Input id="u-provider" name="provider" defaultValue={debt.provider} required maxLength={60} /></FormField>
      <FormField id="u-label" label="Keterangan" error={e.label}><Input id="u-label" name="label" defaultValue={debt.label} maxLength={80} /></FormField>
      <FormField id="u-acc" label="Akun pembayaran" error={e.payment_account_id}>
        <Select id="u-acc" name="payment_account_id" defaultValue={debt.payment_account_id ?? ""}><option value="">Pilih saat membayar</option>{accounts.filter((a) => !a.is_archived || a.id === debt.payment_account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
      </FormField>
      <FormField id="u-notes" label="Catatan" error={e.notes}><Input id="u-notes" name="notes" defaultValue={debt.notes ?? ""} maxLength={300} /></FormField>
      <p className="text-xs text-muted">Pokok, bunga, dan jadwal tidak dapat diubah setelah utang dibuat agar riwayat tetap konsisten. Jika salah input dan belum ada pembayaran, batalkan utang lalu buat ulang.</p>
      <FormError message={!state.errors ? state.message : undefined} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton>Simpan</SubmitButton></div>
    </form>
  );
}

export function DebtDetailActions({ debt, openRows, accounts, today, hasPayments }: { debt: DebtSummary; openRows: OpenRow[]; accounts: AccountWithBalance[]; today: string; hasPayments: boolean }) {
  const [dlg, setDlg] = React.useState<"pay" | "edit" | "cancel" | null>(null);
  const [err, setErr] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const toast = useToast();
  const router = useRouter();
  const close = () => { setDlg(null); setErr(undefined); };
  const active = debt.status === "active";
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {active && <Button onClick={() => setDlg("pay")}><Banknote className="h-4 w-4" aria-hidden />Catat pembayaran</Button>}
        <Button variant="secondary" onClick={() => setDlg("edit")}><Pencil className="h-4 w-4" aria-hidden />Ubah data</Button>
        {active && !hasPayments && <Button variant="ghost" onClick={() => setDlg("cancel")}><XCircle className="h-4 w-4" aria-hidden />Batalkan utang</Button>}
      </div>
      <Dialog wide open={dlg === "pay"} onClose={close} title="Catat pembayaran" description="Satu pembayaran dicatat sebagai satu pengeluaran dan langsung mengurangi sisa kewajiban.">
        {dlg === "pay" && <PaymentForm debt={debt} openRows={openRows} accounts={accounts} today={today} onDone={close} />}
      </Dialog>
      <Dialog open={dlg === "edit"} onClose={close} title="Ubah data utang">{dlg === "edit" && <DetailsForm debt={debt} accounts={accounts} onDone={close} />}</Dialog>
      <ConfirmDialog open={dlg === "cancel"} onCancel={close} danger pending={pending} error={err} confirmLabel="Batalkan utang" title="Batalkan utang ini?"
        description="Jadwalnya tidak lagi dihitung sebagai kewajiban. Hanya bisa dilakukan jika belum ada pembayaran."
        onConfirm={() => startTransition(async () => { const r = await cancelDebtAction(debt.id); if (r.ok) { toast("Utang dibatalkan"); close(); router.push("/debts"); } else setErr(r.message); })} />
    </>
  );
}

const KIND: Record<string, string> = { regular: "Cicilan", partial: "Sebagian", early: "Dipercepat", settlement: "Pelunasan" };

export function PaymentHistory({ payments }: { payments: DebtPaymentRow[] }) {
  const [voiding, setVoiding] = React.useState<DebtPaymentRow | null>(null);
  const [err, setErr] = React.useState<string>();
  const [pending, startTransition] = React.useTransition();
  const toast = useToast();
  const close = () => { setVoiding(null); setErr(undefined); };
  const cols: Column<DebtPaymentRow>[] = [
    { key: "d", header: "Tanggal", render: (p) => <span className={`whitespace-nowrap ${p.status === "voided" ? "line-through opacity-60" : ""}`}>{formatDateID(p.paid_on)}</span> },
    { key: "k", header: "Jenis", render: (p) => <div className="flex flex-wrap items-center gap-1.5"><Badge tone={p.kind === "settlement" ? "brand" : p.kind === "partial" ? "warn" : "neutral"}>{KIND[p.kind]}</Badge>{p.status === "voided" && <Badge tone="loss">Dibatalkan</Badge>}</div> },
    { key: "i", header: "Cicilan", render: (p) => <span className="text-muted">{p.installments ?? "—"}</span> },
    { key: "a", header: "Akun", render: (p) => p.account_name },
    { key: "x", header: "Denda + biaya", align: "right", render: (p) => (p.penalty + p.fee > 0 ? formatIDR(p.penalty + p.fee) : "—") },
    { key: "m", header: "Nominal", align: "right", render: (p) => <span className={p.status === "voided" ? "line-through opacity-60" : ""}>{formatIDR(p.amount)}</span> },
    { key: "v", header: "", align: "right", render: (p) => (p.status === "posted" ? <Button size="sm" variant="ghost" aria-label="Batalkan pembayaran" onClick={() => setVoiding(p)}><Ban className="h-4 w-4" aria-hidden /></Button> : null) },
  ];
  return (
    <>
      <DataTable columns={cols} rows={payments} rowKey={(p) => p.id} empty={<EmptyState icon={Banknote} title="Belum ada pembayaran" description="Pembayaran yang dicatat akan muncul di sini beserta cicilan yang dilunasinya." />} />
      <ConfirmDialog open={!!voiding} onCancel={close} danger pending={pending} error={err} confirmLabel="Batalkan pembayaran" title="Batalkan pembayaran ini?"
        description={voiding ? `Pembayaran ${formatIDR(voiding.amount)} pada ${formatDateID(voiding.paid_on)} dibatalkan: saldo akun dan sisa kewajiban dikembalikan, catatannya tetap tersimpan sebagai "Dibatalkan".` : ""}
        onConfirm={() => voiding && startTransition(async () => { const r = await voidDebtPaymentAction(voiding.id); if (r.ok) { toast("Pembayaran dibatalkan"); close(); } else setErr(r.message); })} />
    </>
  );
}
