"use server";
import { revalidatePath } from "next/cache";
import { closeDatabase, dbPathFor, getActiveProfile, getDb, getRawDb, migrationsDir } from "@/lib/db/client";
import { loadMigrations } from "@/lib/db/migrate";
import { runIntegrityChecks, type IntegrityReport } from "@/lib/db/integrity";
import { backupDir } from "@/lib/db/paths";
import { createBackup, deleteBackup, restoreBackup, safeBackupPath, validateBackupFile, type BackupCheck } from "@/lib/backup/backup";
import { LedgerError } from "@/lib/ledger/errors";
import { done, fail, type ActionState } from "./shared";

const known = () => loadMigrations(migrationsDir());

/** Backups and restores only ever concern personal data, never the demo database. */
function requirePersonal() {
  if (getActiveProfile() !== "personal") throw new LedgerError("Cadangan hanya untuk data pribadi. Kembali ke data pribadi di Pengaturan terlebih dahulu.");
}

export async function createBackupAction(): Promise<ActionState & { name?: string }> {
  try {
    requirePersonal();
    const b = createBackup(getDb(), backupDir(), "manual");
    revalidatePath("/backup");
    return { ...done(), name: b.name };
  } catch (e) { return fail(e); }
}

export async function validateBackupAction(name: string): Promise<{ ok: boolean; message?: string; check?: BackupCheck }> {
  try {
    getDb(); // enforces the PIN gate
    const check = validateBackupFile(safeBackupPath(backupDir(), name), known());
    return { ok: true, check };
  } catch (e) { return { ok: false, message: fail(e).message }; }
}

export async function restoreBackupAction(name: string): Promise<ActionState & { preRestore?: string }> {
  try {
    requirePersonal();
    const db = getDb();
    const live = dbPathFor("personal");
    const r = restoreBackup({ db, liveFile: live, dir: backupDir(), name, known: known(), hooks: { close: () => closeDatabase(live), reopen: () => { getRawDb("personal"); } } });
    revalidatePath("/", "layout");
    return { ...done(), preRestore: r.preRestore.name };
  } catch (e) { return fail(e); }
}

export async function deleteBackupAction(name: string): Promise<ActionState> {
  try { getDb(); deleteBackup(backupDir(), name); revalidatePath("/backup"); return done(); } catch (e) { return fail(e); }
}

export async function runIntegrityAction(): Promise<{ ok: boolean; message?: string; report?: IntegrityReport }> {
  try { return { ok: true, report: runIntegrityChecks(getDb()) }; } catch (e) { return { ok: false, message: fail(e).message }; }
}
