import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Migration as MigrationFile } from "../db/migrate";
import { LedgerError } from "../ledger/errors";

/**
 * Local backups. A backup is a complete, consistent SQLite file made with VACUUM INTO (safe while the database is in use,
 * unlike copying a WAL database file). Restoring always makes a pre-restore backup first and rolls back if anything fails.
 * Backups are ordinary files containing all financial data: store them like the database itself.
 */
export type BackupKind = "manual" | "pre-restore" | "pre-migration" | "other";
export interface BackupInfo { name: string; kind: BackupKind; sizeBytes: number; createdAt: string }

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(db|bak)$/;
const kindOf = (n: string): BackupKind => (n.includes(".pre-migration-") ? "pre-migration" : /^finance-.*-pre-restore\.db$/.test(n) ? "pre-restore" : /^finance-.*-manual\.db$/.test(n) ? "manual" : "other");

/** The only way a file name from a browser becomes a path: a plain file name inside the backup folder, nothing else. */
export function safeBackupPath(dir: string, name: string): string {
  if (!NAME.test(name) || name.includes("..")) throw new LedgerError("Nama cadangan tidak valid.");
  const full = path.join(dir, name);
  if (path.dirname(path.resolve(full)) !== path.resolve(dir)) throw new LedgerError("Nama cadangan tidak valid.");
  if (!fs.existsSync(full)) throw new LedgerError("Cadangan tidak ditemukan.");
  return full;
}

export function listBackups(dir: string): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => NAME.test(n)).map((name) => {
    const st = fs.statSync(path.join(dir, name));
    return { name, kind: kindOf(name), sizeBytes: st.size, createdAt: st.mtime.toISOString() };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");

export function createBackup(db: Database.Database, dir: string, kind: "manual" | "pre-restore" = "manual", now: Date = new Date()): BackupInfo {
  fs.mkdirSync(dir, { recursive: true });
  const name = `finance-${stamp(now)}-${kind}.db`;
  const full = path.join(dir, name);
  if (fs.existsSync(full)) throw new LedgerError("Cadangan dengan nama yang sama sudah ada. Coba lagi sebentar lagi.");
  db.exec(`VACUUM INTO '${full.replace(/'/g, "''")}'`);
  const st = fs.statSync(full);
  return { name, kind, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
}

export interface BackupCheck {
  ok: boolean;
  problems: string[];
  schemaVersion: number | null;
  accounts: number;
  transactions: number;
  newerThanApp: boolean;
}

/** Opens the file read-only and checks it is a healthy database of this app, not newer than this version, with untouched migrations. */
export function validateBackupFile(file: string, known: Pick<MigrationFile, "version" | "checksum">[]): BackupCheck {
  const bad = (problems: string[], extra: Partial<BackupCheck> = {}): BackupCheck => ({ ok: false, problems, schemaVersion: null, accounts: 0, transactions: 0, newerThanApp: false, ...extra });
  let db: Database.Database;
  try { db = new Database(file, { readonly: true, fileMustExist: true }); } catch { return bad(["Berkas bukan basis data SQLite yang valid."]); }
  try {
    const problems: string[] = [];
    let integrity: string[];
    try { integrity = (db.pragma("integrity_check") as { integrity_check: string }[]).map((r) => r.integrity_check); } catch { return bad(["Berkas rusak dan tidak bisa diperiksa."]); }
    if (!(integrity.length === 1 && integrity[0] === "ok")) problems.push(`Pemeriksaan integritas gagal: ${integrity.slice(0, 2).join("; ")}`);
    const fk = (db.pragma("foreign_key_check") as unknown[]).length;
    if (fk) problems.push(`${fk} pelanggaran keterkaitan data.`);
    const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(t);
    if (!has("schema_migrations") || !has("accounts") || !has("transactions")) return bad([...problems, "Ini bukan basis data Personal Finance OS."]);
    const rows = db.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version").all() as { version: number; checksum: string }[];
    const latest = Math.max(0, ...known.map((k) => k.version));
    const version = rows.length ? Math.max(...rows.map((r) => r.version)) : 0;
    const newer = version > latest;
    if (newer) problems.push(`Cadangan dibuat oleh versi aplikasi yang lebih baru (skema ${version}, aplikasi ini ${latest}).`);
    for (const r of rows) {
      const k = known.find((x) => x.version === r.version);
      if (k && k.checksum !== r.checksum) problems.push(`Migrasi ${r.version} pada cadangan berbeda dari aplikasi ini.`);
    }
    const n = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
    return { ok: problems.length === 0, problems, schemaVersion: version, accounts: n("accounts"), transactions: n("transactions"), newerThanApp: newer };
  } finally { db.close(); }
}

export interface RestoreHooks {
  /** Close the live handle before the file is replaced. */
  close: () => void;
  /** Reopen (and migrate) after the file is replaced. Must throw if the restored database cannot be opened. */
  reopen: () => void;
}

/**
 * Replace the live database with a validated backup. Order: validate -> pre-restore backup of what exists now -> close ->
 * swap the file -> reopen. If the swap or reopen fails, the pre-restore backup is put back and the error is reported.
 */
export function restoreBackup(opts: { db: Database.Database; liveFile: string; dir: string; name: string; known: Pick<MigrationFile, "version" | "checksum">[]; hooks: RestoreHooks; now?: Date }): { restored: string; preRestore: BackupInfo } {
  const src = safeBackupPath(opts.dir, opts.name);
  const check = validateBackupFile(src, opts.known);
  if (!check.ok) throw new LedgerError(`Cadangan tidak bisa dipulihkan: ${check.problems[0]}`);
  const pre = createBackup(opts.db, opts.dir, "pre-restore", opts.now);
  const preFile = path.join(opts.dir, pre.name);
  const swap = (from: string) => {
    const tmp = `${opts.liveFile}.restoring`;
    fs.copyFileSync(from, tmp);
    for (const s of ["-wal", "-shm"]) fs.rmSync(opts.liveFile + s, { force: true });
    fs.renameSync(tmp, opts.liveFile);
  };
  opts.hooks.close();
  try {
    swap(src);
    opts.hooks.reopen();
  } catch (e) {
    try { opts.hooks.close(); swap(preFile); opts.hooks.reopen(); } catch { /* the pre-restore backup file still exists on disk */ }
    throw new LedgerError(`Pemulihan gagal dan data semula dikembalikan. ${e instanceof Error ? e.message : ""}`.trim());
  }
  return { restored: opts.name, preRestore: pre };
}

export function deleteBackup(dir: string, name: string) {
  fs.rmSync(safeBackupPath(dir, name), { force: true });
}

/** All tables as JSON: a complete, readable export of every record (for archiving or moving data). */
export function exportAllData(db: Database.Database, meta: { appVersion: string; exportedOn: string }) {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  const data: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of tables) { data[t] = db.prepare(`SELECT * FROM "${t}"`).all(); counts[t] = data[t].length; }
  const version = (db.prepare("SELECT COALESCE(MAX(version),0) v FROM schema_migrations").get() as { v: number }).v;
  return { meta: { app: "Personal Finance OS", ...meta, schemaVersion: version, currency: "IDR", timezone: "Asia/Jakarta", tableCounts: counts }, tables: data };
}

export function lastBackupAt(dir: string): string | null {
  return listBackups(dir).find((b) => b.kind === "manual" || b.kind === "pre-restore")?.createdAt ?? null;
}
