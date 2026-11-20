"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { LedgerError } from "@/lib/ledger/errors";
import { createRule, updateRule, setRuleActive, deleteRule, confirmOccurrence, skipOccurrence, reopenSkipped, detectPatterns, dismissPattern } from "@/lib/automation/recurring";
import { markReviewed } from "@/lib/actions/data";
import { setBudget, copyBudgets } from "@/lib/budgets/budgets";
import { createGoal, updateGoal, addContribution, removeContribution, setGoalArchived, deleteGoal } from "@/lib/goals/goals";
import { loadAiSettings, saveAiSettings, ollamaHealth } from "@/lib/capture/ollama";
import { parseCaptureSmart } from "@/lib/capture/smart";
import { findLedgerDuplicates } from "@/lib/inbox/inbox";
import { findObligationMatch } from "@/lib/inbox/matching";
import { parseIDR, todayWIB } from "@/lib/format";
import { money, moneyOrNull, moneyOrZero, id, optId, date, text, fd, done, fail, type ActionState } from "./shared";
import type { DraftView } from "./capture";

/* ---------------- recurring rules ---------------- */

const ruleSchema = z.object({
  id: optId,
  name: z.string().trim().min(1, "Nama wajib diisi").max(80),
  type: z.enum(["income", "expense"]),
  amount: money,
  account_id: optId,
  category_id: optId,
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  day_of_month: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(1).max(31).nullable()),
  start_date: date,
  end_date: z.string().optional(),
});
export async function saveRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = ruleSchema.parse(fd(form));
    const input = { ...v, end_date: v.end_date || null };
    const db = getDb();
    if (v.id) updateRule(db, v.id, input); else createRule(db, input);
    return done();
  } catch (e) { return fail(e); }
}
export async function toggleRuleAction(ruleId: number, active: boolean): Promise<ActionState> {
  try { setRuleActive(getDb(), ruleId, active); return done(); } catch (e) { return fail(e); }
}
export async function deleteRuleAction(ruleId: number): Promise<ActionState> {
  try { deleteRule(getDb(), ruleId); return done(); } catch (e) { return fail(e); }
}

const confirmSchema = z.object({ rule_id: id, due_date: date, account_id: optId, amount: moneyOrNull, link_transaction_id: optId });
export async function confirmOccurrenceAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = confirmSchema.parse(fd(form));
    confirmOccurrence(getDb(), { rule_id: v.rule_id, due_date: v.due_date, account_id: v.account_id ?? undefined, amount: v.amount ?? undefined, link_transaction_id: v.link_transaction_id ?? undefined });
    return done();
  } catch (e) { return fail(e); }
}
export async function skipOccurrenceAction(ruleId: number, due: string): Promise<ActionState> {
  try { skipOccurrence(getDb(), ruleId, due); return done(); } catch (e) { return fail(e); }
}
export async function reopenSkippedAction(ruleId: number, due: string): Promise<ActionState> {
  try { reopenSkipped(getDb(), ruleId, due); return done(); } catch (e) { return fail(e); }
}

/** The pattern is looked up again on the server by its key, so the browser cannot inject values into the new rule. */
export async function createRuleFromPatternAction(key: string): Promise<ActionState> {
  try {
    const db = getDb();
    const p = detectPatterns(db).find((x) => x.key === key);
    if (!p) throw new LedgerError("Pola ini sudah tidak terdeteksi atau sudah dibuat.");
    createRule(db, { name: p.name, type: p.type, amount: p.amount, account_id: p.account_id, category_id: p.category_id, frequency: p.frequency, day_of_month: p.day_of_month, start_date: p.start_date });
    return done();
  } catch (e) { return fail(e); }
}
export async function dismissPatternAction(key: string): Promise<ActionState> {
  try { dismissPattern(getDb(), key); return done(); } catch (e) { return fail(e); }
}

/* ---------------- daily review ---------------- */

export async function markReviewedAction(): Promise<ActionState> {
  try { markReviewed(getDb()); return done(); } catch (e) { return fail(e); }
}

/* ---------------- budgets ---------------- */

export async function setBudgetAction(categoryId: number, month: string, amountText: string): Promise<ActionState> {
  try {
    const t = amountText.trim();
    const amount = t === "" ? null : parseIDR(t);
    if (t !== "" && amount === null) throw new LedgerError("Nominal tidak valid. Contoh: 1,5jt atau 1.500.000");
    setBudget(getDb(), categoryId, month, amount);
    return done();
  } catch (e) { return fail(e); }
}
export async function copyBudgetsAction(from: string, to: string, overwrite: boolean): Promise<ActionState & { copied?: number; skipped?: number }> {
  try { const r = copyBudgets(getDb(), from, to, { overwrite }); revalidatePath("/", "layout"); return { ok: true, ...r }; } catch (e) { return fail(e); }
}

