# Development Progress

**Current phase:** 4 of 8 complete. Next: Phase 5.

## Phases 1-3: done
Foundation and demo mode; core ledger (accounts, income, expenses, transfers, reconciliation); debts, installments and bills. See git history.

## Phase 4: done (`feat: implement smart transaction capture`)
- **Catat Cepat:** offline Indonesian parser (all five spec examples, several transactions per input, dates, cash aliases, transfers), editable preview with warnings (missing account, duplicate, "will be recorded as installment payment"), post now or send to the inbox, explicit clipboard paste, favourite templates (create, reuse, delete, "make template" from a row).
- **Screenshot & receipt OCR:** drag/drop, file picker, explicit clipboard paste; multiple images per batch, one at a time with per-file status; extracts merchant, total, date, payment method, reference, admin fee; separates the total from balances/subtotals; shows confidence and reasons; account guessed from the payment method.
- **Statement import:** CSV (any delimiter, quotes), XLSX, text PDF (column-aware), scanned PDF and images (OCR). Column mapping UI with live preview, broken rows reported with row numbers, saved mapping templates, import history with error reports.
- **Smart Inbox:** tabs and counts per status, search, pagination, bulk approve/reject/categorize, single edit (with "remember this category" -> user rule), restore rejected, duplicate confirmation, per-item results for failures.
- **Merchant rules:** 92 defaults (Fore Coffee -> Kopi, PLN -> Listrik, Netflix -> Langganan Digital, ...), user rules win, manage in the Inbox ("Aturan merchant"), never overrides a category the user chose.
- **Duplicates and reconciliation:** duplicate flags against the ledger; installment, bill and transfer-pair suggestions; idempotent re-imports.
- Dashboard "Kotak masuk" card; demo data includes inbox items and a template; migration `0004_smart_capture.sql`.

## Verification (Linux sandbox, Node 22)
- `npm run typecheck`, `npm run lint`, `npm run check:offline`, `npm run build`: clean.
- `npm test`: **227 tests passing** across 12 files, including real OCR, PDF, XLSX and CSV fixtures (`tests/fixtures`, all fictional).
- **Offline proof:** the OCR/PDF/XLSX tests were re-run inside a network namespace with all outbound traffic cut; all 9 passed.
- Production server (`next start`) exercised through its API: OCR worker, text PDF, scanned PDF, XLSX, unsupported type rejected, cross-origin POST rejected.
- Browser E2E (Playwright/Chromium, clean database): setup of accounts/debt/bill; Quick Capture (rule categories, validation gating, edit-then-post, two transactions from one sentence, transfer, template round trip); two screenshots OCR'd in one batch and the same screenshot refused; CSV import with a broken row, same file refused, overlapping file (1 new, 7 skipped); inbox shows installment, bill and transfer-pair suggestions; duplicate flagged and excluded from bulk approval, approved only after confirmation; **installment recorded against the debt, bill occurrence settled, transfer posted once, balances reconcile to the rupiah**; correction saved as rule and applied to the next entry; text PDF (debit/credit apart), XLSX, scanned PDF flagged; import history with error report; persistence after restart; demo mode isolation; dark mode reviewed on the inbox.
- Real upgrade 3 -> 4 on a populated on-disk database: data intact, legacy inbox/batch rows get the new columns, 92 default rules installed, pre-migration backup created.

## Bugs found and fixed during verification
1. **State loss after revalidation:** the root `loading.tsx` caused Next.js to remount pages after server actions, wiping the Quick Capture preview/banner (and would have wiped inbox selections and result dialogs). Fixed by scoping skeletons to routes with disposable client state.
2. **Paired transfers were held in "needs review"** only because they had no category. They are now `new` when otherwise complete (test added).
(Other E2E failures were wrong expectations in the test script, not application bugs.)

## Not yet verified / known limitations
- **No real bank statements or real phone screenshots were available.** Parsing is verified on fictional CSV/XLSX/PDF files and clean synthetic receipt images. Real-world OCR accuracy on noisy screenshots will be lower; that is why uncertain records go to review. No bank-specific format is claimed.
- Windows CMD with a real `npm install` has not been run (OCR and PDF use WebAssembly, so only `better-sqlite3` is native).
- OCR text of receipts is stored in the database (`raw_payload`); treat the DB file as sensitive.
- The browser logs console errors for the intentional HTTP 409 responses (duplicate file/screenshot refused).
- Statement rows that mention an installment may be suggested against the next open installment even when imported into another account; the suggestion is visible and dismissible.
- Optional Ollama-based interpretation is Phase 7.
