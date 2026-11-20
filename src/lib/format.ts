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
  let text = input.trim().toLowerCase().replace(/^rp\.?\s*/, "").replace(/\s+/g, "");
  // "9.5jt" / "1.5k": a dot with 1-2 digits before a unit is a decimal point, not a thousands separator.
  text = text.replace(/^(\d+)\.(\d{1,2})(rb|ribu|k|jt|juta|m)$/, "$1,$2$3");
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

/** Shift an ISO date by whole days (calendar arithmetic in UTC, so it is timezone independent). */
export function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** First and last calendar day of a 'YYYY-MM' month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/**
 * Add whole months to an ISO date, keeping the intended day of month and clamping to month end
 * (Jan 31 + 1 month = Feb 28/29). `anchorDay` lets a series stay on day 31 after a short month.
 */
export function addMonthsClamped(isoDate: string, months: number, anchorDay?: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const day = anchorDay ?? d;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** "2,5" or "2.5" (percent) -> 250 basis points. Returns null when it is not a plain number. */
export function parsePercentToBps(input: string): number | null {
  const t = input.trim().replace("%", "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Math.round(Number(t) * 100);
  return Number.isSafeInteger(v) ? v : null;
}

/** A valid YYYY-MM-DD string or null (for untrusted URL parameters). */
export function isoOrNull(v: string | undefined | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** A stored UTC timestamp as WIB date and time, e.g. "20 November 2026 14.05". */
export function formatDateTimeID(iso: string): string {
  const t = new Date(Date.parse(iso) + 7 * 3_600_000).toISOString();
  return `${formatDateID(t.slice(0, 10))} ${t.slice(11, 13)}.${t.slice(14, 16)}`;
}
