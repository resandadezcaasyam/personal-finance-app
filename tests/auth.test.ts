import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hashPin, verifyPin, validatePin, signSession, verifySession, newSecret } from "@/lib/auth/crypto";
import { enableAuth, attemptLogin, verifyToken, changePin, disableAuth, revokeAllSessions, isAuthEnabled, SESSION_TTL_MS, FREE_ATTEMPTS } from "@/lib/auth/store";
import { getDb, closeDatabase, dbPathFor } from "@/lib/db/client";
import { AuthError } from "@/lib/auth/guard";

let dir: string;
let prev: string | undefined;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "pfos-auth-")); prev = process.env.FINANCE_DATA_DIR; process.env.FINANCE_DATA_DIR = dir; });
afterEach(() => { closeDatabase(dbPathFor("personal")); closeDatabase(dbPathFor("demo")); if (prev === undefined) delete process.env.FINANCE_DATA_DIR; else process.env.FINANCE_DATA_DIR = prev; fs.rmSync(dir, { recursive: true, force: true }); });

const T0 = Date.UTC(2026, 10, 20, 3, 0, 0);

describe("PIN hashing", () => {
  it("stores a salted scrypt hash, never the PIN, and verifies correctly", () => {
    const h = hashPin("rahasia-88");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain("rahasia-88");
    expect(hashPin("rahasia-88")).not.toBe(h); // random salt
    expect(verifyPin("rahasia-88", h)).toBe(true);
    expect(verifyPin("rahasia-89", h)).toBe(false);
    expect(verifyPin("", h)).toBe(false);
  });
  it("treats malformed stored values as a failed check, never a crash", () => {
    for (const bad of ["", "x", "scrypt$1$2", "md5$a$b$c$d$e", "scrypt$16384$8$1$!!$!!", "scrypt$16384$8$1$$", "scrypt$16384$8$1$c2FsdHNhbHRzYWx0$", "scrypt$3$8$1$c2FsdHNhbHRzYWx0$YWJjZGVmZ2hpamtsbW5vcA==", "scrypt$99999999$8$1$c2FsdHNhbHRzYWx0$YWJjZGVmZ2hpamtsbW5vcA=="]) expect(verifyPin("a", bad)).toBe(false);
    // an empty-hash record (e.g. a damaged auth.json) must not accept any PIN, including the empty one
    expect(verifyPin("", "scrypt$16384$8$1$c2FsdHNhbHRzYWx0$")).toBe(false);
  });
  it("normalizes unicode so the same PIN typed differently still matches", () => {
    expect(verifyPin("é-pin", hashPin("e\u0301-pin"))).toBe(true);
  });
  it("rejects short, long and obviously weak PINs", () => {
    expect(validatePin("123")).toMatch(/minimal/);
    expect(validatePin("x".repeat(65))).toMatch(/maksimal/);
    for (const w of ["1234", "0000", "111111", "123456", "Password", "aaaaaa"]) expect(validatePin(w)).toMatch(/mudah ditebak/);
    expect(validatePin("481926")).toBeNull();
    expect(validatePin("kopi susu enak")).toBeNull();
  });
});

describe("session tokens", () => {
  it("are accepted while valid and rejected after expiry", () => {
    const s = newSecret();
    const t = signSession(s, T0, 1000);
    expect(verifySession(s, t, T0 + 500)).toBe(true);
    expect(verifySession(s, t, T0 + 1000)).toBe(false);
  });
  it("reject tampering, another secret, garbage and missing values", () => {
    const s = newSecret();
    const t = signSession(s, T0, 60_000);
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ iat: T0, exp: T0 + 9e12 })).toString("base64url");
    expect(verifySession(s, `${forged}.${sig}`, T0)).toBe(false);
    expect(verifySession(s, `${body}.${sig.slice(0, -2)}AA`, T0)).toBe(false);
    expect(verifySession(newSecret(), t, T0)).toBe(false);
    for (const bad of ["", "abc", "a.b.c", ".", `${body}.`, "x".repeat(600), null, undefined]) expect(verifySession(s, bad as string, T0)).toBe(false);
  });
  it("reject a token issued in the future", () => {
    const s = newSecret();
    expect(verifySession(s, signSession(s, T0 + 3_600_000, 60_000), T0)).toBe(false);
  });
});