/* ---------------- goals ---------------- */

const goalSchema = z.object({
  id: optId, name: z.string().trim().min(1, "Nama wajib diisi").max(60), kind: z.enum(["emergency", "travel", "purchase", "custom"]),
  target_amount: money, target_date: z.string().optional(),
});
export async function saveGoalAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = goalSchema.parse(fd(form));
    const input = { name: v.name, kind: v.kind, target_amount: v.target_amount, target_date: v.target_date || null };
    const db = getDb();
    if (v.id) updateGoal(db, v.id, input); else createGoal(db, input);
    return done();
  } catch (e) { return fail(e); }
}
const contribSchema = z.object({ goal_id: id, amount: z.string().trim().min(1, "Wajib diisi"), direction: z.enum(["add", "withdraw"]), contributed_on: date, note: text(120).optional(), account_id: optId });
export async function contributeAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = contribSchema.parse(fd(form));
    const n = parseIDR(v.amount);
    if (n === null || n <= 0) throw new LedgerError("Nominal tidak valid. Contoh: 500rb", "amount");
    addContribution(getDb(), v.goal_id, { amount: v.direction === "withdraw" ? -n : n, contributed_on: v.contributed_on, note: v.note, account_id: v.account_id });
    return done();
  } catch (e) { return fail(e); }
}
export async function removeContributionAction(contributionId: number): Promise<ActionState> {
  try { removeContribution(getDb(), contributionId); return done(); } catch (e) { return fail(e); }
}
export async function archiveGoalAction(goalId: number, archived: boolean): Promise<ActionState> {
  try { setGoalArchived(getDb(), goalId, archived); return done(); } catch (e) { return fail(e); }
}
export async function deleteGoalAction(goalId: number): Promise<ActionState> {
  try { deleteGoal(getDb(), goalId); return done(); } catch (e) { return fail(e); }
}

/* ---------------- optional local AI ---------------- */

const aiSchema = z.object({ enabled: z.string().optional(), url: z.string().trim().min(1, "Alamat wajib diisi").max(200), model: z.string().trim().min(1, "Model wajib diisi").max(80) });
export async function saveAiSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  try { const v = aiSchema.parse(fd(form)); saveAiSettings(getDb(), { enabled: v.enabled === "on", url: v.url, model: v.model }); revalidatePath("/", "layout"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function testAiAction(): Promise<{ ok: boolean; message: string }> {
  const s = loadAiSettings(getDb());
  const h = await ollamaHealth(s.url);
  if (!h.ok) return { ok: false, message: `Tidak tersambung: ${h.error}` };
  const has = h.models.some((m) => m === s.model || m.startsWith(`${s.model}:`));
  return { ok: true, message: has ? `Tersambung. Model "${s.model}" tersedia.` : `Tersambung, tetapi model "${s.model}" belum terpasang. Terpasang: ${h.models.join(", ") || "(tidak ada)"}.` };
}

/** Same preview flow as the built-in parser; falls back to it automatically when the AI is off or fails. */
export async function parseCaptureAiAction(input: string): Promise<{ ok: boolean; drafts: DraftView[]; message?: string; source?: "ai" | "builtin" }> {
  try {
    if (input.length > 3000) throw new LedgerError("Teks terlalu panjang (maksimal 3.000 karakter).");
    const db = getDb();
    const today = todayWIB();
    const r = await parseCaptureSmart(db, input, { useAi: true, today });
    if (r.drafts.length === 0) return { ok: false, drafts: [], message: r.notice ?? "Tidak ada transaksi yang terbaca. Contoh: kopi 25rb gopay" };
    return {
      ok: true, source: r.source, message: r.notice ?? undefined,
      drafts: r.drafts.map((d) => {
        const type = d.type === "transfer" ? null : d.type;
        const dup = type ? findLedgerDuplicates(db, { account_id: d.account_id, type, amount: d.amount, occurred_on: d.occurred_on }).length > 0 : false;
        const m = type ? findObligationMatch(db, { type, amount: d.amount, occurred_on: d.occurred_on, account_id: d.account_id, description: d.description, merchant: d.merchant }) : null;
        return { ...d, duplicate: dup, match_label: m ? (m.kind === "debt" ? `cicilan ${m.label} #${m.sequence_no}` : m.kind === "bill" ? `tagihan ${m.label}` : null) : null };
      }),
    };
  } catch (e) { return { ok: false, drafts: [], message: fail(e).message }; }
}

void moneyOrZero;
