import fs from "node:fs";
import { getDb, getActiveProfile, dbPathFor } from "./client";

export interface DbStatus {
  profile: "personal" | "demo";
  file: string;
  sizeBytes: number;
  schemaVersion: number;
  accounts: number;
  transactions: number;
}

export function getDbStatus(): DbStatus {
  const profile = getActiveProfile();
  const db = getDb(profile);
  const file = dbPathFor(profile);
  const v = db.prepare("SELECT COALESCE(MAX(version),0) AS v FROM schema_migrations").get() as { v: number };
  const a = db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE is_archived = 0").get() as { c: number };
  const t = db.prepare("SELECT COUNT(*) AS c FROM transactions WHERE status = 'posted'").get() as { c: number };
  return { profile, file, sizeBytes: fs.statSync(file).size, schemaVersion: v.v, accounts: a.c, transactions: t.c };
}
