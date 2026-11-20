import { isoOrNull, parseIDR, shiftDate } from "../format";
import { PRESETS, type PresetKey, type ScenarioParams } from "../forecast/engine";
import type { DebtSim, RepayParams } from "./simulate";
import type { StrategyParams } from "./strategies";

type SP = Record<string, string | undefined>;

export interface RepayQuery {
  /** Present only when a debt was chosen; otherwise the page just shows the form. */
  params: RepayParams | null;
  preset: PresetKey;
  scenario: ScenarioParams;
  /** Raw text of the form fields, echoed back so the user's input is never silently changed. */
  raw: { date: string; amount: string; quote: string; rebate: string; fee: string; penalty: string; buffer: string };
  errors: string[];
  strategy: StrategyParams & { rawExtra: string; rawRebate: string };
  compare: number[];
}

/** Parse "5jt", "1.250.000", "250000" to an integer; empty -> null; garbage -> NaN marker via errors. */
function money(raw: string | undefined, label: string, errors: string[]): number | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const v = parseIDR(t);
  if (v === null) { errors.push(`${label} tidak valid: "${t}". Contoh: 500rb atau 1.250.000`); return null; }
  return v;
}

/** URL parameters are untrusted: everything is validated and clamped here. */
export function parseRepayQuery(sp: SP, debts: DebtSim[], today: string): RepayQuery {
  const errors: string[] = [];
  const preset = (["baseline", "conservative", "optimistic"] as const).includes(sp.preset as PresetKey) ? (sp.preset as PresetKey) : "baseline";
  const buffer = money(sp.buf, "Cadangan kas", errors) ?? 0;
  const scenario: ScenarioParams = { income_pct: PRESETS[preset].income_pct, spending_pct: PRESETS[preset].spending_pct, bills_pct: PRESETS[preset].bills_pct, income_delay_days: PRESETS[preset].income_delay_days, buffer: Math.min(buffer, 1e12) };

  const debtId = /^\d+$/.test(sp.debt ?? "") ? Number(sp.debt) : null;
  const debt = debtId !== null ? debts.find((d) => d.debt_id === debtId) : undefined;
  if (debtId !== null && !debt) errors.push("Utang yang dipilih tidak ditemukan atau sudah lunas.");
  const mode = sp.mode === "partial" ? "partial" : "full";
  const date = isoOrNull(sp.date) ?? shiftDate(today, 14);
  if (sp.date && !isoOrNull(sp.date)) errors.push(`Tanggal tidak valid: "${sp.date}".`);
  const amount = money(sp.amt, "Nominal pembayaran", errors);
  const quote = money(sp.quote, "Kuotasi pelunasan", errors);
  const rb = (sp.rb ?? "").trim() === "" ? 0 : Number((sp.rb ?? "").replace(",", "."));
  if (!Number.isFinite(rb) || rb < 0 || rb > 100) errors.push("Rebat bunga harus berupa angka 0 sampai 100.");
  const fee = money(sp.fee, "Biaya pelunasan", errors) ?? 0;
  const penalty = money(sp.pen, "Denda", errors) ?? 0;

  const params: RepayParams | null = debt
    ? { debt_id: debt.debt_id, date, mode, amount: mode === "partial" ? amount : null, quote: mode === "full" ? quote : null, rebate_pct: Number.isFinite(rb) ? Math.min(100, Math.max(0, rb)) : 0, fee, penalty }
    : null;

  const extra = money(sp.extra, "Anggaran tambahan", errors) ?? 0;
  const srb = (sp.srb ?? "").trim() === "" ? 0 : Number((sp.srb ?? "").replace(",", "."));
  if (!Number.isFinite(srb) || srb < 0 || srb > 100) errors.push("Rebat bunga strategi harus berupa angka 0 sampai 100.");
  const fromList = (sp.order ?? "").split(",").map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  const fromSelects = [sp.p1, sp.p2, sp.p3, sp.p4].map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
  const order = [...new Set([...fromSelects, ...fromList])].slice(0, 50);
  const compare = (sp.cmp ?? "").split(",").map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 4);
  return {
    params, preset, scenario, errors,
    raw: { date, amount: sp.amt ?? "", quote: sp.quote ?? "", rebate: sp.rb ?? "", fee: sp.fee ?? "", penalty: sp.pen ?? "", buffer: sp.buf ?? "" },
    strategy: { extra: Math.min(extra, 1e12), rebate_pct: Number.isFinite(srb) ? Math.min(100, Math.max(0, srb)) : 0, order, rawExtra: sp.extra ?? "", rawRebate: sp.srb ?? "" },
    compare,
  };
}
