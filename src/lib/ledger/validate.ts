import { LedgerError } from "./errors";
import { todayWIB } from "../format";

export const MAX_AMOUNT = 1_000_000_000_000; // Rp 1 triliun: sanity cap, far below Number.MAX_SAFE_INTEGER

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Phase 2 records what actually happened, so dates after today are rejected (scheduled items arrive in Phase 3+). */
export function assertPastOrToday(date: string, today: string = todayWIB(), field = "occurred_on") {
  if (!isValidIsoDate(date)) throw new LedgerError("Tanggal tidak valid.", field);
  if (date > today) throw new LedgerError("Tanggal tidak boleh di masa depan. Pembayaran terjadwal dicatat sebagai tagihan atau cicilan.", field);
}

export function assertAmount(amount: number, field = "amount", allowZero = false) {
  if (!Number.isSafeInteger(amount)) throw new LedgerError("Nominal harus bilangan bulat rupiah.", field);
  if (amount < 0 || (!allowZero && amount === 0)) throw new LedgerError("Nominal harus lebih dari 0.", field);
  if (amount > MAX_AMOUNT) throw new LedgerError("Nominal terlalu besar.", field);
}

export function normalizeTags(tags: string | null | undefined): string | null {
  if (!tags) return null;
  const list = [...new Set(tags.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))];
  return list.length ? list.join(",") : null;
}
