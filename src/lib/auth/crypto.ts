import crypto from "node:crypto";

/**
 * Local PIN/password protection primitives. The PIN is stored only as a salted scrypt hash. This guards the APP against
 * casual access on a shared computer; it is NOT database encryption: finance.db and the backups are ordinary files.
 */
const N = 16384, R = 8, P = 1, KEYLEN = 32;
export const MIN_PIN = 4, MAX_PIN = 64;
const WEAK = new Set(["1234", "0000", "1111", "12345", "123456", "000000", "111111", "1234567", "12345678", "password", "qwerty"]);

export function validatePin(pin: string): string | null {
  if (pin.length < MIN_PIN) return `PIN minimal ${MIN_PIN} karakter.`;
  if (pin.length > MAX_PIN) return `PIN maksimal ${MAX_PIN} karakter.`;
  if (WEAK.has(pin.toLowerCase()) || /^(.)\1+$/.test(pin)) return "PIN terlalu mudah ditebak. Hindari angka berulang atau berurutan.";
  return null;
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  try {
    const [alg, n, r, p, salt, hash] = stored.split("$");
    if (alg !== "scrypt") return false;
    const expected = Buffer.from(hash, "base64");
    const saltBytes = Buffer.from(salt, "base64");
    const N2 = Number(n), r2 = Number(r), p2 = Number(p);
    // Fail closed on anything that is not a well-formed, reasonably strong record (an empty hash must never match).
    if (expected.length < 16 || saltBytes.length < 8 || !Number.isInteger(N2) || N2 < 1024 || N2 > 1 << 20 || (N2 & (N2 - 1)) !== 0 || !(r2 >= 1 && r2 <= 16) || !(p2 >= 1 && p2 <= 4)) return false;
    const actual = crypto.scryptSync(pin.normalize("NFKC"), saltBytes, expected.length, { N: N2, r: r2, p: p2 });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

export const newSecret = () => crypto.randomBytes(32).toString("base64");

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, body: string) => crypto.createHmac("sha256", Buffer.from(secret, "base64")).update(body).digest();

/** A session token is `payload.signature`; the payload only carries issue/expiry times. */
export function signSession(secret: string, now: number, ttlMs: number): string {
  const body = b64(JSON.stringify({ iat: now, exp: now + ttlMs }));
  return `${body}.${b64(mac(secret, body))}`;
}

export function verifySession(secret: string, token: string | undefined | null, now: number): boolean {
  if (!token || token.length > 512) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  const good = mac(secret, body);
  let given: Buffer;
  try { given = Buffer.from(sig, "base64url"); } catch { return false; }
  if (given.length !== good.length || !crypto.timingSafeEqual(given, good)) return false;
  try {
    const { iat, exp } = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { iat: number; exp: number };
    return Number.isFinite(iat) && Number.isFinite(exp) && iat <= now + 60_000 && now < exp;
  } catch { return false; }
}
