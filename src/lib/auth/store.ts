import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../db/paths";
import { hashPin, newSecret, signSession, validatePin, verifyPin, verifySession } from "./crypto";

/**
 * Auth state lives in data/auth.json, deliberately OUTSIDE the database: switching between personal and demo data cannot
 * bypass it, and restoring an old database backup cannot silently remove or change it.
 */
export const SESSION_TTL_MS = 12 * 3_600_000;
export const FREE_ATTEMPTS = 5;
const BASE_LOCK_MS = 30_000, MAX_LOCK_MS = 15 * 60_000;

interface AuthState { v: 1; hash: string; secret: string; createdAt: string; failed: number; lockedUntil: number }
const file = (dir: string) => path.join(dir, "auth.json");

function read(dir: string): AuthState | null {
  try {
    const s = JSON.parse(fs.readFileSync(file(dir), "utf8")) as AuthState;
    return s && typeof s.hash === "string" && typeof s.secret === "string" ? s : null;
  } catch { return null; }
}

function write(dir: string, s: AuthState) {
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file(dir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
  fs.renameSync(tmp, file(dir));
}

/** Cached by file mtime: this is consulted on every database access. */
const cache = new Map<string, { mtime: number; size: number; state: AuthState | null }>();
function load(dir: string): AuthState | null {
  const f = file(dir);
  try {
    const st = fs.statSync(f);
    const hit = cache.get(f);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.state;
    const state = read(dir);
    cache.set(f, { mtime: st.mtimeMs, size: st.size, state });
    return state;
  } catch { cache.delete(f); return null; }
}

export const isAuthEnabled = (dir = dataDir()) => load(dir) !== null;

export type LoginResult = { ok: true; token: string } | { ok: false; reason: "invalid" | "locked"; retryAfterSec: number; attemptsLeft: number };

/** Lockout with backoff: after 5 wrong attempts, 30 s, doubling per further wrong attempt up to 15 minutes. Persisted across restarts. */
export function attemptLogin(pin: string, opts: { dir?: string; now?: number } = {}): LoginResult {
  const dir = opts.dir ?? dataDir(), now = opts.now ?? Date.now();
  const s = read(dir);
  if (!s) return { ok: false, reason: "invalid", retryAfterSec: 0, attemptsLeft: 0 };
  if (s.lockedUntil > now) return { ok: false, reason: "locked", retryAfterSec: Math.ceil((s.lockedUntil - now) / 1000), attemptsLeft: 0 };
  if (verifyPin(pin, s.hash)) {
    write(dir, { ...s, failed: 0, lockedUntil: 0 });
    return { ok: true, token: signSession(s.secret, now, SESSION_TTL_MS) };
  }
  const failed = s.failed + 1;
  const over = failed - FREE_ATTEMPTS;
  const lockMs = over >= 0 ? Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** over) : 0;
  write(dir, { ...s, failed, lockedUntil: lockMs ? now + lockMs : 0 });
  return { ok: false, reason: lockMs ? "locked" : "invalid", retryAfterSec: Math.ceil(lockMs / 1000), attemptsLeft: Math.max(0, FREE_ATTEMPTS - failed) };
}

export function verifyToken(token: string | undefined | null, opts: { dir?: string; now?: number } = {}): boolean {
  const s = load(opts.dir ?? dataDir());
  return !!s && verifySession(s.secret, token, opts.now ?? Date.now());
}

export function enableAuth(pin: string, opts: { dir?: string; now?: number } = {}): { token: string } {
  const dir = opts.dir ?? dataDir(), now = opts.now ?? Date.now();
  if (read(dir)) throw new Error("PIN sudah aktif.");
  const bad = validatePin(pin);
  if (bad) throw new Error(bad);
  const secret = newSecret();
  write(dir, { v: 1, hash: hashPin(pin), secret, createdAt: new Date(now).toISOString(), failed: 0, lockedUntil: 0 });
  return { token: signSession(secret, now, SESSION_TTL_MS) };
}

/** Changing the PIN rotates the session secret, which signs out every other session. */
export function changePin(current: string, next: string, opts: { dir?: string; now?: number } = {}): { ok: true; token: string } | { ok: false; reason: string } {
  const dir = opts.dir ?? dataDir(), now = opts.now ?? Date.now();
  const check = attemptLogin(current, opts);
  if (!check.ok) return { ok: false, reason: check.reason === "locked" ? `Terkunci. Coba lagi dalam ${check.retryAfterSec} detik.` : "PIN saat ini salah." };
  const bad = validatePin(next);
  if (bad) return { ok: false, reason: bad };
  const s = read(dir) as AuthState;
  const secret = newSecret();
  write(dir, { ...s, hash: hashPin(next), secret, failed: 0, lockedUntil: 0 });
  return { ok: true, token: signSession(secret, now, SESSION_TTL_MS) };
}

export function disableAuth(current: string, opts: { dir?: string; now?: number } = {}): { ok: true } | { ok: false; reason: string } {
  const dir = opts.dir ?? dataDir();
  const check = attemptLogin(current, opts);
  if (!check.ok) return { ok: false, reason: check.reason === "locked" ? `Terkunci. Coba lagi dalam ${check.retryAfterSec} detik.` : "PIN saat ini salah." };
  fs.rmSync(file(dir), { force: true });
  return { ok: true };
}

/** Sign out every session (rotates the secret) without changing the PIN. */
export function revokeAllSessions(opts: { dir?: string } = {}) {
  const dir = opts.dir ?? dataDir();
  const s = read(dir);
  if (s) write(dir, { ...s, secret: newSecret() });
}
