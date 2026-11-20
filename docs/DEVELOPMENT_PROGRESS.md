# Development Progress

**Status: all 8 phases complete (version 1.0.0).**

| Phase | Commit message | Status |
|---|---|---|
| 1 Foundation, schema, shell, demo | feat: initialize personal finance os | ✔ |
| 2 Core ledger | feat: implement core financial ledger | ✔ |
| 3 Debts and bills | feat: implement debt and bills management | ✔ |
| 4 Smart capture, OCR, import, inbox | feat: implement smart transaction capture | ✔ |
| 5 Cash-flow forecasting | feat: implement cash flow forecasting | ✔ |
| 6 Early repayment simulator | feat: implement early repayment simulator | ✔ |
| 7 Automation, budgets, goals, reports, optional AI | feat: implement automation and analytics | ✔ |
| 8 Security, backup/restore, E2E, offline verification, docs | chore: finalize testing and security | ✔ |

## Phase 8 (this phase)
- **PIN protection** (optional): scrypt hash, signed session cookie, persisted lockout with backoff, enforced in `getDb()` and API routes; lock screen; settings to enable/change/disable/lock/sign out everywhere.
- **Backup & restore** page: create (VACUUM INTO), validate, download, delete, restore with pre-restore backup and automatic rollback; full JSON export; reminder in Next Actions.
- **Data health:** startup quick check (banner on failure), full integrity check including financial invariants.
- **Performance:** 25,000-transaction test; migration 0007 adds indexes found missing by query plans.
- **End-to-end suite** in the repo (`npm run test:e2e`): 60 scenarios on the production build, with automatic failure on any request leaving localhost; axe accessibility audits (light/dark), phone overflow check, keyboard checks.
- **Offline verification** (`npm run verify:offline`): the whole E2E suite inside a loopback-only network namespace.
- **UI fixes from audits:** warning-color contrast, donut chart focus, OCR drop zone semantics, forecast calendar semantics, focusable scroll regions, link `aria-pressed`, ids with spaces, dashboard overflow on phones, silent form errors (14 forms).
- **Docs:** README, INSTALLATION, USER_GUIDE, BACKUP_RESTORE, SECURITY, TROUBLESHOOTING, TESTING, ARCHITECTURE, DECISIONS.

## Bugs and risks found during Phase 8 verification (all fixed unless noted)
1. PIN verification accepted ANY PIN for a record with an empty hash (damaged `auth.json`). Now fails closed; test added.
2. **Linking a recurring-schedule occurrence to an existing transaction never worked in the UI** (validation error on a missing amount, hidden by the form). Fixed; the earlier manual test passed falsely because it only checked that nothing changed. Lesson recorded as decision 76.
3. 14 forms could hide a failed action's message when a field error existed; now a shared helper always shows it.
4. `transactions` lookups by linked payment/bill, by creation time, and by category+date were full scans (migration 0007).
5. The E2E server could run against a stale build (hid missing pages); it now always builds.
6. Accessibility violations (serious/critical) on the dashboard, import, forecast and early-repayment pages, in both themes; fixed and now guarded by the suite.
7. The dashboard overflowed horizontally on phones (grid item min-width); fixed in `Card`.
8. Reconciling to an already-correct balance left no trace (fixed in Phase 7 work); noted because the new reminder logic depends on it.

## Not verified / known limitations (see README for the user-facing list)
- **Windows has never been used.** Everything ran on Linux with Node 22.
- **No real-world inputs:** only fictional statements, receipts and screenshots; OCR accuracy on noisy photos is unmeasured.
- **Real Ollama was never run;** the AI path is tested against a fake local server and the app is verified to work without it.
- **GitHub:** the private repository was never created or pushed (no access from the build environment).
- The PIN is not database encryption. One user, one computer, no sync.
- Only Chromium is covered by the E2E suite.
- Strategy comparisons model debts only (not the cash flow); partial early payments assume no interest saving; goals are earmarks; OCR/AI results always require human review.
