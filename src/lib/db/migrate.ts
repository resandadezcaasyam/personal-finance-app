import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

/** Load numbered .sql files (0001_name.sql) from a directory, sorted by version. */
export function loadMigrations(dir: string): Migration[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      return {
        version: parseInt(file.slice(0, 4), 10),
        name: file.replace(/\.sql$/, ""),
        sql,
        checksum: crypto.createHash("sha256").update(sql).digest("hex"),
      };
    });
}

export interface MigrateOptions {
  /** Called before pending migrations run, only when the DB already holds applied migrations. */
  backup?: () => void;
}

/**
 * Apply pending migrations. Each migration runs in its own transaction.
 * Existing data is never dropped; applied migrations are verified by checksum.
 */
export function migrate(db: Database.Database, migrations: Migration[], opts: MigrateOptions = {}): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const applied = new Map<number, string>(
    (db.prepare("SELECT version, checksum FROM schema_migrations").all() as { version: number; checksum: string }[]).map(
      (r) => [r.version, r.checksum],
    ),
  );
  for (const m of migrations) {
    const prev = applied.get(m.version);
    if (prev && prev !== m.checksum) {
      throw new Error(`Migration ${m.name} was modified after being applied. Add a new migration instead.`);
    }
  }
  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length === 0) return [];
  if (applied.size > 0 && opts.backup) opts.backup();

  const ran: number[] = [];
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, checksum) VALUES (?,?,?)").run(m.version, m.name, m.checksum);
    })();
    ran.push(m.version);
  }
  return ran;
}
