import { parseIDR, shiftDate } from "../format";
import { containsPhrase, isoDate, MONTHS, normalizeText } from "./text";

export interface ParseAccount { id: number; name: string; type: "cash" | "bank" | "ewallet" | "other" }
export interface RuleHit { category_id: number | null; merchant: string | null }

export interface ParseContext {
  today: string;
  accounts: ParseAccount[];
  /** Looks up a category/merchant for free text. Supplied from the rules table; null when nothing matches. */
  matchRule: (text: string, kind: "income" | "expense") => RuleHit | null;
}

export interface Draft {
  key: string;
  type: "expense" | "income" | "transfer";
  amount: number | null;
  occurred_on: string;
  description: string;
  merchant: string | null;
  account_id: number | null;
  to_account_id: number | null;
  category_id: number | null;
  category_source: "rule" | "user" | "parser" | null;
  confidence: number;
  issues: string[];
  source_text: string;
}

const DAYS = ["minggu", "senin", "selasa", "rabu", "kamis", "jumat", "sabtu"];
const INCOME_STRONG = /\b(gaji|gajian|bonus|thr|honor|freelance|komisi|refund|reimburse|reimbursement|cashback|dividen|pencairan|cair)\b/;
const INCOME_WEAK = /\b(terima|diterima|dapat|dapet|masuk|pemasukan|jual|penjualan)\b/;
const EXPENSE_STRONG = /\b(beli|bayar|belanja|jajan|keluar|bayarin|traktir|langganan)\b/;
const TRANSFER_RE = /^\s*(transfer|tf|pindah(?:kan)?|top\s?up|topup|isi(?:\s+saldo)?)\b/;
const FILLER = new Set(["masuk", "tadi", "sama", "pakai", "pake", "pakek", "via", "dari", "ke", "di", "rp", "dgn", "dengan", "ya", "nih", "barusan"]);
const CASH_ALIASES = new Set(["cash", "tunai", "dompet", "kas"]);
const SEPARATOR = /\s*(?:;|\s\+\s|\bsama\b|\bdan\b|\blalu\b|\bkemudian\b|\bterus\b|\bserta\b)\s*/i;

/** A token that is clearly an amount: has a unit (rb/k/jt), thousands dots, or at least 4 digits. */
function amountOf(token: string): number | null {
  const t = token.replace(/^rp\.?/i, "");
  if (!t) return null;
  const hasUnit = /(rb|ribu|k|jt|juta)$/i.test(t);
  if (!hasUnit && !/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) && !/^\d{4,}$/.test(t)) return null;
  const v = parseIDR(t);
  return v !== null && v > 0 ? v : null;
}

function tokenize(segment: string): string[] {
  return segment.replace(/\brp\.?\s*(?=\d)/gi, "").split(/\s+/).filter(Boolean);
}

/** Split a line into candidate transactions. Segments without an amount are merged into a neighbour. */
function splitSegments(line: string): string[] {
  const rawParts = line.split(SEPARATOR).map((p) => p.trim()).filter(Boolean);
  const parts: string[] = [];
  let carry = "";
  for (const p of rawParts) {
    const withCarry = carry ? `${carry} ${p}` : p;
    if (tokenize(withCarry).some((t) => amountOf(t) !== null)) { parts.push(withCarry); carry = ""; } else carry = withCarry;
  }
  if (carry) { if (parts.length) parts[parts.length - 1] += ` ${carry}`; else parts.push(carry); }
  // "kopi 25rb makan siang 35rb" (no connector): split between amounts.
  return parts.flatMap(splitByAmounts);
}

