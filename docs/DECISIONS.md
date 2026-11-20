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
19. **One expense per debt payment, with penalty and fee folded in.** The split stays in `debt_payments` (amount/penalty/fee); the ledger shows a single cash movement and cannot double count. Cost: spending reports show it under "Cicilan & Utang" rather than separating penalties.
20. **Payments allocate oldest-first and may span installments**, tracked in `debt_payment_allocations`. A single `schedule_id` per payment could not be reversed exactly.
21. **Remaining principal is derived** with fees -> interest -> principal ordering inside each installment. This is a convention; if a provider applies payments differently, the figure is an estimate. The UI never claims contractual interest savings.
22. **Interest model formulas are conventions, with `manual` as the escape hatch.** Providers differ; we do not guess contract rules.
23. **Past-due installments are allowed at creation** (the debt may already be running). `already_paid_count` marks earlier installments paid without touching balances.
24. **Debt schedule is immutable after creation** to keep history consistent; mistakes are fixed by cancelling (no payments) or voiding payments.
25. **Bill payment history keeps one settlement per occurrence** (DB-enforced) and only the newest can be undone, so due dates cannot become inconsistent.
26. **"Early" payment needs a 7-day margin** so paying a few days ahead of the due date is not mislabelled.
27. **Calendar projections are labelled.** Future bill occurrences are extrapolated, shown dashed/"Proyeksi", and excluded from totals of what is actually owed.
28. **The inbox is the only door to the ledger.** Even typed Quick Capture goes through it ("Catat sekarang" = queue + approve in one transaction). One posting path means matching, duplicate checks and validation cannot be bypassed.
29. **Fingerprints include an occurrence counter** for identical lines, so genuine repeat purchases survive while overlapping statements still dedupe.
30. **Duplicates are flagged, never deleted or auto-posted.** Bulk approval excludes them; approving one needs an explicit confirmation.
31. **Suggested matches apply by default but are re-validated at approval and can be dismissed.** Ambiguity produces no suggestion. This favors not creating a second expense for an obligation.
32. **No bank-specific templates are claimed.** Without real statement samples we ship generic header detection and user-saved mapping templates, and say so. Add built-in presets only from real files.
33. **Direction inference never guesses.** Rows whose direction cannot be derived (no sign/marker/debit-credit/previous balance) are reported as errors with the original row number.
34. **Scanned PDFs and weak OCR are always `needs_review`;** confident receipts become `new`. Observed in testing: OCR read "QRIS" as "ORIS" on a scanned page, which is why review is mandatory there.
35. **Images are never stored.** Only the hash (idempotency) and extracted text are kept. The recognized text can contain personal details, so the database file should be treated as sensitive (Phase 8 covers backup/PIN guidance).
36. **Library choices:** `tesseract.js` (WebAssembly, no native build on Windows) with npm-packaged language data (no runtime download); `pdfjs-dist` for positional text and `@hyzyla/pdfium` to render scanned pages (pdfjs needs a native canvas to render); `read-excel-file` instead of the npm `xlsx` package (known advisories); `pngjs` to encode renders.
37. **Categories are optional for approval.** `needs_review` is advisory; the user decides.
38. **No root `loading.tsx`** (see Architecture, Phase 4 pitfall).
39. **Clipboard access is explicit only:** buttons call the clipboard API on click, and the image drop zone accepts Ctrl+V only while focused.
40. **Forecast is computed on request, never stored as fact.** Nothing about it is persisted except user-saved assumptions, so it can never disagree with the ledger.
41. **Today's income and spending are not projected.** The opening cash already includes today's actuals; projecting today's salary again would double count. Obligations due today/overdue are still projected because they are unpaid.
42. **Habitual spending is a single historical daily average**, excluding obligations and non-spending rows. It is simple and explainable; it ignores seasonality and one-off large expenses, which the page states.
43. **Unknown amounts are visible, not hidden:** variable bills without history count as Rp 0 and are listed as such.
44. **Scenarios are five transparent knobs**, not a model. Presets are conventions (documented), custom values are clamped (income 0-200%, spending 0-300%, delay 0-30 days).
45. **Payday survival is conservative about order:** it checks the lowest point on the way to payday, not only the balance on that day. Safe-to-spend uses only income and scheduled obligations so it answers "how much can I spend", not "how much do I usually spend".
46. **Actual history on the chart is the total of accounts active now**, reconstructed from the ledger; money that moved to an archived account is not part of it.
47. **Saved scenarios keep assumptions + a snapshot**; re-opening recomputes with today's data (a snapshot is for reference only).
