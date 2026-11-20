import type Database from "better-sqlite3";
import { z } from "zod";
import { LedgerError } from "../ledger/errors";
import { isValidIsoDate } from "../ledger/validate";
import { getSetting, setSetting } from "../settings";
import { normalizeText } from "./text";
import type { Draft } from "./nl-parser";

/**
 * OPTIONAL local AI (Ollama) for reading free-form entries. Off by default, never required, never used for any calculation.
 * Privacy rules enforced here: the address must be this computer (localhost / 127.0.0.1 / ::1, plain http, no credentials,
 * redirects refused), and the only data sent is the sentence the user typed plus the NAMES of their accounts and
 * categories. The result is untrusted: it is validated, mapped to real accounts/categories by name (never by id), and shown
 * in the same editable preview as everything else. Any failure falls back to the built-in parser.
 */
export const DEFAULT_AI_URL = "http://127.0.0.1:11434";
export const DEFAULT_AI_MODEL = "llama3.2";
export const AI_TIMEOUT_MS = 25_000;
const MAX_ITEMS = 20;

export interface AiSettings { enabled: boolean; url: string; model: string }

export function isLocalUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" || u.username || u.password) return false;
  return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
}

export function loadAiSettings(db: Database.Database): AiSettings {
  const url = getSetting(db, "ai_url") ?? DEFAULT_AI_URL;
  return { enabled: getSetting(db, "ai_enabled") === "1" && isLocalUrl(url), url, model: getSetting(db, "ai_model") ?? DEFAULT_AI_MODEL };
}

export function saveAiSettings(db: Database.Database, s: AiSettings) {
  const url = s.url.trim().replace(/\/+$/, "");
  if (!isLocalUrl(url)) throw new LedgerError("Alamat harus komputer ini (http://127.0.0.1 atau http://localhost). Data keuangan tidak boleh dikirim ke alamat lain.", "url");
  const model = s.model.trim();
  if (!/^[A-Za-z0-9._:\-/]{1,80}$/.test(model)) throw new LedgerError("Nama model tidak valid. Contoh: llama3.2", "model");
  setSetting(db, "ai_enabled", s.enabled ? "1" : "0");
  setSetting(db, "ai_url", url);
  setSetting(db, "ai_model", model);
}

export class AiError extends Error {}

type Fetch = typeof fetch;

async function call(fetchImpl: Fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...init, signal: ctrl.signal, redirect: "error" }); }
  catch (e) { throw new AiError(e instanceof Error && e.name === "AbortError" ? "AI lokal tidak menjawab tepat waktu." : "AI lokal tidak dapat dihubungi."); }
  finally { clearTimeout(timer); }
}

export async function ollamaHealth(url: string, fetchImpl: Fetch = fetch, timeoutMs = 4_000): Promise<{ ok: boolean; models: string[]; error?: string }> {
  if (!isLocalUrl(url)) return { ok: false, models: [], error: "Alamat bukan komputer ini." };
  try {
    const res = await call(fetchImpl, `${url.replace(/\/+$/, "")}/api/tags`, { method: "GET" }, timeoutMs);
    if (!res.ok) return { ok: false, models: [], error: `Server menjawab ${res.status}.` };
    const data = (await res.json()) as { models?: { name?: string }[] };
    return { ok: true, models: (data.models ?? []).map((m) => m.name ?? "").filter(Boolean).slice(0, 50) };
  } catch (e) { return { ok: false, models: [], error: e instanceof Error ? e.message : "Gagal." }; }
}

export interface AiContext {
  today: string;
  accounts: { id: number; name: string }[];
  categories: { id: number; name: string; kind: "income" | "expense" }[];
  /** Same rule matcher the built-in parser uses, to fill a category when the model gives none. */
  matchRule?: (text: string, kind: "income" | "expense") => { category_id: number | null; merchant: string | null } | null;
}

const item = z.object({
  type: z.enum(["expense", "income", "transfer"]),
  amount: z.number().int().positive().max(1_000_000_000_000),
  date: z.string().nullable().optional(),
  description: z.string().max(200).optional().default(""),
  merchant: z.string().max(100).nullable().optional(),
  account: z.string().max(60).nullable().optional(),
  to_account: z.string().max(60).nullable().optional(),
  category: z.string().max(80).nullable().optional(),
});
const reply = z.object({ transactions: z.array(item).min(1) });

