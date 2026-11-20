/** Money is an integer number of rupiah. Never use floats for stored amounts. */

const idr = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const plain = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

export function formatIDR(amount: number): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError("Amount must be a safe integer of rupiah");
  return idr.format(amount).replace(/\u00a0/g, " ");
}

export function formatNumber(amount: number): string {
  return plain.format(amount);
}

/** Compact form for charts and tight spaces: 9.500.000 -> "9,5 jt". */
export function formatCompactIDR(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const fmt = (n: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(n);
  if (abs >= 1_000_000_000) return `${sign}Rp ${fmt(abs / 1_000_000_000)} M`;
  if (abs >= 1_000_000) return `${sign}Rp ${fmt(abs / 1_000_000)} jt`;
  if (abs >= 1_000) return `${sign}Rp ${fmt(abs / 1_000)} rb`;
  return `${sign}Rp ${abs}`;
}

/**
 * Parse user-typed rupiah text into an integer. Understands "25rb", "25k", "9,5jt",
 * "1.250.000", "Rp 30.000". Returns null when the text is not a clear amount.
 */
export function parseIDR(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/^rp\.?\s*/, "").replace(/\s+/g, "");
  const m = text.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(rb|ribu|k|jt|juta|m)?$/);
  if (!m) return null;
  const whole = m[1].replace(/\./g, "");
  const dec = m[2] ?? "";
  const unit = m[3];
  const mult = !unit ? 1 : unit === "jt" || unit === "juta" || unit === "m" ? 1_000_000 : 1_000;
  if (dec && !unit) return null; // "1,5" without a unit is ambiguous
  const value = Number(whole) * mult + (dec ? Math.round(Number("0." + dec) * mult) : 0);
  return Number.isSafeInteger(value) ? value : null;
}

const TZ = "Asia/Jakarta";

/** Today's calendar date in WIB as YYYY-MM-DD, regardless of the machine's timezone. */
export function todayWIB(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function currentMonthWIB(now: Date = new Date()): string {
  return todayWIB(now).slice(0, 7);
}

export function formatDateID(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function formatMonthID(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}
