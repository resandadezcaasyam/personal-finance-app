# Handoff: Phase 3: Debt, Installment & Bills Management

Read `ARCHITECTURE.md` (especially "Phase 2 ledger rules") and migrations 0001/0002 first. Do not recreate the project.

## Build
1. **Debt manager** (providers like ShopeePay/SeaBank/KrediFazz/GoPay Pinjam/custom): principal, remaining principal, interest model (none/flat/reducing/manual), rate (bps), admin fee, total obligation, installment amount/count, start/maturity, payment account, status. Tables `debts`, `installment_schedules`, `debt_payments` already exist.
2. **Schedule generation**: fixed, reducing-balance, manual. Monthly list and calendar view. Integer math only; deterministic rounding (put the remainder in the last installment) and tests for zero-interest, flat, reducing, irregular.
3. **Payment recording**: full, partial, overdue, early, with fees and penalties. Posting a payment = ONE `expense` row in `transactions` with `debt_payment_id` set, in the same `db.transaction` as the `debt_payments` insert and schedule update. Never create a second cash movement.
4. **Bills & subscriptions** (`bills` table): due dates, reminders, statuses. "Mark as paid" posts ONE expense with `bill_id` set.
5. **Commitments overview**: total outstanding debt, monthly installment totals, upcoming, overdue, completion.
6. Activate nav routes `/debts` and `/bills` (`CURRENT_PHASE = 3` in `src/lib/nav.ts`).

## Must handle
- `updateTransaction` / `voidTransaction` in `src/lib/ledger/transactions.ts` should refuse (or route through the debt/bill module for) rows with `debt_payment_id` or `bill_id`; voiding a payment must reverse the schedule/outstanding amounts.
- The ledger rejects future-dated transactions; scheduled installments/bills live in their own tables until paid.
- If a migration is needed, add `0003_*.sql` (never edit 0001/0002; checksums are enforced). It will trigger the first real pre-migration backup for existing users.
- Keep `audit_logs` entries for every debt/payment/bill change.

## Tests to write
Zero-interest, flat, reducing schedules; partial then completing payment; late payment with penalty; early payment; void payment restores outstanding; installment never double-counted in balances; bill paid once.

## Finish
tests, typecheck, lint, build, browser check; commit `feat: implement debt and bills management`; update these docs.
