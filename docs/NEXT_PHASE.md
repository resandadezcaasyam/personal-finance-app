# Project status: complete (Phase 8 of 8)

There is no next phase. All eight phases are implemented and committed. This file now only lists ideas for future work; none of them is promised or started.

## Not verified (do these first on a real machine)
1. Install and run on **Windows** exactly as `INSTALLATION.md` says; fix anything that differs.
2. Try real exports from your banks/e-wallets (CSV/XLSX/PDF) and real receipts/screenshots; save mappings as templates and report formats the parser does not handle.
3. Install **Ollama** locally and try the optional AI reader.
4. Create the private GitHub repository and push (`git remote add origin ...`, `git push -u origin main`). Confirm nothing sensitive is tracked: `git ls-files | grep -E "\.db|\.bak|\.env|^data/"` must show only `.env.example` and `data/.gitkeep`.

## Possible future work
- Disk-level or database encryption (SQLCipher) if file-level protection is needed beyond OS disk encryption.
- Bank-specific import templates once real statements are available.
- Multi-currency, shared/household use, reminders via OS notifications, scheduled automatic backups.
- Installer / one-click start script for Windows.
- Firefox/Safari in the E2E matrix.

## Rules to keep when changing the code
- Money is integer rupiah; dates are WIB calendar dates; the ledger is the single source of truth and balances are derived.
- Migrations only add (`0008_*.sql` next); 0001-0007 are checksummed and must not be edited.
- Anything that reads or writes data goes through `getDb()` (the PIN gate). Do not add a data path that bypasses it.
- Keep `npm run test:all` and `npm run verify:offline` green; every E2E test fails on a request that leaves localhost.
