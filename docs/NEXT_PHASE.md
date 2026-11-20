# Handoff: Phase 2: Core Financial Ledger & Account Management

Start by reading `ARCHITECTURE.md` and `src/lib/db/migrations/0001_initial_schema.sql`. Do not recreate the project.

## Build
1. Account CRUD: create/edit/archive/reconcile; types cash, bank, ewallet, other; custom names.
2. Income and expense entry (categories + subcategories, date, description, account, tags); one-time income and recurring-income *configuration* (generation is Phase 7).
3. Transaction list: search, filter, sort, date range, void/edit.
4. Transfers between accounts (`transfers` table; optional fee posts as an expense row).
5. Reconciliation: enter actual balance, post a traceable `adjustment` transaction + audit log.
6. Dashboard: total cash, month income/expense/net, account balances, spending breakdown (Recharts), recent transactions.
7. Seed default categories (a migration, e.g. `0002_default_categories.sql`; first real use of the pre-migration backup).
8. Activate nav routes: Transaksi, Akun & Saldo, Pemasukan, Pengeluaran & Anggaran (`CURRENT_PHASE = 2` in `src/lib/nav.ts`).

## Rules to keep
- Money is integer rupiah. Balance = derived from ledger, never stored.
- Every write that touches several rows runs in one `db.transaction`.
- Void instead of delete; write `audit_logs`.
- Unit tests for ledger math: income, expense, transfer, edit recalculation, void, reconciliation adjustment.

## Acceptance
See Phase 2 criteria in `PRODUCT_REQUIREMENTS.md`. Finish with tests, typecheck, lint, build, then commit `feat: implement core financial ledger` and update these docs.
