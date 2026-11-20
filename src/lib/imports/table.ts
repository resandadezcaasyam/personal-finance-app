import { MONTHS, isoDate } from "../capture/text";

/** A parsed spreadsheet-like table. Cells are raw strings, numbers (from XLSX) or null. */
export type Cell = string | number | null;
export type Table = Cell[][];

/* ---------------- CSV ---------------- */

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 15);
  let best = ",";
  let bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = sample.map((l) => splitLine(l, d).length);
    const common = counts.filter((c) => c === counts[0]).length;
    const score = counts[0] > 1 ? common * 100 + counts[0] : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** RFC-4180-style CSV with quoted fields (including quoted newlines). */
export function parseCsv(input: string, delimiter?: string): Table {
  const text = input.replace(/^\uFEFF/, "");
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

/* ---------------- numbers & dates ---------------- */

export type NumberFormat = "auto" | "id" | "en";
export type DateFormat = "auto" | "dmy" | "mdy" | "ymd";

/**
 * Parse a statement amount to a signed number of rupiah (may carry decimals).
 * Understands 1.250.000,50 (id), 1,250,000.50 (en), (25.000) and trailing/leading minus, and "DB"/"CR" suffixes.
 */
export function parseAmountCell(cell: Cell, format: NumberFormat = "auto"): { value: number; dc: "D" | "C" | null } | null {
  if (cell === null || cell === "") return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? { value: cell, dc: null } : null;
  let s = cell.trim();
  if (!s) return null;
  let dc: "D" | "C" | null = null;
  const suffix = s.match(/\s*(db|dr|debit|debet|d|cr|kr|credit|kredit|k)\.?$/i);
  if (suffix && /\d/.test(s.slice(0, suffix.index))) { dc = /^(db|dr|debit|debet|d)$/i.test(suffix[1]) ? "D" : "C"; s = s.slice(0, suffix.index).trim(); }
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-") || s.startsWith("−")) { neg = true; s = s.slice(1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/^(rp|idr)\.?\s*/i, "").replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let decimalSep: "." | "," | null = null;
  if (format === "id") decimalSep = commas ? "," : null;
  else if (format === "en") decimalSep = dots ? "." : null;
  else if (dots && commas) decimalSep = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
  else if (dots + commas === 1) {
    const sep = dots ? "." : ",";
    const tail = s.length - s.indexOf(sep) - 1;
    if (tail !== 3) decimalSep = sep; // 25.000 is thousands; 25.50 is decimals
  }
  let num = s;
  if (decimalSep) {
    const i = s.lastIndexOf(decimalSep);
    num = s.slice(0, i).replace(/[.,]/g, "") + "." + s.slice(i + 1).replace(/[.,]/g, "");
  } else num = s.replace(/[.,]/g, "");
  const v = Number(num);
  if (!Number.isFinite(v)) return null;
  return { value: neg ? -v : v, dc };
}

export function parseDateCell(cell: Cell, format: DateFormat = "auto"): string | null {
  if (cell === null || cell === "") return null;
  if (typeof cell === "number") {
    // Excel serial date (days since 1899-12-30)
    if (cell > 20000 && cell < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(cell) * 86_400_000).toISOString().slice(0, 10);
    return null;
  }
  const s = cell.trim().replace(/\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s*(?:wib|wita|wit|am|pm))?$/i, "").replace(/,$/, "");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const a = +m[1], b = +m[2];
    if (format === "mdy") return isoDate(y, a, b);
    if (format === "dmy" || format === "auto") {
      const dmy = isoDate(y, b, a);
      if (dmy || format === "dmy") return dmy;
      return isoDate(y, a, b);
    }
    return null;
  }
  m = s.match(/^(\d{1,2})[\s\-/]([A-Za-z]{3,9})\.?[\s\-/,]*(\d{2}|\d{4})$/);
  if (m) { const mo = MONTHS[m[2].toLowerCase()]; return mo ? isoDate(+m[3] < 100 ? 2000 + +m[3] : +m[3], mo, +m[1]) : null; }
  m = s.match(/^(\d{1,2})[\s\-/]([A-Za-z]{3,9})\.?$/); // no year: caller decides
  return m ? null : null;
}

