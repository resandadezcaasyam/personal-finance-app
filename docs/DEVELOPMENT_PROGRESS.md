# Development Progress

**Current phase:** 6 of 8 complete. Next: Phase 7.

## Phases 1-5: done
Foundation and demo mode; core ledger; debts, installments and bills; smart capture; cash-flow forecasting. See git history.

## Phase 6: done (`feat: implement early repayment simulator`)
- **/early-repayment:** choose a debt, a date (today to 12 months), full or partial, optional provider quotation, rebate %, early-repayment fee, penalty, the underlying forecast scenario and a cash buffer.
- **A vs B comparison** over 12 months: closing cash, lowest balance and date, negative days, liquidity risk (rendah/sedang/tinggi), payments on the debt, total remaining payments, scheduled interest+fees remaining, average installments per month, routine monthly surplus, debt-free date, each with the difference. A plain-language verdict above the table.
- **Payment breakdown** on the repayment date (installments covered, schedule cost, rebate/quotation, fee, penalty, total cash-out) and an honest note: no interest saving is assumed unless the user enters a rebate or quotation; the scheduled interest is shown only as an upper bound.
- **Chart** (A solid, B dashed, repayment-date marker) and a monthly comparison table.
- **Strategy comparison** for all active debts: minimum, snowball, avalanche, custom priority, with an extra monthly budget and optional rebate; debt-free month, months, total paid, interest+fees paid, saving vs minimum, month each debt clears, ranking basis, and a 4-line chart (distinct dash patterns).
- **Saved scenarios:** save, re-open, compare up to 4 side by side (recomputed with today's data), duplicate, delete.
- **Real repayment is separate:** a confirmation dialog records an actual full settlement (today, no rebate/quotation) through the normal debt-payment path; otherwise the page explains why and links to the debt page. Debt pages link to the simulator.
- Engine extension: optional `oneOffs` (dated outflows). No migration.

## Verification (Linux sandbox, Node 22)
- `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- `npm test`: **323 tests passing** across 16 files (43 new: engine one-offs, settlement maths, A-vs-B scenarios, strategies, real-database behavior, scenario storage, URL parsing).
- Browser E2E (Playwright/Chromium, clean database; numbers computed by hand beforehand): empty state; link from the debt page; full settlement + fee gives cash-out Rp 1.140.000 and closing B - A = -Rp 20.000; 50% rebate gives payoff Rp 1.060.000 and +Rp 40.000; quotation gives +Rp 100.000; partial Rp 500rb pays #2 and part of #3 oldest-first; six validation messages; hostile URL parameters; **all simulations leave the database and balances unchanged**; scenario save, duplicate-name refusal, compare, duplicate, delete, re-open; strategies (all pay the same total Rp 1.944.000 and finish sooner than minimum; with a 100% rebate avalanche saves more than snowball; custom order); low cash + settling before payday gives Risiko Tinggi and one negative day; real recording only when allowed, balance reduced by outstanding + fee and debt settled; settled debt no longer offered.
- Zero non-localhost requests and zero page errors during the E2E run; persistence after restart, demo mode, dark mode and mobile screenshots reviewed.

## Not yet verified / known limitations
- Windows CMD with a real `npm install` has not been run.
- The simulator cannot know contract terms: early-repayment fees, rebates and quotations must be entered by the user; partial payments are modelled as paying the next installments earlier with no assumed interest saving; real contracts may recalculate the schedule differently.
- Avalanche ranking uses scheduled interest+fees per rupiah of remaining principal as a proxy for the true rate.
- The strategy comparison models the debts only (it does not feed the extra budget back into the cash-flow forecast); the page shows the baseline routine surplus as a hint for choosing a budget.
- Only single-debt simulations are saved; strategy comparisons live in the URL.
- A real settlement with a rebate or quotation cannot be recorded automatically (the ledger has no way to represent a waived amount); the user records the amount actually paid on the debt page.
- The horizon is fixed at 12 months.
