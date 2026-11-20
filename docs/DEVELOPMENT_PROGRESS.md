# Development Progress

**Current phase:** 7 of 8 complete. Next: Phase 8 (final).

## Phases 1-6: done
Foundation; ledger; debts/bills; smart capture; cash-flow forecast; early-repayment simulator. See git history.

## Phase 7: done (`feat: implement automation and analytics`)
- **Aturan Otomasi:** recurring rules (income/expense; weekly/monthly/quarterly/yearly; start/end; account and category). Planned occurrences wait for a decision: **confirm** (posts one transaction), **link** an existing transaction (no duplicate), or **skip**. Detected recurring patterns are suggested and created only on approval.
- **Langkah Keuangan Berikutnya** (`/next-actions`): ranked actions with a "Mengapa" explanation (overdue payments, upcoming obligations, forecast deficits, budget overruns, missing income, reconciliation, imports waiting). **Tinjauan harian** tab: new transactions since the last review, inbox and duplicate warnings, upcoming payments, discrepancies, last review date, "tandai sudah ditinjau".
- **Anggaran bulanan** on the Pengeluaran page: per top-level category with subcategory roll-up, status (aman / hampir habis / terlampaui), copy from the previous month.
- **Target Tabungan:** emergency fund (with a 3-6 month hint), travel, purchase, custom; contributions and withdrawals (earmarks only), progress, pace, required monthly amount, projected date, on-track status, archive.
- **Laporan & Analitik:** income vs expense trend, savings rate, category breakdown with subcategories, debt reduction, budget vs actual, cash/debt over time; presets and custom ranges; **CSV (transactions, monthly, categories), JSON and PDF exports**, all generated offline.
- **AI lokal opsional** (Ollama): off by default, localhost only, names-only context, validated output, automatic fallback to the built-in parser; a "Baca dengan AI lokal" button in Catat Cepat when enabled.
- Dashboard card "Langkah keuangan berikutnya"; demo data now includes a recurring expense, budgets and a goal; migration `0006_automation_goals.sql`.
- Reconciling to a balance that already matches is now recorded.

## Verification (Linux sandbox, Node 22)
- `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- `npm test`: **424 tests passing** across 22 files (101 new: automation 21, budgets+goals 13, actions 18, reports 16, local AI 32, migration 0006 1).
- Browser E2E (Playwright/Chromium, clean database): empty states; rules created, overdue occurrences derived without posting anything; an existing transaction detected and **linked without changing the balance**; confirming posts exactly one transaction (`source=recurring`) and skipping hides; a recurring pattern detected from five monthly entries, created only after approval; budgets (92% "hampir habis", then "terlampaui" with remaining -Rp 20.000), copy to the next month and clearing; actions ranked with the overdue installment first and every item explained; daily review date stored and the new-transaction list resets; goals (17% progress without touching balances or the ledger, over-withdrawal refused, auto "Tercapai", archive); report totals equal the ledger; PDF/JSON/CSV exports reconcile (CSV rows = JSON rows); bad export requests rejected; AI: non-local address refused, connection test, draft from a fake local Ollama appears in the normal preview with only the sentence and names sent, and an unreachable AI falls back automatically.
- Zero non-localhost requests and zero page errors during the E2E run; persistence after restart; demo mode populated; dark mode and mobile screenshots reviewed.
- Real upgrade 5 -> 6 on a populated database: data intact, new tables present, pre-migration backup created, a legacy goal's saved amount preserved as an opening contribution.

## Bugs/risks found and fixed during verification
1. An unconfirmed salary entry from last month ranked above an overdue installment. Priorities adjusted (and a test added).
2. Reconciling to an already-correct balance left no trace, so the "needs reconciliation" reminder never cleared. It is now recorded.
3. A goal's `saved_amount` set outside the contribution rows would be lost on the next contribution; migration 0006 now converts it into an opening contribution.

## Not yet verified / known limitations
- **A real Ollama installation was not available.** The AI path is verified against a fake local Ollama server (success, malformed output, errors, timeouts, redirects, unreachable) and the app is verified to work fully without it. Real model output quality is untested.
- Windows CMD with a real `npm install` has not been run.
- The E2E scripts used for verification are not yet part of the repository; Phase 8 should add them as a proper Playwright test project.
- Goals are earmarks (no real money moves). Budgets exist only for top-level categories.
- Pattern detection needs about three months of history and steady amounts; it will not find irregular recurring items.
- The PDF report is a text-and-bars summary (standard fonts); it is not a designed document.
- Phase 7 has no PIN/password or encryption; see Phase 8.