/* ---------------- mapping ---------------- */

export interface Mapping {
  /** Index of the header row; rows before it (and it) are skipped. -1 = no header. */
  header_row: number;
  date: number | null;
  description: number | null;
  debit: number | null;
  credit: number | null;
  /** Single amount column (signed, or paired with `dc`, or with a DB/CR suffix). */
  amount: number | null;
  dc: number | null;
  reference: number | null;
  balance: number | null;
  date_format: DateFormat;
  number_format: NumberFormat;
  /** For a single unsigned amount column: which type a positive number is. */
  positive_is: "income" | "expense" | null;
}

type MapField = "date" | "description" | "debit" | "credit" | "amount" | "dc" | "reference" | "balance";

export const EMPTY_MAPPING: Mapping = { header_row: -1, date: null, description: null, debit: null, credit: null, amount: null, dc: null, reference: null, balance: null, date_format: "auto", number_format: "auto", positive_is: null };

const SYN: Record<MapField, string[]> = {
  date: ["tanggal", "tgl", "date", "waktu", "tanggal transaksi", "tgl transaksi", "posting date", "tanggal posting", "transaction date"],
  description: ["keterangan", "deskripsi", "uraian", "description", "remark", "remarks", "berita", "detail", "transaksi", "narasi", "particulars", "memo"],
  debit: ["debet", "debit", "db", "keluar", "pengeluaran", "withdrawal", "uang keluar", "dana keluar"],
  credit: ["kredit", "credit", "cr", "masuk", "pemasukan", "deposit", "uang masuk", "dana masuk"],
  amount: ["jumlah", "nominal", "amount", "mutasi", "nilai", "total"],
  dc: ["tipe", "jenis", "d/k", "db/cr", "dc", "type", "dk", "cr/db"],
  reference: ["referensi", "ref", "no ref", "no. ref", "nomor referensi", "id transaksi", "trx id", "reference", "no referensi", "nomor transaksi"],
  balance: ["saldo", "balance", "saldo akhir"],
};

const norm = (c: Cell) => String(c ?? "").toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();

export function fieldOfHeader(c: Cell): MapField | null {
  const t = norm(c);
  if (!t) return null;
  for (const [field, words] of Object.entries(SYN)) if (words.includes(t)) return field as MapField;
  for (const [field, words] of Object.entries(SYN)) if (words.some((w) => w.length > 4 && t.includes(w))) return field as MapField;
  return null;
}

/** Find the header row (first row with at least two recognised column names) and propose a mapping. */
export function guessMapping(table: Table): Mapping {
  let headerRow = -1;
  for (let i = 0; i < Math.min(table.length, 40); i++) {
    const hits = new Set(table[i].map(fieldOfHeader).filter(Boolean));
    if (hits.size >= 2 && (hits.has("date") || hits.has("description") || hits.has("amount") || hits.has("debit"))) { headerRow = i; break; }
  }
  const m: Mapping = { ...EMPTY_MAPPING, header_row: headerRow };
  if (headerRow >= 0) {
    table[headerRow].forEach((c, idx) => {
      const f = fieldOfHeader(c);
      if (f && m[f] === null) (m[f] as number | null) = idx;
    });
  }
  return m;
}

export function headerSignature(table: Table, mapping: Mapping): string {
  const row = mapping.header_row >= 0 ? table[mapping.header_row] : table[0] ?? [];
  return row.map(norm).join("|");
}

export interface NormalizedRow {
  row_no: number; // 1-based position in the original file
  occurred_on: string;
  description: string;
  amount: number; // positive whole rupiah
  type: "income" | "expense";
  reference: string | null;
  balance: number | null;
}
export interface RowError { row_no: number; reason: string }
export interface NormalizeResult { rows: NormalizedRow[]; errors: RowError[]; skipped: number }

const str = (c: Cell | undefined) => (c === null || c === undefined ? "" : String(c).trim());

/**
 * Turn raw rows into transactions using a column mapping. Rows that are clearly not transactions (no date, no
 * amount: totals, opening balance, page headers) are skipped silently; rows that look like transactions but are
 * broken are reported as errors with the original row number. Nothing is guessed silently.
 */
