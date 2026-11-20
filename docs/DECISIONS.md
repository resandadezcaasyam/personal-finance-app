# Decisions

1. **better-sqlite3 + SQL migrations instead of Drizzle.** The spec allows "Drizzle or equivalent". Plain SQL files plus a small runner avoid a second schema definition to keep in sync, and need no codegen step on Windows. Typed query helpers will be added per module. Revisit if query volume makes an ORM worthwhile.
2. **Next.js 14.2.35, Tailwind 3.** Chosen for stability; 14.2.35 is a patched release (earlier 14.2.x have published advisories).
3. **UI primitives hand-written, not via shadcn CLI.** Keeps installs offline-friendly and the dependency list short; same API style so shadcn components can be dropped in later.
4. **Native `<dialog>` for dialogs.** Built-in focus handling and Esc behaviour, no extra dependency.
5. **Derived balances.** Stored balances drift; derive from the ledger (Phase 2).
6. **Phase-gated navigation.** Future routes are shown disabled with their phase (F2…F7) and have no pages, so nothing unfinished looks finished.
7. **Dashboard shows "—" not zeros** for metrics until real data exists.
8. **IDR stored as whole rupiah.** No minor unit in practice.
9. **Indonesian UI strings inline** (no i18n framework) since Indonesian is the only default language.
