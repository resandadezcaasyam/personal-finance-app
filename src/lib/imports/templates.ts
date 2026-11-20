import type Database from "better-sqlite3";
import { LedgerError } from "../ledger/errors";
import { EMPTY_MAPPING, type Mapping } from "./table";

export interface ImportTemplateRow { id: number; name: string; header_signature: string; mapping: Mapping }

export function listImportTemplates(db: Database.Database): ImportTemplateRow[] {
  return (db.prepare("SELECT * FROM import_templates ORDER BY name COLLATE NOCASE").all() as { id: number; name: string; header_signature: string; mapping_json: string }[])
    .map((r) => ({ id: r.id, name: r.name, header_signature: r.header_signature, mapping: { ...EMPTY_MAPPING, ...(JSON.parse(r.mapping_json) as Partial<Mapping>) } }));
}

export function createImportTemplate(db: Database.Database, name: string, signature: string, mapping: Mapping): number {
  const n = name.trim();
  if (!n || n.length > 40) throw new LedgerError("Nama template 1 sampai 40 karakter.", "name");
  try {
    return Number(db.prepare("INSERT INTO import_templates (name, header_signature, mapping_json) VALUES (?,?,?)").run(n, signature, JSON.stringify(mapping)).lastInsertRowid);
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new LedgerError("Sudah ada template dengan nama tersebut.", "name");
    throw e;
  }
}

export function deleteImportTemplate(db: Database.Database, id: number) {
  db.prepare("DELETE FROM import_templates WHERE id = ?").run(id);
}
