import type Database from "better-sqlite3";

export function getSetting(db: Database.Database, key: string): string | null {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return r?.value ?? null;
}

export function setSetting(db: Database.Database, key: string, value: string) {
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?,?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(key, value);
}

export function deleteSetting(db: Database.Database, key: string) {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}
