# Architecture

## Stack
Next.js 14 (App Router) · React 18 · TypeScript (strict) · Tailwind CSS 3 · hand-written shadcn-style components in `src/components/ui` · Lucide icons · better-sqlite3 · Zod · Vitest.

## Layout
```
src/app/                 routes (Dasbor, Pengaturan, /api/health)
src/components/ui/       Button, Card, Badge, DataTable, Dialog/ConfirmDialog, FormField, EmptyState
src/components/layout/   AppShell (sidebar, topbar, mobile drawer)
src/lib/db/              client.ts (profiles, connection), migrate.ts (runner), demo.ts, status.ts
src/lib/db/migrations/   numbered .sql files (0001_initial_schema.sql)
src/lib/debts/           schedule.ts (pure: generator, allocation), debts.ts (DB: create, pay, void, summaries)
src/lib/bills/           bills.ts (recurrence, pay/skip/void, statuses)
src/lib/obligations.ts   commitments overview, upcoming/overdue feed, month agenda (calendar)
src/lib/ledger/          accounts, categories, transactions (+list/filter), transfers, reconcile, summary, recurring, validate, audit
src/app/actions/ledger.ts  server actions: Zod validation, LedgerError -> UI messages
src/components/ledger/   AccountsManager, TransactionsManager, FilterBar, SpendingChart, ...
src/lib/format.ts        IDR formatting/parsing, WIB date helpers
src/lib/nav.ts           navigation + the phase in which each route activates
data/                    finance.db, demo.db, backups/ (git-ignored)
```

## Data conventions
- Money: INTEGER rupiah. No floats stored.
- Dates: `YYYY-MM-DD` for local WIB calendar dates; timestamps ISO-8601 UTC.
- Account balance is derived (see `ledger/accounts.ts`): `initial_balance + income - expense + transfers in - transfers out + adjustments`. It is not stored.
- Actual ledger = `transactions` + `transfers`. A debt payment or paid bill (Phase 3) posts **one** expense row in `transactions` linked by `debt_payment_id` / `bill_id`, so cash is affected exactly once. Schedules, bills, recurring rules, forecasts and simulations are projections and never change balances until confirmed and posted.
- Transfers are separate rows in `transfers`, so they cannot be counted as income/expense.
- `transactions(source, source_ref)` is unique for posted rows, and `import_batches.file_hash` / `inbox_items.fingerprint` are unique: these back idempotent imports.
- Voiding (`status='voided'`) is preferred over hard delete; `audit_logs` records before/after JSON.

## Schema (migration 0001)
settings · accounts · categories · transactions · transfers · debts · installment_schedules · debt_payments · bills · recurring_rules · budgets · goals · import_batches · inbox_items · simulation_scenarios · audit_logs. Tables for later phases exist but are unused until their phase.

## Migrations
`migrate.ts` applies `NNNN_name.sql` files in order, each in its own transaction, recorded in `schema_migrations` with a SHA-256 checksum. Editing an applied migration throws. Before pending migrations run on a database that already has applied migrations, `client.ts` checkpoints the WAL and copies the DB to `data/backups/<file>.pre-migration-<timestamp>.bak`.

## Profiles / demo mode
`data/active-profile.json` selects `finance.db` (personal) or `demo.db` (fictional seed). Each is a separate file; switching never reads or writes the other.

## Offline
No remote fonts/scripts (system font stack, inline theme script), Next telemetry disabled in `postinstall`, `npm run check:offline` scans `src/` for external URLs, and `start`/`dev` bind to `localhost`.

## Phase 2 ledger rules
- **Balance** = `initial_balance` + income - expense + adjustments in/out + transfers in - transfers out, voided rows excluded. Computed in SQL; never stored.
- **Transfers** are rows in `transfers`. An optional fee is a separate `expense` row (`source='transfer_fee'`, `source_ref='transfer:<id>'`) on the source account, so it is counted once. `transfers.fee` records the amount for display only and is *not* used in balance math.
- **Reconciliation** posts a `type='adjustment'` row with `adj_direction` ('in'/'out'). A DB trigger enforces that adjustments have a direction and other types do not. Adjustments are excluded from income/expense totals.
- **No future dates**: the ledger holds only what happened (date <= today in WIB). Scheduled items belong to bills/installments (Phase 3) and forecasts (Phase 5).
- **Void, not delete.** Voided rows stay for traceability and are hidden by default. Transfer-fee rows can only be voided with their transfer.
- **Audit**: every create/update/void/archive/reconcile writes `audit_logs` with before/after JSON.
- **Unified history**: `listLedger` UNIONs transactions and transfers; a transfer appears in the history of both accounts.
- **DB handle cache** lives on `globalThis` (`__pfosDbCache`) because Next.js can instantiate `client.ts` separately for pages and server actions; a per-module cache kept a stale handle after demo reset.

## Phase 3 rules: debts, installments, bills
- **Schedule = projection, payment = actual.** `installment_schedules` rows never move money. `recordDebtPayment` posts ONE `expense` in `transactions` (installment + penalty + fee, `source='debt_payment'`, `debt_payment_id` set) in the same DB transaction as the payment, allocations and schedule updates. Balance math is therefore unchanged from Phase 2 and cash moves exactly once.
- **Allocation:** a payment is applied to the oldest unpaid installments first and may span several (`debt_payment_allocations`), which is what lets voiding reverse it exactly. Penalty and fee are extra cash out and never reduce the obligation.
- **Derived figures (no stored balances):** outstanding = sum(amount_due - amount_paid); remaining principal applies each installment's payments to fees, then interest, then principal; remaining installments = rows not fully paid. `debts.status` flips to `settled` at zero and back to `active` if a payment is voided.
- **Payment kind** is derived: `settlement` (pays everything across >1 installment), `partial` (last touched installment not completed), `early` (any covered installment due more than 7 days later), else `regular`.
- **Schedule models:** `none` (even split), `flat` (monthly rate x principal x count, split evenly), `reducing` (annuity, per-row rounding, last row absorbs the remainder), `manual` (user dates/amounts; cost split proportionally). Rate is **per month** in basis points. Admin fee is a total spread evenly over installments. Month-end dates clamp (31 Jan -> 28 Feb) but keep the anchor day.
- **Opening paid count:** installments already paid before tracking began are marked paid without any transaction, so account balances are untouched.
- **Debt immutability:** after creation only provider/label/notes/payment account can change. A debt with no payments can be cancelled; otherwise void the payments first.
- **Linked ledger rows are protected:** `updateTransaction`/`voidTransaction` refuse rows with `debt_payment_id` or `bill_id` and point to the owning module.
- **Bills:** `bills.next_due_date` is the current occurrence. `payBill` posts one expense (`source='bill_payment'`, `source_ref='bill:<id>:<due>'`), records `bill_payments`, and advances the due date (`once` bills deactivate). A unique index on `(bill_id, due_date)` for paid/skipped makes double posting impossible. Skip advances without a ledger entry. Only the latest settlement of a bill can be voided.
- **Variable bills** (`amount IS NULL`) take the amount at payment time.
- **Obligations feed** (`obligations.ts`): installments come from real schedules; for bills the next due date is real and later occurrences are labelled projections. Nothing in this module changes a balance.
- **Server-action redirects:** after creating a debt the action calls `redirect()` (outside try/catch). A client-side `router.push` after a server action was overwritten by the revalidation refresh.
