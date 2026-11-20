# Product Requirements & Roadmap

> Condensed from the original master specification. For the verbatim original, save it next to this file as `PRODUCT_REQUIREMENTS_ORIGINAL.md` (it contains no personal data).

## Vision
A privacy-first, local-first personal finance OS (Windows laptop, `http://localhost:3000`, SQLite, IDR, WIB, Indonesian UI) that answers: current total cash, safe-to-spend, upcoming bills/installments, post-obligation cash, cash until payday, 1/3/6/12-month outlook, early-repayment effects, obligation priority, spending hotspots, and how to minimize manual entry.

## Non-negotiables
- Runs fully offline after `npm install`; bound to localhost; no CDN assets, no cloud/online AI/auth.
- SQLite at `./data/finance.db`; integer rupiah; versioned migrations; backup before destructive migrations; never auto-reset data; demo data separate.
- Integrity: actual vs projected separate; scheduled != paid; transfers are not income/expense; installments hit cash once; re-imports idempotent; simulations never touch real records; changes traceable; deterministic math; confirm destructive ops; never silently overwrite.
- Only activate nav routes whose features exist. No placeholder pages presented as done.

## Phases
| # | Name | Commit message | Status |
|---|------|----------------|--------|
| 1 | Foundation, database & UI shell | `feat: initialize personal finance os` | Done |
| 2 | Core ledger & accounts (accounts, income, expenses, transfers, reconciliation, dashboard metrics) | `feat: implement core financial ledger` | Done |
| 3 | Debt, installments & bills | `feat: implement debt and bills management` | Done |
| 4 | Smart capture (NL parser, OCR, imports, inbox, dedupe, matching, templates) | `feat: implement smart transaction capture` | Done |
| 5 | Cash flow forecasting (daily engine, scenarios, payday survival) | `feat: implement cash flow forecasting` | Done |
| 6 | Early repayment simulator & strategies | `feat: implement early repayment simulator` | Done |
| 7 | Automation, budgets, goals, insights, reports/exports, optional Ollama | `feat: implement automation and analytics` | Next |
| 8 | Security, backup/restore, E2E tests, offline verification, final docs | `chore: finalize testing and security` | |

Per-phase acceptance criteria are tracked in `DEVELOPMENT_PROGRESS.md` and `NEXT_PHASE.md`. Process rules: one phase at a time, read existing code first, never reset data, real logic only, tests/typecheck/lint/build every phase, stop after each phase.

## Phase 1 acceptance criteria
- Launches on localhost:3000. ✔
- SQLite DB auto-created; persists across restarts. ✔
- Navigation/layout work; dark/light works. ✔
- No external runtime requests. ✔
- Builds without TypeScript errors. ✔

## Phase 2 acceptance criteria
- Income increases the correct account balance. ✔ (unit + browser tested)
- Expenses decrease the correct account balance. ✔
- Transfers update both accounts without creating income or expenses. ✔
- Editing transactions correctly recalculates balances. ✔
- Reconciliation adjustments are traceable. ✔ (adjustment row + audit log)
- All records persist after restart. ✔
- Unit tests cover core ledger calculations. ✔ (24 ledger tests)

## Phase 3 acceptance criteria
- Debt schedules match configured terms. ✔ (none/flat/reducing/manual; unit-tested to the rupiah)
- Payments reduce the corresponding balance correctly. ✔
- Installments are never double-counted. ✔ (one expense per payment; schedule/ledger linked)
- Partial payments are handled correctly. ✔
- Upcoming and overdue obligations are accurate. ✔
- Bills marked as paid generate the appropriate ledger entry. ✔ (once per occurrence)
- Tests cover zero-interest, partial, late, and irregular payments. ✔

## Phase 4 acceptance criteria
- Natural-language input generates correct editable transaction drafts. ✔ (all five spec examples, multi-item, dates, transfers)
- Multiple screenshots can be processed locally. ✔ (batch upload, offline OCR; verified with the network cut)
- CSV/XLSX/PDF imports work for supported formats. ✔ for CSV, XLSX, text PDF and scanned PDF *fixtures*. Not claimed for any specific bank: no real statement samples were available (see Known limitations).
- Smart Inbox supports bulk review. ✔
- Repeat imports do not duplicate ledger entries. ✔ (file hash, line fingerprints, ledger unique index)
- Category corrections can be reused. ✔ (user merchant rules)
- Imported transactions can be matched to debt payments. ✔ (also bills and transfer pairs)
- Financial balances remain accurate. ✔ (E2E reconciles to the rupiah)

## Phase 5 acceptance criteria
- Forecast updates when transactions or obligations change. ✔ (computed on every request from live data; browser-tested: pay an installment, reconcile a balance)
- Already paid installments are not projected again. ✔ (unit + browser tested)
- Daily cash shortfalls can be detected. ✔ (first deficit date, deficit periods, lowest balance and date)
- Monthly opening and closing balances reconcile. ✔ (asserted in unit tests and on the rendered table)
- Scenario assumptions are clearly displayed. ✔ ("Asumsi yang dipakai" + "Dari mana angkanya")
- Financial calculations have passing tests. ✔ (53 forecast tests)

## Phase 6 acceptance criteria
- Baseline matches the standard forecast. ✔ (Scenario A is the same `runForecast` call; asserted by JSON equality in unit tests and on real data)
- Repayment scenarios recalculate subsequent obligations. ✔ (later installments removed or reduced, one-off cash-out on the date)
- Penalties and fees are included. ✔ (extra cash out; never reduce the obligation)
- Partial settlements are handled appropriately. ✔ (oldest-first across the installments after the date, fees -> interest -> principal)
- Real data remains unchanged after simulation. ✔ (row-count tests and browser check; only an explicit, separate confirmation records a real payment)
- Scenarios can be saved and reopened. ✔ (save, open, compare side by side, duplicate, delete)
- Calculation tests pass. ✔ (43 simulator tests)
