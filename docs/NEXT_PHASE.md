# Handoff: Phase 6: Early Debt Repayment Simulator

Read `ARCHITECTURE.md` (Phase 3 and Phase 5 sections) and migrations 0001-0005 first. Do not recreate the project.

## Build (spec Part 4, Phase 6)
1. Inputs: debt to settle, proposed repayment date, full or partial, amount, early-repayment fee, penalty, interest rebate / settlement quotation.
2. **Scenario A** continue regular installments vs **Scenario B** settle earlier. Compare cash balance, remaining debt, monthly obligations, total payments, interest and fees, monthly surplus, **lowest projected cash balance**, liquidity risk, debt-free date.
3. Strategy comparison: Debt Snowball, Debt Avalanche, Minimum Payments, Custom Priority.
4. Side-by-side/overlapping 12-month balance charts (Recharts).
5. Save, compare, duplicate and delete scenarios.
6. Activate `/early-repayment` (`CURRENT_PHASE = 6` in `src/lib/nav.ts`).

## Reuse (do not rebuild)
- **The Phase 5 engine is the baseline.** `runForecast(input, params, days)` in `src/lib/forecast/engine.ts` is pure. Build Scenario B by transforming the `ForecastInput` (remove the settled debt's remaining installments from `installments`, subtract the settlement cash from the opening cash on the repayment date as a one-off event, add fee/penalty), then run the same engine so "Baseline matches the standard forecast" holds by construction. You will likely need a small engine extension for one-off dated cash events (add an optional `oneOffs: {date, label, amount}[]` to `ForecastInput`; keep results identical when it is empty and add a test).
- `loadForecastContext(db, ...)` in `src/lib/forecast/data.ts` loads actual inputs read-only. `loadForecastContext` already excludes paid installments.
- Saved scenarios: `simulation_scenarios` (kinds `early_repayment`, `strategy` already allowed by the CHECK); `saveScenario`/`listScenarios` in `forecast/data.ts` are forecast-specific, so add generic helpers or new ones keyed by `kind`. Migration `0006_*.sql` only if needed (never edit 0001-0005; checksums enforced).
- Debt facts: `getDebt`, `listSchedule` in `src/lib/debts/debts.ts` (outstanding, remaining principal, per-row principal/interest/fee split). Remaining principal applies payments to fees, then interest, then principal.

## Rules to keep
- **Simulations never modify real records.** No writes to transactions, transfers, debts, debt_payments, schedules, bills. A test must compare row counts before/after. Recording the actual repayment happens separately through the existing `recordDebtPayment` after an explicit confirmation.
- **Do not invent interest savings when contractual rules are unknown.** Interest saved should only be claimed from user-entered rebate/settlement quotation, or shown as "not known" with the scheduled-interest-remaining figure labelled as an upper bound at most. Say what is assumed.
- Penalty/fee inputs are extra cash out, never reducing the obligation (same convention as `debt_payments.penalty/fee`).
- Integer rupiah only; deterministic; explain every number.
- Pending inbox items are not actuals. Avoid a root `loading.tsx` and client `router.push` after server actions (see Architecture, Phase 4 pitfall).

## Tests to write
Baseline scenario equals the standard forecast exactly; settling removes the remaining installments and applies cash on the right date; partial settlement shortens/reduces correctly using the real schedule rows; fee and penalty included; lowest balance and liquidity-risk flags (settlement causes a deficit); debt-free date; snowball vs avalanche ordering on a known example; real data unchanged after simulation; saved scenario round trip.

## Finish
tests, typecheck, lint, build, browser check; commit `feat: implement early repayment simulator`; update these docs.
