"use server";
import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { getDb, resetDemoDatabase } from "@/lib/db/client";
import { LedgerError } from "@/lib/ledger/errors";
import { createAccount, updateAccount, archiveAccount, restoreAccount } from "@/lib/ledger/accounts";
import { createTransaction, updateTransaction, voidTransaction } from "@/lib/ledger/transactions";
import { createTransfer, voidTransfer } from "@/lib/ledger/transfers";
import { reconcileAccount } from "@/lib/ledger/reconcile";
import { createCategory, setCategoryArchived } from "@/lib/ledger/categories";
import { createRecurringIncome, setRecurringActive } from "@/lib/ledger/recurring";
import { parseIDR } from "@/lib/format";

export type ActionState = { ok: boolean; message?: string; errors?: Record<string, string> };

const AMOUNT_MSG = "Nominal tidak valid. Contoh: 25rb, 9,5jt, atau 1.250.000";

const money = z.string().trim().min(1, "Wajib diisi").transform((s, ctx) => {
  const v = parseIDR(s);
  if (v === null) { ctx.addIssue({ code: "custom", message: AMOUNT_MSG }); return z.NEVER; }
  return v;
});
/** Empty means 0 (for optional amounts such as fees). */
const moneyOrZero = z.string().trim().transform((s, ctx) => {
  if (s === "") return 0;
  const v = parseIDR(s);
  if (v === null) { ctx.addIssue({ code: "custom", message: AMOUNT_MSG }); return z.NEVER; }
  return v;
});
/** Signed amount for balances that may legitimately be negative (overdraft). */
const signedMoney = z.string().trim().min(1, "Wajib diisi").transform((s, ctx) => {
  const neg = s.startsWith("-");
  const v = parseIDR(neg ? s.slice(1) : s);
  if (v === null) { ctx.addIssue({ code: "custom", message: AMOUNT_MSG }); return z.NEVER; }
  return neg ? -v : v;
});
const id = z.coerce.number().int().positive("Pilih salah satu");
const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable());
const date = z.string().min(1, "Tanggal wajib diisi");
const text = (max: number) => z.string().trim().max(max, `Maksimal ${max} karakter`);
const fd = (f: FormData) => Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === "string"));

function done(): ActionState {
  revalidatePath("/", "layout");
  return { ok: true };
}

function fail(e: unknown): ActionState {
  if (e instanceof ZodError) {
    const errors: Record<string, string> = {};
    for (const i of e.issues) errors[String(i.path[0] ?? "form")] ??= i.message;
    return { ok: false, message: "Periksa kembali isian yang ditandai.", errors };
  }
  if (e instanceof LedgerError) return { ok: false, message: e.message, errors: e.field ? { [e.field]: e.message } : undefined };
  console.error(e);
  return { ok: false, message: "Terjadi kesalahan tak terduga. Data Anda tidak berubah." };
}

const accountSchema = z.object({
  id: optId,
  name: z.string().trim().min(1, "Nama akun wajib diisi").max(60, "Maksimal 60 karakter"),
  type: z.enum(["cash", "bank", "ewallet", "other"]),
  initial_balance: moneyOrZero,
});

export async function saveAccountAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = accountSchema.parse(fd(form));
    const db = getDb();
    if (v.id) updateAccount(db, v.id, v);
    else createAccount(db, v);
    return done();
  } catch (e) { return fail(e); }
}

export async function archiveAccountAction(accountId: number): Promise<ActionState> {
  try { archiveAccount(getDb(), accountId); return done(); } catch (e) { return fail(e); }
}
export async function restoreAccountAction(accountId: number): Promise<ActionState> {
  try { restoreAccount(getDb(), accountId); return done(); } catch (e) { return fail(e); }
}

const reconcileSchema = z.object({ account_id: id, actual_balance: signedMoney, occurred_on: date, note: text(150).optional() });
export async function reconcileAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = reconcileSchema.parse(fd(form));
    const r = reconcileAccount(getDb(), v);
    return { ...done(), message: r.adjusted ? "Saldo direkonsiliasi. Selisih dicatat sebagai penyesuaian." : "Saldo sudah sesuai. Tidak ada penyesuaian." };
  } catch (e) { return fail(e); }
}

const txSchema = z.object({
  id: optId,
  type: z.enum(["income", "expense"]),
  account_id: id,
  category_id: optId,
  amount: money,
  occurred_on: date,
  description: text(200),
  merchant: text(100).optional(),
  tags: text(100).optional(),
});

export async function saveTransactionAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = txSchema.parse(fd(form));
    const db = getDb();
    if (v.id) updateTransaction(db, v.id, v);
    else createTransaction(db, v);
    return done();
  } catch (e) { return fail(e); }
}

const transferSchema = z.object({
  from_account_id: id,
  to_account_id: id,
  amount: money,
  fee: moneyOrZero,
  occurred_on: date,
  description: text(200).optional(),
});
export async function saveTransferAction(_: ActionState, form: FormData): Promise<ActionState> {
  try { createTransfer(getDb(), transferSchema.parse(fd(form))); return done(); } catch (e) { return fail(e); }
}

export async function voidTransactionAction(txId: number): Promise<ActionState> {
  try { voidTransaction(getDb(), txId); return done(); } catch (e) { return fail(e); }
}
export async function voidTransferAction(transferId: number): Promise<ActionState> {
  try { voidTransfer(getDb(), transferId); return done(); } catch (e) { return fail(e); }
}

const categorySchema = z.object({ name: z.string().trim().min(1, "Nama wajib diisi").max(50), kind: z.enum(["income", "expense"]), parent_id: optId });
export async function createCategoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  try { createCategory(getDb(), categorySchema.parse(fd(form))); return done(); } catch (e) { return fail(e); }
}
export async function setCategoryArchivedAction(categoryId: number, archived: boolean): Promise<ActionState> {
  try { setCategoryArchived(getDb(), categoryId, archived); return done(); } catch (e) { return fail(e); }
}

const recurringSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(80),
  amount: money,
  account_id: id,
  category_id: optId,
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  day_of_month: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(1).max(31).nullable()),
  start_date: date,
  end_date: z.string().optional(),
});
export async function createRecurringIncomeAction(_: ActionState, form: FormData): Promise<ActionState> {
  try { createRecurringIncome(getDb(), recurringSchema.parse(fd(form))); return done(); } catch (e) { return fail(e); }
}
export async function setRecurringActiveAction(ruleId: number, active: boolean): Promise<ActionState> {
  try { setRecurringActive(getDb(), ruleId, active); return done(); } catch (e) { return fail(e); }
}

export async function resetDemoAction(): Promise<ActionState> {
  try { resetDemoDatabase(); return done(); } catch (e) { return fail(e); }
}
