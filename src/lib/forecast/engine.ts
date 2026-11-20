import { addMonthsClamped, daysBetween, shiftDate } from "../format";

/**
 * Cash-flow forecast engine. PURE: it receives plain data and returns numbers, never touching the database, so the
 * same input always gives the same output. Every projected figure carries its source so it can be explained.
 *
 *   Projected Closing Cash = Opening Cash + Expected Income - Expected Expenses - Scheduled Payments
 *
 * calculated per day. Day 0 is today: the opening cash already contains every actual transaction up to now, so day 0
 * only receives obligations that are due today or overdue (they are still unpaid). Habitual spending and recurring
 * income start tomorrow.
 */

export interface ScenarioParams {
  /** Expected income as a percentage of the configured amount. */
  income_pct: number;
  /** Habitual (discretionary) spending as a percentage of the historical daily average. */
  spending_pct: number;
  /** Applied to bills whose amount is variable (estimated from history). */
  bills_pct: number;
  /** Income arrives this many days later than scheduled. */
  income_delay_days: number;
  /** Cash that should never be touched (used by payday survival and safe-to-spend). */
  buffer: number;
}

export type PresetKey = "baseline" | "conservative" | "optimistic";
export const PRESETS: Record<PresetKey, ScenarioParams & { label: string; description: string }> = {
  baseline: { label: "Baseline", description: "Pemasukan sesuai jadwal, belanja sebesar rata-rata riwayat.", income_pct: 100, spending_pct: 100, bills_pct: 100, income_delay_days: 0, buffer: 0 },
  conservative: { label: "Konservatif", description: "Pemasukan 90% dan terlambat 3 hari, belanja 115%, tagihan berubah-ubah 105%.", income_pct: 90, spending_pct: 115, bills_pct: 105, income_delay_days: 3, buffer: 0 },
  optimistic: { label: "Optimis", description: "Pemasukan sesuai jadwal, belanja 90% dari rata-rata.", income_pct: 100, spending_pct: 90, bills_pct: 100, income_delay_days: 0, buffer: 0 },
};

export interface IncomeRule {
  id: number; name: string; amount: number; frequency: "weekly" | "monthly" | "quarterly" | "yearly"; day_of_month: number | null;
  start_date: string; end_date: string | null; category_name: string | null;
}
export interface InstallmentInput { debt_id: number; label: string; sequence_no: number; installment_count: number; due_date: string; remaining: number }
export interface BillInput {
  id: number; name: string; kind: "bill" | "subscription"; amount: number | null; estimate: number | null;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly" | "once"; due_day: number | null; next_due_date: string;
}

export interface ForecastInput {
  today: string;
  openingCash: number;
  incomeRules: IncomeRule[];
  /** Actual income already received in the last days, so a salary that arrived early is not projected again. */
  recentIncome: { date: string; amount: number }[];
  installments: InstallmentInput[];
  bills: BillInput[];
  baselineDailySpend: number;
  /** Which income rule is "payday" (null = auto), or an explicit date. */
  paydayRuleId: number | null;
  paydayOverride: string | null;
  /** Extra dated cash outflows that are not recurring (e.g. a simulated early repayment). Absent/empty = no effect. */
  oneOffs?: OneOff[];
}

export interface OneOff { date: string; label: string; amount: number; id?: number; note?: string | null }

export type EventKind = "income" | "installment" | "bill" | "oneoff";
export interface ProjectedEvent {
  date: string;
  kind: EventKind;
  label: string;
  /** Positive magnitude; direction is implied by kind (income adds, others subtract). */
  amount: number;
  overdue: boolean;
  /** True when the amount is an estimate or unknown. */
  uncertain: boolean;
  note: string | null;
  source: { type: "income_rule" | "installment" | "bill" | "oneoff"; id: number };
}

export interface DayRow {
  date: string;
  opening: number;
  income: number;
  installments: number;
  bills: number;
  /** Dated one-off outflows (zero unless the input has `oneOffs`). */
  oneOffs: number;
  spending: number;
  net: number;
  closing: number;
  events: ProjectedEvent[];
}

export interface MonthRow {
  month: string;
  partial: boolean;
  opening: number;
  income: number;
  spending: number;
  installments: number;
  bills: number;
  oneOffs: number;
  net: number;
  closing: number;
  lowest: number;
  lowestDate: string;
  status: "surplus" | "deficit";
}

