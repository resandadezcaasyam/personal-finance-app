import { findDateInText } from "./text";

export interface ReceiptResult {
  amount: number | null;
  fee: number | null;
  occurred_on: string | null;
  merchant: string | null;
  reference: string | null;
  payment_method: string | null;
  type: "expense" | "income";
  confidence: number;
  /** Per-field confidence 0..1 so the UI can show what is uncertain. */
  fields: { amount: number; date: number; merchant: number; reference: number };
  issues: string[];
  /** Why the amount was chosen (shown to the user). */
  amount_source: string | null;
}

/**
 * "Rp 1.250.000", "Rp25.000,00", "IDR 25,000", "25.50" -> whole rupiah.
 * Rules: with both separators the last one is the decimal point; a single separator repeated is thousands;
 * a single separator followed by exactly 3 digits is thousands, followed by 1-2 digits is decimals.
 */
export function parseReceiptAmount(raw: string): number | null {
  let s = raw.replace(/[^\d.,]/g, "").replace(/[.,]+$/, "");
  if (!/\d/.test(s)) return null;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  let decimal = "";
  if (dots && commas) {
    const sep = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const tail = s.slice(s.lastIndexOf(sep) + 1);
    if (tail.length <= 2) { decimal = tail; s = s.slice(0, s.lastIndexOf(sep)); }
  } else if (dots + commas === 1) {
    const sep = dots ? "." : ",";
    const tail = s.slice(s.indexOf(sep) + 1);
    if (tail.length >= 1 && tail.length <= 2) { decimal = tail; s = s.slice(0, s.indexOf(sep)); }
  }
  const whole = s.replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole)) return null;
  const v = Math.round(Number(`${whole}${decimal ? "." + decimal : ""}`));
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}

const AMOUNT_RE = /(?:rp|idr)\.?\s*([\d][\d.,]*)|(\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\b)/gi;
const EXCLUDE = /\b(saldo|balance|sisa|subtotal|sub\s*total|diskon|potongan|kembali|kembalian|poin|point|points|cashback|voucher|promo|limit)\b/i;
const FEE = /\b(biaya|admin|fee|layanan|service|ppn|pajak)\b/i;
const TOTAL_STRONG = /\b(total\s*(pembayaran|bayar|tagihan|transaksi|belanja|pembelian)?|grand\s*total|jumlah\s*(bayar|pembayaran|transfer)?|total)\b/i;
const TOTAL_WEAK = /\b(nominal|amount|dibayar|tagihan|bayar|harga|pembayaran)\b/i;
const GENERIC_HEAD = /(berhasil|sukses|success|struk|bukti|receipt|detail|transaksi|pembayaran|terima kasih|thank|invoice|rincian|selesai)/i;
const METHODS = ["gopay", "ovo", "dana", "shopeepay", "linkaja", "qris", "bca", "mandiri", "bni", "bri", "seabank", "jago", "permata", "cimb", "visa", "mastercard", "jenius", "blu"];

function amountsIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    const v = parseReceiptAmount(m[1] ?? m[2]);
    if (v !== null) out.push(v);
  }
  return out;
}

/**
 * Heuristic extractor for OCR text of payment receipts/screenshots. It separates the transaction total from
 * balances, subtotals, fees and other numbers, and reports how sure it is. It never invents values.
 */
export function extractReceipt(text: string, opts: { today: string; ocrConfidence?: number }): ReceiptResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const issues: string[] = [];

  // --- amount
  type Cand = { v: number; score: number; why: string };
  const cands: Cand[] = [];
  let fee: number | null = null;
  lines.forEach((line, i) => {
    let vals = amountsIn(line);
    if (vals.length === 0 && (TOTAL_STRONG.test(line) || TOTAL_WEAK.test(line)) && lines[i + 1]) vals = amountsIn(lines[i + 1]); // label on one line, value on the next
    if (vals.length === 0) return;
    const v = vals[vals.length - 1];
    if (EXCLUDE.test(line)) return;
    if (FEE.test(line) && !TOTAL_STRONG.test(line)) { fee = fee ?? v; return; }
    if (TOTAL_STRONG.test(line)) cands.push({ v, score: /total/i.test(line) ? 4 : 3, why: `baris "${line.slice(0, 40)}"` });
    else if (TOTAL_WEAK.test(line)) cands.push({ v, score: 2, why: `baris "${line.slice(0, 40)}"` });
    else cands.push({ v, score: 1, why: "angka terbesar" });
  });
  let amount: number | null = null;
  let amountConf = 0;
  let amount_source: string | null = null;
  if (cands.length) {
    const best = [...cands].sort((a, b) => b.score - a.score || b.v - a.v)[0];
    amount = best.v;
    amount_source = best.why;
    amountConf = best.score >= 3 ? 0.95 : best.score === 2 ? 0.75 : 0.45;
    if (best.score < 3) issues.push("Nominal ditebak dari angka di struk, mohon periksa");
  } else issues.push("Nominal transaksi tidak ditemukan");

  // --- date
  const occurred_on = findDateInText(text, opts.today);
  if (!occurred_on) issues.push("Tanggal tidak terbaca");

  // --- reference
  const refM = text.match(/(?:no\.?\s*(?:ref(?:erensi)?|transaksi)|id\s*transaksi|ref(?:erence)?(?:\s*(?:no|id|number))?|order\s*id|trx\s*id|nomor\s*(?:referensi|transaksi))\s*[:#]?\s*([A-Z0-9][A-Z0-9\-]{5,})/i);
  const reference = refM ? refM[1].toUpperCase() : null;

  // --- merchant
  let merchant: string | null = null;
  let merchantConf = 0;
  const labelM = text.match(/(?:merchant|nama\s*merchant|toko|penerima|kepada|tujuan)\s*[:\-]\s*([^\n]+)/i);
  if (labelM) { merchant = labelM[1].trim().replace(/\s{2,}.*/, ""); merchantConf = 0.85; }
  else {
    const head = lines.slice(0, 4).find((l) => /[a-z]{3,}/i.test(l) && !GENERIC_HEAD.test(l) && amountsIn(l).length === 0 && !/\d{1,2}[/\-.]\d{1,2}/.test(l));
    if (head) { merchant = head.slice(0, 60); merchantConf = 0.55; }
  }
  if (!merchant) issues.push("Nama merchant tidak terbaca");

  // --- payment method
  const low = text.toLowerCase();
  const method = METHODS.find((m) => new RegExp(`(?<![a-z])${m}(?![a-z])`).test(low)) ?? null;

  const income = /(uang masuk|dana masuk|diterima|terima dari|transfer masuk)/i.test(text);
  const ocr = Math.max(0.5, Math.min(1, (opts.ocrConfidence ?? 90) / 100));
  const confidence = Math.round((amountConf * 0.55 + (occurred_on ? 0.25 : 0) + merchantConf * 0.2) * ocr * 100) / 100;
  return {
    amount, fee, occurred_on, merchant, reference, payment_method: method, type: income ? "income" : "expense", confidence,
    fields: { amount: amountConf, date: occurred_on ? 0.9 : 0, merchant: merchantConf, reference: reference ? 0.8 : 0 }, issues, amount_source,
  };
}
