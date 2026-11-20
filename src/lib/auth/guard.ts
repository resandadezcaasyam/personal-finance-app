import { cookies } from "next/headers";
import { isAuthEnabled, verifyToken } from "./store";

export const SESSION_COOKIE = "pfos_session";
export const SESSION_MAX_AGE_S = 12 * 3600;

export class AuthError extends Error {
  constructor() { super("Aplikasi terkunci. Masukkan PIN untuk melanjutkan."); this.name = "AuthError"; }
}

function cookieToken(): string | undefined {
  try { return cookies().get(SESSION_COOKIE)?.value; } catch { return undefined; } // outside a request there is no session
}

/** True when no PIN is set, or the request carries a valid signed session. */
export function hasValidSession(): boolean {
  return !isAuthEnabled() || verifyToken(cookieToken());
}

/** Fail closed. Called by every database access and by API routes, so pages, server actions and routes are all covered. */
export function assertSession(): void {
  if (!hasValidSession()) throw new AuthError();
}

export const sessionCookieOptions = { httpOnly: true, sameSite: "strict" as const, path: "/", maxAge: SESSION_MAX_AGE_S };
