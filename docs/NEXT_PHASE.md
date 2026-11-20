# Handoff: Phase 5: Cash Flow Forecasting Engine

Read `ARCHITECTURE.md` (Phase 2, 3 and 4 rules) and migrations 0001-0004 first. Do not recreate the project.

## Build (spec Part 4, Phase 5)
1. Daily-level forecast for 1/3/6/12 months: `Projected Closing Cash = Opening Cash + Expected Income - Expected Expenses - Scheduled Payments`.
2. Financial calendar of expected salary, bills, installments and other movements.
3. Future balance analysis: opening cash, expected income, expected expenses, debt payments, closing cash, **lowest projected balance**, surplus/deficit periods.
4. Payday survival analysis: is the balance enough until the next expected salary date?
5. Scenarios (baseline, conservative, optimistic) with user-adjustable, clearly displayed assumptions.
6. Line charts (Recharts) and monthly projection tables. Forecast values must be visually distinct from actuals.
7. Activate `/forecast` (`CURRENT_PHASE = 5` in `src/lib/nav.ts`).

## Existing data to build on
- **Opening cash:** `listAccounts(db, {archived:false})` balances (derived, actual only).
- **Expected income:** `recurring_rules` (type income; Phase 2 stored configuration only, nothing auto-posts). Respect `frequency`, `day_of_month`, `start_date`, `end_date`, `is_active`.
- **Scheduled payments:** real installments from `installment_schedules` (unpaid remainder = `amount_due - amount_paid`, debts with `status='active'`; already-paid and skipped rows are NOT projected) and bill occurrences from `bills` (`nextOccurrence()` in `src/lib/bills/bills.ts`; `listObligations`/`getMonthAgenda` in `src/lib/obligations.ts` already produce them, with variable bills at amount 0, so the forecast needs an assumption, e.g. the average of that bill's past `bill_payments`).
- **Expected expenses:** derive a baseline from history (average daily discretionary spending over recent months from `transactions` of type expense, excluding rows with `debt_payment_id`/`bill_id`, transfers and adjustments), plus a scenario multiplier.
- `monthTotals`, `spendingByCategory` in `src/lib/ledger/summary.ts`; dates via `todayWIB`, `shiftDate`, `addMonthsClamped`, `daysBetween` in `src/lib/format.ts`.

## Rules to keep
- **Pending inbox items are not actuals.** Do not include `inbox_items` in opening cash or history; optionally show them as a data-quality warning ("N items waiting for review may change this forecast").
- Forecast never writes to `transactions`/`transfers`/`debt_payments`. Persist scenario assumptions in `simulation_scenarios` (JSON) if saving is needed (Phase 6 reuses this table).
- Deterministic and explainable: every projected number should be traceable to a source (rule, installment #n, bill, baseline).
- Integer rupiah only; add `0005_*.sql` if schema changes are needed (never edit 0001-0004; checksums enforced).
- Avoid a root `loading.tsx` (see Architecture, Phase 4 pitfall). Do not use client `router.push` after a server action; use `redirect()`.

## Tests to write
Opening/closing reconcile month by month; an already-paid installment is not projected again; a bill paid early moves its next occurrence; month-end clamping; salary on day 31; deficit day detection; lowest balance date; payday survival true/false; scenario multipliers; no writes to actual tables.

## Finish
tests, typecheck, lint, build, browser check; commit `feat: implement cash flow forecasting`; update these docs.
