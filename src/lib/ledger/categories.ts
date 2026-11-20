import type Database from "better-sqlite3";
import { writeAudit } from "./audit";
import { LedgerError } from "./errors";
import type { CategoryRow } from "./types";

export function listCategories(db: Database.Database, opts: { includeArchived?: boolean } = {}): CategoryRow[] {
  const where = opts.includeArchived ? "" : "WHERE is_archived = 0";
  return db.prepare(`SELECT * FROM categories ${where} ORDER BY kind DESC, COALESCE(parent_id, id), parent_id IS NOT NULL, name COLLATE NOCASE`).all() as CategoryRow[];
}

export function findCategoryId(db: Database.Database, name: string, kind: "income" | "expense"): number | null {
  const r = db.prepare("SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND kind = ? AND is_archived = 0 ORDER BY parent_id IS NOT NULL LIMIT 1").get(name, kind) as { id: number } | undefined;
  return r?.id ?? null;
}

export function createCategory(db: Database.Database, input: { name: string; kind: "income" | "expense"; parent_id?: number | null }): number {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new LedgerError("Nama kategori wajib diisi.", "name");
  if (name.length > 50) throw new LedgerError("Nama kategori maksimal 50 karakter.", "name");
  const parentId = input.parent_id ?? null;
  if (parentId !== null) {
    const p = db.prepare("SELECT * FROM categories WHERE id = ?").get(parentId) as CategoryRow | undefined;
    if (!p) throw new LedgerError("Kategori induk tidak ditemukan.", "parent_id");
    if (p.parent_id !== null) throw new LedgerError("Subkategori hanya boleh satu tingkat.", "parent_id");
    if (p.kind !== input.kind) throw new LedgerError("Jenis subkategori harus sama dengan kategori induk.", "kind");
  }
  try {
    return db.transaction(() => {
      const id = Number(db.prepare("INSERT INTO categories (name, kind, parent_id) VALUES (?,?,?)").run(name, input.kind, parentId).lastInsertRowid);
      writeAudit(db, "category", id, "create", null, { name, kind: input.kind, parent_id: parentId });
      return id;
    })();
  } catch (e) {
    if (e instanceof Error && "code" in e && (e as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new LedgerError("Kategori dengan nama tersebut sudah ada.", "name");
    throw e;
  }
}

/** Archived categories disappear from pickers; existing transactions keep their category. */
export function setCategoryArchived(db: Database.Database, id: number, archived: boolean) {
  db.transaction(() => {
    db.prepare("UPDATE categories SET is_archived = ? WHERE id = ? OR parent_id = ?").run(archived ? 1 : 0, id, id);
    writeAudit(db, "category", id, archived ? "archive" : "restore", null, { is_archived: archived });
  })();
}

/** Ids of a category plus its subcategories, for filtering by a parent. */
export function categoryAndChildren(db: Database.Database, id: number): number[] {
  return (db.prepare("SELECT id FROM categories WHERE id = ? OR parent_id = ?").all(id, id) as { id: number }[]).map((r) => r.id);
}
