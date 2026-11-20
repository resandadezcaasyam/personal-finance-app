# Handoff: Phase 4: Smart Transaction Capture & Automation

Read `ARCHITECTURE.md` (Phase 2 and Phase 3 rules) and migrations 0001-0003 first. Do not recreate the project. This is the HIGH-PRIORITY phase for reducing manual entry.

## Build (see spec Part 4, Phase 4)
1. Natural-language Quick Capture (`kopi 25rb gopay`, multiple transactions per line) with an offline deterministic parser (reuse `parseIDR`), editable previews, then post.
2. Screenshot/receipt OCR (offline engine), batch upload, confidence, merchant/amount/date/reference/fee extraction.
3. Bulk statement import: CSV, XLSX, text PDF, scanned PDF via OCR; bank templates, column mapping, preview, import history.
4. Smart Transaction Inbox (`inbox_items`, statuses new / needs_review / potential_duplicate / approved / rejected). Only approved items touch the ledger.
5. Merchant auto-categorization rules (user-correctable, never override explicit choices), duplicate detection, favorite templates, explicit clipboard paste.
6. Transfer matching and **installment/bill matching**.
7. Activate `/quick-capture`, `/inbox`, `/import` (`CURRENT_PHASE = 4` in `src/lib/nav.ts`).

## Existing pieces to build on
- Tables already exist: `import_batches` (unique `file_hash`), `inbox_items` (unique `fingerprint`, `raw_payload`, `confidence`, `posted_transaction_id`). Add `0004_*.sql` for what is missing (merchant rules, favorite templates, maybe import templates). Never edit 0001-0003 (checksums enforced).
- Posting an approved inbox item must go through the existing domain functions, not raw inserts:
  - expense/income -> `createTransaction` with `source` + `source_ref` (the unique `(source, source_ref)` index makes re-imports idempotent);
  - transfer between own accounts -> `createTransfer`;
  - an imported payment matching a scheduled installment -> `recordDebtPayment` (NOT a new expense; that would double count);
  - an imported payment matching a bill occurrence -> `payBill`.
  Matching candidates: `listObligations` / `installment_schedules` / `bills.next_due_date`.
- The ledger rejects future-dated transactions and archived accounts; surface those as review issues.
- `parseIDR` already understands `25rb`, `9,5jt`, `1.250.000`; `todayWIB`/`shiftDate` for relative dates (hari ini, kemarin).
- Server-action helpers live in `src/app/actions/shared.ts`. For flows that navigate after success use `redirect()` inside the action.

## Constraints and risks
- Everything must work offline after `npm install`: any OCR/PDF library must ship its models/language data locally (no CDN download at runtime). Verify with the Playwright request log (`external requests: []`). Decide how Tesseract language data is bundled and document it in README (Windows).
- Uploaded files and statements must stay out of Git (`.gitignore` already covers `uploads/`, `statements/`, `receipts/`).
- Never silently override a user's category/account choice; flag uncertain records instead of dropping duplicates.
- Do not claim OCR/import support for a bank format without a real sample or a test fixture.

## Tests to write
Parser (amounts, dates, accounts, multi-item), import idempotency (same file twice, same row twice), duplicate/potential-duplicate flagging, inbox approval posting once, installment/bill matching posts no extra expense, rule learning from corrections.

## Finish
tests, typecheck, lint, build, browser check; commit `feat: implement smart transaction capture`; update these docs.
