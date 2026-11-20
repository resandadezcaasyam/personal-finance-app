# Handoff: Phase 7: Advanced Automation, Budgeting & Financial Insights

Read `ARCHITECTURE.md` (Phases 2-6) and migrations 0001-0005 first. Do not recreate the project.

## Build (spec Part 4, Phase 7)
1. **Recurring automation:** generate *planned* recurring income/expenses from `recurring_rules` without duplicate postings; detect likely recurring patterns in imported data and suggest rules for confirmation.
2. **Daily Financial Review:** compact view of new transactions, unreviewed imports, duplicate warnings, upcoming payments, account discrepancies; show the last review date.
3. **Next Financial Actions** (`/actions`): prioritize overdue payments, upcoming installments, insufficient-balance risks, budget overruns, missing income confirmation, account reconciliation; **explain why** each is recommended.
4. **Monthly budgeting** (`budgets` table exists): category budgets vs actual. **Savings goals** (`goals` table exists): emergency fund, travel, purchase, custom; contributions and progress.
5. **Reports & analytics** (`/reports`): income vs expense trends, category breakdown, monthly savings, debt reduction, budget vs actual, performance over time; **CSV, JSON and offline PDF exports** (choose a pure-JS offline PDF library, e.g. `pdf-lib`, and check it works with the network cut).
6. **Optional offline AI** via a locally installed Ollama for better natural-language interpretation: must be optional, off by default, never required, never used for financial calculations; all data stays local (localhost only).
7. Activate `/goals`, `/actions`, `/reports`, `/automation` (`CURRENT_PHASE = 7` in `src/lib/nav.ts`).

## Existing pieces to build on
- **Planned vs actual:** the forecast already treats recurring income as *projection*. Phase 7 "planned" entries must stay separate from the ledger until confirmed; confirming posts through `createTransaction` (so every Phase 2 rule applies) and must be idempotent (e.g. `source='recurring'`, `source_ref='rule:<id>:<date>'`, unique `(source, source_ref)` index already exists).
- **Missing income confirmation:** the forecast's "income already received" matching (amount within 15%, within 5 days before the date, `recentIncome` in `src/lib/forecast/engine.ts`) is the model; reuse it rather than inventing a second rule.
- **Action sources** (read-only, already computed elsewhere): overdue and upcoming obligations `getCommitmentsOverview` (`src/lib/obligations.ts`); deficits and payday survival from `runForecast` (`summary.deficitPeriods`, `survival`); pending inbox `inboxCounts` and duplicates (`src/lib/inbox/inbox.ts`); account balances `listAccounts`; reconciliation `reconcileAccount`.
- **Pattern detection** can use `merchant_rules`, `inbox_items` and posted transactions; suggestions must be confirmed by the user, never auto-created.
- Reports can reuse `monthTotals`, `spendingByCategory` (`src/lib/ledger/summary.ts`) and the debt/bill tables; exports must reconcile with the ledger (add tests that totals match).
- Server-action helpers in `src/app/actions/shared.ts`; Recharts charts follow the solid/dashed + text-table pattern used in `components/forecast` and `components/repay`.

## Rules to keep
- Financial calculations are deterministic; AI (if any) only interprets text and its output goes through the same preview/inbox review as everything else.
- Never post silently: automation proposes, the user confirms.
- Avoid a root `loading.tsx`; do not call client `router.push` after a server action (use `redirect()`); see Architecture, Phase 4 pitfall.
- New schema in `0006_*.sql` (never edit 0001-0005; checksums enforced).
- Exports must not include anything that is not already in the user's data and must work offline.

## Tests to write
Recurring generation is idempotent and respects start/end/day clamping; duplicates avoided across re-runs; missing-income detection (received early, received late, missing); action ranking and explanations from real data; budget vs actual including subcategories; goal progress; every report total reconciles with the ledger; CSV/JSON round trip; PDF is produced offline; Ollama off by default and app fully works when it is unreachable.

## Finish
tests, typecheck, lint, build, browser check; commit `feat: implement automation and analytics`; update these docs.
