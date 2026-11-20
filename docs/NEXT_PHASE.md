# Handoff: Phase 8 (FINAL): Security, Reliability, Testing & Release

Read `ARCHITECTURE.md` (all phases) and migrations 0001-0006 first. This is the last phase: after it, provide the **final delivery report** (spec Part 4, Phase 8, and Part 8 "Final Definition of Done").

## Build (spec Part 4, Phase 8)
1. **Data protection:** optional local PIN/password with secure hashing (`node:crypto` scrypt or argon2 if a pure/offline build is available) and sensible local session handling (httpOnly, SameSite, expiry, lockout/backoff). Do NOT present a PIN as database encryption; say plainly that `data/finance.db` and backups are readable files. Protect pages, server actions and the API routes (`/api/import/*`, `/api/ocr/receipt`, `/api/export`, `/api/health`).
2. **Backup & restore UI:** create a local database backup (use SQLite's backup API or `VACUUM INTO`, not a raw file copy of a WAL database), list/validate backups (`PRAGMA integrity_check`, schema version), restore with confirmation and an automatic pre-restore backup, export all financial records. Existing automatic pre-migration backups live in `data/backups/`.
3. **Database reliability:** verify migration safety (already: checksums + backup before upgrading), `PRAGMA foreign_key_check`, atomic ledger transactions, duplicate prevention, persistence, consistent calculations. Consider a startup self-check and a Settings "Periksa integritas" action.
4. **Automated tests:** unit and integration tests exist (`npm test`). **Add a proper Playwright E2E project to the repository** (`e2e/`, `npm run test:e2e`) covering the main workflows. The flows were verified with throwaway scripts in earlier phases; reproduce them: accounts, income/expense/transfer, reconciliation, debt + payments, bills, quick capture, OCR/import -> inbox -> approve, forecast, early repayment, recurring confirm/link, budgets, goals, reports/exports, demo mode, restart persistence. Use fixtures in `tests/fixtures`.
5. **Offline verification:** `npm run check:offline` scans source; also inspect runtime requests (the Playwright request log was empty in every phase) and re-run OCR/PDF tests in a network-less namespace (done in Phase 4). Make this a documented, repeatable check.
6. **UI/UX polish:** accessibility pass (keyboard, focus, contrast in both themes, aria), loading/empty/error states, performance (large ledgers: pagination, indexes, `EXPLAIN` on the heavy queries), responsive review of every page (mobile screenshots for Phase 5-7 pages were only captured, not reviewed in detail).
7. **Final documentation:** installation guide, Windows CMD commands, database backup guide, troubleshooting, product feature guide (Indonesian), architecture overview, known limitations. README already has a start; extend it and keep `docs/` current.

## Things to be honest about in the final report
- GitHub: the private repo was never created from the build environment (no access); give the push commands again and confirm nothing sensitive is tracked (`git ls-files | grep -E "\.db|\.bak|\.env|^data/"`).
- Not verified: a real Windows `npm install`/run, a real Ollama install, real bank statements and phone screenshots (only fictional fixtures), noisy-photo OCR accuracy.
- Data sensitivity: OCR text (`inbox_items.raw_payload`) and all records are in `data/finance.db`; backups and exports contain the same data.

## Rules to keep
- Never auto-reset or overwrite user data; restore must back up first and confirm. Migrations only add (`0007_*.sql`; never edit 0001-0006; checksums enforced).
- Avoid a root `loading.tsx`; do not call client `router.push` after a server action (use `redirect()`); see Architecture, Phase 4 pitfall.
- If a PIN gate is added, make sure server actions and route handlers enforce it (a middleware-only gate is not enough), and that the demo/personal profile switch cannot bypass it.

## Finish
tests (unit, integration, E2E), typecheck, lint, production build, offline verification; commit `chore: finalize testing and security`; update docs; provide the final delivery report. STOP after Phase 8.
