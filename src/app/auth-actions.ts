"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { attemptLogin, changePin, disableAuth, enableAuth, isAuthEnabled, revokeAllSessions } from "@/lib/auth/store";
import { SESSION_COOKIE, assertSession, sessionCookieOptions } from "@/lib/auth/guard";
import { validatePin } from "@/lib/auth/crypto";
import type { ActionState } from "./actions/shared";

const str = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string).slice(0, 128) : "");

/** Sign in. The only action that works while the app is locked. */
export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const r = attemptLogin(str(form, "pin"));
  if (!r.ok) {
    return { ok: false, message: r.reason === "locked" ? `Terlalu banyak percobaan. Coba lagi dalam ${r.retryAfterSec} detik.` : `PIN salah.${r.attemptsLeft > 0 ? ` Sisa percobaan sebelum dikunci sementara: ${r.attemptsLeft}.` : ""}` };
  }
  cookies().set(SESSION_COOKIE, r.token, sessionCookieOptions);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function lockNowAction(): Promise<void> {
  cookies().delete(SESSION_COOKIE);
  revalidatePath("/", "layout");
  redirect("/");
}

export async function enablePinAction(_: ActionState, form: FormData): Promise<ActionState> {
  assertSession();
  const pin = str(form, "pin"), confirm = str(form, "confirm");
  if (isAuthEnabled()) return { ok: false, message: "PIN sudah aktif." };
  const bad = validatePin(pin);
  if (bad) return { ok: false, errors: { pin: bad } };
  if (pin !== confirm) return { ok: false, errors: { confirm: "Konfirmasi PIN tidak sama." } };
  const { token } = enableAuth(pin);
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions); // the person who just set it stays signed in
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changePinAction(_: ActionState, form: FormData): Promise<ActionState> {
  assertSession();
  const next = str(form, "pin"), confirm = str(form, "confirm");
  if (next !== confirm) return { ok: false, errors: { confirm: "Konfirmasi PIN tidak sama." } };
  const r = changePin(str(form, "current"), next);
  if (!r.ok) return { ok: false, errors: { current: r.reason } };
  cookies().set(SESSION_COOKIE, r.token, sessionCookieOptions);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function disablePinAction(_: ActionState, form: FormData): Promise<ActionState> {
  assertSession();
  const r = disableAuth(str(form, "current"));
  if (!r.ok) return { ok: false, errors: { current: r.reason } };
  cookies().delete(SESSION_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Sign out every browser/session, keeping the PIN. */
export async function signOutEverywhereAction(): Promise<void> {
  assertSession();
  revokeAllSessions();
  cookies().delete(SESSION_COOKIE);
  revalidatePath("/", "layout");
  redirect("/");
}
