import type Database from "better-sqlite3";
import { LedgerError } from "../ledger/errors";
import { requireActiveAccount } from "../ledger/accounts";
import { todayWIB } from "../format";
import { normalizeText } from "../capture/text";
import type { RuleHit } from "../capture/nl-parser";
import type { ReceiptResult } from "../capture/receipt";
import type { NormalizedRow, RowError } from "../imports/table";
import { createBatch, createInboxItems, finalizeBatch, type NewInboxItem } from "./inbox";
import { lineFingerprint, receiptFingerprint } from "./fingerprint";

type Matcher = (text: string, kind: "income" | "expense") => RuleHit | null;

export interface ImportSummary { batchId: number; imported: number; duplicates: number; errors: RowError[]; skippedRows: number; needsReview: number }

/**
 * Turn normalized statement rows into inbox items inside one batch. Nothing touches the ledger here.
 * Re-importing the same file is refused (file hash); re-importing an overlapping statement skips lines that already
 * exist (line fingerprints), so the same transaction is never queued twice.
 */
export function commitStatementImport(
  db: Database.Database,
  p: { sourceType: "csv" | "xlsx" | "pdf"; fileName: string | null; fileHash: string | null; accountId: number; rows: NormalizedRow[]; errors: RowError[]; skipped: number; ocr?: boolean; matcher?: Matcher; today?: string },
): ImportSummary {
  requireActiveAccount(db, p.accountId, "account_id");
  if (p.rows.length === 0 && p.errors.length === 0) throw new LedgerError("Tidak ada transaksi yang dapat diimpor dari file ini.");
  return db.transaction(() => {
    const batchId = createBatch(db, { source_type: p.sourceType, file_name: p.fileName, file_hash: p.fileHash, account_id: p.accountId, row_count: p.rows.length + p.errors.length });
    const seen = new Map<string, number>();
    const items: NewInboxItem[] = p.rows.map((r) => {
      const key = `${r.occurred_on}|${r.amount}|${r.type}|${normalizeText(r.description)}`;
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      return {
        type: r.type, amount: r.amount, occurred_on: r.occurred_on, description: r.description || "(tanpa keterangan)", account_id: p.accountId, category_id: null,
        fingerprint: lineFingerprint({ account_id: p.accountId, occurred_on: r.occurred_on, amount: r.amount, type: r.type, description: r.description, reference: r.reference, occurrence }),
        source_ref: r.reference, confidence: p.ocr ? 0.6 : 0.9, forceReview: !!p.ocr, source_kind: p.sourceType, note: p.ocr ? "Dibaca dengan OCR, periksa nominal dan tanggal." : null,
        raw_payload: { row_no: r.row_no, balance: r.balance },
      };
    });
    const res = createInboxItems(db, items, { batchId, matcher: p.matcher, today: p.today });
    finalizeBatch(db, batchId, { imported: res.created, duplicates: res.skippedDuplicates, errors: p.errors });
    const needsReview = res.ids.length ? (db.prepare(`SELECT COUNT(*) AS n FROM inbox_items WHERE id IN (${res.ids.join(",")}) AND status <> 'new'`).get() as { n: number }).n : 0;
    return { batchId, imported: res.created, duplicates: res.skippedDuplicates, errors: p.errors, skippedRows: p.skipped, needsReview };
  })();
}

/** Match a detected payment method ("gopay", "bca") to one of the user's accounts by name. */
export function guessAccountFromMethod(db: Database.Database, method: string | null): number | null {
  if (!method) return null;
  const accounts = db.prepare("SELECT id, name FROM accounts WHERE is_archived = 0").all() as { id: number; name: string }[];
  const hits = accounts.filter((a) => normalizeText(a.name).split(" ").includes(method));
  return hits.length === 1 ? hits[0].id : null;
}

export function commitReceipt(
  db: Database.Database,
  p: { fileName: string | null; fileHash: string; extraction: ReceiptResult; ocrText: string; accountId?: number | null; matcher?: Matcher; today?: string },
): { batchId: number; itemId: number; created: boolean } {
  const ex = p.extraction;
  const account = p.accountId ?? guessAccountFromMethod(db, ex.payment_method);
  return db.transaction(() => {
    const batchId = createBatch(db, { source_type: "ocr", file_name: p.fileName, file_hash: p.fileHash, account_id: account, row_count: 1 });
    const notes = [
      ex.fee ? `Biaya admin/layanan terdeteksi ${ex.fee.toLocaleString("id-ID")}.` : null,
      ex.amount_source ? `Nominal diambil dari ${ex.amount_source}.` : null,
      ...ex.issues,
    ].filter(Boolean).join(" ");
    const fingerprint = ex.reference && ex.amount ? receiptFingerprint(ex.reference, ex.amount) : null;
    const res = createInboxItems(db, [{
      type: ex.type, amount: ex.amount, occurred_on: ex.occurred_on, description: ex.merchant ?? "Struk (periksa keterangan)", merchant: ex.merchant, account_id: account, category_id: null,
      fingerprint, source_ref: ex.reference, confidence: ex.confidence, forceReview: ex.issues.length > 0, source_kind: "ocr", note: notes || null,
      raw_payload: { text: p.ocrText.slice(0, 2000), fields: ex.fields, payment_method: ex.payment_method },
    }], { batchId, matcher: p.matcher, today: p.today ?? todayWIB() });
    finalizeBatch(db, batchId, { imported: res.created, duplicates: res.skippedDuplicates, errors: [] });
    return { batchId, itemId: res.ids[0] ?? 0, created: res.created > 0 };
  })();
}
