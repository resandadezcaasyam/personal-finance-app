import type Database from "better-sqlite3";
import { LedgerError } from "../ledger/errors";
import { createTransfer } from "../ledger/transfers";
import { todayWIB } from "../format";
import { approveInboxItems, createInboxItems, type NewInboxItem } from "../inbox/inbox";
import type { RuleHit } from "./nl-parser";

/** A draft as confirmed by the user in the preview (amount already a number). */
export interface ConfirmedDraft {
  type: "expense" | "income" | "transfer";
  amount: number | null;
  occurred_on: string;
  description: string;
  merchant: string | null;
  account_id: number | null;
  to_account_id: number | null;
  category_id: number | null;
  category_source: "rule" | "user" | "parser" | null;
  confidence: number;
}

export interface PostResult { posted: number; queued: number }

/**
 * Quick Capture -> ledger or inbox, all or nothing.
 * - 'now'  : each draft is queued and immediately approved through the same pipeline as the inbox, so duplicate
 *            checks, installment/bill matching and posting rules are identical. Any failure rolls everything back.
 * - 'inbox': drafts are only queued for later review. Transfers must be posted directly.
 */
export function postDrafts(db: Database.Database, drafts: ConfirmedDraft[], mode: "now" | "inbox", opts: { matcher?: (t: string, k: "income" | "expense") => RuleHit | null; today?: string } = {}): PostResult {
  const today = opts.today ?? todayWIB();
  if (drafts.length === 0) throw new LedgerError("Tidak ada transaksi untuk dicatat.");
  if (drafts.length > 100) throw new LedgerError("Maksimal 100 transaksi sekali kirim.");
  return db.transaction(() => {
    let posted = 0, queued = 0;
    const regular: ConfirmedDraft[] = [];
    drafts.forEach((d, i) => {
      if (d.type === "transfer") {
        if (mode === "inbox") throw new LedgerError(`Baris ${i + 1}: transfer tidak bisa dikirim ke kotak masuk. Gunakan "Catat sekarang".`);
        if (!d.account_id || !d.to_account_id) throw new LedgerError(`Baris ${i + 1}: akun asal dan tujuan wajib dipilih.`);
        if (!d.amount) throw new LedgerError(`Baris ${i + 1}: nominal wajib diisi.`);
        createTransfer(db, { from_account_id: d.account_id, to_account_id: d.to_account_id, amount: d.amount, occurred_on: d.occurred_on, description: d.description === "Transfer" ? "" : d.description }, { today });
        posted++;
      } else regular.push(d);
    });
    const items: NewInboxItem[] = regular.map((d) => ({
      type: d.type as "income" | "expense", amount: d.amount, occurred_on: d.occurred_on, description: d.description, merchant: d.merchant, account_id: d.account_id,
      category_id: d.category_id, category_source: d.category_source, confidence: mode === "now" ? 1 : d.confidence, source_kind: "quick_capture",
    }));
    if (items.length) {
      const res = createInboxItems(db, items, { matcher: opts.matcher, today });
      if (mode === "inbox") queued += res.created;
      else {
        const out = approveInboxItems(db, res.ids, { today, includeDuplicates: true });
        const bad = out.filter((r) => !r.ok);
        if (bad.length) {
          const idx = bad.map((b) => `baris ${res.ids.indexOf(b.id) + 1}: ${b.error}`);
          throw new LedgerError(`Tidak ada yang dicatat karena ${idx.join("; ")}`);
        }
        posted += out.length;
      }
    }
    return { posted, queued };
  })();
}