export interface DeficitPeriod { from: string; to: string; lowest: number; lowestDate: string; days: number }

export interface PaydaySurvival {
  payday: string;
  daysUntil: number;
  /** Lowest closing balance from today through the day before payday, including habitual spending. */
  lowest: number;
  lowestDate: string;
  endBalance: number;
  survives: boolean;
  shortfall: number;
  /** Cash that can be spent on top of all scheduled obligations until payday while staying above the buffer. */
  safeTotal: number;
  safePerDay: number;
  baselinePerDay: number;
  sourceLabel: string;
}

export interface ForecastResult {
  today: string;
  displayDays: number;
  params: ScenarioParams;
  days: DayRow[];
  events: ProjectedEvent[];
  months: MonthRow[];
  summary: {
    openingCash: number; closingCash: number; totalIncome: number; totalSpending: number; totalInstallments: number; totalBills: number; totalOneOffs: number;
    lowest: { date: string; balance: number }; firstDeficitDate: string | null; deficitDays: number; deficitPeriods: DeficitPeriod[];
  };
  survival: PaydaySurvival | null;
  assumptions: { baselineDailySpend: number; scenarioDailySpend: number; overdueCount: number; unknownBills: string[]; skippedIncome: string[] };
}

const MIN_RUN_DAYS = 70; // long enough to always reach the next monthly payday

/* ---------------- occurrence generation ---------------- */

export function incomeOccurrences(rule: IncomeRule, afterExclusive: string, toInclusive: string): string[] {
  const out: string[] = [];
  const end = rule.end_date && rule.end_date < toInclusive ? rule.end_date : toInclusive;
  if (rule.frequency === "weekly") {
    let d = rule.start_date;
    if (d <= afterExclusive) d = shiftDate(d, Math.ceil((daysBetween(d, afterExclusive) + 1) / 7) * 7);
    for (; d <= end; d = shiftDate(d, 7)) out.push(d);
    return out;
  }
  const step = rule.frequency === "monthly" ? 1 : rule.frequency === "quarterly" ? 3 : 12;
  const dom = rule.day_of_month ?? Number(rule.start_date.slice(8, 10));
  const anchor = `${rule.start_date.slice(0, 7)}-01`;
  for (let k = 0; k < 600; k++) {
    const d = addMonthsClamped(anchor, k * step, dom);
    if (d > end) break;
    if (d >= rule.start_date && d > afterExclusive) out.push(d);
  }
  return out;
}

export function billOccurrences(b: BillInput, toInclusive: string): string[] {
  const out: string[] = [];
  let d: string | null = b.next_due_date;
  for (let i = 0; d && d <= toInclusive && i < 800; i++) {
    out.push(d);
    if (b.frequency === "once") break;
    d = b.frequency === "weekly" ? shiftDate(d, 7) : addMonthsClamped(d, b.frequency === "monthly" ? 1 : b.frequency === "quarterly" ? 3 : 12, b.due_day ?? undefined);
  }
  return out;
}

const pct = (n: number, p: number) => Math.round((n * p) / 100);

/* ---------------- the forecast ---------------- */

