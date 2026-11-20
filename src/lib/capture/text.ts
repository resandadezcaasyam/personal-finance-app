/** Lowercase, strip punctuation to single spaces. Used for rule matching and fingerprints. */
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** True when `pattern` (already normalized) occurs in `text` as whole words. */
export function containsPhrase(text: string, pattern: string): boolean {
  if (!pattern) return false;
  return ` ${normalizeText(text)} `.includes(` ${pattern} `);
}

export const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mar: 3, maret: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5,
  jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, agu: 8, agt: 8, agust: 8, agustus: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12,
};

export function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function expandYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

/**
 * Find a calendar date inside free text (OCR text, receipts). Understands 18/11/2026, 18-11-26, 2026-11-18,
 * "18 November 2026", "18 Nov 26". Returns the first valid one not after `today`.
 */
export function findDateInText(text: string, today: string): string | null {
  const cands: string[] = [];
  const push = (v: string | null) => { if (v && v <= today) cands.push(v); };
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(isoDate(+m[1], +m[2], +m[3]));
  for (const m of text.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})\b/g)) push(isoDate(expandYear(+m[3]), +m[2], +m[1]));
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_RE})[a-z]*\\.?,?\\s+(\\d{4}|\\d{2})\\b`, "gi"))) push(isoDate(expandYear(+m[3]), MONTHS[m[2].toLowerCase()], +m[1]));
  return cands[0] ?? null;
}

/** A sensible default pattern for "remember this merchant": the merchant, else the first meaningful words. */
export function suggestPattern(description: string, merchant?: string | null): string {
  const base = normalizeText(merchant || description);
  const words = base.split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  return words.slice(0, 3).join(" ");
}
