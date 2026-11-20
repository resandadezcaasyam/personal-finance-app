"use server";
import { z } from "zod";
import { getDb, resetDemoDatabase } from "@/lib/db/client";
import { assertSession } from "@/lib/auth/guard";
import { createAccount, updateAccount, archiveAccount, restoreAccount } from "@/lib/ledger/accounts";
import { createTransaction, updateTransaction, voidTransaction } from "@/lib/ledger/transactions";
import { createTransfer, voidTransfer } from "@/lib/ledger/transfers";
import { reconcileAccount } from "@/lib/ledger/reconcile";
import { createCategory, setCategoryArchived } from "@/lib/ledger/categories";
import { createRecurringIncome, setRecurringActive } from "@/lib/ledger/recurring";
import { money, moneyOrZero, signedMoney, id, optId, date, text, fd, done, fail, type ActionState } from "./shared";

export type { ActionState } from "./shared";

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
  try { assertSession(); resetDemoDatabase(); return done(); } catch (e) { return fail(e); }
}
