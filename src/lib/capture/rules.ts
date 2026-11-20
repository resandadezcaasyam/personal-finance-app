import type Database from "better-sqlite3";
import { writeAudit } from "../ledger/audit";
import { LedgerError } from "../ledger/errors";
import { containsPhrase, normalizeText } from "./text";
export { suggestPattern } from "./text";
import type { RuleHit } from "./nl-parser";

export interface RuleRow {
  id: number; pattern: string; merchant_name: string | null; kind: "income" | "expense" | null; category_id: number | null;
  source: "default" | "user"; is_active: number; category_name: string | null;
}

export function listRules(db: Database.Database): RuleRow[] {
  return db.prepare(
    `SELECT r.*, c.name AS category_name FROM merchant_rules r LEFT JOIN categories c ON c.id = r.category_id
     ORDER BY (r.source = 'user') DESC, r.kind, r.pattern`,
  ).all() as RuleRow[];
}

/**
 * Build a matcher from the active rules. User rules always beat default rules; within a source, the longest
 * (most specific) pattern wins. A rule only applies if its category kind matches the transaction type.
 */
export function loadMatcher(db: Database.Database): (text: string, kind: "income" | "expense") => RuleHit | null {
  const rules = (db.prepare(
    `SELECT r.pattern, r.merchant_name, r.kind, r.category_id, r.source, c.kind AS cat_kind
     FROM merchant_rules r LEFT JOIN categories c ON c.id = r.category_id
     WHERE r.is_active = 1 AND (c.id IS NULL OR c.is_archived = 0)`,
  ).all() as { pattern: string; merchant_name: string | null; kind: string | null; category_id: number | null; source: string; cat_kind: string | null }[])
    .sort((a, b) => (a.source === b.source ? b.pattern.length - a.pattern.length : a.source === "user" ? -1 : 1));
  return (text, kind) => {
    const norm = normalizeText(text);
    for (const r of rules) {
      if ((r.kind ?? r.cat_kind ?? kind) !== kind) continue;
      if (r.cat_kind && r.cat_kind !== kind) continue;
      if (containsPhrase(norm, r.pattern)) return { category_id: r.category_id, merchant: r.merchant_name };
    }
    return null;
  };
}

export function createUserRule(db: Database.Database, input: { pattern: string; merchant_name?: string | null; kind: "income" | "expense"; category_id: number }): number {
  const pattern = normalizeText(input.pattern);
  if (pattern.length < 3) throw new LedgerError("Pola aturan minimal 3 huruf.", "pattern");
  if (pattern.length > 60) throw new LedgerError("Pola aturan maksimal 60 karakter.", "pattern");
  const cat = db.prepare("SELECT kind, is_archived FROM categories WHERE id = ?").get(input.category_id) as { kind: string; is_archived: number } | undefined;
  if (!cat) throw new LedgerError("Kategori tidak ditemukan.", "category_id");
  if (cat.kind !== input.kind) throw new LedgerError("Jenis kategori tidak sesuai dengan jenis transaksi.", "category_id");
  const merchant = input.merchant_name?.trim() || null;
  return db.transaction(() => {
    db.prepare(
      `INSERT INTO merchant_rules (pattern, merchant_name, kind, category_id, source, is_active) VALUES (?,?,?,?, 'user', 1)
       ON CONFLICT (pattern, COALESCE(kind,''), source) DO UPDATE SET merchant_name = excluded.merchant_name, category_id = excluded.category_id, is_active = 1`,
    ).run(pattern, merchant, input.kind, input.category_id);
    const id = (db.prepare("SELECT id FROM merchant_rules WHERE pattern = ? AND kind = ? AND source = 'user'").get(pattern, input.kind) as { id: number }).id;
    writeAudit(db, "merchant_rule", id, "save", null, { pattern, merchant, kind: input.kind, category_id: input.category_id });
    return id;
  })();
}

export function setRuleActive(db: Database.Database, id: number, active: boolean) {
  db.transaction(() => {
    db.prepare("UPDATE merchant_rules SET is_active = ? WHERE id = ?").run(active ? 1 : 0, id);
    writeAudit(db, "merchant_rule", id, active ? "activate" : "deactivate", null, null);
  })();
}

/** Only rules the user created can be deleted; built-in ones can be switched off. */
export function deleteUserRule(db: Database.Database, id: number) {
  const r = db.prepare("SELECT source FROM merchant_rules WHERE id = ?").get(id) as { source: string } | undefined;
  if (!r) throw new LedgerError("Aturan tidak ditemukan.");
  if (r.source !== "user") throw new LedgerError("Aturan bawaan tidak dapat dihapus, hanya dinonaktifkan.");
  db.transaction(() => {
    db.prepare("DELETE FROM merchant_rules WHERE id = ?").run(id);
    writeAudit(db, "merchant_rule", id, "delete", null, null);
  })();
}
