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
src/lib/automation/      recurring (rules, planned occurrences, confirm/link/skip, pattern detection)
src/lib/actions/         engine (pure ranking with explanations), data (fact loader, daily review)
src/lib/budgets/ goals/ reports/   budgets, savings goals (earmarks), report builder + csv + pdf (pdf-lib)
src/lib/capture/ollama.ts, smart.ts   optional local AI and the AI-or-builtin reader
src/lib/repay/           simulate (pure A-vs-B early repayment), strategies (pure snowball/avalanche/custom/minimum), data (loader, saved scenarios, real settlement), query (URL parsing)
src/lib/forecast/        engine (pure daily cash-flow engine), data (read-only loader, actual cash history, saved scenarios)
src/lib/capture/         nl-parser (Indonesian quick entry), receipt (OCR text -> fields), rules (merchant rules), templates, post (quick capture -> ledger/inbox), text (shared pure helpers)
src/lib/imports/         table (CSV, cell parsing, mapping, normalization), pdf-table (positional PDF -> table), files (XLSX/PDF readers), ocr (offline Tesseract), templates (saved mappings)
src/lib/inbox/           inbox (create/list/edit/approve/batches), matching (installment/bill suggestions), fingerprint, import-commit
src/app/api/             import/parse, import/commit, ocr/receipt (multipart/JSON routes; same-origin checked)
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