export function runForecast(input: ForecastInput, rawParams: ScenarioParams, displayDays: number): ForecastResult {
  const { today } = input;
  // Only the five assumptions matter; strip anything else (e.g. a preset's label) so results stay clean and comparable.
  const params: ScenarioParams = { income_pct: rawParams.income_pct, spending_pct: rawParams.spending_pct, bills_pct: rawParams.bills_pct, income_delay_days: rawParams.income_delay_days, buffer: rawParams.buffer };
  const runDays = Math.max(displayDays, MIN_RUN_DAYS);
  const last = shiftDate(today, runDays);
  const events: ProjectedEvent[] = [];
  const unknownBills: string[] = [];
  const skippedIncome: string[] = [];
  const clampToToday = (d: string) => (d < today ? today : d);

  // Income. Occurrences start tomorrow; one that matches money already received shortly before its date is skipped.
  const recent = input.recentIncome.map((r) => ({ ...r, used: false }));
  for (const rule of input.incomeRules) {
    for (const occ of incomeOccurrences(rule, today, last)) {
      const hit = recent.find((r) => !r.used && r.date >= shiftDate(occ, -5) && r.date <= today && Math.abs(r.amount - rule.amount) <= rule.amount * 0.15);
      if (hit) { hit.used = true; skippedIncome.push(`${rule.name} (${occ}): dianggap sudah diterima pada ${hit.date}`); continue; }
      const date = shiftDate(occ, params.income_delay_days);
      if (date > last) continue;
      events.push({
        date, kind: "income", label: rule.name, amount: pct(rule.amount, params.income_pct), overdue: false, uncertain: params.income_pct !== 100,
        note: params.income_delay_days ? `jadwal ${occ}, bergeser +${params.income_delay_days} hari` : null, source: { type: "income_rule", id: rule.id },
      });
    }
  }

  // Installments: the unpaid remainder of each schedule row. Paid rows never reach this function.
  for (const i of input.installments) {
    if (i.remaining <= 0 || i.due_date > last) continue;
    const overdue = i.due_date < today;
    events.push({
      date: clampToToday(i.due_date), kind: "installment", label: `${i.label} #${i.sequence_no}/${i.installment_count}`, amount: i.remaining, overdue, uncertain: false,
      note: overdue ? `jatuh tempo ${i.due_date}, belum dibayar` : null, source: { type: "installment", id: i.debt_id },
    });
  }

  // Bills: the next due date is real; later occurrences are repeats of the same schedule.
  for (const b of input.bills) {
    const variable = b.amount === null;
    let amount = b.amount ?? b.estimate ?? 0;
    if (variable) {
      if (b.estimate === null) unknownBills.push(b.name);
      else amount = pct(amount, params.bills_pct);
    }
    billOccurrences(b, last).forEach((d, idx) => {
      const overdue = d < today;
      events.push({
        date: clampToToday(d), kind: "bill", label: b.name, amount, overdue, uncertain: variable,
        note: overdue ? `jatuh tempo ${d}, belum dibayar` : variable ? (b.estimate === null ? "nominal belum diketahui (dihitung Rp 0)" : "estimasi dari pembayaran sebelumnya") : idx > 0 ? "berulang sesuai jadwal" : null,
        source: { type: "bill", id: b.id },
      });
    });
  }
  // One-off outflows: dated, exact, never scaled by the scenario.
  for (const o of input.oneOffs ?? []) {
    if (o.amount <= 0) continue;
    const date = clampToToday(o.date);
    if (date > last) continue;
    events.push({ date, kind: "oneoff", label: o.label, amount: o.amount, overdue: false, uncertain: false, note: o.note ?? null, source: { type: "oneoff", id: o.id ?? 0 } });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "income" ? -1 : 1));

  // Daily roll-forward. Habitual spending uses cumulative rounding so the total over N days is round(daily x N).
  const daily = (input.baselineDailySpend * params.spending_pct) / 100;
  const byDate = new Map<string, ProjectedEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const days: DayRow[] = [];
  let balance = input.openingCash;
  for (let i = 0; i <= runDays; i++) {
    const date = shiftDate(today, i);
    const ev = byDate.get(date) ?? [];
    const sum = (k: EventKind) => ev.filter((e) => e.kind === k).reduce((s, e) => s + e.amount, 0);
    const spending = i === 0 ? 0 : Math.round(daily * i) - Math.round(daily * (i - 1));
    const income = sum("income"), installments = sum("installment"), bills = sum("bill"), oneOffs = sum("oneoff");
    const net = income - installments - bills - oneOffs - spending;
    days.push({ date, opening: balance, income, installments, bills, oneOffs, spending, net, closing: balance + net, events: ev });
    balance += net;
  }

  const shown = days.slice(0, displayDays + 1);
  const shownEvents = events.filter((e) => e.date <= shiftDate(today, displayDays));
  const sumD = (f: (d: DayRow) => number) => shown.reduce((s, d) => s + f(d), 0);
  let lowest = shown[0];
  for (const d of shown) if (d.closing < lowest.closing) lowest = d;

  // Deficit periods: runs of days that close below zero.
  const deficitPeriods: DeficitPeriod[] = [];
  let cur: DeficitPeriod | null = null;
  for (const d of shown) {
    if (d.closing < 0) {
      if (!cur) cur = { from: d.date, to: d.date, lowest: d.closing, lowestDate: d.date, days: 1 };
      else { cur.to = d.date; cur.days++; if (d.closing < cur.lowest) { cur.lowest = d.closing; cur.lowestDate = d.date; } }
    } else if (cur) { deficitPeriods.push(cur); cur = null; }
  }
  if (cur) deficitPeriods.push(cur);

  // Monthly roll-up (the first month starts today and is partial).
  const months: MonthRow[] = [];
  for (const d of shown) {
    const m = d.date.slice(0, 7);
    let row = months[months.length - 1];
    if (!row || row.month !== m) {
      row = { month: m, partial: months.length === 0 && d.date !== `${m}-01`, opening: d.opening, income: 0, spending: 0, installments: 0, bills: 0, oneOffs: 0, net: 0, closing: d.closing, lowest: d.closing, lowestDate: d.date, status: "surplus" };
      months.push(row);
    }
    row.income += d.income; row.spending += d.spending; row.installments += d.installments; row.bills += d.bills; row.oneOffs += d.oneOffs; row.net += d.net; row.closing = d.closing;
    if (d.closing < row.lowest) { row.lowest = d.closing; row.lowestDate = d.date; }
  }
  for (const m of months) m.status = m.net >= 0 ? "surplus" : "deficit";

  return {
    today, displayDays, params, days: shown, events: shownEvents, months,
    summary: {
      openingCash: input.openingCash, closingCash: shown[shown.length - 1].closing, totalIncome: sumD((d) => d.income), totalSpending: sumD((d) => d.spending),
      totalInstallments: sumD((d) => d.installments), totalBills: sumD((d) => d.bills), totalOneOffs: sumD((d) => d.oneOffs), lowest: { date: lowest.date, balance: lowest.closing },
      firstDeficitDate: deficitPeriods[0]?.from ?? null, deficitDays: deficitPeriods.reduce((s, p) => s + p.days, 0), deficitPeriods,
    },
    survival: payday(input, params, days, events),
    assumptions: { baselineDailySpend: input.baselineDailySpend, scenarioDailySpend: Math.round(daily), overdueCount: events.filter((e) => e.overdue).length, unknownBills, skippedIncome },
  };
}

