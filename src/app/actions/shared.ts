import { revalidatePath } from "next/cache";
import { z, ZodError } from "zod";
import { LedgerError } from "@/lib/ledger/errors";
import { parseIDR, parsePercentToBps } from "@/lib/format";

export type ActionState = { ok: boolean; message?: string; errors?: Record<string, string> };

export const AMOUNT_MSG = "Nominal tidak valid. Contoh: 25rb, 9,5jt, atau 1.250.000";

export const money = z.string().trim().min(1, "Wajib diisi").transform((s, ctx) => {
  const v = parseIDR(s);
  if (v === null) { ctx.addIssue({ code: "custom", message: AMOUNT_MSG }); return z.NEVER; }
  return v;
});
/** Empty means 0 (for optional amounts such as fees). */
export const moneyOrZero = z.string().trim().transform((s, ctx) => {
  if (s === "") return 0;
  const v = parseIDR(s);
  if (v === null) { ctx.addIssue({ code: "custom", message: AMOUNT_MSG }); return z.NEVER; }
  return v;
});
/** Empty means "not set" (null). */
export const moneyOrNull = z.string().trim().transform((s, ctx) => {
  if (s === "") return null;
  const v = parseIDR(s);
  if (v === null) { ctx.addIssue({ code: "custom", message: AMOUNT_MSG }); return z.NEVER; }
  return v;
});
/** Signed amount for balances that may legitimately be negative (overdraft). */
export const signedMoney = z.string().trim().min(1, "Wajib diisi").transform((s, ctx) => {
  const neg = s.startsWith("-");
  const v = parseIDR(neg ? s.slice(1) : s);
  if (v === null) { ctx.addIssue({ code: "custom", message: AMOUNT_MSG }); return z.NEVER; }
  return neg ? -v : v;
});
export const percentBps = z.string().trim().transform((s, ctx) => {
  if (s === "") return null;
  const v = parsePercentToBps(s);
  if (v === null) { ctx.addIssue({ code: "custom", message: "Persentase tidak valid. Contoh: 2,5" }); return z.NEVER; }
  return v;
});
export const id = z.coerce.number().int().positive("Pilih salah satu");
export const optId = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().positive().nullable());
export const optInt = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().int().optional());
export const date = z.string().min(1, "Tanggal wajib diisi");
export const text = (max: number) => z.string().trim().max(max, `Maksimal ${max} karakter`);
export const fd = (f: FormData) => Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === "string"));

export function done(): ActionState {
  revalidatePath("/", "layout");
  return { ok: true };
}

export function fail(e: unknown): ActionState {
  if (e instanceof ZodError) {
    const errors: Record<string, string> = {};
    for (const i of e.issues) errors[String(i.path[0] ?? "form")] ??= i.message;
    return { ok: false, message: "Periksa kembali isian yang ditandai.", errors };
  }
  if (e instanceof LedgerError) return { ok: false, message: e.message, errors: e.field ? { [e.field]: e.message } : undefined };
  console.error(e);
  return { ok: false, message: "Terjadi kesalahan tak terduga. Data Anda tidak berubah." };
}
