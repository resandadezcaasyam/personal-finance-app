# Development Progress

**Current phase:** 3 of 8 complete. Next: Phase 4.

## Phase 1: done
Foundation, SQLite + versioned migrations, UI shell, demo mode (`feat: initialize personal finance os`).

## Phase 2: done
Accounts, income/expense/transfers, reconciliation, dashboard, categories (`feat: implement core financial ledger`).

## Phase 3: done (`feat: implement debt and bills management`)
- **Debt manager:** provider, label, principal, interest model (none/flat/reducing/manual), monthly rate, admin fee, installment count, first due date, payment account, notes. Live schedule preview before saving; optional "already paid" installments for loans that are already running.
- **Installment schedules:** generated deterministically (integer rupiah, exact totals); month-end clamping; irregular schedules via manual entry.
- **Payments:** regular, partial, overdue (penalty), early/lump-sum, settlement, admin fee. Preview of how a payment is allocated; one expense posted per payment; void restores schedule, status and balance exactly.
- **Bills & subscriptions:** fixed or variable amount, weekly/monthly/quarterly/yearly/once, reminders, statuses (overdue / due soon / upcoming / inactive), pay (one ledger entry), skip, undo latest, history.
- **Commitments overview:** total outstanding and principal, this month's installments (paid/remaining), 30-day upcoming, overdue list, completion %, per-debt progress.
- **Views:** Utang (table), Jadwal bulanan (agenda with totals), Kalender (month grid with paid/partial/overdue/projected states), debt detail page.
- **Dashboard:** "Kewajiban mendatang" card. **Ledger:** debt/bill payment rows are badged and cannot be edited/voided from the transaction list.
- Demo data now includes two fictional loans (one partly paid) and four bills (one overdue).
- Migration `0003_debts_and_bills.sql`.

## Verification (Linux sandbox, Node 22)
- `npm run typecheck`, `npm run lint`, `npm run check:offline`, `npm run build`: clean.
- `npm test`: **93 tests passing** (14 schedule engine; 19 debts/payments/commitments/agenda; 11 bills; 49 from earlier phases: 24 ledger, 17 format, 6 migration, 2 upgrade+demo).
- Browser E2E (Playwright/Chromium, clean database): empty states; debt creation with live preview (Rp 1.344.000); regular, partial, late (penalty+fee, cash-out Rp 130.000), overpayment rejection; ledger rows protected; void restores balance and outstanding; settlement closes the debt; bills added/paid once/undone/variable/skipped; calendar, monthly agenda and projection labels; dashboard card; persistence after server restart; demo mode shows fictional obligations and leaves personal data untouched.
- Zero non-localhost requests and zero page errors during the E2E run.

## Real upgrade test (Phase 2 -> 3)
A genuine on-disk Phase 2 database (migrations 1-2; one account, one transaction, one legacy bill row) was upgraded by starting the Phase 3 server: schema reached version 3, all data was intact, the legacy bill received the new `kind`/`notes` columns, and `data/backups/finance.db.pre-migration-<timestamp>.bak` held the pre-migration state (versions 1-2, no `bill_payments` table).

## Bug found and fixed during verification
After creating a debt, the dialog closed but the app did not navigate to the new debt: a client `router.push` after a server action was overwritten by the revalidation refresh. Fixed by redirecting from the server action.

## Not yet verified
- Windows CMD run with a real `npm install` (better-sqlite3 prebuilt binary).
- Dark mode on the new Phase 3 pages was not reviewed visually.
- Floating-point is used inside the reducing-balance formula (rounded to whole rupiah per row, deterministic, verified against a known annuity); results can differ from a provider's own rounding by a few rupiah.

## Known issues / limitations
- Debt terms cannot be edited after creation (cancel if unpaid, or void payments).
- A debt payment needs an amount > 0 (penalty-only payments are not supported).
- Bills do not catch up automatically: each missed period is paid or skipped one at a time.
- Early settlement uses the schedule's remaining amount; contractual rebates or settlement quotes are for the Phase 6 simulator.