function splitByAmounts(seg: string): string[] {
  const tokens = tokenize(seg);
  const idx = tokens.map((t, i) => (amountOf(t) !== null ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return [seg];
  const out: string[] = [];
  let start = 0;
  for (let k = 0; k < idx.length - 1; k++) {
    // Tokens after an amount belong to it only if they are an account/date word; otherwise they start the next item.
    let end = idx[k] + 1;
    while (end < idx[k + 1] && isTrailer(tokens[end])) end++;
    out.push(tokens.slice(start, end).join(" "));
    start = end;
  }
  out.push(tokens.slice(start).join(" "));
  return out;
}

const TRAILER = new Set(["pakai", "pake", "pakek", "via", "dari", "cash", "tunai", "kemarin", "tadi", "hari", "ini", "lusa"]);
let ACCOUNT_NAMES: Set<string> = new Set();
function isTrailer(token: string): boolean {
  const t = token.toLowerCase();
  return TRAILER.has(t) || ACCOUNT_NAMES.has(t);
}

function extractDate(text: string, today: string): { date: string | null; rest: string; explicit: boolean } {
  let rest = text;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => string | null): string | null => {
    const m = rest.match(re);
    if (!m) return null;
    const v = fn(m);
    if (v) rest = rest.replace(m[0], " ");
    return v;
  };
  const [ty, tm, td] = today.split("-").map(Number);
  let date =
    take(/\bkemarin\s+lusa\b/i, () => shiftDate(today, -2)) ??
    take(/\bkemarin\b/i, () => shiftDate(today, -1)) ??
    take(/\b(?:hari\s+ini|tadi(?:\s+(?:pagi|siang|sore|malam))?|barusan)\b/i, () => today) ??
    take(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => isoDate(+m[1], +m[2], +m[3])) ??
    take(/\b(\d{1,2})[/\-](\d{1,2})[/\-](\d{4}|\d{2})\b/, (m) => isoDate(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2], +m[1])) ??
    take(/\b(\d{1,2})[/](\d{1,2})\b/, (m) => { const v = isoDate(ty, +m[2], +m[1]); return v && v > today ? isoDate(ty - 1, +m[2], +m[1]) : v; }) ??
    take(new RegExp(`\\b(\\d{1,2})\\s+(${Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|")})[a-z]*\\.?(?:\\s+(\\d{4}))?\\b`, "i"),
      (m) => { const mo = MONTHS[m[2].toLowerCase()]; const v = isoDate(m[3] ? +m[3] : ty, mo, +m[1]); return v && !m[3] && v > today ? isoDate(ty - 1, mo, +m[1]) : v; }) ??
    take(/\b(?:tgl|tanggal)\.?\s*(\d{1,2})\b/i, (m) => {
      const v = isoDate(ty, tm, +m[1]);
      if (v && v <= today) return v;
      const pm = tm === 1 ? 12 : tm - 1;
      return isoDate(tm === 1 ? ty - 1 : ty, pm, +m[1]);
    });
  if (!date) {
    date = take(new RegExp(`\\b(?:hari\\s+)?(${DAYS.join("|")})\\b`, "i"), (m) => {
      const target = DAYS.indexOf(m[1].toLowerCase());
      const todayDow = new Date(`${today}T00:00:00Z`).getUTCDay();
      const back = (todayDow - target + 7) % 7;
      return shiftDate(today, -back);
    });
  }
  return { date, rest, explicit: date !== null };
}

