import type Database from "better-sqlite3";
import { writeAudit } from "../ledger/audit";
import { LedgerError } from "../ledger/errors";
import { requireActiveAccount } from "../ledger/accounts";
import { assertAmount } from "../ledger/validate";

export interface TemplateRow {
  id: number; name: string; type: "income" | "expense"; amount: number | null; account_id: number | null; category_id: number | null;
  description: string; merchant: string | null; sort_order: number; account_name: string | null; category_name: string | null;
}

export function listTemplates(db: Database.Database): TemplateRow[] {
  return db.prepare(
    `SELECT t.*, a.name AS account_name, c.name AS category_name FROM favorite_templates t
     LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id ORDER BY t.sort_order, t.name COLLATE NOCASE`,
  ).all() as TemplateRow[];
}

export interface TemplateInput { name: string; type: "income" | "expense"; amount: number | null; account_id: number | null; category_id: number | null; description: string; merchant?: string | null }

export function createTemplate(db: Database.Database, i: TemplateInput): number {
  const name = i.name.trim().replace(/\s+/g, " ");
  if (!name) throw new LedgerError("Nama template wajib diisi.", "name");
  if (name.length > 40) throw new LedgerError("Nama template maksimal 40 karakter.", "name");
  if (i.amount !== null) assertAmount(i.amount, "amount");
  if (i.account_id) requireActiveAccount(db, i.account_id, "account_id");
  if (i.category_id) {
    const c = db.prepare("SELECT kind FROM categories WHERE id = ?").get(i.category_id) as { kind: string } | undefined;
    if (!c || c.kind !== i.type) throw new LedgerError("Kategori tidak sesuai dengan jenis template.", "category_id");
  }
  try {
    return db.transaction(() => {
      const next = (db.prepare("SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM favorite_templates").get() as { n: number }).n;
      const id = Number(
        db.prepare("INSERT INTO favorite_templates (name, type, amount, account_id, category_id, description, merchant, sort_order) VALUES (?,?,?,?,?,?,?,?)")
          .run(name, i.type, i.amount, i.account_id, i.category_id, i.description.trim().slice(0, 200), i.merchant?.trim() || null, next).lastInsertRowid,
      );
      writeAudit(db, "template", id, "create", null, { ...i, name });
      return id;
    })();
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new LedgerError("Sudah ada template dengan nama tersebut.", "name");
    throw e;
  }
}

export function deleteTemplate(db: Database.Database, id: number) {
  db.transaction(() => {
    db.prepare("DELETE FROM favorite_templates WHERE id = ?").run(id);
    writeAudit(db, "template", id, "delete", null, null);
  })();
}