## Phase 4: capture pipeline
```
 text (Catat Cepat) ─┐                         ┌─ plain income/expense  -> createTransaction
 screenshot / receipt ├─> parser ─> inbox_items ─> approve ─┼─ matched installment   -> recordDebtPayment
 CSV / XLSX / PDF ───┘   (nothing posted)                  ├─ matched bill          -> payBill
                                                            └─ paired transfer       -> createTransfer
```
- **The inbox is the only way in.** `approveInboxItems` is the single path from `inbox_items` to the ledger and it calls the same domain functions as manual entry, so every Phase 2/3 rule (no future dates, active accounts, one expense per obligation payment, unique source refs) still holds. Quick Capture "Catat sekarang" queues and immediately approves through the same function inside one DB transaction, so a failing row rolls the whole submission back.
- **Statuses:** `new` (complete, categorized, confident) · `needs_review` (missing field/category or low confidence, e.g. every OCR'd PDF row) · `potential_duplicate` (looks like an existing ledger row) · `approved` · `rejected`. Statuses are advice: bulk approval skips duplicates but will approve uncategorized items the user selected.
- **Idempotency, three layers:** (1) `import_batches.file_hash` is unique, so the same file/screenshot is refused; (2) `inbox_items.fingerprint` is unique: bank reference + amount when present, otherwise account + date + amount + type + normalized text + the *occurrence number* of identical lines in the file (keeps two real identical purchases apart yet matches again in an overlapping statement); (3) the ledger's unique `(source, source_ref)`.
- **Duplicate detection** compares with posted transactions and transfers: same account, type and amount, date within one day. It flags, never deletes.
- **Matching** (`matching.ts`): an expense is suggested as an installment payment (amount equals the next open installment within 10 days of its due date, or the provider is named) or a bill payment (fixed amount equal, or the bill name appears, within 10 days). Two equally good candidates yield *no* suggestion. The suggestion is re-checked at approval and invalidated if the situation changed. Two pending items in different own accounts with opposite direction, equal amount and dates within a day are paired and become one transfer.
- **Rules:** `merchant_rules` (92 defaults, user rules win; longest pattern first; whole-word phrase match; category kind must match). A category set by the user is stored with `category_source='user'` and never overwritten.
- **Quick-capture parser** is deterministic and offline: splits on lines/";"/"sama"/"dan"/amounts, reads `25rb`, `9.5jt`, `Rp30.000`, dates (kemarin, 17/11, tgl 3, weekday names; never the future), accounts by name plus cash aliases, transfers (`dari X ke Y`, `isi X dari Y`), type words (gaji, bayar...), then rules for category/merchant. Anything uncertain becomes an `issue` shown in the preview.
- **OCR:** `tesseract.js` v5 with Indonesian+English language data from the npm packages `@tesseract.js-data/ind|eng` (copied once to `os.tmpdir()/pfos-tessdata`). One lazily created worker, one image at a time, 90 s timeout, closed after 5 idle minutes. Images are processed in memory and never stored; only the file hash and up to 2000 characters of recognized text (`raw_payload`) are kept.
- **Receipt extraction** picks the total line (not balance/subtotal/fee/discount lines), reports a confidence and the reasons, and never invents values.
- **Statements:** CSV (delimiter detection, quotes, windows-1252 fallback), XLSX (`read-excel-file`), text PDF (`pdfjs-dist` positions -> columns via the header, so debit/credit stay apart), scanned PDF (PDFium renders pages, OCR reads them; always flagged for review), plain images. Column mapping is guessed from Indonesian/English headers, editable, and saveable as a template keyed by the header signature. Direction comes from debit/credit columns, a D/K column or DB/CR suffix, the sign, or the running balance; when none can decide, the row is reported as an error rather than guessed. The server re-normalizes the table with the submitted mapping before anything is queued.
- **Security:** state-changing API routes require a same-origin request; file size limits (15 MB statements, 10 MB images); file type sniffed from content.
- **Pitfall (fixed):** a root `loading.tsx` made Next.js remount the page after any revalidating server action, wiping client state (preview rows, selections, result dialogs). Skeletons now live only on routes with disposable client state, not on `/quick-capture`, `/inbox`, `/import`.

## Phase 5: forecast
- **Engine is pure** (`forecast/engine.ts`): plain data in, numbers out, no DB, no clock. `data.ts` reads ACTUAL data only and never writes to ledger/debt/bill/inbox tables (asserted by tests and in the browser by comparing row counts). Saved scenarios (`simulation_scenarios`, kind `forecast`, migration 0005 adds a unique name index) store assumptions plus a small result snapshot only.
- **Formula** per day: `closing = opening + income - installments - bills - habitual spending`. Day 0 is today: opening cash already contains all actuals up to now, so day 0 only gets obligations due today or overdue (still unpaid). Income and habitual spending start tomorrow. Months roll up from the daily rows; the first month is "sisa bulan"; each month's closing is the next month's opening.
- **Sources:** opening cash = derived balances of active accounts; income = active income `recurring_rules` (weekly/monthly/quarterly/yearly, day clamped to month end, `start_date`/`end_date`); installments = unpaid remainder of rows on active debts (paid rows never appear; a partly paid row projects what is left); bills = `next_due_date` then repeats by frequency (variable amounts use the average of the last three paid amounts, unknown ones count as Rp 0 and are listed); habitual spending = average daily expense over the last 90 days (or since the first expense), excluding rows linked to debt/bill payments, transfers and adjustments (those are projected separately or are not spending).
- **No double counting:** an income occurrence is skipped when matching money (amount within 15%) arrived in the 5 days before its date and not later than today. Overdue installments/bills are placed on today and flagged. Pending inbox items are never included (a warning shows how many are waiting).
- **Scenarios:** baseline, conservative (income 90% and 3 days late, spending 115%, variable bills 105%), optimistic (spending 90%), and custom (income %, spending %, bills %, delay days, buffer). Only these five numbers influence results.
- **Payday survival:** payday = chosen income rule, else the salary-category rule, else the largest monthly-equivalent rule, or a manual date. `survives` = lowest closing balance from today through the day before payday >= buffer. Safe-to-spend = (lowest cumulative cash counting only income and scheduled obligations - buffer) / days left, floored at 0. The engine always runs at least 70 days so payday is found even when the display horizon is short.
- **Chart:** solid line = actual total cash of the last 30 days, reconstructed backwards from the ledger for accounts active now; dashed line = projection; markers for today and the lowest point. The monthly table is the accessible equivalent.
- **URL state:** months, scenario, assumptions, payday and calendar month live in the query string and are validated/clamped; the page is a server component with no client state to lose.

## Phase 6: early repayment simulator
- **Scenario A is the standard forecast.** `simulateEarlyRepayment` calls `runForecast` unchanged for A, and for B the same engine with the debt's installments transformed and one `oneOffs` cash-out added. The engine gained an optional `oneOffs` input (dated outflows, never scaled by the scenario, zero effect when absent), so "baseline matches the forecast" holds by construction.
- **What a settlement covers.** For a repayment on date D: installments due on or before D are paid on schedule (as in the forecast); installments due after D are what the settlement covers (full) or what the partial amount is applied to, oldest first. Overdue installments stay scheduled for today. This avoids paying the same installment twice.
- **No invented savings.** Contract rules are unknown, so the only savings are user-entered: a rebate percentage of the scheduled interest on the prepaid installments, or a provider quotation that replaces the schedule amount. Without them the payoff equals the schedule; the page shows the scheduled interest on those installments as an *upper bound*, labelled as not guaranteed. Fee and penalty are extra cash out. Partial payments move cash earlier and are assumed to save nothing.
- **Liquidity risk:** `tinggi` if the lowest projected balance is below zero; `sedang` if it stays above zero but under the cash buffer or one month of habitual spending; otherwise `rendah`.
- **Comparison measures:** closing cash (12 months), lowest balance and date, negative days, payments on this debt in the horizon, total remaining payments, scheduled interest+fees remaining, average installments per month (all debts), routine monthly surplus (income - spending - installments - bills; the one-off payment is excluded), debt-free date (last due date over all debts; a full settlement ends the debt on its date).
- **Strategies** (`strategies.ts`, pure): every debt keeps its scheduled installments; an extra monthly budget prepays whole future installments of one target debt, oldest first, with unspent budget rolling over. Snowball targets the smallest remaining balance, avalanche the highest (scheduled interest + fees) per rupiah of remaining principal (a ranking proxy computed from the schedules, shown to the user), custom follows the user's order, minimum adds nothing. With a 0% rebate all strategies pay the same total and only differ in speed; savings appear only through the user-entered rebate.
- **Saved scenarios:** `simulation_scenarios` with kind `early_repayment` (assumptions + small snapshot). Comparing saved scenarios recomputes them with today's data. No migration was needed in Phase 6.
- **The only write path** is `confirmSettlementAction`: after an explicit dialog it calls `recordDebtPayment` for the whole outstanding obligation (amount read from the database on the server, never from the browser), then redirects to the debt. It is offered only for a full settlement dated today with no rebate/quotation, because the ledger cannot represent a waived amount.
- **URL state** (debt, date, mode, amounts, rebate, fee, penalty, preset, buffer, strategy budget/priorities, compared scenarios) is parsed and clamped by `repay/query.ts`; the form echoes the user's raw text back.

## Phase 7: automation, budgets, goals, insights, reports
- **Planned entries are derived, never stored as money.** `listPlanned` computes occurrences of active rules on demand (from the day the rule was created, never before its start date, at most 62 days back, up to 7 days ahead) and leaves out those already decided. Only the user's decision is stored in `recurring_occurrences` (`confirmed` with a transaction, or `skipped`), unique per (rule, due date). Confirming posts ONE transaction through `createTransaction` (`source='recurring'`, `source_ref='rule:<id>:<date>'`) so every ledger rule applies; voiding that transaction reopens the occurrence. If a transaction of the same type, account and amount (within 15%) exists within 5 days of the due date, the UI offers to **link** it instead of posting a duplicate; this is the same matching idea the forecast uses for income already received.
- **Pattern detection** (`detectPatterns`) looks at the last ~190 days of posted entries (excluding debt/bill payments, transfer fees, recurring postings): at least 3 occurrences at a steady monthly (27-34 days) or weekly (6-8 days) rhythm, amounts within 15% of the median, not stopped, not already covered by an active rule or bill, not dismissed. It only suggests; creating the rule happens server-side from the pattern key, so the browser cannot inject values.
- **Next Financial Actions** (`actions/engine.ts`, pure): facts in, ranked actions out, each with a plain-language reason containing the numbers. Severity (critical/high/medium/low) plus small bonuses for lateness or closeness decide the order. Anything that can cost money (overdue payments, forecast deficits, upcoming obligations, budget overruns) outranks bookkeeping (unconfirmed income, linking, reconciliation, inbox). No facts, no action.
- **Daily Review** reads what changed since `settings.last_review_at` and stores the review date when the user marks it done. It never changes financial data.
- **Budgets** belong to top-level expense categories and cover their subcategories (no double counting). Actual = posted expenses of the month; transfers and adjustments are not expenses; debt and bill payments count under their own categories. Warning at 90%, over above 100%.
- **Goals are earmarks.** Contributions (or withdrawals) record money set aside; they never move money or create transactions. `saved_amount` and the achieved/active status are recomputed from the contribution rows. Pace = net contributions of the last 90 days / 3; on-track compares the projected date with the target date. Migration 0006 turns an old `saved_amount` into an opening contribution.
- **Reports** (`reports/reports.ts`) are read-only: monthly income/expense/net/savings rate, expense categories with subcategory detail, income categories, debt paid per month and outstanding at each month end (today's balance plus payments made after that date), budget vs actual per month, and month-end cash (rebuilt from the ledger, accounts active now) minus debt. Tests assert the parts equal the ledger's own totals.
- **Exports** (`/api/export`, GET, read-only): CSV transactions (signed amounts, transfers included), CSV monthly and category summaries, JSON (meta + report + transactions) and a PDF summary built with `pdf-lib` (pure JavaScript, no network). CSV cells starting with `= + - @` are prefixed with an apostrophe against formula injection; a UTF-8 BOM keeps accents readable in Excel; text outside WinAnsi is replaced so PDF generation cannot fail.
- **Optional local AI** (`capture/ollama.ts`): disabled by default; the address must be http on localhost/127.0.0.1/::1 without credentials (checked when saving, when loading and before every request; redirects refused); only the user's sentence and the NAMES of accounts/categories are sent; the reply is validated with Zod, accounts/categories are mapped by name (never by id), future dates are replaced, at most 20 items; any failure (off, unreachable, slow, invalid) falls back to the built-in parser. AI drafts go through the same editable preview as everything else. AI is never used for calculations.
- **Route note:** the page for Next Financial Actions is `/next-actions` (the `src/app/actions` folder holds server actions, so `/actions` would be confusing).

## Phase 8: security, reliability, testing, release
- **Auth state lives outside the database** (`data/auth.json`: scrypt hash, HMAC session secret, failed-attempt counter and lock time), so switching profile or restoring a database backup can neither bypass nor remove the PIN. `lib/auth/crypto.ts` (scrypt hash, signed session tokens; malformed or empty hashes fail closed), `lib/auth/store.ts` (enable/change/disable, backoff lockout persisted on disk, mtime-cached reads), `lib/auth/guard.ts` (cookie check).
- **Enforcement point = `getDb()`.** Every page, server action and route that touches data goes through `getDb()`, which throws `AuthError` without a valid session; `getRawDb()` exists only for lifecycle code. The root layout renders a lock screen instead of the app, API routes return 401 (`requireSession`), `/api/health` reveals nothing while locked, and profile switching / demo reset assert the session explicitly. A replayed server-action request without a session is refused (E2E test with a positive control).
- **Backups** (`lib/backup/backup.ts`): `VACUUM INTO` (consistent, safe on a live WAL database); file names from the browser are accepted only as plain names inside `data/backups` (regex + resolved-directory check); validation opens the file read-only (`integrity_check`, `foreign_key_check`, app tables, schema version not newer than the app, migration checksums); `restoreBackup` = validate -> pre-restore backup -> close handle -> swap file (copy to `.restoring`, drop `-wal/-shm`, rename) -> reopen (migrates if older) -> on any failure put the pre-restore file back. Restore is personal-data only.
- **Integrity** (`lib/db/integrity.ts`): SQLite checks plus financial invariants (installment paid = opening-paid + allocations of posted payments; each posted debt payment has exactly one matching posted expense and voided ones none; paid bills have a live expense; goals = contributions; confirmed occurrences point to existing transactions). A quick check runs once when each database file is opened and its result is shown on the dashboard and the backup page.
- **Full export** (`exportAllData`, `/api/export?kind=all`): every table as JSON with row counts.
- **Performance:** a 25,000-transaction test (`tests/perf.test.ts`) keeps every main query well under a second and asserts query plans; migration `0007_performance_indexes.sql` added the indexes the plans showed missing (`transactions` by linked payment/bill, creation time, category+date; `debt_payments` by debt).
- **Form errors can never be silent:** `lib/form-state.ts#bannerMessage` shows a failed action's message unless the same text is already shown under a field.
- **E2E** (`e2e/`, Playwright): production build on :3100 with a throw-away `FINANCE_DATA_DIR`; a fixture fails any test on a request leaving localhost or an uncaught page error; serial specs share one database; axe-core audits (WCAG 2 A/AA, light and dark) and a phone-width overflow check are part of the suite. `scripts/verify-offline.sh` runs the whole suite inside a loopback-only network namespace.

## Overview (all phases)
Local-first Next.js 14 (App Router, server components and server actions) + SQLite (better-sqlite3, checksummed SQL migrations 0001-0007). Pure, unit-tested engines hold the financial logic (schedule generator, forecast engine, repayment simulator and strategies, action ranking); thin loaders read the database; pages and server actions only orchestrate. The ledger is the single source of truth: balances are derived, imports and OCR stop in the inbox, simulations and forecasts never write, automation proposes and the user confirms. Money is integer rupiah, dates are WIB calendar dates, everything works offline.
