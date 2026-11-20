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
src/lib/format.ts        IDR formatting/parsing, WIB date helpers
src/lib/nav.ts           navigation + the phase in which each route activates
data/                    finance.db, demo.db, backups/ (git-ignored)
```

## Data conventions
- Money: INTEGER rupiah. No floats stored.
- Dates: `YYYY-MM-DD` for local WIB calendar dates; timestamps ISO-8601 UTC.
- Account balance (Phase 2) is derived: `initial_balance + income - expense + transfers in - transfers out + adjustments`. It is not stored.
- Actual ledger = `transactions` + `transfers` + `debt_payments`. Schedules, bills, recurring rules, forecasts and simulations are projections and never change balances until confirmed and posted.
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
