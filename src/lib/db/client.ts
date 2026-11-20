import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { loadMigrations, migrate } from "./migrate";
import { seedDemo } from "./demo";

export type Profile = "personal" | "demo";

import { dataDir } from "./paths";
import { assertSession } from "../auth/guard";
import { quickHealth } from "./integrity";
const profileFile = () => path.join(dataDir(), "active-profile.json");
export const migrationsDir = () => path.join(process.cwd(), "src", "lib", "db", "migrations");

export function getActiveProfile(): Profile {
  try {
    const p = JSON.parse(fs.readFileSync(profileFile(), "utf8")).profile;
    return p === "demo" ? "demo" : "personal";
  } catch {
    return "personal";
  }
}

export function setActiveProfile(profile: Profile) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(profileFile(), JSON.stringify({ profile }));
}

export function dbPathFor(profile: Profile) {
  return path.join(dataDir(), profile === "demo" ? "demo.db" : "finance.db");
}

// Shared across module instances: Next.js can load this file separately for pages and server actions,
// and a per-module cache would leave one of them holding a stale handle after demo.db is rebuilt.
const g = globalThis as unknown as { __pfosDbCache?: Map<string, Database.Database> };
const cache: Map<string, Database.Database> = (g.__pfosDbCache ??= new Map());
/** Result of the quick self-check run when each database file was opened (null = healthy). */
const gh = globalThis as unknown as { __pfosHealth?: Map<string, string | null> };
const health: Map<string, string | null> = (gh.__pfosHealth ??= new Map());
export const getStartupHealth = (profile: Profile = getActiveProfile()): string | null => health.get(dbPathFor(profile)) ?? null;

export function openDatabase(file: string): Database.Database {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existed = fs.existsSync(file);
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db, loadMigrations(migrationsDir()), {
    backup: () => {
      if (!existed) return;
      db.pragma("wal_checkpoint(TRUNCATE)");
      const dir = path.join(dataDir(), "backups");
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.copyFileSync(file, path.join(dir, `${path.basename(file)}.pre-migration-${stamp}.bak`));
    },
  });
  return db;
}

/** Returns the database for the active profile (personal by default). Refuses (AuthError) while the app is locked. */
export function getDb(profile: Profile = getActiveProfile()): Database.Database {
  assertSession();
  return getRawDb(profile);
}

/** Unguarded access for lifecycle code only (health check, self-check). Never expose its data to a request without a session. */
export function getRawDb(profile: Profile = getActiveProfile()): Database.Database {
  const file = dbPathFor(profile);
  let db = cache.get(file);
  if (!db) {
    const isNewDemo = profile === "demo" && !fs.existsSync(file);
    db = openDatabase(file);
    if (isNewDemo) seedDemo(db);
    try { const problem = quickHealth(db); health.set(file, problem); if (problem) console.warn(`[pfos] self-check: ${problem}`); } catch (e) { health.set(file, `Pemeriksaan awal gagal: ${e instanceof Error ? e.message : "?"}`); }
    cache.set(file, db);
  }
  return db;
}

/** Delete and rebuild the fictional demo database. Safe: demo.db never holds personal data. */
export function resetDemoDatabase() {
  const file = dbPathFor("demo");
  const open = cache.get(file);
  if (open) {
    open.close();
    cache.delete(file);
  }
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
  getRawDb("demo");
}

/** Close and forget the open handle of a database file (used before a restore replaces it). */
export function closeDatabase(file: string) {
  const open = cache.get(file);
  if (open) {
    try { open.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* ignore */ }
    open.close();
    cache.delete(file);
  }
}
