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
| 2 | Core ledger & accounts (accounts, income, expenses, transfers, reconciliation, dashboard metrics) | `feat: implement core financial ledger` | Next |
| 3 | Debt, installments & bills | `feat: implement debt and bills management` | |
| 4 | Smart capture (NL parser, OCR, imports, inbox, dedupe, matching, templates) | `feat: implement smart transaction capture` | |
| 5 | Cash flow forecasting (daily engine, scenarios, payday survival) | `feat: implement cash flow forecasting` | |
| 6 | Early repayment simulator & strategies | `feat: implement early repayment simulator` | |
| 7 | Automation, budgets, goals, insights, reports/exports, optional Ollama | `feat: implement automation and analytics` | |
| 8 | Security, backup/restore, E2E tests, offline verification, final docs | `chore: finalize testing and security` | |

Per-phase acceptance criteria are tracked in `DEVELOPMENT_PROGRESS.md` and `NEXT_PHASE.md`. Process rules: one phase at a time, read existing code first, never reset data, real logic only, tests/typecheck/lint/build every phase, stop after each phase.

## Phase 1 acceptance criteria
- Launches on localhost:3000. ✔
- SQLite DB auto-created; persists across restarts. ✔
- Navigation/layout work; dark/light works. ✔
- No external runtime requests. ✔
- Builds without TypeScript errors. ✔
