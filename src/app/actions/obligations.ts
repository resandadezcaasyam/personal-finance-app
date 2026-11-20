"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { createDebt, updateDebtDetails, cancelDebt, recordDebtPayment, voidDebtPayment } from "@/lib/debts/debts";
import { parseManualSchedule } from "@/lib/debts/schedule";
import { createBill, updateBill, setBillActive, payBill, skipBill, voidBillPayment } from "@/lib/bills/bills";
import { LedgerError } from "@/lib/ledger/errors";
import { parseIDR } from "@/lib/format";
import { money, moneyOrZero, moneyOrNull, percentBps, id, optId, optInt, date, text, fd, done, fail, type ActionState } from "./shared";

const debtSchema = z.object({
  provider: z.string().trim().min(1, "Penyedia wajib diisi").max(60, "Maksimal 60 karakter"),
  label: text(80).optional(),
  model: z.enum(["none", "flat", "reducing", "manual"]),
  principal: money,
  rate: percentBps.optional(),
  admin_fee: moneyOrZero,
  count: optInt,
  start_date: date,
  first_due_date: date,
  manual: z.string().optional(),
  payment_account_id: optId,
  notes: text(300).optional(),
  already_paid_count: optInt,
});

export async function createDebtAction(_: ActionState, form: FormData): Promise<ActionState> {
  let debtId: number;
  try {
    const v = debtSchema.parse(fd(form));
    const manual = v.model === "manual" ? parseManualSchedule(v.manual ?? "", parseIDR) : undefined;
    debtId = createDebt(getDb(), { ...v, rate_bps: v.rate ?? null, manual });
  } catch (e) { return fail(e); }
  // redirect() throws by design, so it must stay outside the try/catch.
  revalidatePath("/", "layout");
  redirect(`/debts/${debtId}`);
}

const debtDetailsSchema = z.object({
  id, provider: z.string().trim().min(1, "Penyedia wajib diisi").max(60), label: text(80).optional(), notes: text(300).optional(), payment_account_id: optId,
});
export async function updateDebtDetailsAction(_: ActionState, form: FormData): Promise<ActionState> {
  try { const v = debtDetailsSchema.parse(fd(form)); updateDebtDetails(getDb(), v.id, v); return done(); } catch (e) { return fail(e); }
}
export async function cancelDebtAction(debtId: number): Promise<ActionState> {
  try { cancelDebt(getDb(), debtId); return done(); } catch (e) { return fail(e); }
}

const paymentSchema = z.object({ debt_id: id, account_id: id, amount: money, penalty: moneyOrZero, fee: moneyOrZero, paid_on: date, note: text(150).optional() });
export async function recordPaymentAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const r = recordDebtPayment(getDb(), paymentSchema.parse(fd(form)));
    const msg = r.debtSettled ? "Pembayaran dicatat. Utang ini lunas." : "Pembayaran dicatat.";
    return { ...done(), message: msg };
  } catch (e) { return fail(e); }
}
export async function voidDebtPaymentAction(paymentId: number): Promise<ActionState> {
  try { voidDebtPayment(getDb(), paymentId); return done(); } catch (e) { return fail(e); }
}

const billSchema = z.object({
  id: optId,
  name: z.string().trim().min(1, "Nama wajib diisi").max(80),
  kind: z.enum(["bill", "subscription"]),
  category_id: optId,
  account_id: optId,
  amount: moneyOrNull,
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly", "once"]).optional(),
  next_due_date: z.string().optional(),
  remind_days: z.coerce.number().int().min(0, "0 sampai 60").max(60, "0 sampai 60"),
  notes: text(300).optional(),
});
export async function saveBillAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = billSchema.parse(fd(form));
    const db = getDb();
    if (v.id) updateBill(db, v.id, v);
    else {
      if (!v.frequency) throw new LedgerError("Pilih frekuensi.", "frequency");
      if (!v.next_due_date) throw new LedgerError("Tanggal jatuh tempo wajib diisi.", "next_due_date");
      createBill(db, { ...v, frequency: v.frequency, next_due_date: v.next_due_date });
    }
    return done();
  } catch (e) { return fail(e); }
}
export async function setBillActiveAction(billId: number, active: boolean): Promise<ActionState> {
  try { setBillActive(getDb(), billId, active); return done(); } catch (e) { return fail(e); }
}

const payBillSchema = z.object({ bill_id: id, account_id: id, amount: money, paid_on: date });
export async function payBillAction(_: ActionState, form: FormData): Promise<ActionState> {
  try { payBill(getDb(), payBillSchema.parse(fd(form))); return done(); } catch (e) { return fail(e); }
}
export async function skipBillAction(billId: number): Promise<ActionState> {
  try { skipBill(getDb(), billId); return done(); } catch (e) { return fail(e); }
}
export async function voidBillPaymentAction(paymentId: number): Promise<ActionState> {
  try { voidBillPayment(getDb(), paymentId); return done(); } catch (e) { return fail(e); }
}
