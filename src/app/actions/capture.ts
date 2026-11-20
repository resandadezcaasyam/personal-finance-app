"use server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { listAccounts } from "@/lib/ledger/accounts";
import { LedgerError } from "@/lib/ledger/errors";
import { parseQuickCapture, type Draft } from "@/lib/capture/nl-parser";
import { loadMatcher, createUserRule, setRuleActive, deleteUserRule } from "@/lib/capture/rules";
import { createTemplate, deleteTemplate } from "@/lib/capture/templates";
import { postDrafts } from "@/lib/capture/post";
import { findLedgerDuplicates, approveInboxItems, rejectInboxItems, restoreInboxItem, updateInboxItem, setCategoryForItems, setMatchDismissed, type ApproveResult } from "@/lib/inbox/inbox";
import { findObligationMatch } from "@/lib/inbox/matching";
import { todayWIB, parseIDR } from "@/lib/format";
import { normalizeText } from "@/lib/capture/text";
import { createImportTemplate, deleteImportTemplate } from "@/lib/imports/templates";
import { money, moneyOrNull, optId, text, fd, done, fail, type ActionState } from "./shared";
import { revalidatePath } from "next/cache";

/* ---------------- quick capture ---------------- */

export interface DraftView extends Draft { duplicate: boolean; match_label: string | null }

export async function parseCaptureAction(input: string): Promise<{ ok: boolean; drafts: DraftView[]; message?: string }> {
  try {
    if (input.length > 5000) throw new LedgerError("Teks terlalu panjang (maksimal 5.000 karakter).");
    const db = getDb();
    const matcher = loadMatcher(db);
    const accounts = listAccounts(db, { archived: false }).map((a) => ({ id: a.id, name: a.name, type: a.type }));
    const today = todayWIB();
    const drafts = parseQuickCapture(input, { today, accounts, matchRule: matcher });
    if (drafts.length === 0) return { ok: false, drafts: [], message: "Tidak ada transaksi yang terbaca. Contoh: kopi 25rb gopay" };
    return {
      ok: true,
      drafts: drafts.map((d) => {
        const type = d.type === "transfer" ? null : d.type;
        const dup = type ? findLedgerDuplicates(db, { account_id: d.account_id, type, amount: d.amount, occurred_on: d.occurred_on }).length > 0 : false;
        const m = type ? findObligationMatch(db, { type, amount: d.amount, occurred_on: d.occurred_on, account_id: d.account_id, description: d.description, merchant: d.merchant }) : null;
        return { ...d, duplicate: dup, match_label: m ? (m.kind === "debt" ? `cicilan ${m.label} #${m.sequence_no}` : m.kind === "bill" ? `tagihan ${m.label}` : null) : null };
      }),
    };
  } catch (e) { return { ok: false, drafts: [], message: fail(e).message }; }
}

const draftSchema = z.array(z.object({
  type: z.enum(["expense", "income", "transfer"]),
  amount_text: z.string().max(30),
  occurred_on: z.string().max(10),
  description: z.string().max(200),
  merchant: z.string().max(100).nullable(),
  account_id: z.number().int().positive().nullable(),
  to_account_id: z.number().int().positive().nullable(),
  category_id: z.number().int().positive().nullable(),
  category_source: z.enum(["rule", "user", "parser"]).nullable(),
  confidence: z.number().min(0).max(1),
})).max(100);

export async function postDraftsAction(draftsJson: string, mode: "now" | "inbox"): Promise<ActionState & { posted?: number; queued?: number }> {
  try {
    const parsed = draftSchema.parse(JSON.parse(draftsJson));
    const drafts = parsed.map((d, i) => {
      const amount = d.amount_text.trim() ? parseIDR(d.amount_text) : null;
      if (d.amount_text.trim() && amount === null) throw new LedgerError(`Baris ${i + 1}: nominal "${d.amount_text}" tidak valid.`);
      if (mode === "now" && !amount) throw new LedgerError(`Baris ${i + 1}: nominal wajib diisi.`);
      if (mode === "now" && !d.account_id) throw new LedgerError(`Baris ${i + 1}: akun wajib dipilih.`);
      return { ...d, amount, to_account_id: d.to_account_id };
    });
    const db = getDb();
    const r = postDrafts(db, drafts, mode, { matcher: loadMatcher(db) });
    revalidatePath("/", "layout");
    return { ok: true, posted: r.posted, queued: r.queued };
  } catch (e) { return fail(e); }
}

/* ---------------- templates ---------------- */

const templateSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(40, "Maksimal 40 karakter"),
  type: z.enum(["expense", "income"]),
  amount: moneyOrNull,
  account_id: optId,
  category_id: optId,
  description: text(200).optional(),
  merchant: text(100).optional(),
});
export async function createTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  try { const v = templateSchema.parse(fd(form)); createTemplate(getDb(), { ...v, description: v.description ?? "" }); return done(); } catch (e) { return fail(e); }
}
export async function deleteTemplateAction(id: number): Promise<ActionState> {
  try { deleteTemplate(getDb(), id); return done(); } catch (e) { return fail(e); }
}

/* ---------------- merchant rules ---------------- */

const ruleSchema = z.object({ pattern: z.string().trim().min(1, "Pola wajib diisi").max(60), merchant: text(60).optional(), kind: z.enum(["expense", "income"]), category_id: z.coerce.number().int().positive("Pilih kategori") });
export async function createRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  try { const v = ruleSchema.parse(fd(form)); createUserRule(getDb(), { pattern: v.pattern, merchant_name: v.merchant || null, kind: v.kind, category_id: v.category_id }); return done(); } catch (e) { return fail(e); }
}
export async function setRuleActiveAction(id: number, active: boolean): Promise<ActionState> {
  try { setRuleActive(getDb(), id, active); return done(); } catch (e) { return fail(e); }
}
export async function deleteRuleAction(id: number): Promise<ActionState> {
  try { deleteUserRule(getDb(), id); return done(); } catch (e) { return fail(e); }
}

/* ---------------- inbox ---------------- */

const inboxSchema = z.object({
  id: z.coerce.number().int().positive(),
  type: z.enum(["expense", "income"]),
  amount: moneyOrNull,
  occurred_on: z.string().max(10),
  description: text(200),
  merchant: text(100).optional(),
  account_id: optId,
  category_id: optId,
  dismiss_match: z.string().optional(),
  save_rule: z.string().optional(),
  rule_pattern: text(60).optional(),
});
export async function updateInboxItemAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = inboxSchema.parse(fd(form));
    const db = getDb();
    updateInboxItem(db, v.id, {
      type: v.type, amount: v.amount, occurred_on: v.occurred_on || null, description: v.description, merchant: v.merchant || null,
      account_id: v.account_id, category_id: v.category_id, dismiss_match: v.dismiss_match === "on",
    });
    if (v.save_rule === "on" && v.category_id) {
      if (!v.rule_pattern || normalizeText(v.rule_pattern).length < 3) throw new LedgerError("Isi pola aturan (minimal 3 huruf) atau matikan 'simpan sebagai aturan'.", "rule_pattern");
      createUserRule(db, { pattern: v.rule_pattern, merchant_name: v.merchant || null, kind: v.type, category_id: v.category_id });
    }
    return done();
  } catch (e) { return fail(e); }
}

export async function approveItemsAction(ids: number[], includeDuplicates: boolean): Promise<{ ok: boolean; results: ApproveResult[]; message?: string }> {
  try {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) throw new LedgerError("Pilih 1 sampai 500 item.");
    const results = approveInboxItems(getDb(), ids.map(Number), { includeDuplicates });
    revalidatePath("/", "layout");
    return { ok: true, results };
  } catch (e) { return { ok: false, results: [], message: fail(e).message }; }
}
export async function rejectItemsAction(ids: number[]): Promise<ActionState & { count?: number }> {
  try { const n = rejectInboxItems(getDb(), ids.map(Number)); revalidatePath("/", "layout"); return { ok: true, count: n }; } catch (e) { return fail(e); }
}
export async function restoreItemAction(id: number): Promise<ActionState> {
  try { restoreInboxItem(getDb(), id); return done(); } catch (e) { return fail(e); }
}
export async function categorizeItemsAction(ids: number[], categoryId: number): Promise<ActionState & { updated?: number; skipped?: number }> {
  try { const r = setCategoryForItems(getDb(), ids.map(Number), Number(categoryId)); revalidatePath("/", "layout"); return { ok: true, ...r }; } catch (e) { return fail(e); }
}
export async function dismissMatchAction(id: number, dismissed: boolean): Promise<ActionState> {
  try { setMatchDismissed(getDb(), id, dismissed); return done(); } catch (e) { return fail(e); }
}

/* ---------------- import templates ---------------- */

export async function saveImportTemplateAction(name: string, signature: string, mappingJson: string): Promise<ActionState> {
  try { createImportTemplate(getDb(), name, signature, JSON.parse(mappingJson)); return done(); } catch (e) { return fail(e); }
}
export async function deleteImportTemplateAction(id: number): Promise<ActionState> {
  try { deleteImportTemplate(getDb(), id); return done(); } catch (e) { return fail(e); }
}

void money;
