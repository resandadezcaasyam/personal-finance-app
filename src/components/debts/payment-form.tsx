"use client";
import * as React from "react";
import { useFormState } from "react-dom";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select } from "@/components/ui/form-field";
import { SubmitButton, FormError } from "@/components/ui/submit-button";
import { useToast } from "@/components/toast";
import { formatIDR, parseIDR, daysBetween } from "@/lib/format";
import { allocatePayment, derivePaymentKind, type OpenRow, type PaymentKind } from "@/lib/debts/schedule";
import type { AccountWithBalance } from "@/lib/ledger/types";
import { recordPaymentAction } from "@/app/actions/obligations";
import type { ActionState } from "@/app/actions/shared";

const INIT: ActionState = { ok: false };
const KIND_LABEL: Record<PaymentKind, string> = { regular: "Pembayaran cicilan", partial: "Pembayaran sebagian", early: "Pembayaran dipercepat", settlement: "Pelunasan" };

export function PaymentForm({ debt, openRows, accounts, today, onDone }: {
  debt: { id: number; provider: string; payment_account_id: number | null };
  openRows: OpenRow[]; accounts: AccountWithBalance[]; today: string; onDone: () => void;
}) {
  const [state, action] = useFormState(recordPaymentAction, INIT);
  const usable = accounts.filter((a) => !a.is_archived);
  const outstanding = openRows.reduce((s, r) => s + r.remaining, 0);
  const next = openRows[0]?.remaining ?? 0;
  const [amount, setAmount] = React.useState(String(next));
  const [penalty, setPenalty] = React.useState("");
  const [fee, setFee] = React.useState("");
  const [paidOn, setPaidOn] = React.useState(today);
  const toast = useToast();
  React.useEffect(() => { if (state.ok) { toast(state.message ?? "Pembayaran dicatat"); onDone(); } }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const e = state.errors ?? {};

  const amt = parseIDR(amount);
  const pen = penalty.trim() ? parseIDR(penalty) : 0;
  const fe = fee.trim() ? parseIDR(fee) : 0;
  const alloc = amt && amt > 0 && amt <= outstanding ? allocatePayment(openRows, amt) : null;
  const kind = alloc && /^\d{4}-\d{2}-\d{2}$/.test(paidOn) ? derivePaymentKind(alloc.allocations, outstanding, amt!, paidOn, daysBetween) : null;
  const cashOut = (amt ?? 0) + (pen ?? 0) + (fe ?? 0);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="debt_id" value={debt.id} />
      <p className="rounded-md bg-sunken px-3 py-2 text-sm">Sisa kewajiban {debt.provider}: <strong className="num">{formatIDR(outstanding)}</strong></p>

      <FormField id="p-amount" label="Nominal untuk cicilan" error={e.amount}
        hint="Diterapkan ke cicilan paling lama yang belum lunas, lalu berlanjut ke berikutnya.">
        <Input id="p-amount" name="amount" inputMode="numeric" value={amount} onChange={(ev) => setAmount(ev.target.value)} required autoFocus aria-invalid={!!e.amount} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setAmount(String(next))}>Cicilan berikutnya · {formatIDR(next)}</Button>
        <Button size="sm" variant="secondary" onClick={() => setAmount(String(outstanding))}>Lunasi semua · {formatIDR(outstanding)}</Button>
      </div>

      {alloc ? (
        <div role="status" className="rounded-md border border-line px-3 py-2 text-sm">
          <p className="font-medium">{kind ? KIND_LABEL[kind] : "Pratinjau"}</p>
          <ul className="mt-1 space-y-0.5 text-muted">
            {alloc.allocations.map((a) => (
              <li key={a.schedule_id}>Cicilan #{a.sequence_no}: <span className="num text-ink">{formatIDR(a.amount)}</span> {a.fully ? "(lunas)" : "(sebagian)"}</li>
            ))}
          </ul>
        </div>
      ) : amt && amt > outstanding ? <p role="alert" className="text-sm text-loss">Nominal melebihi sisa kewajiban.</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="p-penalty" label="Denda keterlambatan (opsional)" error={e.penalty} hint="Biaya tambahan di luar cicilan."><Input id="p-penalty" name="penalty" inputMode="numeric" value={penalty} onChange={(ev) => setPenalty(ev.target.value)} aria-invalid={!!e.penalty} /></FormField>
        <FormField id="p-fee" label="Biaya admin (opsional)" error={e.fee} hint="Mis. biaya transfer/pembayaran."><Input id="p-fee" name="fee" inputMode="numeric" value={fee} onChange={(ev) => setFee(ev.target.value)} aria-invalid={!!e.fee} /></FormField>
        <FormField id="p-acc" label="Dibayar dari akun" error={e.account_id}>
          <Select id="p-acc" name="account_id" defaultValue={debt.payment_account_id ?? usable[0]?.id}>{usable.map((a) => <option key={a.id} value={a.id}>{a.name} · {formatIDR(a.balance)}</option>)}</Select>
        </FormField>
        <FormField id="p-date" label="Tanggal bayar" error={e.paid_on}><Input id="p-date" name="paid_on" type="date" value={paidOn} max={today} onChange={(ev) => setPaidOn(ev.target.value)} required /></FormField>
      </div>
      <FormField id="p-note" label="Catatan (opsional)" error={e.note}><Input id="p-note" name="note" maxLength={150} /></FormField>

      <p className="text-sm">Uang keluar dari akun: <strong className="num">{formatIDR(cashOut)}</strong> <span className="text-muted">(dicatat sebagai satu pengeluaran)</span></p>
      <FormError message={!state.errors ? state.message : undefined} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Batal</Button><SubmitButton disabled={usable.length === 0}>Catat pembayaran</SubmitButton></div>
    </form>
  );
}