export function normalizeRows(table: Table, m: Mapping, today: string): NormalizeResult {
  const rows: NormalizedRow[] = [];
  const errors: RowError[] = [];
  let skipped = 0;
  const get = (r: Cell[], i: number | null) => (i === null ? undefined : r[i]);

  // When there is no explicit debit/credit and the amount is unsigned with no DC marker, the running balance can
  // tell money in from money out. Used as a fallback only.
  const balances = m.balance !== null ? table.map((r) => parseAmountCell(get(r, m.balance) ?? null, m.number_format)?.value ?? null) : [];

  for (let i = m.header_row + 1; i < table.length; i++) {
    const r = table[i];
    const rowNo = i + 1;
    const dateCell = get(r, m.date);
    const date = parseDateCell(dateCell ?? null, m.date_format);
    let amount: number | null = null;
    let type: "income" | "expense" | null = null;

    if (m.debit !== null || m.credit !== null) {
      const d = parseAmountCell(get(r, m.debit) ?? null, m.number_format);
      const c = parseAmountCell(get(r, m.credit) ?? null, m.number_format);
      const dv = d ? Math.abs(d.value) : 0;
      const cv = c ? Math.abs(c.value) : 0;
      if (dv > 0 && cv > 0) { errors.push({ row_no: rowNo, reason: "Kolom debet dan kredit sama-sama terisi" }); continue; }
      if (dv > 0) { amount = dv; type = "expense"; } else if (cv > 0) { amount = cv; type = "income"; }
    } else if (m.amount !== null) {
      const a = parseAmountCell(get(r, m.amount) ?? null, m.number_format);
      if (a) {
        amount = Math.abs(a.value);
        const marker = str(get(r, m.dc)).toLowerCase();
        if (a.dc) type = a.dc === "D" ? "expense" : "income";
        else if (marker) type = /^(d|db|dr|debit|debet|k?eluar|out)/.test(marker) ? "expense" : /^(c|cr|k|kr|kredit|credit|masuk|in)/.test(marker) ? "income" : null;
        else if (a.value < 0) type = "expense";
        else if (a.value > 0 && m.balance === null) {
          if (!m.positive_is) { errors.push({ row_no: rowNo, reason: "Tentukan apakah nominal positif adalah pemasukan atau pengeluaran" }); continue; }
          type = m.positive_is;
        }
        else if (a.value > 0) {
          // Unsigned amount with a running balance: the balance change tells money in from money out.
          const bal = balances[i];
          const prev = balances.slice(0, i).reverse().find((b) => b !== null) ?? null;
          if (bal !== null && prev !== null) {
            if (Math.abs(bal - prev - amount) < 1) type = "income";
            else if (Math.abs(bal - prev + amount) < 1) type = "expense";
            else { errors.push({ row_no: rowNo, reason: "Saldo tidak cocok dengan nominal; periksa baris ini" }); continue; }
          } else {
            errors.push({ row_no: rowNo, reason: "Arah transaksi tidak dapat dipastikan (belum ada saldo sebelumnya). Gunakan kolom debet/kredit atau atur 'nominal positif adalah'." });
            continue;
          }
        }
      }
    }

    const description = [str(get(r, m.description))].filter(Boolean).join(" ").replace(/\s+/g, " ");
    if (!date && (amount === null || amount === 0)) { skipped++; continue; }
    if (!date) { errors.push({ row_no: rowNo, reason: `Tanggal tidak terbaca: "${str(dateCell)}"` }); continue; }
    if (date > today) { errors.push({ row_no: rowNo, reason: `Tanggal ${date} ada di masa depan` }); continue; }
    if (amount === null || !type) {
      errors.push({ row_no: rowNo, reason: amount === null ? "Nominal tidak terbaca atau kosong" : "Tidak bisa menentukan masuk atau keluar" });
      continue;
    }
    const whole = Math.round(amount);
    if (whole <= 0) { errors.push({ row_no: rowNo, reason: "Nominal harus lebih dari 0" }); continue; }
    rows.push({
      row_no: rowNo, occurred_on: date, description, amount: whole, type,
      reference: str(get(r, m.reference)) || null, balance: m.balance !== null ? balances[i] : null,
    });
  }
  return { rows, errors, skipped };
}
