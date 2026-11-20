import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { loadMigrations, migrate } from "./migrate";
import { seedDemo } from "./demo";

export type Profile = "personal" | "demo";

const dataDir = () => path.resolve(process.env.FINANCE_DATA_DIR ?? path.join(process.cwd(), "data"));
const profileFile = () => path.join(dataDir(), "active-profile.json");
const migrationsDir = () => path.join(process.cwd(), "src", "lib", "db", "migrations");

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

const cache = new Map<string, Database.Database>();

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

/** Returns the database for the active profile (personal by default). */
export function getDb(profile: Profile = getActiveProfile()): Database.Database {
  const file = dbPathFor(profile);
  let db = cache.get(file);
  if (!db) {
    const isNewDemo = profile === "demo" && !fs.existsSync(file);
    db = openDatabase(file);
    if (isNewDemo) seedDemo(db);
    cache.set(file, db);
  }
  return db;
}