describe("enabling, logging in, changing and disabling", () => {
  it("is off until enabled, stores only a hash on disk, and keeps the file private", () => {
    expect(isAuthEnabled(dir)).toBe(false);
    const { token } = enableAuth("481926", { dir, now: T0 });
    expect(isAuthEnabled(dir)).toBe(true);
    const raw = fs.readFileSync(path.join(dir, "auth.json"), "utf8");
    expect(raw).not.toContain("481926");
    expect(JSON.parse(raw).hash.startsWith("scrypt$")).toBe(true);
    expect(verifyToken(token, { dir, now: T0 + 1000 })).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(path.join(dir, "auth.json")).mode & 0o077).toBe(0);
    expect(() => enableAuth("729104", { dir })).toThrow(/sudah aktif/);
  });
  it("refuses a weak PIN when enabling", () => {
    expect(() => enableAuth("1234", { dir })).toThrow(/mudah ditebak/);
    expect(isAuthEnabled(dir)).toBe(false);
  });
  it("logs in with the right PIN and not with a wrong one", () => {
    enableAuth("481926", { dir, now: T0 });
    const ok = attemptLogin("481926", { dir, now: T0 });
    expect(ok.ok).toBe(true);
    expect(ok.ok && verifyToken(ok.token, { dir, now: T0 + SESSION_TTL_MS - 1 })).toBe(true);
    expect(ok.ok && verifyToken(ok.token, { dir, now: T0 + SESSION_TTL_MS + 1 })).toBe(false);
    const bad = attemptLogin("000999", { dir, now: T0 });
    expect(bad).toMatchObject({ ok: false, reason: "invalid", attemptsLeft: FREE_ATTEMPTS - 1 });
  });
  it("changing the PIN needs the current one and signs out every old session", () => {
    const { token } = enableAuth("481926", { dir, now: T0 });
    expect(changePin("wrong1", "739205", { dir, now: T0 })).toMatchObject({ ok: false, reason: "PIN saat ini salah." });
    expect(changePin("481926", "1234", { dir, now: T0 })).toMatchObject({ ok: false });
    const r = changePin("481926", "739205", { dir, now: T0 });
    expect(r.ok).toBe(true);
    expect(verifyToken(token, { dir, now: T0 + 1 })).toBe(false);        // old session is gone
    expect(r.ok && verifyToken(r.token, { dir, now: T0 + 1 })).toBe(true);
    expect(attemptLogin("481926", { dir, now: T0 }).ok).toBe(false);
    expect(attemptLogin("739205", { dir, now: T0 }).ok).toBe(true);
  });
  it("disabling needs the current PIN", () => {
    enableAuth("481926", { dir, now: T0 });
    expect(disableAuth("nope11", { dir, now: T0 })).toMatchObject({ ok: false });
    expect(isAuthEnabled(dir)).toBe(true);
    expect(disableAuth("481926", { dir, now: T0 })).toEqual({ ok: true });
    expect(isAuthEnabled(dir)).toBe(false);
    expect(verifyToken("anything", { dir })).toBe(false);
  });
  it("revoking all sessions invalidates tokens but keeps the PIN", () => {
    const { token } = enableAuth("481926", { dir, now: T0 });
    revokeAllSessions({ dir });
    expect(verifyToken(token, { dir, now: T0 + 1 })).toBe(false);
    expect(attemptLogin("481926", { dir, now: T0 }).ok).toBe(true);
  });
});

describe("lockout with backoff", () => {
  it("allows 5 wrong attempts, then locks for 30 s and doubles up to 15 minutes", () => {
    enableAuth("481926", { dir, now: T0 });
    let r;
    for (let i = 1; i <= FREE_ATTEMPTS - 1; i++) { r = attemptLogin("bad000", { dir, now: T0 }); expect(r).toMatchObject({ ok: false, reason: "invalid", attemptsLeft: FREE_ATTEMPTS - i }); }
    r = attemptLogin("bad000", { dir, now: T0 });
    expect(r).toMatchObject({ ok: false, reason: "locked", retryAfterSec: 30 });
    // while locked even the RIGHT PIN is refused
    expect(attemptLogin("481926", { dir, now: T0 + 10_000 })).toMatchObject({ ok: false, reason: "locked", retryAfterSec: 20 });
    expect(attemptLogin("bad000", { dir, now: T0 + 31_000 })).toMatchObject({ reason: "locked", retryAfterSec: 60 });
    expect(attemptLogin("bad000", { dir, now: T0 + 31_000 + 61_000 })).toMatchObject({ retryAfterSec: 120 });
    let t = T0 + 200_000, last = 0;
    for (let i = 0; i < 12; i++) { const x = attemptLogin("bad000", { dir, now: t }); last = x.ok ? 0 : x.retryAfterSec; t += (last + 1) * 1000; }
    expect(last).toBe(900); // capped
  });
  it("a successful login resets the counter; the lock survives a 'restart' (state is on disk)", () => {
    enableAuth("481926", { dir, now: T0 });
    for (let i = 0; i < 3; i++) attemptLogin("bad000", { dir, now: T0 });
    expect(attemptLogin("481926", { dir, now: T0 }).ok).toBe(true);
    expect(attemptLogin("bad000", { dir, now: T0 })).toMatchObject({ attemptsLeft: FREE_ATTEMPTS - 1 });
    for (let i = 0; i < FREE_ATTEMPTS; i++) attemptLogin("bad000", { dir, now: T0 });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf8")).lockedUntil).toBeGreaterThan(T0);
    expect(attemptLogin("481926", { dir, now: T0 + 1000 })).toMatchObject({ reason: "locked" });
  });
});

describe("the database fails closed while locked", () => {
  it("opens normally with no PIN set", () => {
    expect(() => getDb("personal").prepare("SELECT 1").get()).not.toThrow();
  });
  it("refuses personal AND demo data once a PIN is set and there is no valid session", () => {
    enableAuth("481926");
    expect(() => getDb("personal")).toThrow(AuthError);
    expect(() => getDb("demo")).toThrow(AuthError);
    expect(() => getDb()).toThrow(/terkunci/i);
  });
  it("the PIN lives outside the database, so a restored or replaced database cannot remove it", () => {
    enableAuth("481926");
    fs.rmSync(path.join(dir, "finance.db"), { force: true });
    expect(isAuthEnabled()).toBe(true);
    expect(fs.existsSync(path.join(dir, "auth.json"))).toBe(true);
  });
});