function buildMessages(text: string, ctx: AiContext) {
  const system = [
    "Anda membaca catatan keuangan pribadi berbahasa Indonesia dan mengubahnya menjadi JSON. Jangan menghitung atau menebak saldo.",
    'Balas HANYA JSON: {"transactions":[{"type":"expense|income|transfer","amount":<bilangan bulat rupiah>,"date":"YYYY-MM-DD atau null","description":"...","merchant":"... atau null","account":"nama akun atau null","to_account":"nama akun tujuan (transfer) atau null","category":"nama kategori atau null"}]}.',
    "Nominal: 25rb = 25000, 9,5jt = 9500000. Jika tidak yakin pada suatu bidang, isi null. Jangan mengarang akun atau kategori di luar daftar.",
    `Hari ini ${ctx.today}. Akun: ${ctx.accounts.map((a) => a.name).join(", ") || "(belum ada)"}.`,
    `Kategori pengeluaran: ${ctx.categories.filter((c) => c.kind === "expense").map((c) => c.name).join(", ")}.`,
    `Kategori pemasukan: ${ctx.categories.filter((c) => c.kind === "income").map((c) => c.name).join(", ")}.`,
  ].join("\n");
  return [{ role: "system", content: system }, { role: "user", content: text }];
}

const byName = <T extends { name: string }>(list: T[], name: string | null | undefined): T | null => {
  if (!name) return null;
  const n = normalizeText(name);
  return list.find((x) => normalizeText(x.name) === n) ?? null;
};

/** Ask the local model; validate everything; return drafts for the usual preview. Throws AiError on ANY problem. */
export async function parseWithOllama(text: string, ctx: AiContext, settings: AiSettings, opts: { fetchImpl?: Fetch; timeoutMs?: number } = {}): Promise<Draft[]> {
  if (!settings.enabled) throw new AiError("AI lokal tidak aktif.");
  if (!isLocalUrl(settings.url)) throw new AiError("Alamat AI bukan komputer ini.");
  const res = await call(opts.fetchImpl ?? fetch, `${settings.url.replace(/\/+$/, "")}/api/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: settings.model, messages: buildMessages(text, ctx), stream: false, format: "json", options: { temperature: 0, num_predict: 1024 } }),
  }, opts.timeoutMs ?? AI_TIMEOUT_MS);
  if (!res.ok) throw new AiError(`AI lokal menjawab ${res.status}.`);
  let parsed: z.infer<typeof reply>;
  try {
    const body = (await res.json()) as { message?: { content?: string } };
    parsed = reply.parse(JSON.parse(body.message?.content ?? ""));
  } catch { throw new AiError("Jawaban AI tidak dapat dibaca."); }

  return parsed.transactions.slice(0, MAX_ITEMS).map((t, i): Draft => {
    const issues = ["Dibaca dengan AI lokal, periksa hasilnya."];
    const kind = t.type === "transfer" ? null : t.type;
    let date = t.date && isValidIsoDate(t.date) ? t.date : null;
    if (date && date > ctx.today) { issues.push(`Tanggal ${date} ada di masa depan, diganti hari ini.`); date = null; }
    const acc = byName(ctx.accounts, t.account);
    const to = byName(ctx.accounts, t.to_account);
    if (t.account && !acc) issues.push(`Akun "${t.account}" tidak dikenal.`);
    if (!acc) issues.push(t.type === "transfer" ? "Pilih akun asal." : "Akun belum dipilih");
    if (t.type === "transfer" && (!to || to.id === acc?.id)) issues.push("Pilih akun tujuan yang berbeda.");
    let category_id: number | null = null;
    let merchant = t.merchant?.trim() || null;
    let source: Draft["category_source"] = null;
    if (kind) {
      const cat = byName(ctx.categories.filter((c) => c.kind === kind), t.category);
      if (cat) { category_id = cat.id; source = "parser"; }
      else {
        if (t.category) issues.push(`Kategori "${t.category}" tidak dikenal.`);
        const hit = ctx.matchRule?.(`${merchant ?? ""} ${t.description} ${text}`, kind);
        if (hit?.category_id) { category_id = hit.category_id; source = "rule"; merchant = merchant ?? hit.merchant; }
      }
      if (!category_id) issues.push("Kategori belum ditentukan");
    }
    return {
      key: `ai${i}`, type: t.type, amount: t.amount, occurred_on: date ?? ctx.today, description: (t.description || merchant || (t.type === "income" ? "Pemasukan" : t.type === "transfer" ? "Transfer" : "Pengeluaran")).slice(0, 200),
      merchant, account_id: acc?.id ?? null, to_account_id: t.type === "transfer" ? to?.id ?? null : null, category_id, category_source: source, confidence: 0.7, issues, source_text: text.slice(0, 200),
    };
  });
}