function findAccounts(text: string, accounts: ParseAccount[]): { ids: number[]; rest: string } {
  let rest = ` ${text.toLowerCase()} `;
  const found: { id: number; at: number }[] = [];
  const sorted = [...accounts].sort((a, b) => b.name.length - a.name.length);
  for (const a of sorted) {
    const name = normalizeText(a.name);
    if (!name) continue;
    const re = new RegExp(`(?<![a-z0-9])${name.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]*")}(?![a-z0-9])`, "i");
    const m = rest.match(re);
    if (m && m.index !== undefined) { found.push({ id: a.id, at: m.index }); rest = rest.replace(m[0], " ".repeat(m[0].length)); }
  }
  const alias = rest.match(/(?<![a-z0-9])(cash|tunai|dompet|kas)(?![a-z0-9])/);
  if (alias && alias.index !== undefined) {
    const cash = accounts.find((a) => a.type === "cash");
    if (cash && !found.some((f) => f.id === cash.id)) { found.push({ id: cash.id, at: alias.index }); rest = rest.replace(alias[0], " ".repeat(alias[0].length)); }
  }
  found.sort((a, b) => a.at - b.at);
  return { ids: found.map((f) => f.id), rest: rest.trim() };
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function parseSegment(seg: string, ctx: ParseContext, n: number): Draft {
  const issues: string[] = [];
  const lowerAll = seg.toLowerCase();
  const { date, rest: noDate } = extractDate(seg, ctx.today);
  const tokens = tokenize(noDate);
  const amtIdx = tokens.findIndex((t) => amountOf(t) !== null);
  const amount = amtIdx >= 0 ? amountOf(tokens[amtIdx]) : null;
  if (amtIdx >= 0) tokens.splice(amtIdx, 1);
  const textNoAmount = tokens.join(" ");

  let type: Draft["type"] = "expense";
  const isTransfer = TRANSFER_RE.test(lowerAll);
  if (isTransfer) type = "transfer";
  else if (INCOME_STRONG.test(lowerAll) || (INCOME_WEAK.test(lowerAll) && !EXPENSE_STRONG.test(lowerAll))) type = "income";

  const acc = findAccounts(textNoAmount, ctx.accounts);
  let account_id: number | null = null;
  let to_account_id: number | null = null;
  if (type === "transfer") {
    const low = ` ${textNoAmount.toLowerCase()} `;
    const names = (id: number) => normalizeText(ctx.accounts.find((a) => a.id === id)?.name ?? "");
    const pos = (id: number, marker: string) => new RegExp(`${marker}\\s+${names(id).split(" ").join("[\\s-]*")}`).test(low);
    const fromMarked = acc.ids.find((id) => pos(id, "dari"));
    const toMarked = acc.ids.find((id) => pos(id, "ke"));
    if (/^\s*(top\s?up|topup|isi)/.test(lowerAll)) {
      // "isi gopay 200rb dari bca": the wallet named first is the destination.
      to_account_id = toMarked ?? acc.ids[0] ?? null;
      account_id = fromMarked ?? acc.ids.find((id) => id !== to_account_id) ?? null;
    } else {
      account_id = fromMarked ?? acc.ids.find((id) => id !== toMarked) ?? null;
      to_account_id = toMarked ?? acc.ids.find((id) => id !== account_id) ?? null;
    }
    if (!account_id || !to_account_id || account_id === to_account_id) issues.push("Akun asal dan tujuan transfer belum jelas");
  } else {
    account_id = acc.ids[0] ?? null;
    if (!account_id) issues.push("Akun belum dipilih");
  }

  const words = acc.rest.split(/\s+/).filter((w) => w && !FILLER.has(w) && !CASH_ALIASES.has(w));
  let description = cap(words.join(" ").replace(/\s+/g, " ").trim());
  if (type === "transfer") description = description.replace(/^(Transfer|Tf|Pindah(?:kan)?|Top ?up|Topup|Isi(?: saldo)?)\s*/i, "") || "";

  let category_id: number | null = null;
  let merchant: string | null = null;
  let category_source: Draft["category_source"] = null;
  if (type !== "transfer") {
    const hit = ctx.matchRule(`${seg}`, type);
    if (hit) { category_id = hit.category_id; merchant = hit.merchant; category_source = hit.category_id ? "rule" : null; }
    if (!description) description = merchant ?? (type === "income" ? "Pemasukan" : "Pengeluaran");
  } else if (!description) description = "Transfer";

  if (amount === null) issues.push("Nominal tidak ditemukan");
  if (type !== "transfer" && !category_id) issues.push("Kategori belum ditentukan");
  let confidence = amount === null ? 0.2 : 0.5 + (account_id ? 0.25 : 0) + (category_id || type === "transfer" ? 0.15 : 0) + (date ? 0.1 : 0.05);
  confidence = Math.min(1, Math.round(confidence * 100) / 100);

  return {
    key: `d${n}`, type, amount, occurred_on: date ?? ctx.today, description, merchant, account_id, to_account_id,
    category_id, category_source, confidence, issues, source_text: seg.trim(),
  };
}

/**
 * Deterministic, offline parser for Indonesian quick-entry text. One input can hold several transactions
 * (separate lines, ";", "sama", "dan", or simply several amounts). Always returns drafts: anything uncertain
 * is reported in `issues` so the UI can ask the user instead of guessing silently.
 */
export function parseQuickCapture(input: string, ctx: ParseContext): Draft[] {
  ACCOUNT_NAMES = new Set(ctx.accounts.flatMap((a) => normalizeText(a.name).split(" ")));
  const drafts: Draft[] = [];
  let n = 0;
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const seg of splitSegments(trimmed)) drafts.push(parseSegment(seg, ctx, n++));
  }
  return drafts;
}

export { containsPhrase };
