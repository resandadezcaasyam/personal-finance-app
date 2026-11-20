"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { clampParams, deleteScenario, horizonDays, loadForecastContext, saveScenario } from "@/lib/forecast/data";
import { runForecast } from "@/lib/forecast/engine";
import { todayWIB } from "@/lib/format";
import { fd, fail, type ActionState } from "./shared";

const schema = z.object({
  name: z.string().trim().min(1, "Nama skenario wajib diisi").max(40, "Maksimal 40 karakter"),
  ip: z.coerce.number(), sp: z.coerce.number(), bp: z.coerce.number(), dd: z.coerce.number(), buf: z.coerce.number(),
  months: z.coerce.number().int().min(1).max(12),
});

/** Saves the assumptions (and a small result snapshot). Never touches the ledger. */
export async function saveScenarioAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const v = schema.parse(fd(form));
    const db = getDb();
    const params = clampParams({ income_pct: v.ip, spending_pct: v.sp, bills_pct: v.bp, income_delay_days: v.dd, buffer: v.buf });
    const today = todayWIB();
    const result = runForecast(loadForecastContext(db, { today }).input, params, horizonDays(today, v.months));
    saveScenario(db, v.name, params, result);
    revalidatePath("/forecast");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteScenarioAction(id: number): Promise<ActionState> {
  try { deleteScenario(getDb(), id); revalidatePath("/forecast"); return { ok: true }; } catch (e) { return fail(e); }
}