/* ---------------- payday survival ---------------- */

function payday(input: ForecastInput, params: ScenarioParams, days: DayRow[], events: ProjectedEvent[]): PaydaySurvival | null {
  const { today } = input;
  let date: string | null = input.paydayOverride && input.paydayOverride > today ? input.paydayOverride : null;
  let sourceLabel = "tanggal yang Anda tentukan";
  if (!date) {
    let ruleId = input.paydayRuleId;
    if (ruleId === null) {
      // Auto: a rule categorised as salary, else the rule with the highest monthly-equivalent amount.
      const monthly = (r: IncomeRule) => (r.frequency === "weekly" ? r.amount * 4.345 : r.frequency === "monthly" ? r.amount : r.frequency === "quarterly" ? r.amount / 3 : r.amount / 12);
      const sorted = [...input.incomeRules].sort((a, b) => Number((b.category_name ?? "").toLowerCase() === "gaji") - Number((a.category_name ?? "").toLowerCase() === "gaji") || monthly(b) - monthly(a));
      ruleId = sorted[0]?.id ?? null;
    }
    if (ruleId === null) return null;
    const ev = events.find((e) => e.kind === "income" && e.source.id === ruleId);
    if (!ev) return null;
    date = ev.date;
    sourceLabel = ev.label;
  }
  const idx = daysBetween(today, date);
  if (idx < 1 || idx >= days.length) return null;
  const period = days.slice(0, idx); // today .. day before payday
  let low = period[0];
  for (const d of period) if (d.closing < low.closing) low = d;
  // Obligations only (no habitual spending): how much headroom is there?
  let cum = input.openingCash, minCum = input.openingCash;
  for (const d of period) { cum += d.income - d.installments - d.bills - d.oneOffs; if (cum < minCum) minCum = cum; }
  const spendDays = Math.max(1, idx - 1);
  const safeTotal = minCum - params.buffer;
  const baselinePerDay = Math.round((input.baselineDailySpend * params.spending_pct) / 100);
  return {
    payday: date, daysUntil: idx, lowest: low.closing, lowestDate: low.date, endBalance: period[period.length - 1].closing,
    survives: low.closing >= params.buffer, shortfall: Math.max(0, params.buffer - low.closing), safeTotal: Math.max(0, safeTotal),
    safePerDay: Math.max(0, Math.floor(safeTotal / spendDays)), baselinePerDay, sourceLabel,
  };
}
