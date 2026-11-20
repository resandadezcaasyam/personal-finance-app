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
48. **The simulator reuses the forecast engine instead of a parallel model.** One-off outflows were added to the engine; Scenario A is the unmodified forecast so the two can never disagree.
49. **Installments due on or before the repayment date are paid as scheduled; the settlement covers the later ones.** It avoids double counting and matches how the forecast already places obligations.
50. **Savings are never assumed.** A rebate % or a provider quotation entered by the user is the only source; otherwise the scheduled interest is shown as an upper bound, explicitly not a promise. Partial payments assume no saving.
51. **Rebate applies to full settlements and to prepaid installments in the strategy comparison, not to partial payments** in the single-debt simulator, to avoid inventing contract behavior.
52. **Avalanche ranks by scheduled interest+fees per rupiah of remaining principal.** The stored interest rate is unreliable across models (flat, reducing, manual), so the ranking uses numbers that are in the schedule and shows them.
53. **Strategies prepay whole installments only,** with rollover of unspent budget, so costs and rebates stay exact.
54. **Recording a real settlement is separate, explicit and narrow:** full, dated today, no rebate/quotation, amount computed on the server. Other cases are explained and point to the debt page.
55. **Only the single-debt simulation can be saved;** strategy comparisons are recomputed from the URL (shareable) and not stored.
56. **Planned recurring entries are derived on demand, not generated into the database.** There is no background job and no GET that writes; idempotency is a unique (rule, due date) decision row plus a unique ledger `source_ref`.
57. **A new rule starts from its creation day.** No backlog of past months is created (that would flood the user); the window is also capped at 62 days back.
58. **Link instead of post when a matching transaction exists** (type, account, amount within 15%, within 5 days). It is the same convention the forecast uses for income already received.
59. **Pattern suggestions are conservative:** 3+ occurrences, steady rhythm and amount, still active, not already covered. Better to suggest little than to nag.
60. **Action priority:** money-at-risk items outrank bookkeeping. Found in testing: an old unconfirmed salary entry initially ranked above an overdue installment; unconfirmed income is now "medium" (low when due today).
61. **Budgets on top-level categories only,** with subcategories rolled up, so one rupiah is never counted in two budgets.
62. **Goals are earmarks, not transfers.** Simple, honest and reversible; a real savings account is just another account the user already tracks.
63. **Reports are computed on request from the ledger** (no stored aggregates), so they cannot drift; reconciliation tests guard it.
64. **Exports are GET downloads of the same numbers**, generated locally; PDF via pdf-lib (no browser/headless dependency).
65. **Optional AI is a convenience, never a dependency:** off by default, local only, names-only context, validated output, automatic fallback. A tampered non-local URL in the database disables it.
66. **Reconciling to an already-correct balance is recorded** (audit entry, no transaction), so "verified today" clears the reconciliation reminder.
67. **The PIN guard sits in `getDb()`, not in middleware or the UI.** Pages, server actions and routes all reach data through it, so no new code path can forget the check; middleware cannot read the auth file (Edge runtime) and a UI-only gate would be bypassable.
68. **Auth state is a file outside the database.** Restoring an old backup must never disable or change the PIN, and the demo/personal switch must not bypass it.
69. **The PIN is honestly not encryption.** Documented in the UI, README and SECURITY.md; the realistic advice is disk encryption.
70. **Lockout persists on disk with exponential backoff (30 s up to 15 min)**; a locked app refuses even the right PIN, so guessing cannot continue by waiting for the right moment.
71. **Backups use `VACUUM INTO`**, never a raw copy of a WAL database; backup names from the browser are plain file names inside one folder.
72. **Restore is validate -> pre-restore backup -> swap -> reopen, with automatic rollback.** A refused restore changes nothing.
73. **Integrity checks include financial invariants, not only SQLite's**, because a database can be structurally fine and financially inconsistent.
74. **E2E runs against the production build with a throw-away data folder and always rebuilds** (a stale build once hid missing pages). Every test fails on a non-localhost request.
75. **Accessibility is tested in the suite (axe, both themes) and fixed in the product** (contrast of the warning color, chart focus, drop zone, calendar semantics, scroll regions, ids without spaces) instead of being waived.
76. **Verify the effect, not only its absence.** A Phase 7 manual test passed while "link a transaction" never worked, because it only checked that balances did not change. E2E tests now assert the intended outcome (and include positive controls).
