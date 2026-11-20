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
10. **Balances count only dates <= today.** Future-dated entries are rejected rather than half-counted. Scheduled money is modeled separately (Phase 3/5).
11. **Archiving an account requires a zero balance.** Otherwise money would silently vanish from "Total kas".
12. **Reconciliation = adjustment row, not income/expense.** Keeps reports honest and the correction auditable. Needed migration 0002 (`adj_direction` + triggers).
13. **Transfer fee = separate expense row.** Makes spending reports and balance math each count it once.
14. **Transfers are not editable** (void and re-create). Transactions are editable for amount, date, account, category, text; the type is fixed once created.
15. **Recurring income is configuration only in Phase 2.** Nothing posts automatically (Phase 7) so projections never masquerade as actuals.
16. **Default categories ship in migration 0002** with `INSERT OR IGNORE`, so existing databases (including a Phase 1 demo.db) upgrade without conflicts. Users can add categories/subcategories (one level) and archive them.
17. **Amount input accepts Indonesian shorthand** (`25rb`, `9,5jt`, `1.250.000`) via `parseIDR`; stored values stay integers.
18. **Recharts** is used for the spending donut, with a text legend carrying the same data for accessibility.
