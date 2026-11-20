"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { LedgerError } from "@/lib/ledger/errors";
import { loadRepayContext, saveRepayScenario, duplicateRepayScenario, deleteRepayScenario, recordFullSettlement } from "@/lib/repay/data";
import { parseRepayQuery } from "@/lib/repay/query";
import { simulateEarlyRepayment } from "@/lib/repay/simulate";
import { PRESETS } from "@/lib/forecast/engine";
import { horizonDays } from "@/lib/forecast/data";
import { todayWIB } from "@/lib/format";
import { fd, fail, id, date, moneyOrZero, type ActionState } from "./shared";

/** Re-validates the parameters on the server and stores only assumptions plus a small snapshot. Nothing real changes. */
export async function saveRepayScenarioAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const raw = fd(form);
    const v = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : undefined);
    const name = v("name") ?? "";
    const db = getDb();
    const today = todayWIB();
    const ctx = loadRepayContext(db, { today });
    const q = parseRepayQuery({ debt: v("debt"), date: v("date"), mode: v("mode"), amt: v("amt"), quote: v("quote"), rb: v("rb"), fee: v("fee"), pen: v("pen"), preset: v("preset"), buf: v("buf") }, ctx.debts, today);
    if (!q.params) throw new LedgerError(q.errors[0] ?? "Pilih utang yang akan disimulasikan.", "debt");
    if (q.errors.length) throw new LedgerError(q.errors[0]);
    const sim = simulateEarlyRepayment(ctx.forecast.input, ctx.debts, q.params, q.scenario, horizonDays(today, 12));
    saveRepayScenario(db, name, { ...q.params, preset: q.preset, buffer: q.scenario.buffer }, { closing: sim.b.summary.closingCash, lowest: sim.b.summary.lowest.balance, cashOut: sim.settlement.cashOut });
    revalidatePath("/early-repayment");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function duplicateRepayScenarioAction(scenarioId: number): Promise<ActionState> {
  try { duplicateRepayScenario(getDb(), scenarioId); revalidatePath("/early-repayment"); return { ok: true }; } catch (e) { return fail(e); }
}
export async function deleteRepayScenarioAction(scenarioId: number): Promise<ActionState> {
  try { deleteRepayScenario(getDb(), scenarioId); revalidatePath("/early-repayment"); return { ok: true }; } catch (e) { return fail(e); }
}

const settleSchema = z.object({ debt_id: id, account_id: id, paid_on: date, fee: moneyOrZero, penalty: moneyOrZero });

/**
 * The ONLY place this feature changes real data, and only after an explicit confirmation in the UI. The amount is the
 * outstanding obligation read from the database here, never a number sent by the browser.
 */
export async function confirmSettlementAction(_: ActionState, form: FormData): Promise<ActionState> {
  let debtId: number;
  try {
    const v = settleSchema.parse(fd(form));
    recordFullSettlement(getDb(), v);
    debtId = v.debt_id;
  } catch (e) { return fail(e); }
  revalidatePath("/", "layout");
  redirect(`/debts/${debtId}`);
}

void PRESETS;
