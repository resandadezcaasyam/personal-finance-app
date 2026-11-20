# Development Progress

**Current phase:** 1 of 8 complete. Next: Phase 2.

## Phase 1: done
- Next.js/TypeScript/Tailwind app on localhost:3000.
- SQLite with versioned, checksummed migrations and pre-migration backups; full normalized schema for all phases.
- App shell: sidebar, top bar, mobile drawer, dark/light theme (no flash), reusable UI components, IDR/WIB utilities.
- Dashboard shell with honest empty states and a live database-status card.
- Settings page: theme, demo-mode switch (separate `demo.db`), storage info.
- `/api/health`.

## Verification (run in the build environment, Linux, Node 22)
- `npm run typecheck`, `npm run lint`: clean.
- `npm test`: 23 tests passing (formatting/parsing/WIB dates; migrations, idempotency, backup hook, checksum guard, FK/CHECK/duplicate constraints).
- `npm run build`: succeeds.
- Runtime: server started, `/` and `/settings` return 200, data survived a server restart, demo mode used a separate file and left personal data untouched.
- Browser (Playwright/Chromium): theme toggle works and persists across reload; **zero non-localhost requests** on page load; mobile drawer renders.

## Not yet verified
- Running on Windows (CMD) with a real `npm install` there: better-sqlite3 downloads a prebuilt Windows binary; if it can't, it needs the VS Build Tools (see README Troubleshooting).
- The pre-migration backup file copy itself is only exercised through the hook in tests; it will first run for real when migration 0002 ships.
- GitHub repo creation/push: no GitHub access was available.

## Known issues
- None blocking. `npm audit` may report advisories in dev tooling; not evaluated.
