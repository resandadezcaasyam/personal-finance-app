# Development Progress

**Current phase:** 2 of 8 complete. Next: Phase 3.

## Phase 1: done
Foundation, SQLite + versioned migrations, UI shell, demo mode. See git history (`feat: initialize personal finance os`).

## Phase 2: done (`feat: implement core financial ledger`)
- **Accounts & Saldo:** create, edit, archive (zero balance only), restore, reconcile; types cash/bank/e-wallet/other; derived balances; link to per-account history.
- **Transactions:** create/edit/void for income and expense (category + subcategory, account, date, description, merchant, tags); search, filters (type, account, category incl. subcategories, date range, show voided), sort, pagination, "Bulan ini/lalu" presets.
- **Transfers** between accounts with optional fee; never counted as income/expense.
- **Reconciliation** with live difference preview; posts a traceable adjustment.
- **Income page** with recurring-income configuration (no auto-posting); **Expenses page** with monthly category chart.
- **Dashboard:** real total cash, month income/expense/net, account balances, spending donut, recent transactions; empty states when no data.
- **Settings:** category manager (add, archive), demo reset.
- Default Indonesian categories (migration 0002). Toasts, confirm dialogs, loading/error/empty states.
- Demo database now seeds fictional accounts, categories use, transactions and a transfer, relative to today.

## Verification (Linux sandbox, Node 22)
- `npm run typecheck`, `npm run lint`, `npm run build`: clean.
- `npm test`: **49 tests passing** (17 format + 6 migration from Phase 1; 24 ledger; 2 for the 0002 upgrade and demo seed).
- Browser E2E (Playwright/Chromium, clean database): empty states; create accounts; duplicate-name rejection; income; invalid-amount message; expense with merchant/tag; transfer with fee; balances (BCA Rp 10.072.500, GoPay Rp 400.000); dashboard totals exclude the transfer and count the fee once; edit recalculates; void recalculates; voided rows visible with filter; reconciliation preview + adjustment excluded from income/expense; search; empty filter result; archive blocked at non-zero balance; persistence after server restart; demo mode isolation, demo reset, custom subcategory, return to personal data.
- Zero non-localhost requests and zero page errors during the E2E run.

## Real upgrade test (Phase 1 -> 2)
A genuine on-disk Phase 1 database (migration 0001 only, one account) was upgraded by starting the Phase 2 server: schema reached version 2, the account and its balance were intact, 31 default categories were added, and `data/backups/finance.db.pre-migration-<timestamp>.bak` was created containing the pre-migration state (version 1, 0 categories, the account).

## Bug found and fixed during verification
After "Reset data demo", pages kept a handle to the deleted demo.db because Next.js loaded `client.ts` twice (pages vs server actions) with separate connection caches. Fixed with a `globalThis`-shared cache. Covered by the browser flow, not by a unit test.

## Not yet verified
- Running on Windows CMD with a real `npm install` there (better-sqlite3 prebuilt binary).
- Dark mode was reviewed on the dashboard, chart and transaction dialog only, not on every page.
- GitHub push (no access from the build environment).

## Known issues / limitations
- Transfers cannot be edited, only voided and re-created.
- Filter bar is plain GET (full page reload), by design for simplicity.
- Recurring income is configuration only until Phase 7.
